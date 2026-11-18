// Stream-dance demo: the samba capture cut on its beat into two-beat blocks, per body part (legs: hips and legs;
// torso: spine, neck, head; arms: both arms and hands), and played back on a beat clock.
//
// The body keeps to the dance: block after block in the capture's own order, each part playing its own cut of that
// block (`legs@3`), so the joins are the capture's own and nothing is pieced together. Dancing is mostly not decided
// beat by beat; what the head decides is a change here and there. An edit names, for one block, an atom for one part
// (or two): {arms: 'arms5'}, size 0..1 for how big; the parts it leaves out go on with the dance. Atoms
// (scripts/samba_atoms.mjs → assets/samba_atoms.json) are the capture's phrases grouped by likeness, one block each.
// A part set to null goes back to rest. Edits are queued (push) or asked of a driver as each block starts.
//
// Everything is cut from the retargeted clip (clips.samba), so the chibi corrections (arms kept out of the dress,
// feet planted) are already in it. The hips keep their swivel but not the slow turning: she dances facing front.
import * as THREE from 'three';

const part = name => {
  const n = name.replace(/^mixamorig/, '');
  return /Shoulder|Arm|Hand/.test(n) ? 'arms' : /Spine|Neck|Head/.test(n) ? 'torso' : /Hips|Leg|Foot|Toe/.test(n) ? 'legs' : null;
};
// FADE: the shortest crossfade between blocks; it grows with the gap between the outgoing atom's last pose and the
// incoming one's first (a 15° gap over 0.12 s snapped the arms 40–60° in a frame). TAIL covers the longest fade.
const FADE = 0.12, FADE_MAX = 0.32, FADE_PER_DEG = 0.012, TAIL = 0.34, FPS = 30;
// the largest gap (mean degrees over a part's bones) an edit may open at either end
export const LIMIT = {legs: 15, torso: 10, arms: 22};
// Holds: the arms stop for a block or two in a clear pose of her own (the same poses her other moves use, solved for
// her body: beside the head, out wide, on the hips…) while the legs and body dance on. The pose is solved once, at
// rest, by the host (Mover.solvePose) and played like any atom: in and out of it the gap is eased out bone by bone,
// so nothing is solved on the way and no elbow can flip. The host sets the expression.
export const HOLDS = {
  up: {arms: {L: 'up', R: 'up'}, face: 'excited', cn: '双手举起'},
  open: {arms: {L: 'out', R: 'out'}, face: 'happy', cn: '张开双臂'},
  hips: {arms: {L: 'hips', R: 'hips'}, face: 'smug', cn: '叉腰'},
  chest: {arms: {L: 'chest', R: 'chest'}, face: 'excited', cn: '握拳胸前'},
};

