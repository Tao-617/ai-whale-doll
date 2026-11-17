// Retarget Mixamo clips (any GLB on a mixamorig skeleton) onto Xiaojing's Mixamo skeleton.
// The skeletons share bone names but not rest poses: the sources stand in a T-pose, Xiaojing in an A-pose with chibi
// proportions. So first turn her limbs (in a copy of the rest frames) until every limb bone points where the source's
// does at rest; then each frame's source world rotation, taken relative to the source rest, is applied on top of that
// aligned rest. The spine is not aligned: her pelvis is tilted differently and aligning it would lean the whole body.
// Nor are the collar bones (Shoulder): hers slope down from the neck to the sleeve caps where a Mixamo body's lie flat,
// and the straps and ruffles on her shoulders are weighted to them, so turning them level tore her shoulders up in
// every clip; they only take the source's own movement (a shrug stays a shrug).
// The hips' travel is scaled by hip height. Chibi corrections (opts):
//   armFloor   [start, limit] radians below horizontal: an upper arm hanging lower than `start` is eased out so it never
//              hangs lower than `limit` (her dress is far wider than a Mixamo body; her own rest arms hang at ~47°)
//   legLift    [start, limit] radians from straight down: a thigh swinging further is eased so it never passes `limit`
//              (Mixamo strides are for long legs; hers are short under a stiff bell skirt)
//   spine      0..1, how much of the source's spine / neck / head motion is kept (a big head swings a lot)
//   inPlace    drop the hips' horizontal travel (keep the bob)
//   lift       scale on the hips' vertical travel (a game jump is as high as she is tall)
//   plant      keep the feet flat (her own rest orientation, turned only with the hips) and on the ground: while the
//              lower foot is within 5 cm of the floor the hips are lowered (or raised) so it stands on it. Source feet
//              point differently (SD Unity-chan's toes turned in and up) and a bent-knee stance lifts short legs off it
//   solve      fn(bones by Mixamo name, e.g. 'LeftArm') called on every posed frame; may adjust the bones' local rotations
import * as THREE from 'three';

const LIMB_CHILD = {};
for (const s of ['Left', 'Right']) {
  Object.assign(LIMB_CHILD, {
    [s + 'Arm']: s + 'ForeArm', [s + 'ForeArm']: s + 'Hand', [s + 'Hand']: s + 'HandMiddle1',
    [s + 'UpLeg']: s + 'Leg', [s + 'Leg']: s + 'Foot', [s + 'Foot']: s + 'ToeBase',
  });
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
    for (let i = 1; i < 4; i++) LIMB_CHILD[s + 'Hand' + f + i] = s + 'Hand' + f + (i + 1);
}
// 0: the collar bones stay at rest in every clip. The joint between neck and shoulder is not one a Mixamo clip may move:
// on her a few degrees there show as a dropped shoulder (2026-11-16, the user: it should be fixed in place).
const COLLAR = 0;
const SPINE = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']);
// Mixamo ('mixamorig:Hips') and MotionBuilder / Unity-chan ('Character1_Hips') skeletons share the bone names
const key = name => name.replace(/^(mixamorig:?|Character1_)/, '');

function boneMap(root) {
  const m = {};
  root.traverse(o => { if ((o.isBone || o.type === 'Object3D') && /^(mixamorig|Character1_)/.test(o.name)) m[key(o.name)] = o; });
  return m;
}
const wq = o => o.getWorldQuaternion(new THREE.Quaternion());
const wp = o => o.getWorldPosition(new THREE.Vector3());

// target bone world rotations with the limbs turned into the source's rest directions
function alignedRest(dst, src) {
  const saved = new Map(Object.values(dst).map(b => [b, b.quaternion.clone()]));
  const order = [];
  dst.Hips.traverse(o => { if (o.isBone && dst[key(o.name)] === o) order.push(key(o.name)); });
  for (const n of order) {
    const c = LIMB_CHILD[n];
    if (!c || !dst[c] || !src[n] || !src[c]) continue;
    const b = dst[n];
    b.parent.updateMatrixWorld(true);
    b.updateMatrixWorld(true);
    const dT = wp(dst[c]).sub(wp(b)).normalize(), dS = wp(src[c]).sub(wp(src[n])).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(dT, dS);
    const world = turn.multiply(wq(b));
    b.quaternion.copy(wq(b.parent).invert().multiply(world));
    b.updateMatrixWorld(true);
  }
  const out = {};
  for (const n of order) out[n] = wq(dst[n]);
  for (const [b, q] of saved) b.quaternion.copy(q);
  dst.Hips.updateMatrixWorld(true);
  return {out, order};
}

