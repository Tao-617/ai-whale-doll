// Stream-dance demo, step 2: the samba capture cut on its beat. Finds the beat grid from the hips' low points, then
// describes every beat per body part (which foot steps, hops, turns; where the hands go relative to the chest).
// node scripts/samba_beats.mjs [--json]
import { samba, sample, THREE } from './samba_lib.mjs';

const {root, clip, B} = samba();
const FPS = 30;
const wp = o => o.getWorldPosition(new THREE.Vector3()).multiplyScalar(100);
const yawOf = o => new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
const local = (o, ref) => ref.worldToLocal(o.getWorldPosition(new THREE.Vector3())).multiplyScalar(100 * ref.getWorldScale(new THREE.Vector3()).x);
const F = [];
sample(root, clip, FPS, (i, t) => F.push({
  t, hy: wp(B.Hips).y, lf: wp(B.LeftFoot), rf: wp(B.RightFoot), yaw: yawOf(B.Hips), cyaw: yawOf(B.Spine2),
  hip: wp(B.Hips), lh: local(B.LeftHand, B.Spine2), rh: local(B.RightHand, B.Spine2),
}));
// unwrap the heading
for (let i = 1; i < F.length; i++) { let d = F[i].yaw - F[i - 1].yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; F[i].yaw = F[i - 1].yaw + d; }
for (let i = 1; i < F.length; i++) { let d = F[i].cyaw - F[i - 1].cyaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; F[i].cyaw = F[i - 1].cyaw + d; }

// The beat: the hips go down on every beat. Their low points, then a least-squares grid t = t0 + k·P through them.
const lows = [];
for (let i = 3; i < F.length - 3; i++) {
  const w = F.slice(i - 3, i + 4).map(f => f.hy);
  if (F[i].hy === Math.min(...w) && Math.max(...w) - F[i].hy > 1.5) {
    // parabolic refinement between frames
    const a = F[i - 1].hy, b = F[i].hy, c = F[i + 1].hy, d = (a - c) / (2 * (a - 2 * b + c) || 1);
    lows.push(F[i].t + d / FPS);
  }
}
let P = 0.567, t0 = lows[0];
for (let it = 0; it < 5; it++) {
  const k = lows.map(t => Math.round((t - t0) / P));
  const n = k.length, sk = k.reduce((a, b) => a + b), st = lows.reduce((a, b) => a + b);
  const skk = k.reduce((a, b) => a + b * b), skt = k.reduce((a, b, i) => a + b * lows[i], 0);
  P = (n * skt - sk * st) / (n * skk - sk * sk); t0 = (st - P * sk) / n;
}
const resid = lows.map(t => { const k = Math.round((t - t0) / P); return (t - t0 - k * P) * 1000; });
const missing = [];
{ const ks = new Set(lows.map(t => Math.round((t - t0) / P))); for (let k = 0; k * P + t0 < clip.duration; k++) if (!ks.has(k)) missing.push(k); }
while (t0 - P > 0) t0 -= P;
const beats = [];
for (let t = t0; t + P <= clip.duration + 1e-6; t += P) beats.push(t);

const at = t => F[Math.min(F.length - 1, Math.round(t * FPS))];
const rows = beats.map((s, k) => {
  const e = s + P, fr = F.filter(f => f.t >= s && f.t < e);
  const lift = foot => Math.max(...fr.map(f => f[foot].y)) - 12;
  const hop = Math.max(...fr.map(f => f.hy)) - 99;
  const turn = (at(e).yaw - at(s).yaw) * 57.3, twist = Math.max(...fr.map(f => (f.cyaw - f.yaw) * 57.3)) - Math.min(...fr.map(f => (f.cyaw - f.yaw) * 57.3));
  // hip travel in the heading at the start of the beat
  const d = at(e).hip.clone().sub(at(s).hip).applyAxisAngle(new THREE.Vector3(0, 1, 0), -at(s).yaw);
  const L = lift('lf'), R = lift('rf');
  const legs = hop > 4 && L > 3 && R > 3 ? 'hop' : L > 2.5 && L > R + 1 ? 'stepL' : R > 2.5 && R > L + 1 ? 'stepR' : 'settle';
  const mid = at(s + P / 2);
  const hand = h => { const v = mid[h]; return v.y > 25 ? 'high' : v.z > 30 ? 'front' : Math.abs(v.x) > 40 ? 'out' : 'mid'; };
  return {k, t: +s.toFixed(3), legs, turn: Math.round(turn), lift: [+L.toFixed(1), +R.toFixed(1)], hop: +hop.toFixed(1),
    travel: [Math.round(d.x), Math.round(d.z)], twist: Math.round(twist), armL: hand('lh'), armR: hand('rh'),
    lh: mid.lh.toArray().map(Math.round), rh: mid.rh.toArray().map(Math.round)};
});

if (process.argv.includes('--json')) { console.log(JSON.stringify({period: P, t0, beats: rows}, null, 1)); process.exit(0); }
console.log(`beat period ${P.toFixed(4)} s (${(60 / P).toFixed(1)} bpm), first beat ${t0.toFixed(3)} s, ${beats.length} beats in ${clip.duration.toFixed(2)} s`);
console.log(`hip low points ${lows.length}, residual from the grid: max ${Math.max(...resid.map(Math.abs)).toFixed(0)} ms, beats without a clear low: ${missing.join(',') || 'none'}`);
console.log(' k     t  legs    turn   lift L/R   hop  travel  twist | armL  armR   handL(chest cm)   handR');
for (const r of rows) console.log(String(r.k).padStart(2), r.t.toFixed(2).padStart(6), r.legs.padEnd(7), String(r.turn).padStart(5),
  r.lift.map(x => x.toFixed(1).padStart(5)).join(''), r.hop.toFixed(1).padStart(6), r.travel.map(x => String(x).padStart(4)).join(''),
  String(r.twist).padStart(5), '|', r.armL.padEnd(5), r.armR.padEnd(5), r.lh.map(x => String(x).padStart(4)).join(''), ' ', r.rh.map(x => String(x).padStart(4)).join(''));
