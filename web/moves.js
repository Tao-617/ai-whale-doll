// Procedural moves: short beat-by-beat body performances (wave, clap, cover mouth and giggle, stomp…) layered on top of
// whatever the body is doing (rest pose, a Mixamo clip, idle breathing). The library is web/assets/moves.json, built by
// scripts/build_moves.mjs from docs/motions/move-specs.md (43 moves, most read off the 小鲸 videos); TICS below are the small
// idle habits from the same doc; VARIANTS maps an expression to 2–4 moves.
//
// spec: {id, cn, aka, mood, emotions: {dim: '>0.5' | '<0.4' | '0.2..0.6'}, repeat: 0 | N | 'loop', steps}
// step: {t (seconds from the start), body: {up, lean, side, twist}, head: {pitch, roll, yaw}, arms: {L, R} | {both},
//        osc: [{do, size, hz}], jump, stomp: 'L' | 'R', spin: {yaw}, tail: {wag, hz}, ears, face, look, blink}
//   Fields left out keep the previous step's value (osc: [] stops the oscillations); jump, stomp, spin and blink act once.
//   After the last step everything returns to rest. up −1..1 (crouch .. tiptoe); angles in degrees: lean + forward,
//   side + toward her right, twist + turning to her left; head pitch + down, roll + her right ear down, yaw + to her
//   left. Arm poses: see ARM. repeat N plays the middle steps (or, when the last step only marks the end, the whole
//   sequence) N times, at most ~6 s; 'loop' holds the last step until stopped (at most 12 s).
//
// Animation principles added here, after pet-loop-share (src/alive/motion.ts) and the videos (docs/motions/), so
// specs need not spell them out: the eyes lead (look at once, head 0.1 s later, body another 0.1 s); the arms do not
// move in unison (the second one 70 ms after the first); every channel is a slightly underdamped spring, so it
// overshoots a little and settles; a big lean or turn first swings 20% the other way; a jump crouches first and lands
// soft; at the end the arms come down 0.5 s after the rest; the feet stay planted while the body crouches, leans or
// wiggles (two-bone IK), and the hands go where they are told (IK).
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const UP = V(0, 1, 0), RIGHT = V(1, 0, 0), FWD = V(0, 0, 1);

// Arm poses, by meaning; the numbers that depend on her shape are measured (surface.js: the head, torso and dress as
// shells, the fist as a ball, the eyes and mouth as landmarks), so a pose is "the fist rests on the cheek", wherever
// this model's cheek is. What the IK moves is the centre of her mitten fist (the hand joint lies past the fist's tip).
//   face: [across, down]   on the face: across in half eye-spacings from the midline toward the hand's own side, down
//                          in eye-to-mouth heights below the eye line (mouth = 1, chin ≈ 1.6)
//   ball: [x, y, z]        on the head, in this direction from its centre
//   torso | skirt: [azimuth°, height 0..1]   on the chest column or the dress (0° ahead, + toward the hand's own side)
//   dir: [x, y, z], ext    free: this direction from the shoulder (x toward the hand's own side), at ext × arm length
//   gap: distance of the fist's centre from the surface in fist radii (1 = just touching); R / L: overrides per side
//   pole: where the elbow points (chest frame, x toward the hand's own side); osc: [x, y, z, hz] a small beat on top
export const ARM = {
  mouth: {face: [0.45, 1.05], pole: [1, -1.2, 0]},                 // hands over the mouth
  cheeks: {face: [1.45, 0.85], pole: [1, -1.5, 0]},                // fists on the cheeks
  cheek_rest: {face: [1.35, 1.2], gap: 0.95, pole: [0.35, -1.5, 0.2]}, // lower cheeks supported by the palms, elbows tucked down
  chin: {face: [0.3, 1.38], pole: [1, -1, 0]},                     // thinking
  eyes: {face: [1.0, 0.25], gap: 0.9, pole: [1, -1, 0]},           // rubbing the eyes
  clasp: {face: [0.3, 1.45], gap: 1.9, pole: [1, -1.2, 0]},        // hands together under the chin
  head: {face: [1.85, -0.15], pole: [1, -0.6, -0.3]},              // holding her head (she cannot reach the top)
  chest: {torso: [24, 0.6], pole: [1, -1, 0]},                     // fists at the chest
  hug: {torso: [-40, 0.62], R: {torso: [-40, 0.4]}, gap: 1.2, pole: [1, -1, 0.3]},   // self-hug, one arm over the other
  hips: {skirt: [80, 0.97], pole: [1, 0.3, -0.8]},                 // hands on hips
  behind: {skirt: [150, 0.85], pole: [1, -0.3, -0.5]},
  front: {skirt: [8, 0.72], pole: [1, -0.6, -0.3]},                // hands together on the apron (maid stance)
  skirt: {skirt: [62, 0.5], gap: 0.8, pole: [1, -0.2, -0.6]},      // holding the dress out at the sides (curtsy)
  up: {dir: [0.74, 0.62, 0.32], ext: 0.98, pole: [1, -0.5, -0.2]},  // raised, beside the head
  cheer: {dir: [0.6, 0.72, 0.4], ext: 0.95, pole: [1, -0.5, 0], osc: [0, 0.03, 0, 2.2]},
  wave: {dir: [0.7, 0.42, 0.62], ext: 0.95, pole: [1, -1, 0], osc: [0.05, 0, 0, 2.6]},
  fist: {dir: [0.5, 0.25, 0.85], ext: 0.8, pole: [1, -1, 0], osc: [0, 0.035, 0, 3.2]},   // fist pump
  out: {dir: [0.9, -0.05, 0.45], ext: 0.96, pole: [0, -1, -0.5]},  // open arms
  reach: {dir: [0.35, 0.12, 0.93], ext: 0.97, pole: [1, -1, 0]},   // reaching to the viewer (hug me)
  point: {dir: [0.38, 0.02, 0.92], ext: 0.985, pole: [1, -1, 0]},
  clap: {dir: [-0.02, -0.05, 1], ext: 0.72, pole: [1, -1, 0], osc: [0.03, 0, 0, 3.5], clap: true},
  stiff: {dir: [0.6, -0.78, 0.12], ext: 0.985, pole: [0, 0, -1]},  // arms rigid, spread down
  claw: {dir: [0.72, 0.42, 0.56], ext: 0.85, pole: [1, -0.4, -0.3]},   // ghost "boo"
  down: null,
};
const LOOK = {you: [0, 0], away: [0.75, -0.05], down: [0, -0.7], up: [0, 0.7], side: [-0.65, 0]};
const ONCE = new Set(['t', 'jump', 'stomp', 'spin', 'blink']);