export function retargetClip(srcRoot, clip, dstRoot, opts = {}) {
  const {armFloor = null, legLift = null, spine = 1, inPlace = false, lift = 1, plant = true, fps = 30, name = clip.name, solve = null} = opts;
  const src = boneMap(srcRoot), dst = boneMap(dstRoot);
  srcRoot.updateMatrixWorld(true);
  dstRoot.updateMatrixWorld(true);
  const srcRest = {}, srcRestHips = wp(src.Hips);
  for (const n in src) srcRest[n] = wq(src[n]);
  const {out: dstRest, order} = alignedRest(dst, src);
  const names = order.filter(n => src[n]);
  const dstHipsRest = wp(dst.Hips), scale = dstHipsRest.y / srcRestHips.y;
  // the feet at rest (world rotation and height) for plantFeet
  const footRest = {}, hipsRestQ = wq(dst.Hips);
  for (const S of ['Left', 'Right']) if (dst[S + 'Foot'])
    footRest[S] = {q: wq(dst[S + 'Foot']), y: wp(dst[S + 'Foot']).y, toe: dst[S + 'ToeBase']?.quaternion.clone()};
  const dstHipsParentInv = new THREE.Matrix4().copy(dst.Hips.parent.matrixWorld).invert();

  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(clip).play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n), qv = Object.fromEntries(names.map(k => [k, new Float32Array(n * 4)]));
  const pv = new Float32Array(n * 3);
  const world = {}, tmp = new THREE.Quaternion(), id = new THREE.Quaternion();
  // the aligned rest points each upper arm along the source's rest direction
  const armDir = {};
  for (const k of ['LeftArm', 'RightArm']) if (src[k] && src[k.replace('Arm', 'ForeArm')])
    armDir[k] = wp(src[k.replace('Arm', 'ForeArm')]).sub(wp(src[k])).normalize();
  const down = new THREE.Vector3(0, -1, 0), axis = new THREE.Vector3(), corr = new THREE.Quaternion();
  const legDir = {};
  for (const k of ['LeftUpLeg', 'RightUpLeg']) if (src[k] && src[k.replace('UpLeg', 'Leg')])
    legDir[k] = wp(src[k.replace('UpLeg', 'Leg')]).sub(wp(src[k])).normalize();
  // the target is posed frame by frame (so `solve` can look at it), then put back
  const saved = names.map(k => [dst[k], dst[k].quaternion.clone(), dst[k].position.clone()]);
  // The collar bones keep only their movement about the clip's own average: a Mixamo body rests in a T-pose with level
  // collars and drops them whenever the arms hang, but her rest pose already has the arms down and the collars sloped
  // 32°, so the average drop on top of that gave her sloping shoulders for as long as she ran.
  const own = k => {
    const p = key(src[k].parent.name), d = wq(src[k]).multiply(srcRest[k].clone().invert());
    const pd = src[p] && srcRest[p] ? wq(src[p]).multiply(srcRest[p].clone().invert()) : id.clone();
    return pd.invert().multiply(d);
  };
  const collarMean = {};
  for (const k of names.filter(k => /Shoulder$/.test(k))) {
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      mixer.setTime(Math.min(i / fps, clip.duration - 1e-4)); srcRoot.updateMatrixWorld(true);
      const q = own(k), sg = q.w < 0 ? -1 : 1;
      sum[0] += q.x * sg; sum[1] += q.y * sg; sum[2] += q.z * sg; sum[3] += q.w * sg;
    }
    collarMean[k] = new THREE.Quaternion(...sum).normalize();
  }
  for (let i = 0; i < n; i++) {
    const t = Math.min(i / fps, clip.duration);
    times[i] = t;
    // just short of the end: at exactly `duration` the looping mixer is back at time 0, which put the first pose in as the
    // last key of every clip (a fall, a kneel, a salute snapped back to standing in one key, 80–104°)
    mixer.setTime(Math.min(t, clip.duration - 1e-4));
    srcRoot.updateMatrixWorld(true);
    for (const k of names) {
      // world-space change of the source bone since its rest pose
      let delta = wq(src[k]).multiply(srcRest[k].clone().invert());
      // Her collar bones run all the way out to the sleeve caps, three times as long as a Mixamo body's: the source's
      // collar turn applied whole dropped her shoulders 3 cm for as long as she ran. A third of the angle moves the
      // shoulder as far as the source's moves. (The arms are set in world space and are not affected.)
      const part = SPINE.has(k) ? spine : /Shoulder$/.test(k) ? COLLAR : 1;
      if (part < 1) {
        // keep only part of the change the bone adds over its parent, so the damping does not compound up the chain
        const p = key(src[k].parent.name);
        const pd = src[p] && srcRest[p] ? wq(src[p]).multiply(srcRest[p].clone().invert()) : id.clone();
        let own = pd.clone().invert().multiply(delta);
        if (collarMean[k]) own = collarMean[k].clone().invert().multiply(own);
        delta = pd.multiply(id.clone().slerp(own, part));
      }
      let w = delta.clone().multiply(dstRest[k]);
      if (armFloor && armDir[k]) {
        // how far below horizontal the arm now points; past `start`, ease it toward `limit` (tanh knee)
        const dir = armDir[k].clone().applyQuaternion(delta);
        const [start, limit] = armFloor, e = -Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        if (e > start) {
          const e2 = start + (limit - start) * Math.tanh((e - start) / (limit - start));
          axis.crossVectors(dir, down);
          if (axis.lengthSq() > 1e-8) w = corr.setFromAxisAngle(axis.normalize(), -(e - e2)).multiply(w);
        }
      }
      if (legLift && legDir[k]) {
        // angle of the thigh away from straight down; past `start`, ease it toward `limit` (tanh knee)
        const dir = legDir[k].clone().applyQuaternion(delta);
        const [start, limit] = legLift, e = dir.angleTo(down);
        if (e > start) {
          const e2 = start + (limit - start) * Math.tanh((e - start) / (limit - start));
          axis.crossVectors(down, dir);
          if (axis.lengthSq() > 1e-8) w = corr.setFromAxisAngle(axis.normalize(), -(e - e2)).multiply(w);
        }
      }
      world[k] = w;
      const par = key(dst[k].parent.name);
      const pw = world[par] ?? wq(dst[k].parent);
      dst[k].quaternion.copy(pw.clone().invert().multiply(w));
    }
    const d = wp(src.Hips).sub(srcRestHips).multiplyScalar(scale);
    if (inPlace) d.x = d.z = 0;
    d.y *= lift;
    dst.Hips.position.copy(dstHipsRest.clone().add(d).applyMatrix4(dstHipsParentInv));
    dst.Hips.updateMatrixWorld(true);
    solve?.(dst);
    if (plant) plantFeet(dst, footRest, hipsRestQ);
    for (const k of names) {
      tmp.copy(dst[k].quaternion);
      // keep successive keys on the same hemisphere so interpolation takes the short way
      const a = qv[k];
      if (i > 0 && tmp.x * a[i * 4 - 4] + tmp.y * a[i * 4 - 3] + tmp.z * a[i * 4 - 2] + tmp.w * a[i * 4 - 1] < 0)
        tmp.set(-tmp.x, -tmp.y, -tmp.z, -tmp.w);
      tmp.toArray(a, i * 4);
    }
    dst.Hips.position.toArray(pv, i * 3);
  }
  for (const [b, q, p] of saved) { b.quaternion.copy(q); b.position.copy(p); }
  dstRoot.updateMatrixWorld(true);
  mixer.stopAllAction();
  mixer.uncacheRoot(srcRoot);
  const tracks = names.map(k => new THREE.QuaternionKeyframeTrack(dst[k].name + '.quaternion', times, qv[k]));
  tracks.push(new THREE.VectorKeyframeTrack(dst.Hips.name + '.position', times, pv));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

