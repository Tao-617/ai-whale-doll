// Stream-dance demo: cut the samba capture into atoms. The dance moves in two-beat phrases (samba is in 2/4), so it is
// cut into two-beat blocks on the beat grid (samba_beats.mjs), per body part: legs (hips and legs), torso (spine, neck,
// head) and arms. Blocks of one part that move alike (mean bone-rotation difference under a threshold) are one atom,
// played from its most typical block. Writes web/assets/samba_atoms.json:
//   atoms   {id, channel, label, src: [start, end] seconds in the clip, members: block indices, spread°}
//   score   the original dance as atom ids per block and channel (playing it back rebuilds the dance from atoms)
//   next    per atom, how far its last pose is from every other atom's first pose (degrees): which joins are smooth
// node scripts/samba_atoms.mjs
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { samba, sample, THREE } from './samba_lib.mjs';

const {root, clip, B} = samba();
const grid = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./samba_beats.mjs', import.meta.url)), '--json']));
const P = grid.period, beats = grid.beats;
const SIDES = s => ['Shoulder', 'Arm', 'ForeArm', 'Hand'].map(n => s + n);
const CHANNELS = {
  legs: {bones: ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'], threshold: 13, cn: '腿'},
  torso: {bones: ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'], threshold: 9, cn: '躯干'},
  arms: {bones: [...SIDES('Left'), ...SIDES('Right')], threshold: 20, cn: '手臂'},
};
const BLOCK = 2, PHASE = 1;   // blocks of two beats from beat 1: the step pattern repeats from there (beat 0 is a lead-in)

// the hips without their heading (turning about the vertical): an atom is the same whichever way she faces
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(B.Hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
const untwist = q => {
  const p = new THREE.Vector3(q.x, q.y, q.z).projectOnVector(up);
  return new THREE.Quaternion(p.x, p.y, p.z, q.w).normalize().invert().multiply(q);
};
const FPS = 30, N = 8 * BLOCK;   // poses compared per block
const frames = [];
const all = Object.values(CHANNELS).flatMap(c => c.bones);
sample(root, clip, FPS, () => frames.push(Object.fromEntries(all.map(n => [n, n === 'Hips' ? untwist(B.Hips.quaternion.clone()) : B[n].quaternion.clone()]))));
const poseAt = t => frames[Math.min(frames.length - 1, Math.round(t * FPS))];
const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 57.2958;

const blocks = [];
for (let k = PHASE; k + BLOCK <= beats.length; k += BLOCK) blocks.push({first: k, start: beats[k].t, end: beats[k].t + BLOCK * P});
const poses = (blk) => Array.from({length: N}, (_, i) => poseAt(blk.start + i * (blk.end - blk.start) / N));
const cache = blocks.map(poses);
const dist = (bones, a, b) => {
  let s = 0;
  for (let i = 0; i < N; i++) for (const n of bones) s += ang(cache[a][i][n], cache[b][i][n]);
  return s / (N * bones.length);
};

// average-linkage grouping under the channel's threshold; each group's medoid is the atom's source
function cluster({bones, threshold}) {
  const K = blocks.length, D = blocks.map((_, i) => blocks.map((_, j) => (i === j ? 0 : dist(bones, i, j))));
  let groups = blocks.map((_, i) => [i]);
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      let s = 0;
      for (const a of groups[i]) for (const b of groups[j]) s += D[a][b];
      const d = s / (groups[i].length * groups[j].length);
      if (d < threshold && (!best || d < best.d)) best = {i, j, d};
    }
    if (!best) break;
    groups[best.i] = [...groups[best.i], ...groups[best.j]].sort((a, b) => a - b);
    groups.splice(best.j, 1);
  }
  const sum = (a, g) => g.reduce((s, x) => s + D[a][x], 0);
  return groups.map(g => {
    const rep = g.reduce((b, a) => (sum(a, g) < sum(b, g) ? a : b));
    return {members: g, rep, spread: g.length > 1 ? sum(rep, g) / (g.length - 1) : 0};
  }).sort((a, b) => a.members[0] - b.members[0]);
}

// a few words on what an atom does, from the beat descriptors (samba_beats.mjs)
const LEGS = {stepL: '左点', stepR: '右点', hop: '跳', settle: '稳'};
const HANDS = {high: '高举', front: '前伸', out: '外展', mid: '收'};
function describe(ch, blk) {
  const bs = grid.beats.slice(blk.first, blk.first + BLOCK);
  if (ch === 'legs') {
    const lift = Math.max(...bs.flatMap(b => b.lift)), turn = bs.reduce((s, b) => s + b.turn, 0);
    const kind = lift > 12 ? '踢腿' : bs.every(b => b.legs === 'hop') ? '小跳' : '点步';
    return `${kind}·${bs.map(b => LEGS[b.legs]).join('')}${Math.abs(turn) > 30 ? (turn > 0 ? '·左转' : '·右转') : ''}`;
  }
  if (ch === 'arms') return [...new Set(bs.flatMap(b => [b.armL, b.armR]))].map(h => HANDS[h]).join('');
  const twist = Math.max(...bs.map(b => b.twist));
  return twist > 35 ? '扭身' : twist > 18 ? '摆身' : '稳身';
}

const atoms = [], score = Object.fromEntries(Object.keys(CHANNELS).map(c => [c, []]));
for (const [ch, cfg] of Object.entries(CHANNELS)) {
  cluster(cfg).forEach((g, i) => {
    const id = `${ch}${i + 1}`, blk = blocks[g.rep];
    for (const m of g.members) score[ch][m] = id;
    atoms.push({id, channel: ch, label: describe(ch, blk), src: [+blk.start.toFixed(4), +blk.end.toFixed(4)], members: g.members,
      spread: +g.spread.toFixed(1)});
  });
}
// joins: the end pose of each atom against the first pose of each other atom of the same channel
const endPose = a => poseAt(a.src[1]), startPose = a => poseAt(a.src[0]);
for (const a of atoms) {
  const bones = CHANNELS[a.channel].bones;
  a.next = Object.fromEntries(atoms.filter(b => b.channel === a.channel).map(b =>
    [b.id, +(bones.reduce((s, n) => s + ang(endPose(a)[n], startPose(b)[n]), 0) / bones.length).toFixed(1)]));
}

const out = {
  source: 'web/assets/anims/Michelle.glb#SambaDance', period: +P.toFixed(4), bpm: +(60 / P).toFixed(1), beatsPerBlock: BLOCK,
  channels: Object.fromEntries(Object.entries(CHANNELS).map(([k, c]) => [k, {cn: c.cn, bones: c.bones, threshold: c.threshold}])),
  blocks: blocks.map(b => [+b.start.toFixed(4), +b.end.toFixed(4)]), score, atoms,
};
writeFileSync(new URL('../web/assets/samba_atoms.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');

console.log(`beat ${P.toFixed(4)} s (${out.bpm} bpm), ${blocks.length} blocks of ${BLOCK} beats from beat ${PHASE}`);
for (const ch of Object.keys(CHANNELS)) {
  const list = atoms.filter(a => a.channel === ch);
  console.log(`\n${ch} (${CHANNELS[ch].cn}): ${list.length} atoms, threshold ${CHANNELS[ch].threshold}°`);
  console.log('  score:', score[ch].join(' '));
  for (const a of list) {
    const joins = Object.entries(a.next).sort((x, y) => x[1] - y[1]).slice(0, 3).map(([id, d]) => `${id} ${d}°`).join(', ');
    console.log(`  ${a.id.padEnd(7)} ${a.label.padEnd(10)} ×${a.members.length} spread ${String(a.spread).padStart(4)}°  src ${a.src[0].toFixed(2)}–${a.src[1].toFixed(2)} s  smooth next: ${joins}`);
  }
}