// second-order follower: t90 seconds, damping ratio z (< 1 overshoots)
class Spring {
  constructor(x = 0, t90 = 0.3, z = 0.65) { this.x = x; this.v = 0; this.target = x; this.t90 = t90; this.z = z; }
  step(h) {
    const w = 3.89 / this.t90;
    this.v += (w * w * (this.target - this.x) - 2 * this.z * w * this.v) * h;
    this.x += this.v * h;
  }
}
class Spring3 {
  constructor(t90, z) { this.c = [0, 1, 2].map(() => new Spring(0, t90, z)); }
  set(v) { this.c.forEach((s, i) => { s.target = v.getComponent(i); }); }
  jump(v) { this.c.forEach((s, i) => { s.x = s.target = v.getComponent(i); s.v = 0; }); }
  step(h) { for (const s of this.c) s.step(h); }
  get() { return V(this.c[0].x, this.c[1].x, this.c[2].x); }
}

const wq = o => o.getWorldQuaternion(new THREE.Quaternion());
const wp = o => o.getWorldPosition(new THREE.Vector3());
// rotate a bone about a world axis through its own pivot, by `angle` (radians)
export function turnWorld(bone, axis, angle) {
  if (!angle) return;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  bone.quaternion.copy(wq(bone.parent).invert().multiply(q.multiply(wq(bone))));
  bone.updateMatrixWorld(true);
}
// turn a bone so the direction from it to `child` points along `dir` (world), by fraction w
function aim(bone, child, dir, w = 1) {
  const cur = wp(child).sub(wp(bone)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
  if (w < 1) q.slerp(new THREE.Quaternion(), 1 - w);
  bone.quaternion.copy(wq(bone.parent).invert().multiply(q.multiply(wq(bone))));
  bone.updateMatrixWorld(true);
}
// turn a bone so the point `local` riding on it lies along `dir` (world) from the bone, by fraction w
function aimAt(bone, local, dir, w = 1) {
  const cur = bone.localToWorld(local.clone()).sub(wp(bone)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
  if (w < 1) q.slerp(new THREE.Quaternion(), 1 - w);
  bone.quaternion.copy(wq(bone.parent).invert().multiply(q.multiply(wq(bone))));
  bone.updateMatrixWorld(true);
}
// two-bone IK: root → mid → end reaching `target`, the middle joint bending toward `pole` (world direction)
export function twoBone(root, mid, end, target, pole, w = 1) {
  const S = wp(root), a = wp(mid).distanceTo(S), b = wp(end).distanceTo(wp(mid));
  const toT = target.clone().sub(S);
  const D = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const d = toT.normalize();
  const n = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d)));
  if (n.lengthSq() < 1e-8) n.set(0, -1, 0);
  n.normalize();
  const cosA = (a * a + D * D - b * b) / (2 * a * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const elbow = S.clone().addScaledVector(d, a * cosA).addScaledVector(n, a * sinA);
  aim(root, mid, elbow.clone().sub(S), w);
  aim(mid, end, S.clone().addScaledVector(d, D).sub(wp(mid)), w);
}