// feet flat and on the floor (see the `plant` option)
const _yaw = new THREE.Quaternion(), _e = new THREE.Euler();
function plantFeet(dst, footRest, hipsRestQ) {
  // the hips' turn about the vertical since rest: feet follow only that
  const turn = wq(dst.Hips).multiply(hipsRestQ.clone().invert());
  _e.setFromQuaternion(turn, 'YXZ');
  _yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), _e.y);
  // only while she stands: lying down or tumbling the hips have no heading (it spun the feet half a turn from one key
  // to the next) and flat feet mean nothing. Fades out between 35° and 60° of tilt.
  const tilt = new THREE.Vector3(0, 1, 0).applyQuaternion(turn).angleTo(new THREE.Vector3(0, 1, 0));
  const stand = 1 - THREE.MathUtils.smoothstep(tilt, 0.6, 1.05);
  if (stand <= 0) return;
  const lift = [];
  for (const S of ['Left', 'Right']) {
    const f = dst[S + 'Foot'], r = footRest[S];
    if (!f || !r) continue;
    f.parent.updateMatrixWorld(true);
    f.quaternion.slerp(wq(f.parent).invert().multiply(_yaw.clone().multiply(r.q)), stand);
    if (r.toe) dst[S + 'ToeBase'].quaternion.copy(r.toe);
    f.updateMatrixWorld(true);
    lift.push(wp(f).y - r.y);
  }
  const low = Math.min(...lift);
  if (lift.length && low < 0.05) {
    // stand on the floor: move the hips by the lower foot's height (blend out toward 5 cm so a hop stays a hop)
    const k = low < 0.03 ? 1 : 1 - (low - 0.03) / 0.02;
    const hw = wp(dst.Hips); hw.y -= low * k * stand;
    dst.Hips.position.copy(dst.Hips.parent.worldToLocal(hw));
    dst.Hips.updateMatrixWorld(true);
  }
}
