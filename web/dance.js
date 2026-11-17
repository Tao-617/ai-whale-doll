// Stream-dance demo: the samba capture cut into atoms (scripts/samba_atoms.mjs → assets/samba_atoms.json) and played
// back per body part on a beat clock, a block (two beats) at a time, from a queue that a driver fills as it goes.
//
// An atom is one body part (legs: hips and legs; torso: spine, neck, head; arms: both arms and hands) over one block of
// the original dance. A block command names an atom per part: {legs: 'legs3', arms: 'arms5', torso: 'torso3', size: 0.8}.
// A part left out keeps its groove (the atom that joins on most smoothly); a part set to null goes back to rest.
// size (0..1) is the weight of the block: how far from rest it dances. The queue may run ahead; when it runs dry the
// groove carries on, so a driver that is late never freezes her.
//
// The atoms are cut from the retargeted clip (clips.samba), so the chibi corrections (arms kept out of the dress, feet
// planted) are already in them. The hips lose their heading: every atom dances facing front, whichever way the
// original turned at that moment.
import * as THREE from 'three';

const part = name => {
  const n = name.replace(/^mixamorig/, '');
  return /Shoulder|Arm|Hand/.test(n) ? 'arms' : /Spine|Neck|Head/.test(n) ? 'torso' : /Hips|Leg|Foot|Toe/.test(n) ? 'legs' : null;
};
const FADE = 0.12, FPS = 30;

export class Dancer {
  constructor({mixer, clip, lib, model, hips, hipsRest, rest}) {
    this.mixer = mixer; this.lib = lib; this.bpm = lib.bpm; this.rest = rest;
    this.atoms = Object.fromEntries(lib.atoms.map(a => [a.id, a]));
    this.channels = Object.keys(lib.channels);
    // the hips' frame in model space, to take the heading off their rotation
    const pm = model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hips.parent.getWorldQuaternion(new THREE.Quaternion()));
    const restInv = pm.clone().multiply(hipsRest).invert(), pmInv = pm.clone().invert();
    const hm = new THREE.Quaternion(), d = new THREE.Quaternion(), tw = new THREE.Quaternion();
    this.face = q => {
      hm.copy(pm).multiply(q); d.copy(hm).multiply(restInv);
      tw.set(0, d.y, 0, d.w);
      if (tw.lengthSq() < 1e-10) return q;
      tw.normalize().invert();
      return q.copy(pmInv).multiply(tw.multiply(hm));
    };
    // two copies of every atom's clip, so an atom can follow itself with a crossfade; and its still pose (the mean of
    // each bone over the atom), which `size` blends toward. Blending toward her rest pose instead flipped the hands:
    // the samba holds them 140–160° from her rest, so a part-weight slerp to rest jumped between the two short ways.
    this.clips = Object.fromEntries(lib.atoms.map(a => { const c = this.cut(clip, a); return [a.id, [c, c.clone()]]; }));
    this.stills = Object.fromEntries(lib.atoms.map(a => { const s = still(this.clips[a.id][0]); return [a.id, [s, s.clone()]]; }));
    this.ch = Object.fromEntries(this.channels.map(c => [c, {id: null, actions: [], flip: 0}]));
    this.queue = []; this.on = false; this.feed = null; this.log = [];
  }
  cut(clip, a) {
    const [s, e] = a.src, n = Math.round((e - s) * FPS) + 1, times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = i * (e - s) / (n - 1);
    const tracks = [];
    for (const t of clip.tracks) {
      const [bone, prop] = t.name.split('.');
      if (part(bone) !== a.channel) continue;
      const size = t.getValueSize(), values = new Float32Array(n * size), it = t.createInterpolant(), q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        const v = it.evaluate(s + times[i]);
        if (prop === 'quaternion' && /Hips$/.test(bone)) this.face(q.fromArray(v)).toArray(values, i * size);
        else values.set(v, i * size);
      }
      const T = prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new T(t.name, times, values));
    }
    // keep successive keys on one hemisphere after the heading came off
    for (const t of tracks) if (t instanceof THREE.QuaternionKeyframeTrack) for (let i = 4; i < t.values.length; i += 4) {
      const v = t.values;
      if (v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1] < 0) for (let k = 0; k < 4; k++) v[i + k] = -v[i + k];
    }
    return new THREE.AnimationClip(`dance:${a.id}`, e - s, tracks);
  }
  get block() { return 2 * 60 / this.bpm; }
  start(now, feed = null) {
    this.queue = []; this.feed = feed; this.on = true; this.next = now; this.count = 0; this.log = [];
  }
  push(...blocks) { this.queue.push(...blocks); }
  stop(fade = 0.4) {
    if (!this.on) return;
    this.on = false; this.queue = []; this.feed = null;
    for (const c of Object.values(this.ch)) { for (const a of c.actions) a.fadeOut(fade); c.actions = []; c.id = null; }
  }
  // the atom that joins on most smoothly after the current one (the most common atom to begin with)
  groove(ch) {
    const cur = this.ch[ch].id, list = this.lib.atoms.filter(a => a.channel === ch);
    if (!cur) return list.reduce((b, a) => (a.members.length > b.members.length ? a : b)).id;
    return Object.entries(this.atoms[cur].next).sort((x, y) => x[1] - y[1])[0][0];
  }
  update(now) {
    if (!this.on) return;
    // the driver keeps two blocks ahead
    while (this.feed && this.queue.length < 2) { const b = this.feed(this); if (!b) break; this.queue.push(b); }
    if (now - this.next > 2 * this.block) this.next = now;   // a stalled tab: pick up from here, do not replay the backlog
    while (now >= this.next) { this.advance(this.next, now); this.next += this.block; this.count++; }
  }
  advance(at, now) {
    const cmd = this.queue.shift() ?? {}, played = {}, size = THREE.MathUtils.clamp(cmd.size ?? 1, 0, 1);
    for (const ch of this.channels) {
      const c = this.ch[ch], want = cmd[ch];
      if (want === null || (want && !this.atoms[want])) {     // back to rest
        for (const a of c.actions) a.fadeOut(FADE * 2);
        c.actions = []; c.id = null; played[ch] = '—'; continue;
      }
      const id = want ?? this.groove(ch), k = (c.flip ^= 1), fade = c.actions.length ? FADE : 0.3;
      const start = (clip, weight) => {
        const act = this.mixer.clipAction(clip);
        act.reset(); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
        act.timeScale = clip.duration / this.block; act.time = (now - at) * act.timeScale;
        act.setEffectiveWeight(weight); act.play(); act.fadeIn(fade);
        return act;
      };
      // the outgoing block fades out as the new one fades in: the weights always sum to one, never toward rest
      for (const a of c.actions) a.fadeOut(fade);
      c.actions = [start(this.clips[id][k], size)];
      if (size < 1) c.actions.push(start(this.stills[id][k], 1 - size));
      c.id = id; played[ch] = want ? id : `${id}*`;
    }
    this.log.unshift({n: this.count, ...played, size});
    this.log.length = Math.min(this.log.length, 8);
  }
}