export class Dancer {
  constructor({mixer, clip, lib, model, hips, hipsRest, rest, onHold = null, solveArms = null}) {
    this.onHold = onHold; this.holdLeft = 0; this.hold = null;
    this.mixer = mixer; this.lib = lib; this.bpm = lib.bpm; this.rest = rest;
    this.atoms = Object.fromEntries(lib.atoms.map(a => [a.id, a]));
    this.channels = Object.keys(lib.channels);
    // every block's own cut per part, besides the atoms
    this.n = lib.blocks.length;
    this.own = (ch, k) => `${ch}@${k}`;
    this.segs = {...this.atoms};
    for (let k = 0; k < this.n; k++) for (const ch of this.channels) this.segs[this.own(ch, k)] = {id: this.own(ch, k), channel: ch, src: lib.blocks[k], own: k};
    // the hips' frame in model space, to take the heading off their rotation
    const pm = model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hips.parent.getWorldQuaternion(new THREE.Quaternion()));
    const restInv = pm.clone().multiply(hipsRest).invert(), pmInv = pm.clone().invert();
    // The hips' heading (twist about the model's up) in radians. Samba swivels the hips 30–70° every beat, and that
    // swivel is the dance: only the slow turning is taken off (a straight ramp from the block's first heading to its
    // last), so every atom starts and ends facing front and joins on any other.
    const hm = new THREE.Quaternion(), d = new THREE.Quaternion(), tw = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
    this.heading = q => { hm.copy(pm).multiply(q); d.copy(hm).multiply(restInv); return 2 * Math.atan2(d.y, d.w); };
    this.turn = (q, a) => {
      hm.copy(pm).multiply(q); tw.setFromAxisAngle(UP, -a);
      return q.copy(pmInv).multiply(tw.multiply(hm));
    };
    // two copies of every atom's clip, so an atom can follow itself with a crossfade; and its still pose (the mean of
    // each bone over the atom), which `size` blends toward. Blending toward her rest pose instead flipped the hands:
    // the samba holds them 140–160° from her rest, so a part-weight slerp to rest jumped between the two short ways.
    const segs = Object.values(this.segs);
    this.clips = Object.fromEntries(segs.map(a => { const c = this.cut(clip, a); return [a.id, [c, c.clone()]]; }));
    this.stills = Object.fromEntries(segs.map(a => { const s = still(this.clips[a.id][0]); return [a.id, [s, s.clone()]]; }));
    // first and last pose of every cut (the channel's main bones), for how well one joins on another
    this.ends = Object.fromEntries(segs.map(a => {
      const names = new Set(lib.channels[a.channel].bones.map(b => `mixamorig${b}.quaternion`)), len = a.src[1] - a.src[0];
      const tr = this.clips[a.id][0].tracks.filter(t => names.has(t.name));
      const at = t => tr.map(x => new THREE.Quaternion().fromArray(x.createInterpolant().evaluate(t)));
      return [a.id, {first: at(0), last: at(len)}];
    }));
    this.holds = this.makeHolds(solveArms);
    // where the loop goes back to after the last block: the block the last one joins best (not the opening, which
    // starts slowly after a last phrase that winds the arms down: 34° on the arms, a stop and a stumble every round)
    const cost = (a, b) => this.channels.reduce((s, c) => s + this.gap(this.own(c, a), this.own(c, b)) / LIMIT[c], 0);
    // At least 8 blocks round (about 9 s): picked over all blocks, the best join was the block just before the last,
    // and from the second round on she danced the two closing phrases over and over.
    this.back = 1;
    for (let j = 1; j <= this.n - 8; j++) if (cost(this.n - 1, j) < cost(this.n - 1, this.back)) this.back = j;
    this.ch = Object.fromEntries(this.channels.map(c => [c, {id: null, actions: [], flip: 0, blend: null}]));
    this.queue = []; this.on = false; this.feed = null; this.log = [];
    // the bones each part moves, for the joins (after())
    const objs = new Map();
    for (const t of clip.tracks) {
      const [bone, prop] = t.name.split('.'), ch = part(bone), o = model.getObjectByName(bone);
      if (!ch || !o) continue;
      if (!objs.has(o)) objs.set(o, {o, ch, q: prop === 'quaternion', p: false});
      if (prop === 'position') objs.get(o).p = true;
    }
    this.bones = Object.fromEntries(this.channels.map(c => [c, [...objs.values()].filter(b => b.ch === c)]));
    this.last = new Map();   // each bone's pose as the dancer left it on the frame before
    this.hips = hips; this.feet = ['LeftFoot', 'RightFoot'].map(n => model.getObjectByName('mixamorig' + n)).filter(Boolean); this.floor = null;
    // joins: 'inertia' cuts to the new atom at full speed and fades out only the pose gap; 'crossfade' blends the two
    // atoms, which halves the motion while they disagree (legs ran a quarter slower around every join)
    this.join = 'inertia';
  }
  // each hold as a still clip of the arm bones (solve: {L, R} → local rotation per bone name, from the host)
  makeHolds(solve) {
    const out = {};
    if (!solve) return out;
    const names = this.lib.channels.arms.bones;
    for (const [id, h] of Object.entries(HOLDS)) {
      const pose = solve(h.arms), sid = `hold:${id}`, len = this.block + TAIL;
      const tracks = names.filter(n => pose[n]).map(n => { const v = pose[n].toArray(); return new THREE.QuaternionKeyframeTrack(`mixamorig${n}.quaternion`, [0, len], [...v, ...v]); });
      const c = new THREE.AnimationClip(`dance:${sid}`, len, tracks);
      this.segs[sid] = {id: sid, channel: 'arms', src: [0, this.block], hold: id};
      this.clips[sid] = [c, c.clone()];
      this.stills[sid] = [c.clone(), c.clone()];
      const first = names.map(n => pose[n]).filter(Boolean);
      this.ends[sid] = {first, last: first};
      out[id] = sid;
    }
    return out;
  }
  // The whole capture from the first block to the end of the last, with the same turning taken off as in the cuts
  // (per block, a straight ramp from its first heading to its last): the original dance facing front, to compare
  // against her side by side.
  front(clip) {
    const s0 = this.lib.blocks[0][0], s1 = this.lib.blocks[this.n - 1][1], len = s1 - s0, n = Math.round(len * FPS) + 1;
    const times = Float32Array.from({length: n}, (_, i) => i * len / (n - 1)), tracks = [];
    for (const t of clip.tracks) {
      const [bone, prop] = t.name.split('.'), size = t.getValueSize(), it = t.createInterpolant(), values = new Float32Array(n * size);
      const hips = prop === 'quaternion' && /Hips$/.test(bone), q = new THREE.Quaternion();
      const ramps = hips ? this.lib.blocks.map(([a, b]) => this.ramp(it, a, b)) : null;
      for (let i = 0; i < n; i++) {
        const tt = s0 + times[i], v = it.evaluate(tt);
        if (hips) {
          const k = Math.min(this.n - 1, this.lib.blocks.findIndex(([, b]) => tt < b) >>> 0), [h0, rate] = ramps[k];
          this.turn(q.fromArray(v), h0 + rate * (tt - this.lib.blocks[k][0])).toArray(values, i * size);
        } else values.set(v, i * size);
      }
      tracks.push(new (prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack)(t.name, times, values));
    }
    for (const t of tracks) if (t instanceof THREE.QuaternionKeyframeTrack) for (let i = 4; i < t.values.length; i += 4) {
      const v = t.values;
      if (v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1] < 0) for (let k = 0; k < 4; k++) v[i + k] = -v[i + k];
    }
    return new THREE.AnimationClip('sambaFront', len, tracks);
  }
  // the hips' heading at a block's start and its rate of turning over the block (unwrapped)
  ramp(it, s, e) {
    const q = new THREE.Quaternion(), unwrap = (prev, h) => h - 2 * Math.PI * Math.round((h - prev) / (2 * Math.PI));
    const h0 = this.heading(q.fromArray(it.evaluate(s)));
    let h = h0;
    for (let k = 1; k <= 60; k++) h = unwrap(h, this.heading(q.fromArray(it.evaluate(s + k * (e - s) / 60))));
    return [h0, (h - h0) / (e - s)];
  }
  cut(clip, a) {
    // a tail past the block's end: the outgoing atom keeps moving through the crossfade instead of freezing on its
    // last frame (a freeze slowed every join by a quarter)
    const [s, e] = a.src, len = e - s + TAIL, n = Math.round(len * FPS) + 1, times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = i * len / (n - 1);
    const tracks = [];
    for (const t of clip.tracks) {
      const [bone, prop] = t.name.split('.');
      if (part(bone) !== a.channel) continue;
      const size = t.getValueSize(), values = new Float32Array(n * size), it = t.createInterpolant(), q = new THREE.Quaternion();
      const hips = prop === 'quaternion' && /Hips$/.test(bone);
      let h0 = 0, rate = 0;
      if (hips) [h0, rate] = this.ramp(it, s, e);
      for (let i = 0; i < n; i++) {
        const v = it.evaluate(Math.min(s + times[i], clip.duration));
        if (hips) this.turn(q.fromArray(v), h0 + rate * times[i]).toArray(values, i * size);
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
    return new THREE.AnimationClip(`dance:${a.id}`, len, tracks);
  }
  get block() { return 2 * 60 / this.bpm; }
  // how far the end of cut a is from the start of cut b (mean degrees over the part's main bones)
  gap(a, b) {
    if (!a || !b) return 0;
    const x = this.ends[a].last, y = this.ends[b].first;
    return x.reduce((s, q, i) => s + 2 * Math.acos(Math.min(1, Math.abs(q.dot(y[i])))), 0) / x.length * 57.2958;
  }
  // the block the dance is at after this one
  after1(k) { return k + 1 < this.n ? k + 1 : this.back; }
  start(now, feed = null) {
    this.queue = []; this.feed = feed; this.on = true; this.next = now; this.count = 0; this.log = []; this.k = 0; this.events = []; this.blockAt = null; this.blockK = 0;
  }
  push(...blocks) { this.queue.push(...blocks); }
  stop(fade = 0.4) {
    if (!this.on) return;
    this.on = false; this.queue = []; this.feed = null; this.events = [];
    if (this.holdLeft) { this.holdLeft = 0; this.hold = null; this.onHold?.(null); }
    for (const c of Object.values(this.ch)) { for (const a of c.actions) a.fadeOut(fade); for (const a of c.dead ?? []) a.stop(); c.actions = []; c.dead = null; c.id = null; c.blend = null; c.size = null; c.resting = false; }
    this.last.clear();
  }
  update(now) {
    if (!this.on) return;
    if (now - this.next > 2 * this.block) this.next = now;   // a stalled tab: pick up from here, do not replay the backlog
    // blocks and beat events (holds by the beat) in time order; an event on a block's first beat only sets the hold,
    // the block's advance makes the cut
    for (;;) {
      const ev = this.events[0];
      if (ev && ev.at <= now && ev.at < this.next - 1e-4) { this.events.shift(); ev.fn(ev.at, now, false); continue; }
      if (now < this.next) break;
      while (this.events[0] && this.events[0].at < this.next + 1e-4) this.events.shift().fn(this.next, now, true);
      this.advance(this.next, now); this.next += this.block; this.count++;
    }
    // size eases toward the block's value (about 0.6 s): switched at the cut, a ×0.7 block dropped the legs and arms
    // to two thirds of their speed in one frame, and she seemed to stop for two beats
    const dt = this.sizeAt == null ? 0 : Math.max(0, now - this.sizeAt);
    this.sizeAt = now;
    for (const ch of this.channels) {
      const c = this.ch[ch];
      if (c.size == null || !c.actions.length) continue;
      c.size += (c.sizeGoal - c.size) * (1 - Math.exp(-dt / 0.2));
      if (!c.actions[0]._weightInterpolant) c.actions[0].setEffectiveWeight(c.size);
      if (c.actions[1] && !c.actions[1]._weightInterpolant) c.actions[1].setEffectiveWeight(1 - c.size);
    }
  }
  // after the mixer has posed the bones: the joins. On the first frame of a new atom the gap from the pose the dancer
  // left on the frame before is taken as an offset per bone (local rotation, hips position), then eased out (cubic),
  // so the new atom's own motion runs at full speed from the cut.
  after(now) {
    if (!this.on) return;
    const q = new THREE.Quaternion(), I = new THREE.Quaternion();
    for (const ch of this.channels) {
      const c = this.ch[ch], bl = c.blend, bones = this.bones[ch];
      if (bl) {
        // each bone eases its own gap out, longer for a bigger gap (0.12 s + 8 ms per degree, at most 0.7 s: a 30° gap over
        // 0.2 s still read as a jolt)
        if (!bl.off) {
          bl.start = now;
          bl.off = bones.map(b => {
            const old = this.last.get(b.o);
            if (!old) return null;
            const oq = b.o.quaternion.clone().invert().multiply(old.q), deg = 2 * Math.acos(Math.min(1, Math.abs(oq.w))) * 57.3;
            return {q: oq, p: old.p.clone().sub(b.o.position), dur: Math.min(0.7, 0.12 + deg * 0.008)};
          });
        }
        let done = true;
        bones.forEach((b, i) => {
          const off = bl.off[i];
          if (!off) return;
          const u = Math.min(1, (now - bl.start) / off.dur), w = (1 - u) ** 3 * (1 + 3 * u);   // eases out, flat at both ends
          if (u < 1) done = false;
          b.o.quaternion.multiply(q.copy(I).slerp(off.q, w));
          if (b.p) b.o.position.addScaledVector(off.p, w);
        });
        if (done) c.blend = null;
        // the hips' height and the legs' turns ease out on their own, and partway through a foot could sink 2 cm
        // into the floor (a stumble): while the legs are joining, the lower foot is kept on the floor she has been
        // dancing on (the lowest a foot came outside the joins)
        if (ch === 'legs' && this.floor != null) this.keepFeetUp();
      } else if (ch === 'legs') {
        const y = this.footY();
        this.floor = this.floor == null ? y : Math.min(this.floor, y);
      }
      for (const b of bones) {
        const r = this.last.get(b.o) ?? {q: new THREE.Quaternion(), p: new THREE.Vector3()};
        r.q.copy(b.o.quaternion); r.p.copy(b.o.position); this.last.set(b.o, r);
      }
    }
  }
  footY() {
    this.hips.updateMatrixWorld(true);
    return Math.min(...this.feet.map(f => f.getWorldPosition(new THREE.Vector3()).y));
  }
  keepFeetUp() {
    const lack = this.floor - this.footY();
    if (lack <= 0) return;
    const p = this.hips.parent, w = p.localToWorld(this.hips.position.clone());
    w.y += lack;
    this.hips.position.copy(p.worldToLocal(w));
    this.hips.updateMatrixWorld(true);
  }
  // switch part `ch` to cut `id` of a block that began at `at` (it may be partway through: a beat-timed hold ends on
  // the second beat of a block)
  cutTo(ch, id, at, now, size = 1) {
    const c = this.ch[ch];
    const copy = (c.flip ^= 1), gap = this.gap(c.id, id);
    const fade = c.actions.length ? THREE.MathUtils.clamp(FADE + gap * FADE_PER_DEG, FADE, FADE_MAX) : 0.3;
    const start = (clip, weight, fade) => {
      const act = this.mixer.clipAction(clip);
      act.reset(); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
      act.timeScale = (this.segs[id].src[1] - this.segs[id].src[0]) / this.block; act.time = (now - at) * act.timeScale;
      act.setEffectiveWeight(weight); act.play(); if (fade) act.fadeIn(fade);
      return act;
    };
    if (this.join === 'inertia' && (c.actions.length || c.resting)) {
      // cut over: the new atom plays at full weight from its first frame; after() carries the gap to the old pose
      // and lets it die away over `fade`
      // The old actions stay bound at weight 0 until the next block: stopping them released the bones' bindings, and
      // the mixer re-saved and wrote a wrong pose on the cut frame (forearms 100° off for one frame).
      for (const a of c.dead ?? []) a.stop();
      for (const a of c.actions) a.stopFading().setEffectiveWeight(0);
      c.dead = c.actions;
      c.blend = {start: null, off: null};
      const w = c.size ?? size;
      c.actions = [start(this.clips[id][copy], w, 0), start(this.stills[id][copy], 1 - w, 0)];
    } else {
      // the outgoing block fades out as the new one fades in: the weights always sum to one, never toward rest
      for (const a of c.actions) a.fadeOut(fade);
      const w = c.size ?? size;
      c.actions = [start(this.clips[id][copy], w, fade), start(this.stills[id][copy], 1 - w, fade)];
    }
    c.sizeGoal = size; c.size ??= size; c.resting = false; c.id = id;
  }
  get beat() { return this.block / 2; }
  // Hold by the beat: the arms go into hold `id` on the next beat and stay `beats` beats (Infinity: until released);
  // id null lets go on the next beat. Replaces any hold still to come. Returns when it starts (seconds from now).
  holdBeats(id, beats, now) {
    const b = this.beat, next = this.blockAt == null ? this.next : this.blockAt + Math.ceil((now - this.blockAt) / b - 1e-3) * b;
    this.events = [];
    this.holdLeft = 0;
    const set = (hold, cut) => (at, t, boundary) => {
      this.hold = hold; this.onHold?.(hold ? HOLDS[hold] : null);
      if (!boundary) this.cutTo('arms', hold ? this.holds[hold] : this.own('arms', this.blockK), this.blockAt, t);
      if (this.log[0]) this.log[0].hold = hold ?? this.log[0].hold;
      void cut;
    };
    if (id) {
      this.events.push({at: next, fn: set(id)});
      if (beats !== Infinity) this.events.push({at: next + Math.max(1, Math.round(beats)) * b, fn: set(null)});
    } else if (this.hold) this.events.push({at: next, fn: set(null)});
    return next - now;
  }
  advance(at, now) {
    const k = this.k, cmd = this.queue.shift() ?? this.feed?.(this, k) ?? {}, played = {};
    const size = THREE.MathUtils.clamp(cmd.size ?? 1, 0, 1);
    // a hold: the arms frozen in their pose for `blocks` blocks; when it runs out they go back to the dance's own block
    // blocks: Infinity holds until a {hold: null} comes (released at the start of the next block)
    if (HOLDS[cmd.hold]) { this.hold = cmd.hold; this.holdLeft = cmd.blocks === Infinity ? Infinity : Math.max(1, Math.round(cmd.blocks ?? 1)); this.onHold?.(HOLDS[cmd.hold]); }
    else if (cmd.hold === null && this.hold) { this.hold = null; this.holdLeft = 0; this.onHold?.(null); }
    else if (this.holdLeft > 0 && --this.holdLeft === 0) { this.hold = null; this.onHold?.(null); }
    if (this.hold) played.hold = this.hold;
    for (const ch of this.channels) {
      const c = this.ch[ch];
      const want = ch === 'arms' && this.hold ? this.holds[this.hold]
        : ch in cmd && (cmd[ch] === null || this.segs[cmd[ch]]) ? cmd[ch] : this.own(ch, k);
      if (want === null) {     // back to rest: like any join, the gap from the last pose eases out (a crossfade toward
        // rest flipped the hands, which the samba holds 140–160° from her rest: 59° in one frame)
        for (const a of c.dead ?? []) a.stop();
        for (const a of c.actions) a.stopFading().setEffectiveWeight(0);
        c.dead = c.actions; c.actions = []; c.id = null; c.size = null;
        c.blend = this.last.size ? {start: null, off: null} : null; c.resting = true; played[ch] = '—'; continue;
      }
      this.cutTo(ch, want, at, now, size);
      played[ch] = this.segs[want].own === k ? '原' : this.segs[want].hold ? '定格' : want;
    }
    this.blockK = k; this.blockAt = at;
    this.k = this.after1(k);
    this.log.unshift({n: this.count, k, ...played, size});
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

// Drivers: asked for the edit of each block as it starts (a stand-in for an agent's stream). null: no edits.
export const drivers = {
  // the dance as captured, block by block
  score: () => null,
  // one atom over and over, the other parts at rest
  solo: id => d => ({...Object.fromEntries(d.channels.map(c => [c, null])), [d.atoms[id].channel]: id}),
  // The dance goes on by itself; now and then the head changes something for a block or two, and the body carries on.
  // Two kinds: a hold (the arms stop in a pose, a cheer or hands on hips, while the legs dance on: plain to see), or
  // a part swapped for another phrase of the samba (an atom that joins on what is playing and back onto the dance's
  // next block within the limits; mostly the arms, the torso sometimes, the legs seldom: they carry her weight).
  // Never back to back. Taking the order apart (any phrase after any other) read as stumbling from block to block.
  improvise: ({rate = 0.35, holds = 0.6} = {}) => {
    let rest = 0;
    return (d, k) => {
      const rnd = n => Math.floor(Math.random() * n);
      if (rest > 0) { rest--; return {}; }
      if (d.holdLeft === Infinity) return {};   // held on your word: no edits of its own until you let go
      if (Math.random() > rate) return {};
      if (Math.random() < holds) {
        const ids = Object.keys(HOLDS), blocks = 1 + rnd(2);
        rest = blocks;
        return {hold: ids[rnd(ids.length)], blocks};
      }
      const r = Math.random(), ch = r < 0.6 ? 'arms' : r < 0.9 ? 'torso' : 'legs';
      const next = d.after1(k), from = d.ch[ch].id;
      const ok = d.lib.atoms.filter(a => a.channel === ch && !a.members.includes(k) &&
        d.gap(from, a.id) <= LIMIT[ch] && d.gap(a.id, d.own(ch, next)) <= LIMIT[ch]);
      if (!ok.length) return {};
      rest = 1;
      return {[ch]: ok[rnd(ok.length)].id};
    };
  },
};

// What you type to her while she dances, read by keywords (no model call, so it acts on the next block): a hold with
// an optional length in beats ("举手 3 拍"; also 块 = 2 beats, 秒, 一直), "放下"/"继续跳" to let go, "停", "跳". Returns
// {action: 'hold' | 'stop' | 'start', hold, beats, reply} or {reply} when nothing matched.
const WORDS = [
  ['up', /举手|举起|举高|手举|双手.*上|万岁|欢呼|举|抬手/],
  ['open', /张开|张臂|展开|抱抱|张手/],
  ['hips', /叉腰|插腰|掐腰/],
  ['chest', /握拳|胸前|加油|攥拳/],
];
const NUM = {一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10};
export function parseCommand(text, {defaultBeats = 6} = {}) {
  const t = text.trim();
  if (!t) return {reply: ''};
  if (/停|别跳|不跳|不要跳|休息|stop/i.test(t)) return {action: 'stop', reply: '好，停下来。'};
  if (/放下|松开|继续跳|接着跳|恢复|正常跳|手放/.test(t)) return {action: 'hold', hold: null, reply: '手放下，接着跳。'};
  const hit = WORDS.find(([, re]) => re.test(t));
  if (hit) {
    const [id] = hit;
    let beats = defaultBeats;
    if (/一直|保持|别放|不放|持续/.test(t)) beats = Infinity;
    else {
      const m = t.match(/(\d+|[一两二三四五六七八九十])\s*(拍|块|下|秒)/);
      if (m) {
        const n = /\d/.test(m[1]) ? +m[1] : NUM[m[1]];
        beats = m[2] === '秒' ? Math.max(1, Math.round(n / 0.574)) : m[2] === '块' ? n * 2 : n;   // 下 counts as a beat
      }
    }
    const len = beats === Infinity ? '一直保持，说「放下」再放' : `${beats} 拍（约 ${(beats * 0.574).toFixed(1)} 秒）`;
    return {action: 'hold', hold: id, beats, reply: `${HOLDS[id].cn}，${len}。`};
  }
  if (/跳|开始|动起来|dance|^来/i.test(t)) return {action: 'start', reply: '开始跳！'};
  return {reply: '没听懂。可以说：举手 / 张开手 / 叉腰 / 握拳，加上「4 拍」「3 块」「一直」；或者「放下」「停」「跳」。'};
}