export class Mover {
  // B: bones by Mixamo name without the prefix ('Hips', 'LeftArm', …), all at rest when constructed
  // body (app.js, measured on the mesh at rest): {head, torso, skirt: Shell, fist: {L, R: {centre, radius}},
  // face: {eyeL, eyeR, mouth}: rest positions of the landmarks}
  constructor(B, body) {
    this.B = B;
    this.body = body;
    this.shells = [body.head, body.torso, body.skirt];
    this.headRest = wq(B.Head);
    this.chestRest = wq(B.Spine2);
    // the fist's centre rides on the forearm
    this.fist = {};
    for (const [side, S] of [['L', 'Left'], ['R', 'Right']])
      this.fist[side] = {local: B[S + 'ForeArm'].worldToLocal(body.fist[side].centre.clone()), radius: body.fist[side].radius};
    this.anchor = {};
    for (const [name, p] of Object.entries(ARM)) {
      if (!p) continue;
      this.anchor[name] = {};
      for (const side of ['L', 'R']) {
        const q = {...p, ...p[side]}, bone = B[q.face || q.ball ? 'Head' : q.torso ? 'Spine2' : q.skirt ? 'Hips' : q.on ?? 'Spine2'];
        this.anchor[name][side] = {bone, at: bone.worldToLocal(this.place(q, side))};
      }
    }
    const sp = (t90, z) => new Spring(0, t90, z);
    this.ch = {up: sp(0.3, 0.6), lean: sp(0.35, 0.6), side: sp(0.35, 0.6), twist: sp(0.4, 0.6),
      pitch: sp(0.25, 0.6), roll: sp(0.25, 0.6), yaw: sp(0.3, 0.65), ears: sp(0.3, 0.6), spin: sp(0.95, 0.9)};
    const arm = () => ({w: sp(0.22, 0.8), pos: new Spring3(0.24, 0.72), pose: null, swivel: 0, gswivel: 0});
    this.arm = {L: arm(), R: arm()};
    this.move = null;
    this.osc = [];
    this.jump = null;
    this.stomp = null;
    this.tail = null;
    this.look = null;
    this.pending = [];
  }
  // where a pose puts the fist's centre, at rest (world)
  place(p, side) {
    const {head, torso, skirt, face} = this.body, sx = side === 'L' ? 1 : -1, r = this.fist[side].radius * (p.gap ?? 1);
    const off = s => s.p.addScaledVector(s.n, r);
    if (p.face) {
      const mid = face.eyeL.clone().add(face.eyeR).multiplyScalar(0.5);
      const half = Math.abs(face.eyeL.x - face.eyeR.x) / 2, unit = mid.y - face.mouth.y;
      return off(head.front(mid.x + sx * p.face[0] * half, mid.y - p.face[1] * unit));
    }
    if (p.ball) return off(head.surface(head.centre.clone().add(V(sx * p.ball[0], p.ball[1], p.ball[2]))));
    if (p.torso) return off(torso.around(sx * p.torso[0] * DEG, p.torso[1]));
    if (p.skirt) return off(skirt.around(sx * p.skirt[0] * DEG, p.skirt[1]));
    const S = side === 'L' ? 'Left' : 'Right', sh = wp(this.B[S + 'Arm']), el = wp(this.B[S + 'ForeArm']);
    const reach = el.distanceTo(sh) + this.body.fist[side].centre.distanceTo(el);
    // measured from the root of the collar bone, with the collar's length added: a free gesture is made with the whole
    // shoulder, and from the sleeve cap alone her short arm would wave at chest height
    const C = wp(this.B[S + 'Shoulder']);
    return C.addScaledVector(V(sx * p.dir[0], p.dir[1], p.dir[2]).normalize(), (reach + 0.85 * sh.distanceTo(C)) * p.ext);
  }
  get busy() { return !!this.move; }
  get playing() { return this.move?.spec.id ?? null; }
  // endFace: expression to return to when the move ends (the one that triggered it); default: neutral after a beat
  play(spec, now, face, endFace = null) {
    const steps = spec.steps, last = steps[steps.length - 1];
    const bare = Object.keys(last).every(k => k === 't');
    const end = last.t + 0.5;
    const reps = spec.repeat === 'loop' ? 1 : Math.max(1, spec.repeat ?? 1);
    // repeat the middle (or the whole sequence when the last step only marks the end), within ~6 s
    const seg = bare ? [0, steps.length - 1] : [1, steps.length - 1];
    const segLen = bare ? last.t : (steps[seg[1]].t - steps[seg[0]]?.t || 0);
    const n = segLen > 0 ? Math.max(1, Math.min(reps, Math.floor(6 / segLen))) : 1;
    const timeline = [];
    let shift = 0;
    for (let i = 0; i < steps.length; i++) {
      if (i === seg[1] && n > 1) {
        for (let r = 1; r < n; r++) {
          shift += segLen;
          for (let j = seg[0]; j < seg[1]; j++) timeline.push({...steps[j], t: steps[j].t + shift});
        }
      }
      timeline.push({...steps[i], t: steps[i].t + shift});
    }
    this.move = {spec, t0: now, timeline, next: 0, end: (bare ? last.t : end) + shift + (bare ? 0.4 : 0),
      loop: spec.repeat === 'loop', state: {}, endFace};
    this.face = face;
  }
  stop(now = this.now ?? 0) {
    if (!this.move) return;
    const endFace = this.move.endFace;
    this.move = null;
    this.rest(now, endFace);
  }
  rest(now, endFace) {
    // everything back to rest; the arms follow 0.5 s later (they come down last)
    this.apply({t: 0, body: {}, head: {}, arms: {L: this.armNow('L'), R: this.armNow('R')}, osc: [], ears: 0, tail: null, look: null}, now);
    this.pending.push({at: now + 0.5, fn: () => { for (const a of Object.values(this.arm)) { a.pose = null; a.want = 'down'; a.w.target = 0; } }});
    if (this.face) this.face.set(endFace ?? 'neutral', 0, now + 0.2);
    // a turn ends facing the viewer: whole turns are dropped, the rest unwinds
    const sp = this.ch.spin, k = Math.round(sp.target / (2 * Math.PI)) * 2 * Math.PI;
    sp.x -= k; sp.target = 0;
  }
  armNow(side) { return this.arm[side].pose ?? 'down'; }

  // one step, merged over the previous ones
  apply(s, now) {
    const later = (dt, fn) => this.pending.push({at: now + dt, fn});
    const st = this.move ? this.move.state : {};
    for (const [k, v] of Object.entries(s)) {
      if (ONCE.has(k)) continue;
      if (k === 'body' || k === 'head') st[k] = {...st[k], ...v};
      else if (k === 'arms') {
        const a = {...(st.arms ?? {})};
        if (v.both) a.L = a.R = v.both;
        if (v.L) a.L = v.L;
        if (v.R) a.R = v.R;
        st.arms = a;
      } else st[k] = v;
    }
    if (s.face && this.face) this.face.set(s.face, 0, now, 1.4);
    if (s.blink && this.face) this.face.blinkStart = now;
    this.look = st.look ? LOOK[st.look] : null;
    const b = {...st.body}, h = {...st.head};
    // tipping the head back shows the underside of the chin, which Tripo never modelled (an open, jagged edge, and the
    // mouth sheet floats off the face): the head goes back at most 8°, head and body together at most 10°
    if (h.pitch < -8) h.pitch = -8;
    const back = Math.min(0, b.lean ?? 0) + Math.min(0, h.pitch ?? 0);
    if (back < -10) { const k = -10 / back; if (b.lean < 0) b.lean *= k; if (h.pitch < 0) h.pitch *= k; }
    const set = (k, v, delay) => {
      const c = this.ch[k], d = v - c.target;
      // anticipation: a big change swings a little the other way first
      if (Math.abs(d) > 15 * DEG) { later(delay, () => { c.target = c.target - 0.2 * d; }); later(delay + 0.1, () => { c.target = v; }); }
      else later(delay, () => { c.target = v; });
    };
    // the eyes lead: look now, head 0.1 s later, body 0.1 s after that
    set('pitch', (h.pitch ?? 0) * DEG, 0.1); set('roll', (h.roll ?? 0) * DEG, 0.1); set('yaw', (h.yaw ?? 0) * DEG, 0.1);
    set('lean', (b.lean ?? 0) * DEG, 0.2); set('side', (b.side ?? 0) * DEG, 0.2); set('twist', (b.twist ?? 0) * DEG, 0.2);
    later(0.2, () => { this.ch.up.target = THREE.MathUtils.clamp(b.up ?? 0, -1, 1); });
    this.ch.ears.target = st.ears ?? 0;
    if (s.spin?.yaw) later(0.15, () => { this.ch.spin.target += s.spin.yaw * DEG; });
    const arms = st.arms ?? {};
    let L = arms.L ?? 'down', R = arms.R ?? 'down';
    // a fist next to a pointing hand hangs at the side (the pump is for both hands up)
    if (L === 'fist' && R === 'point') L = 'down';
    if (R === 'fist' && L === 'point') R = 'down';
    const lead = s.arms?.R && !s.arms?.L ? 'R' : 'L';
    for (const [side, pose] of [['L', L], ['R', R]]) {
      if (this.arm[side].want === pose) continue;
      this.arm[side].want = pose;
      later(side === lead ? 0.12 : 0.19, () => {
        const a = this.arm[side];
        a.pose = ARM[pose] ? pose : null;
        a.w.target = a.pose ? 1 : 0;
      });
    }
    if (s.osc || !this.move) {
      // the ones playing fade out over 0.2 s instead of stopping dead in mid-swing (the hips jumped up to 14 mm and
      // the legs 10–30° in one frame at the end of every move with a bob, a sway or a bounce)
      for (const o of this.osc) o.t1 ??= now + 0.2;
      this.osc = [...this.osc.filter(o => o.t1 > now), ...(st.osc ?? []).map(o => ({...o, t0: now + 0.2}))];
    }
    if (s.jump) this.jump = {h: Math.min(s.jump, 1.5) * 0.07, t0: now, t: this.stepLen(s)};
    if (s.stomp) this.stomp = {side: s.stomp === 'L' ? 0 : 1, t0: now + 0.1};
    this.tail = st.tail ?? null;
  }
  stepLen(s) {
    const tl = this.move?.timeline ?? [], i = tl.indexOf(s);
    return i >= 0 && tl[i + 1] ? Math.max(0.2, tl[i + 1].t - s.t) : 0.5;
  }