// a clip holding each bone at its mean over `clip` (sign-aligned quaternion average, mean position)
function still(clip) {
  const tracks = clip.tracks.map(t => {
    const w = t.getValueSize(), v = t.values, n = v.length / w, m = new Float32Array(w);
    for (let i = 0; i < n; i++) {
      const s = w === 4 && i > 0 && v[i * 4] * v[0] + v[i * 4 + 1] * v[1] + v[i * 4 + 2] * v[2] + v[i * 4 + 3] * v[3] < 0 ? -1 : 1;
      for (let k = 0; k < w; k++) m[k] += s * v[i * w + k] / n;
    }
    if (w === 4) { const l = Math.hypot(...m); for (let k = 0; k < 4; k++) m[k] /= l; }
    return new t.constructor(t.name, [0, clip.duration], [...m, ...m]);
  });
  return new THREE.AnimationClip(clip.name + ':still', clip.duration, tracks);
}

// Drivers: functions that return the next block when the queue runs short (a stand-in for an agent's stream).
export const drivers = {
  // the original dance, rebuilt from its atoms (and round again)
  score: lib => {
    let i = 0;
    return () => { const k = i++ % lib.blocks.length; return Object.fromEntries(Object.keys(lib.score).map(c => [c, lib.score[c][k]])); };
  },
  // one atom over and over, the other parts at rest
  solo: id => d => ({...Object.fromEntries(d.channels.map(c => [c, null])), [d.atoms[id].channel]: id}),
  // improvising: per part, any atom whose start is close to where the last one ended; a new size now and then
  improvise: () => d => {
    const LIMIT = {legs: 15, torso: 10, arms: 22}, last = {};
    for (const ch of d.channels) last[ch] = [...d.queue].reverse().find(b => b[ch])?.[ch] ?? d.ch[ch].id;
    const b = {};
    for (const ch of d.channels) {
      const from = last[ch] && d.atoms[last[ch]];
      const ok = d.lib.atoms.filter(a => a.channel === ch && (!from || from.next[a.id] <= LIMIT[ch]) && a.id !== last[ch]);
      const pool = ok.length ? ok : d.lib.atoms.filter(a => a.channel === ch);
      b[ch] = pool[Math.floor(Math.random() * pool.length)].id;
    }
    b.size = Math.random() < 0.2 ? 0.6 : 1;
    return b;
  },
};