  // after the clip and idle layers have posed the skeleton, before springs; returns extras for app.js
  update(dt, t, face) {
    this.now = t;
    const m = this.move;
    if (m) {
      const el = t - m.t0;
      while (m.next < m.timeline.length && m.timeline[m.next].t <= el) this.apply(m.timeline[m.next++], m.t0 + m.timeline[m.next - 1].t);
      if (m.next >= m.timeline.length && (m.loop ? el > 12 : el >= m.end)) this.stop(t);
    }
    this.pending = this.pending.filter(p => (p.at <= t ? (p.fn(), false) : true));
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const c of Object.values(this.ch)) c.step(h);
      for (const a of Object.values(this.arm)) { a.w.step(h); a.pos.step(h); }
    }
    // oscillations, faded in and out over 0.15 s
    const o = {bob: 0, shift: 0, lean: 0, side: 0, twist: 0, pitch: 0, roll: 0, yaw: 0, hipsRoll: 0};
    for (const k of this.osc) {
      const env = Math.min(1, Math.max(0, (t - k.t0) / 0.15)) * (k.t1 == null ? 1 : Math.min(1, Math.max(0, (k.t1 - t) / 0.2)));
      if (env <= 0) continue;
      const s = (k.size ?? 0.6) * env, ph = 2 * Math.PI * (k.hz ?? 2) * (t - k.t0), sn = Math.sin(ph);
      if (k.do === 'bob') o.bob += 0.012 * s * sn;
      else if (k.do === 'bounce') o.bob += 0.022 * s * Math.abs(Math.sin(ph / 2));
      // sway: the weight goes from foot to foot, the head follows a beat late and further
      else if (k.do === 'sway') { o.side += 8 * DEG * s * sn; o.roll += 7 * DEG * s * Math.sin(ph - 0.6); }
      else if (k.do === 'twist') o.twist += 14 * DEG * s * sn;
      else if (k.do === 'wiggle') { o.hipsRoll += 9 * DEG * s * sn; o.shift -= 0.012 * s * sn; }
      else if (k.do === 'nod') o.pitch += 13 * DEG * s * Math.max(0, sn);
      else if (k.do === 'shake') o.yaw += 22 * DEG * s * sn;
      else if (k.do === 'shiver') { o.side += 1.6 * DEG * s * Math.sin(ph * 7.3); o.twist += 1.6 * DEG * s * Math.sin(ph * 5.1); o.bob += 0.002 * s * Math.sin(ph * 9.7); }
      else if (k.do === 'circle') { o.side += 7 * DEG * s * sn; o.lean += 7 * DEG * s * Math.cos(ph); }
      else if (k.do === 'nuzzle') { o.yaw += 14 * DEG * s * sn; o.roll += 9 * DEG * s * sn; }      // rub the head into a hand
      else if (k.do === 'counter_roll') o.roll -= 9 * DEG * s * sn;                                 // head against the sway
      else if (k.do === 'rock') o.lean += 6 * DEG * s * sn;
    }
    const B = this.B, c = this.ch;
    const side = c.side.x + o.side, lean = c.lean.x + o.lean, psi = c.spin.x;
    const active = Math.abs(c.up.x) + Math.abs(lean) + Math.abs(side) + Math.abs(c.twist.x) + Math.abs(o.bob) + Math.abs(o.shift) +
      Math.abs(o.twist) + Math.abs(o.hipsRoll) + (this.jump || this.stomp ? 1 : 0) + Math.abs(psi) + Math.abs(c.spin.v) > 1e-4;
    // her own right and forward: the body's axes turn with her
    const heading = new THREE.Quaternion().setFromAxisAngle(UP, psi);
    const R = RIGHT.clone().applyQuaternion(heading), F = FWD.clone().applyQuaternion(heading);
    // feet where the lower layers put them, to keep them planted
    B.Hips.parent.updateMatrixWorld(true);
    B.Hips.updateMatrixWorld(true);
    const feet = active ? ['Left', 'Right'].map(s => wp(B[s + 'Foot'])) : null;
    // hips: crouch / tiptoe, bob, jump arc (crouch first, land soft), hips wiggle, whole-body turn
    let lift = c.up.x < 0 ? c.up.x * 0.045 : c.up.x * 0.012;
    lift += o.bob;
    // stomp: the body sinks into the impact
    if (this.stomp) {
      const u = (t - this.stomp.t0) / 0.3;
      if (u > 1.4) this.stomp = null;
      else if (u > 0.85) lift -= 0.012 * Math.sin(Math.PI * Math.min(1, (u - 0.85) / 0.55));
    }
    let air = 0;
    if (this.jump) {
      const u = (t - this.jump.t0) / this.jump.t;
      if (u < 0.25) lift -= 0.022 * Math.sin(Math.PI * u / 0.25 / 2);
      else if (u < 0.8) { const f = (u - 0.25) / 0.55; air = this.jump.h * 4 * f * (1 - f); lift -= 0.022 * Math.max(0, 1 - f * 4); }
      else if (u < 1) lift -= 0.018 * Math.sin(Math.PI * (u - 0.8) / 0.2);
      else this.jump = null;
    }
    // turning on the spot is a little hop: both feet go round with her instead of twisting the legs
    air += Math.min(0.022, Math.abs(c.spin.v) * 0.006);
    if (active) {
      const h0 = wp(B.Hips), H = h0.y - (feet[0].y + feet[1].y) / 2;
      // she rocks from the feet: leaning sideways carries the hips that way, leaning forward sends them back a little
      const hw = h0.clone().add(V(0, lift + air, 0)).addScaledVector(R, -Math.sin(side) * H * 0.5 + o.shift).addScaledVector(F, -Math.sin(lean) * H * 0.25);
      B.Hips.position.copy(B.Hips.parent.worldToLocal(hw));
      B.Hips.updateMatrixWorld(true);
      turnWorld(B.Hips, UP, psi);
      turnWorld(B.Hips, F, o.hipsRoll + 0.35 * side);      // the bell of the dress tips with the hips
      // the torso bends over three spine bones
      for (const n of ['Spine', 'Spine1', 'Spine2']) {
        turnWorld(B[n], R, lean / 3);
        turnWorld(B[n], F, 0.65 * side / 3);
        turnWorld(B[n], UP, (c.twist.x + o.twist) / 3);
      }
      // legs back onto the feet (carried round by a turn, lifted with the jump; heels up on tiptoe)
      const tip = Math.max(0, c.up.x) * 0.012;
      ['Left', 'Right'].forEach((s, i) => {
        const goal = feet[i].clone().sub(h0).applyQuaternion(heading).add(h0).add(V(0, air + tip, 0));
        goal.y = feet[i].y + air + tip;
        if (this.stomp && this.stomp.side === i) {
          const u = (t - this.stomp.t0) / 0.3;
          if (u >= 0 && u < 1) goal.y += u < 0.65 ? 0.03 * Math.sin(Math.PI / 2 * u / 0.65) : 0.03 * (1 - (u - 0.65) / 0.35) ** 2;
        }
        twoBone(B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot'], goal, F);
      });
    }
    // head and neck, about the chest's own axes
    const hp = c.pitch.x + o.pitch, hr = c.roll.x + o.roll, hy = c.yaw.x + o.yaw;
    if (Math.abs(hp) + Math.abs(hr) + Math.abs(hy) > 1e-5) {
      const turned = new THREE.Quaternion().setFromAxisAngle(UP, psi + c.twist.x + o.twist);
      const R2 = RIGHT.clone().applyQuaternion(turned), F2 = FWD.clone().applyQuaternion(turned);
      for (const [n, f] of [['Neck', 0.35], ['Head', 0.65]]) { turnWorld(B[n], R2, hp * f); turnWorld(B[n], F2, hr * f); turnWorld(B[n], UP, hy * f); }
    }
    this.keepFaceUp();
    this.arms(dt, t);
    return {ears: c.ears.x, tail: this.tail, look: this.look};
  }

  // Her face has to stay readable whatever the layers add up to (gaze, expression, move, body lean, a clip): the head's
  // own tilt in the world is eased into a range. Forward: bangs cover the eyes past ~20°; back: the open underside
  // of the chin shows; sideways: an ear lies on the shoulder.
  keepFaceUp() {
    // only while she is upright: lying down (a clip's fall) the head has no "level" to be held to, and the correction
    // spun it half a turn from one frame to the next. Fades out as the chest tips from 40° to 65°.
    const tip = UP.clone().applyQuaternion(wq(this.B.Spine2).multiply(this.chestRest.clone().invert())).angleTo(UP);
    const k = 1 - THREE.MathUtils.smoothstep(tip, 0.7, 1.13);
    if (k <= 0) return;
    const head = this.B.Head, soft = (x, knee, cap) => x <= knee ? x : knee + (cap - knee) * (1 - Math.exp(-(x - knee) / (cap - knee)));
    for (let pass = 0; pass < 2; pass++) {
      const rel = wq(head).multiply(this.headRest.clone().invert());
      const f = FWD.clone().applyQuaternion(rel), r = RIGHT.clone().applyQuaternion(rel);
      if (pass === 0) {
        const pitch = Math.asin(THREE.MathUtils.clamp(-f.y, -1, 1));
        const want = pitch > 0 ? soft(pitch, 10 * DEG, 19 * DEG) : -soft(-pitch, 6 * DEG, 10 * DEG);
        const axis = V(f.z, 0, -f.x);                  // level, across the way she faces
        if (Math.abs(want - pitch) > 1e-4 && axis.lengthSq() > 1e-6) turnWorld(head, axis.normalize(), (want - pitch) * k);
      } else {
        const roll = Math.asin(THREE.MathUtils.clamp(r.y, -1, 1)), want = Math.sign(roll) * soft(Math.abs(roll), 16 * DEG, 25 * DEG);
        if (Math.abs(want - roll) > 1e-4) turnWorld(head, f, (want - roll) * k);
      }
    }
  }

  // how far (in fist radii) an undriven fist keeps from a shell: the chest carries a bow, a brooch and ruffles that
  // stand off it, so a swinging fist passes a finger's width clear of the torso; it may brush the head and the dress
  clear(shell) { return shell === this.body.torso ? 1.35 : 0.9; }

  // Arms: each fist goes to its pose's anchor on the body, then the same rules for every pose and motion keep it
  // honest: a fist stays out of the head, the chest and the dress and off the other fist, and the elbow swings round
  // the shoulder-to-fist line as far as it must to keep the sleeve out of them.
  arms(dt, t, external = null) {
    const B = this.B, goals = {};
    for (const s of this.shells) s.sync();
    for (const side of ['L', 'R']) {
      if (external?.[side]) { goals[side] = external[side].target.clone(); continue; }
      const a = this.arm[side], w = a.w.x;
      if (a.pose) {
        const p = ARM[a.pose], an = this.anchor[a.pose][side];
        const tgt = an.bone.localToWorld(an.at.clone());
        if (p.osc) {
          const [ax, ay, az, hz] = p.osc, sn = Math.sin(2 * Math.PI * hz * t), sx = side === 'L' ? 1 : -1;
          tgt.add(V(ax * sx * (p.clap ? (sn + 1) / 2 : sn), ay * Math.max(0, sn), az * sn).applyQuaternion(wq(B.Spine2)));
        }
        if (a.lastPose !== a.pose && w < 0.05) a.pos.jump(tgt); else a.pos.set(tgt);
        a.lastPose = a.pose;
      }
      if (w > 0.01 && a.lastPose) goals[side] = a.pos.get();
    }
    // An arm no pose is driving (a clip's swing, the rest pose under a lean) answers to the same rules: when its fist,
    // elbow or sleeve is inside her, the fist is moved out and the arm solved again, bending the way it already bends.
    const guarded = {}, gGoals = {};
    for (const [side, S] of [['L', 'Left'], ['R', 'Right']]) {
      if ((external?.[side] || this.arm[side].w.x > 0.995) && goals[side]) continue;
      const a = this.arm[side], sh = wp(B[S + 'Arm']), E = wp(B[S + 'ForeArm']);
      const fc = B[S + 'ForeArm'].localToWorld(this.fist[side].local.clone());
      const inside = Math.max(...this.shells.map(s => Math.max(s.depth(fc, this.fist[side].radius * this.clear(s)), s.depth(E, 0.02),
        ...[0.25, 0.5, 0.75].map(f => s.depth(E.clone().lerp(fc, f), 0.026)))));
      // eased in over the last centimetre before contact, so the correction never pops
      a.guard = THREE.MathUtils.clamp((inside + 0.01) / 0.01, 0, 1);
      if (a.guard <= 0) { a.gswivel *= Math.exp(-dt * 10); continue; }
      gGoals[side] = fc;
      guarded[side] = E.sub(sh);
    }
    // two passes: first the undriven pose is made honest (the guard), then a pose places the arm on top of that by its
    // weight. So while a pose fades in or out the arm moves between two solved poses, and nothing switches on or off.
    const pass = (goals, guarded) => {
      // a fist can only be where the arm reaches and never inside her: pull it within reach, push it out, and again
      for (const [side, g] of Object.entries(goals)) {
        const S = side === 'L' ? 'Left' : 'Right', sh = wp(B[S + 'Arm']), el = wp(B[S + 'ForeArm']);
        const tip = !guarded[side] && external?.[side]?.tip || this.fist[side].local;
        const reach = (el.distanceTo(sh) + B[S + 'ForeArm'].localToWorld(tip.clone()).distanceTo(el)) * 0.99;
        for (let i = 0; i < 3; i++) {
          const d = g.clone().sub(sh);
          if (d.length() > reach) g.copy(sh).addScaledVector(d.normalize(), reach);
          for (const s of this.shells) s.push(g, !guarded[side] && external?.[side]?.radius != null ? external[side].radius : this.fist[side].radius * (guarded[side] ? this.clear(s) : 0.9));
        }
      }
      if (goals.L && goals.R) {
        const d = goals.L.clone().sub(goals.R), min = (this.fist.L.radius + this.fist.R.radius) * 0.95, len = d.length();
        if (len < min) {
          if (len < 1e-5) d.copy(RIGHT.clone().applyQuaternion(wq(B.Spine2))); else d.multiplyScalar(1 / len);
          goals.L.addScaledVector(d, (min - len) / 2); goals.R.addScaledVector(d, -(min - len) / 2);
        }
      }
      const [head, torso, skirt] = this.shells;
      for (const [side, goal] of Object.entries(goals)) {
        const a = this.arm[side], drive = external?.[side], p = guarded[side] ? null : ARM[a.lastPose], sw = guarded[side] ? 'gswivel' : drive ? 'cswivel' : 'swivel', sx = side === 'L' ? 1 : -1, S = side === 'L' ? 'Left' : 'Right';
        a[sw] ??= 0;
        const root = B[S + 'Arm'], mid = B[S + 'ForeArm'], fl = drive?.tip ?? this.fist[side].local;
        const sh = wp(root), la = wp(mid).distanceTo(sh), lb = mid.localToWorld(fl.clone()).distanceTo(wp(mid));
        const toT = goal.clone().sub(sh);
        const D = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-4, (la + lb) * 0.99);
        const d = toT.normalize(), P = sh.clone().addScaledVector(d, D);
        const pole = drive ? drive.pole.clone() : p ? V(p.pole[0] * sx, p.pole[1], p.pole[2]).applyQuaternion(wq(B.Spine2)) : guarded[side];
        // The elbow's side is the pole's part across the arm's line. It can turn over in one frame: when the line swings
        // past the pole (the part shrinks to nothing and comes back reversed), or when the pose changes to one whose
        // pole points the other way (fist pump → hands on hips: 138° on a forearm in 1/60 s). So the side the elbow is
        // on turns about the arm's line at no more than 500°/s from where it was.
        const n0 = pole.sub(d.clone().multiplyScalar(pole.dot(d))), key = guarded[side] ? 'gn' : drive ? 'cn' : 'n';
        if (n0.lengthSq() < 1e-8) n0.set(0, -1, 0);
        n0.normalize();
        const prev = a[key] && a[key + 'At'] > t - 0.1 ? a[key].clone().addScaledVector(d, -a[key].dot(d)) : null;
        if (prev && prev.lengthSq() > 1e-6) {
          prev.normalize();
          const ang = prev.angleTo(n0), max = 500 * DEG * dt;
          if (ang > max) {
            const sgn = d.dot(prev.clone().cross(n0)) < 0 ? -1 : 1;
            n0.copy(prev).applyAxisAngle(d, sgn * max);
          }
        }
        a[key] = n0.clone(); a[key + 'At'] = t;
        const cosA = (la * la + D * D - lb * lb) / (2 * la * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const elbow = th => sh.clone().addScaledVector(d, la * cosA).addScaledVector(n0.clone().applyAxisAngle(d, th), la * sinA);
        const cost = th => {
          const E = elbow(th), pos = x => Math.max(0, x);
          let k = pos(head.depth(E, 0.035)) + pos(torso.depth(E, 0.03)) + pos(skirt.depth(E, 0.02));
          for (const f of [0.25, 0.5, 0.75]) {       // along the sleeve
            const M = E.clone().lerp(P, f);
            k += (pos(head.depth(M, 0.03)) + pos(torso.depth(M, 0.028)) + pos(skirt.depth(M, 0.015))) / 2;
          }
          return k;
        };
        // the smallest swing that clears; staying where it is counts for a little, so it does not flicker
        let best = 0, bestCost = Infinity;
        for (const deg of [0, 15, -15, 30, -30, 45, -45, 60, -60, 80, -80]) {
          const th = deg * DEG, k = cost(th) + 0.0004 * Math.abs(deg) / 15 + 0.0003 * Math.min(1, Math.abs(th - a[sw]));
          if (k < bestCost - 1e-6) { bestCost = k; best = th; }
        }
        a[sw] += (best - a[sw]) * (1 - Math.exp(-dt * 10));
        const w = drive ? drive.weight : p ? Math.min(1, a.w.x) : a.guard;
        aim(root, mid, elbow(a[sw]).sub(sh), w);
        aimAt(mid, fl, P.sub(wp(mid)), w);
      }
    };
    pass(gGoals, guarded);
    for (const side of Object.keys(goals)) { const S = side === 'L' ? 'Left' : 'Right'; for (const n of ['Shoulder', 'Arm', 'ForeArm']) B[S + n].updateMatrixWorld(true); }
    // The collar bone: her arm from the sleeve cap is short, so like anyone's her shoulder comes up and forward for what
    // the arm alone cannot reach (a cheek, a wave overhead). The collar turns toward the goal by as much as the goal lies
    // beyond 80% of the arm's reach; the straps and ruffles on the shoulder are weighted to it and ride along.
    for (const [side, g] of Object.entries(goals)) {
      const S = side === 'L' ? 'Left' : 'Right', col = B[S + 'Shoulder'], C = wp(col), sh = wp(B[S + 'Arm']), el = wp(B[S + 'ForeArm']);
      const reach = el.distanceTo(sh) + B[S + 'ForeArm'].localToWorld((external?.[side]?.tip ?? this.fist[side].local).clone()).distanceTo(el);
      const need = THREE.MathUtils.clamp((g.distanceTo(sh) - 0.8 * reach) / (0.35 * reach), 0, 1);
      if (need <= 0) continue;
      // Only ever up: turning the collar toward a goal below the shoulder (hands on the skirt, a hug across the chest)
      // dropped the shoulder up to 31° and 4 cm, in more than half of all moves. The joint between neck and shoulder
      // holds; it rises at most 14° for what is above it.
      const c = sh.clone().sub(C).normalize(), to = g.clone().sub(C).normalize();
      const up = UP.clone().applyQuaternion(wq(B.Spine2).multiply(this.chestRest.clone().invert()));     // the chest's own up
      if (to.dot(up) <= c.dot(up)) continue;
      const ang = Math.min(c.angleTo(to), 14 * DEG) * need * need * (3 - 2 * need);
      const axis = c.clone().cross(to);
      if (axis.lengthSq() < 1e-10) continue;
      const nd = c.clone().applyAxisAngle(axis.normalize(), ang);
      // up, and forward or back only half as far
      const rise = Math.max(0, nd.dot(up) - c.dot(up));
      nd.sub(c).multiplyScalar(0.5).addScaledVector(up, rise - 0.5 * (nd.dot(up) + c.dot(up) * 0) * 0).add(c);
      const lack = c.dot(up) + rise - nd.dot(up);
      nd.addScaledVector(up, lack).normalize();
      aim(col, B[S + 'Arm'], nd, external?.[side]?.weight ?? Math.min(1, this.arm[side].w.x));
    }
    pass(goals, {});
  }
}

// idle habits (docs/motions/move-specs.md "闲时小动作"): small, no face change except a blink or a peek of a smile;
// played every 6–15 s while nothing else is going on
export const TICS = [
  {id: 'tic_tilt', steps: [{t: 0, look: 'side'}, {t: 0.1, head: {roll: 11}, blink: true}, {t: 1.5, look: 'you', head: {roll: 0}}, {t: 2}]},
  {id: 'tic_glance', steps: [{t: 0, look: 'away'}, {t: 0.1, head: {yaw: 18, roll: 3}, body: {twist: 5}}, {t: 1.2, look: 'you', head: {yaw: 0, roll: 0}, body: {twist: 0}}, {t: 2.2}]},
  {id: 'tic_counter_sway', steps: [{t: 0, osc: [{do: 'sway', size: 0.4, hz: 0.3}, {do: 'counter_roll', size: 0.55, hz: 0.3}], tail: {wag: 0.4, hz: 0.6}}, {t: 3.3, osc: []}, {t: 4}]},
  {id: 'tic_shrug_blink', steps: [{t: 0, body: {up: 0.8}, blink: true}, {t: 0.4, body: {up: 0}}, {t: 1.2}]},
  {id: 'tic_tail_flick', steps: [{t: 0, tail: {wag: 0.9, hz: 2.2}, look: 'side'}, {t: 0.2, head: {yaw: -12, roll: -4}}, {t: 1, tail: {wag: 0.3, hz: 1}, look: 'you', head: {yaw: 0, roll: 0}}, {t: 2}]},
  {id: 'tic_fidget_hands', steps: [{t: 0, arms: {both: 'front'}, look: 'down'}, {t: 0.4, osc: [{do: 'twist', size: 0.5, hz: 0.5}], look: 'you'}, {t: 2.4, osc: [], arms: {both: 'down'}}, {t: 2.8}]},
  {id: 'tic_tiptoe', steps: [{t: 0, body: {up: 1}}, {t: 0.3, body: {up: 0}}, {t: 0.6, body: {up: 1}}, {t: 0.9, body: {up: 0}}, {t: 1.6}]},
  {id: 'tic_breath_sigh', steps: [{t: 0, body: {up: 0.8}, head: {pitch: -4}}, {t: 1.2, body: {up: -0.3}, head: {pitch: 5}, blink: true}, {t: 2, body: {up: 0}, head: {pitch: 0}}, {t: 2.6}]},
  {id: 'tic_ear_twitch', steps: [{t: 0, ears: 1}, {t: 0.2, ears: -0.3, head: {roll: -5}}, {t: 0.4, ears: 1}, {t: 0.6, ears: 0}, {t: 1, head: {roll: 0}}, {t: 1.6}]},
  {id: 'tic_smile_peek', steps: [{t: 0, look: 'you', face: 'giggle', head: {roll: 7}, body: {up: 0.4}}, {t: 0.7, face: 'neutral', body: {up: 0}}, {t: 1.4, head: {roll: 0}}, {t: 2}]},
  {id: 'tic_hands_behind', steps: [{t: 0, arms: {both: 'behind'}, body: {up: 0.6}, head: {roll: -6}}, {t: 0.4, osc: [{do: 'sway', size: 0.45, hz: 0.5}]}, {t: 2.4, osc: [], arms: {both: 'down'}, body: {up: 0}, head: {roll: 0}}, {t: 2.9}]},
  {id: 'tic_look_down_skirt', steps: [{t: 0, look: 'down', head: {pitch: 9}}, {t: 0.3, arms: {both: 'skirt'}}, {t: 0.8, osc: [{do: 'twist', size: 0.4, hz: 1}]}, {t: 1.8, osc: [], arms: {both: 'down'}, look: 'you', head: {pitch: 0, roll: 5}, face: 'smile'}, {t: 2.4, head: {roll: 0}, face: 'neutral'}, {t: 2.8}]},
];

// expression → moves, the first is the default (docs/motions/move-specs.md "表情 → 动作变体")
export const VARIANTS = {
  content: ['pat_melt', 'hug_sway', 'nibble'], bliss: ['nuzzle', 'cheek_hold', 'pat_melt'],
  smile: ['maid_sway', 'head_tilt', 'wave', 'curtsy'], happy: ['hug_sway', 'clap', 'hope_hop', 'twirl'],
  laugh: ['laugh_back', 'startle_giggle', 'clap'], excited: ['hope_hop', 'cheer', 'greet_open', 'hand_up'],
  shy: ['shy_fidget', 'peek_hide', 'poke_flinch'], giggle: ['clasp_giggle', 'startle_giggle', 'poke_flinch'],
  smug: ['proud_lift', 'look_back', 'boo'], sulky: ['sulk_turn', 'jealous_glare', 'hold_tears'],
  grumpy: ['jealous_glare', 'sulk_turn', 'shake_no'], angry: ['stomp_point', 'sulk_turn'],
  surprised: ['freeze', 'startle_giggle', 'head_tilt'], scared: ['cower', 'peek_hide'],
  teary: ['hold_tears', 'plead_fists'], crying: ['rub_eyes_cry', 'hold_tears'], touched: ['reach_hug', 'pat_melt', 'hold_tears'],
  sleepy: ['doze_nod', 'yawn_stretch', 'flop'], squeeze: ['poke_flinch', 'cower'], shocked: ['freeze'],
  starstruck: ['hope_hop', 'cheer'], lovestruck: ['cheek_hold', 'nuzzle'], pout: ['sulk_turn', 'shake_no', 'jealous_glare'],
  curious: ['think', 'look_around', 'head_tilt', 'look_back'], pleading: ['plead_fists', 'reach_hug'],
  attention: ['nod_yes', 'head_tilt', 'hand_up'], lonely: ['lonely_hug', 'look_around'],
};

// pick a move: avoid the last few, the default slightly favoured
export class Picker {
  constructor(lib) { this.lib = lib; this.recent = []; }
  choose(ids) {
    const ok = ids.filter(id => this.lib[id]);
    if (!ok.length) return null;
    const w = ok.map((id, i) => (i === 0 ? 1.5 : 1) * (this.recent.includes(id) ? 0.15 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), k = 0;
    while (r > w[k]) r -= w[k++];
    this.recent = [ok[k], ...this.recent.filter(x => x !== ok[k])].slice(0, 3);
    return this.lib[ok[k]];
  }
  forFace(name) { return this.choose(VARIANTS[name] ?? []); }
  // moves whose emotion conditions all hold for these scores, more specific ones weighted up
  forDims(dims) {
    const ok = [];
    for (const m of Object.values(this.lib)) {
      const c = Object.entries(m.emotions ?? {});
      if (!c.length || !c.every(([k, v]) => holds(dims[k] ?? 0, v))) continue;
      ok.push([m.id, c.length]);
    }
    ok.sort((a, b) => b[1] - a[1]);
    return this.choose(ok.slice(0, 4).map(x => x[0]));
  }
}
function holds(x, cond) {
  if (typeof cond === 'number') return x >= cond;
  const s = String(cond).trim();
  const r = s.match(/^(-?[\d.]+)\.\.(-?[\d.]+)$/);
  if (r) return x >= +r[1] && x <= +r[2];
  if (s.startsWith('>=')) return x >= +s.slice(2);
  if (s.startsWith('<=')) return x <= +s.slice(2);
  if (s.startsWith('>')) return x > +s.slice(1);
  if (s.startsWith('<')) return x < +s.slice(1);
  return x >= +s;
}
