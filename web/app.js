// Xiaojing (小鲸) viewer: toon-shaded skinned GLB, spring hair / tail / ears / skirt, idle motion, pokes and a few actions.
import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {SpringChain, Hoop, boneCollider, capsuleCollider} from './spring.js';
import {SkeletonView, LEGEND} from './skeleton.js';
import {setupPet} from './pet.js';
import {fitCapsule, markVertices, unmarkNear, wrapVertices, Pusher, Shell, restVertices, fitTip, middle} from './surface.js';
import {Face, EXPRESSIONS, SPECIALS} from './face.js';
import {intentsFromDims, pickSpecial, speed} from './emotion.js';
import {retargetClip} from './retarget.js';
import {Mover, Picker, TICS} from './moves.js';
import {Climber} from './climb.js';
import {Resting, RESTS} from './rest.js';
import {t, getLanguage, setLanguage} from './i18n.js';

const canvas = document.querySelector('#stage');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
camera.position.set(0, 0.5, 2.8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.41, 0);
controls.enableDamping = true;
controls.minDistance = 0.8;
controls.maxDistance = 4;
controls.enablePan = false;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94b8, 1.9));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(-1, 2, 2.5);
scene.add(key);

// soft contact shadow
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(20,30,70,0.35)');
  grd.addColorStop(1, 'rgba(20,30,70,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75),
    new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false}));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.001;
  scene.add(disc);
}

function toonRamp() {
  // soft ramp: a toon look without hard bands on the uneven Tripo surface
  const t = new THREE.DataTexture(new Uint8Array([185, 185, 185, 255, 215, 215, 215, 255, 240, 240, 240, 255, 255, 255, 255, 255]), 4, 1);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const W = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = W(0, 1, 0), RIGHT = W(1, 0, 0), FWD = W(0, 0, 1);

const state = {time: 0, ready: false, style: 'toon', look: new THREE.Vector2(), eyes: new THREE.Vector2(), lookTarget: new THREE.Vector2()};
const B = {};
let model, mesh, hoop, pusher, mixer, mover, climber, resting, picker, MOVES = {}, clips = {}, restLocal = new Map(), face, outline, springs = [], colliders = [], restWorld = new Map(), materials = {};

// v2 (default): the single-mesh Tripo model on a Mixamo skeleton plus our spring bones (scripts/blender/v2/).
// v1 (?model=v1): the 76-part model on our own Unity-named skeleton (scripts/blender/0x-*.py).
const MODELS = {
  v1: {file: 'assets/xiaojing.glb', alias: {},
    colliders: [['Head', [0, 0.66, 0], 0.13], ['Chest', [0, 0.41, 0], 0.085], ['Hips', [0, 0.27, 0.01], 0.1]]},
  v2: {file: 'assets/xiaojing-v2.glb',
    // the names app.js drives → Mixamo bones (GLTFLoader drops the ':' from 'mixamorig:Hips')
    alias: {Hips: 'mixamorigHips', Spine: 'mixamorigSpine', Chest: 'mixamorigSpine2', Neck: 'mixamorigNeck',
      Head: 'mixamorigHead', LeftUpperArm: 'mixamorigLeftArm', LeftLowerArm: 'mixamorigLeftForeArm',
      RightUpperArm: 'mixamorigRightArm', LeftHand: 'mixamorigLeftHand', RightHand: 'mixamorigRightHand'},
    colliders: [['Head', [0, 0.69, 0.05], 0.14], ['Chest', [0, 0.45, 0.075], 0.085], ['Hips', [0, 0.31, 0.075], 0.1]]},
};
MODELS.v2.clips = true;
// ?model=v2r: the retopology experiment (scripts/blender/v2/21c-merge.py): upper clothes fused into one surface
MODELS.v2r = {...MODELS.v2, file: 'assets/xiaojing-v2r.glb'};
const CFG = MODELS[new URLSearchParams(location.search).get('model') ?? 'v2'];

new GLTFLoader().load(CFG.file, gltf => {
  model = gltf.scene;
  scene.add(model);
  model.traverse(o => {
    if (o.isBone) B[o.name] = o;
    if (o.isSkinnedMesh && !o.material.name.startsWith('xj_')) mesh = o;
  });
  for (const [name, bone] of Object.entries(CFG.alias)) B[name] = B[bone];
  const map = mesh.material.map;
  const ramp = toonRamp();
  materials.toon = new THREE.MeshToonMaterial({map, gradientMap: ramp, side: THREE.DoubleSide});
  face = new Face(model, ramp);
  materials.flat = new THREE.MeshBasicMaterial({map, side: THREE.DoubleSide});
  // the model is a single-layer skin: shade its inside like shadow instead of showing the outside print again
  for (const m of [materials.toon, materials.flat]) {
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.35, 0.38, 0.5);');
    };
  }
  model.traverse(o => {
    // the core inside the head (21b-patch): navy above, shadowed skin under the face, from its vertex colours
    if (o.isMesh && o.material.name === 'xj_HeadCore')
      o.material = o.geometry.attributes.color ? new THREE.MeshBasicMaterial({vertexColors: true}) : new THREE.MeshBasicMaterial({color: 0x0b1a45});
  });
  mesh.material = materials.toon;
  mesh.frustumCulled = false;

  // inverted-hull outline sharing the skeleton
  const om = new THREE.MeshBasicMaterial({color: 0x1a2142, side: THREE.BackSide});
  om.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <skinning_vertex>',
      '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * 0.0018;');
  };
  outline = new THREE.SkinnedMesh(mesh.geometry, om);
  outline.bind(mesh.skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;
  outline.visible = false;
  mesh.parent.add(outline);

  model.updateMatrixWorld(true);
  for (const b of Object.values(B)) restWorld.set(b, {q: b.getWorldQuaternion(new THREE.Quaternion()), local: b.quaternion.clone(), pos: b.position.clone()});

  const local = (bone, x, y, z) => bone.worldToLocal(W(x, y, z));
  colliders = CFG.colliders.map(([bone, p, r]) => boneCollider(B[bone], local(B[bone], ...p), r));
  const chain = (names, opts) => springs.push(Object.assign(new SpringChain(names.map(n => B[n]), opts), {names}));
  const hair = {stiffness: 0.9, drag: 0.45, gravity: W(0, -0.3, 0), radius: 0.02};
  // v2: hair in 7 chains (HairA–G), skirt in 8 (SkirtA–H); v1: HairC/L/R and SkirtF/B/L/R
  const hairChains = B.HairA1 ? 'ABCDEFG'.split('').map(c => 'Hair' + c) : ['HairC', 'HairL', 'HairR'];
  const skirtChains = B.SkirtA1 ? 'ABCDEFGH'.split('').map(c => 'Skirt' + c) : ['SkirtF', 'SkirtB', 'SkirtL', 'SkirtR'];
  for (const h of hairChains) chain([1, 2, 3].map(i => h + i), hair);
  chain(['LockL1', 'LockL2'], hair);
  chain(['LockR1', 'LockR2'], hair);
  chain(['Tail2', 'Tail3', 'Tail4'], {stiffness: 1.6, drag: 0.5, gravity: W(0, -0.1, 0)});
  chain(['EarL'], {stiffness: 3, drag: 0.55});
  chain(['EarR'], {stiffness: 3, drag: 0.55});
  chain(['Ahoge'], {stiffness: 2.2, drag: 0.22});
  // the dress is stiff: firm chains held together as a ring (Hoop), swinging little
  // it may still lift far (up to ~70°) when a leg pushes it; colliders push it outward from the body's axis
  const hipsAxis = {o: new THREE.Vector3(), up: W(0, 1, 0)};
  const hipsBone = B.mixamorigHips ?? B.Hips;
  const hipsUpLocal = UP.clone().applyQuaternion(hipsBone.getWorldQuaternion(new THREE.Quaternion()).invert());
  const axis = () => {
    hipsBone.getWorldPosition(hipsAxis.o);
    hipsAxis.up.copy(hipsUpLocal).applyQuaternion(hipsBone.getWorldQuaternion(new THREE.Quaternion()));
    return hipsAxis;
  };
  for (const s of skirtChains) chain([s + '1', s + '2'], {stiffness: 5, drag: 0.75, gravity: W(0, -0.25, 0), radius: 0.015, maxAngle: 1.2, axis});
  if (B.SkirtA1) hoop = new Hoop(springs.filter(s => s.names[0].startsWith('Skirt')), 0.7);
  // limbs as capsules (v2): hair parts around the arms, the skirt is pushed by the legs and hands, the tail by the legs.
  // Radii measured on the sleeves and legs; the hanging hair sits behind the arms at rest, so nothing moves at rest.
  if (B.mixamorigLeftArm) {
    // Body proxy (surface.js): a capsule per body segment, its radius measured on the mesh (fitCapsule: 75th
    // percentile of the vertices around the bone within 12 cm, at most 1.25× the expected size, which catches odd
    // fits such as the sock cuff on a shin). `from`: the top third of a thigh is inside the dress's waist.
    const P = n => B['mixamorig' + n];
    state.fitted = {};
    const seg = (a, b, expect, o = {}) => {
      const f = fitCapsule(mesh, P(a), P(b), o.pct ?? 0.75);
      const radius = o.fixed ? expect : f.count > 50 ? Math.min(f.radius, expect * 1.25) : expect;
      state.fitted[a] = +radius.toFixed(3);
      return {a: P(a), b: P(b), radius, from: o.from ?? 0, ext: o.ext ?? 0};
    };
    const body = {chest: [seg('Spine1', 'Neck', 0.085, {pct: 0.5})], arms: [], thighs: [], shins: []};
    for (const S of ['Left', 'Right']) {
      body.arms.push(seg(S + 'Arm', S + 'ForeArm', 0.038), seg(S + 'ForeArm', S + 'Hand', 0.032),
        seg(S + 'Hand', S + 'HandMiddle1', 0.028, {fixed: true, ext: 0.6}));
      body.thighs.push(seg(S + 'UpLeg', S + 'Leg', 0.048, {from: 0.35}));
      body.shins.push(seg(S + 'Leg', S + 'Foot', 0.036));
    }
    const legs = [...body.thighs, ...body.shins];
    // the tail as capsules too: it lifts over the legs in a run (yieldTail) and the hair hanging down the back parts
    // round it instead of running through it
    if (B.Tail4) body.tail = [1, 2, 3].map(i => ({a: B['Tail' + i], b: B['Tail' + (i + 1)], radius: 0.032 - 0.004 * i, from: 0, ext: 0, contactOnly: true}));
    else body.tail = [];
    // Rules, from what each soft part hangs on:
    //   hair, side locks, ears, ahoge (on the head): the chest and arms push them, away from each capsule
    //   skirt and apron (on the hips): the legs push them, outward from the body's axis (the hips sphere and the hands
    //     sit at the dress and would only lift it)
    //   tail (on the hips): the legs
    const toColliders = list => list.map(c => Object.assign(capsuleCollider(c.a, c.b, c.radius, c.ext, c.from), {contactOnly: c.contactOnly}));
    const rules = [
      {test: /^(Hair|Lock|Ear|Ahoge)/, colliders: colliders.concat(toColliders([...body.chest, ...body.arms, ...body.tail]))},
      {test: /^Skirt/, colliders: toColliders([...legs, ...body.tail])},      // the tail comes out under the hem and lifts it
      {test: /^Tail/, colliders: colliders.concat(toColliders(legs))},
    ];
    for (const s of springs) {
      const r = rules.find(r => r.test.test(s.names[0]));
      if (r) s.colliders = r.colliders;
    }
    // The tail's root is inside the dress and the tail comes out under the hem, so outside the hem's radius it can
    // never be higher than the hem (it would have to pass through the cloth). The hem is read off the tips of the skirt
    // chains as they are now, the allowance is what the tail takes at rest; as a collider: a huge ball right above the
    // point whose underside is that height.
    const skirts = springs.filter(s => s.names[0].startsWith('Skirt')), tails = springs.filter(s => s.names[0].startsWith('Tail'));
    if (skirts.length > 2 && tails.length) {
      const tips = skirts.map(s => s.joints[s.joints.length - 1].tail), c = new THREE.Vector3(), BIG = 1;
      // Read the hem in the hips' frame, including when she lies on her side. Blend neighbouring panels so
      // crossing a panel boundary cannot teleport the tail's contact plane.
      const hemAt = p => {
        const {o, up} = axis(), v = p.clone().sub(o), height = v.dot(up);
        v.addScaledVector(up, -height); const pl = v.length(); v.divideScalar(pl || 1);
        let weight = 0, y = 0, r = 0;
        for (const tip of tips) {
          const d = tip.clone().sub(o), h = d.dot(up); d.addScaledVector(up, -h);
          const radius = d.length(), w = Math.max(0, v.dot(d.divideScalar(radius || 1))) ** 12;
          weight += w; y += w * h; r += w * radius;
        }
        return [y / (weight || 1), r / (weight || 1), pl, height];
      };
      let allow = -Infinity;
      const q = new THREE.Vector3();
      for (const t of tails) for (const j of t.joints) {
        const head = j.bone.getWorldPosition(new THREE.Vector3());
        for (let f = 0; f <= 1; f += 0.125) { q.copy(head).lerp(j.tail, f); const [y, r, pl, height] = hemAt(q); if (pl > 0.8 * r) allow = Math.max(allow, height - y); }
      }
      state.hemAllow = allow = (allow > -1 ? allow : -0.02) + 0.015;
      const under = {radius: BIG, closest(p) {
        const [y, r, pl, height] = hemAt(p);
        // only beyond the hem's radius, eased in over its last fifth
        const k = THREE.MathUtils.clamp((pl / Math.max(r, 1e-6) - 0.8) / 0.2, 0, 1);
        return c.copy(p).addScaledVector(hipsAxis.up, k > 0 ? y + allow + (1 - k) * 0.1 + BIG - height : 2 * BIG + 1);
      }};
      for (const t of tails) t.colliders = t.colliders.concat([under]);
    }
    // the last word, per vertex in the shader: group 1 skirt / apron (outward from the hips' axis, by the legs),
    // group 2 hair / locks (away from chest and arms), group 3 tail (away from the legs)
    // group 4: the clothes on the torso (apron straps, ruffles, the bodice) duck under an arm that crosses them;
    // only what is clear of the arms at rest, so the shoulders and the rest pose stay as modelled
    state.pushed = markVertices(mesh, [/Skirt/, /^(Hair|Lock)/, /^Tail/, /^mixamorig(Spine\d?|Neck|(Left|Right)Shoulder)$/]);
    // (forearms and hands hang against the waist at rest: what they touch there stays as modelled). What lies on an
    // upper arm at rest, the strap and its ruffle over the shoulder, stays on that arm and stretches with it.
    const lower = body.arms.filter((c, i) => i % 3);
    state.pushed[3] = unmarkNear(mesh, 4, lower, 0.03);
    state.wrapped = wrapVertices(mesh, 4, body.arms, [0, 3]);
    pusher = new Pusher(mesh, [
      {caps: [...legs, ...body.tail], axis: P('Hips'), maxPush: 0.045},
      {caps: [...body.chest, ...body.arms, ...body.tail], axis: null, maxPush: 0.04},
      {caps: legs, axis: null, maxPush: 0.045},      // group 3: the tail gives way to a leg swinging back through it
      {caps: body.arms, axis: P('Spine1'), inward: true, wrap: true, maxPush: 0.04},
    ]);
    for (const m of [materials.toon, materials.flat]) {
      const before = m.onBeforeCompile;
      m.onBeforeCompile = sh => { before(sh); pusher.patch(sh); };
      m.customProgramCacheKey = () => 'xj-body-push-' + m.type;
      m.needsUpdate = true;
    }
  }
  // expression offsets on top of the ear / ahoge rest poses: rotate the rest about a world axis (in the bone's frame)
  for (const s of springs) if (/^(Ear|Ahoge)/.test(s.names[0])) {
    const j = s.joints[0], name = s.names[0];
    const worldAxis = name === 'Ahoge' ? RIGHT : name === 'EarL' ? FWD : FWD.clone().negate();
    j.rest0 = j.rest.clone();
    j.axis = worldAxis.clone().applyQuaternion(j.bone.getWorldQuaternion(new THREE.Quaternion()).invert());
  }

  model.traverse(o => { if (o.isBone) restLocal.set(o, {q: o.quaternion.clone(), p: o.position.clone()}); });
  if (B.mixamorigHips) {
    const mb = {};
    for (const [k, b] of Object.entries(B)) if (k.startsWith('mixamorig')) mb[k.slice(9)] = b;
    // What the hands need to know about her, measured on the mesh at rest (surface.js): the head as a ball-like
    // shell, the chest and the dress as columns, the fist at the end of each sleeve, the eyes and mouth as landmarks.
    const rv = restVertices(mesh), pos = n => mb[n].getWorldPosition(new THREE.Vector3());
    const span = (pts, k) => { const a = pts.map(p => p.getComponent(k)).sort((x, y) => x - y); return [a[Math.floor(a.length * 0.02)], a[Math.floor(a.length * 0.98)]]; };
    const headPts = rv.pick(/^(mixamorigHead|Hair[A-G]1)$/);
    const torsoPts = rv.pick(/^mixamorig(Hips|Spine\d?|Neck|(Left|Right)Shoulder)$/);
    const skirtPts = rv.pick(/^Skirt/);
    const centroid = m => {
      const c = new THREE.Vector3(), v = new THREE.Vector3(), n = m.geometry.attributes.position.count;
      for (let i = 0; i < n; i++) c.add((m.isSkinnedMesh ? m.getVertexPosition(i, v) : v.fromBufferAttribute(m.geometry.attributes.position, i)).applyMatrix4(m.matrixWorld));
      return c.multiplyScalar(1 / n);
    };
    const fist = S => {
      const el = pos(S + 'ForeArm');
      return fitTip(rv.pick(new RegExp(S + '(ForeArm|Hand)')), el, pos(S + 'Hand').sub(el).normalize());
    };
    const body = state.body = {
      head: new Shell(mb.Head, headPts, {kind: 'ball', centre: middle(headPts)}),
      torso: new Shell(mb.Spine2, torsoPts, {kind: 'column', centre: middle(torsoPts), y0: span(torsoPts, 1)[0], y1: pos('Neck').y, nv: 8}),
      skirt: new Shell(mb.Hips, skirtPts, {kind: 'column', centre: middle(skirtPts), y0: span(skirtPts, 1)[0], y1: span(skirtPts, 1)[1], nv: 8}),
      fist: {L: fist('Left'), R: fist('Right')},
      face: {eyeL: centroid(face.parts.eyeL), eyeR: centroid(face.parts.eyeR), mouth: centroid(face.parts.mouth)},
    };
    mover = new Mover(mb, body);
    climber = new Climber(mb, mover);
    resting = new Resting(mb,mover,scene);
  }
  if (CFG.clips) Promise.all([loadClips(), loadMoves()]).then(() => { state.ready = true; document.body.classList.add('ready'); });
  else { state.ready = true; document.body.classList.add('ready'); }
});

// Mixamo clip library, retargeted at load (retarget.js). Sources: three.js example models (Mixamo animations).
const SOURCES = {Xbot: 'assets/anims/Xbot.glb', Soldier: 'assets/anims/Soldier.glb', Michelle: 'assets/anims/Michelle.glb'};
export const CLIPS = {
  idle: {src: 'Xbot', clip: 'idle', label: '站立（动捕）'},
  walk: {src: 'Xbot', clip: 'walk', label: '走路', inPlace: true},
  run: {src: 'Xbot', clip: 'run', label: '跑步', inPlace: true, mirrorArm: 'Left'},
  agree: {src: 'Xbot', clip: 'agree', label: '点头同意'},
  headShake: {src: 'Xbot', clip: 'headShake', label: '摇头不要'},
  sad: {src: 'Xbot', clip: 'sad_pose', label: '垂头丧气'},
  sneak: {src: 'Xbot', clip: 'sneak_pose', label: '蹑手蹑脚'},
  soldierIdle: {src: 'Soldier', clip: 'Idle', label: '站立 2'},
  soldierWalk: {src: 'Soldier', clip: 'Walk', label: '走路 2', inPlace: true},
  samba: {src: 'Michelle', clip: 'SambaDance', label: '桑巴舞', inPlace: true},
};
const CHIBI = {armFloor: [0.7, 0.9], legLift: [0.3, 0.5], spine: 0.75, solve: keepOutOfDress};

// Her dress is a wide bell; a Mixamo idle tucks the hands against the thighs, which here is deep inside it.
// Rough dress volume (measured from the mesh, glTF frame): elliptic cone from the hem (y 0.19, half-width 0.20) to the
// waist (y 0.30, 0.13), then the torso (0.095); depth is 0.8 of the width, centred at z 0.06.
const DRESS = {zc: 0.06, hem: [0.19, 0.20], waist: [0.30, 0.13], torso: 0.095, depth: 0.8, margin: 0.015};
function dressInside(p) {
  const {zc, hem, waist, torso, depth, margin} = DRESS;
  if (p.y < hem[0] - 0.03) return 0;
  const f = THREE.MathUtils.clamp((p.y - hem[0]) / (waist[0] - hem[0]), 0, 1);
  const rx = (p.y > waist[0] + 0.02 ? torso : THREE.MathUtils.lerp(hem[1], waist[1], f)) + margin;
  const e = Math.hypot(p.x / rx, (p.z - zc) / (rx * depth));
  return Math.max(0, 1 - e);       // > 0: inside, by this fraction of the radius
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _ax = new THREE.Vector3();
function keepOutOfDress(b) {
  for (const side of ['Left', 'Right']) {
    const arm = b[side + 'Arm'], fore = b[side + 'ForeArm'], hand = b[side + 'Hand'];
    for (let it = 0; it < 30; it++) {
      arm.updateMatrixWorld(true);
      const sh = arm.getWorldPosition(_a), el = fore.getWorldPosition(_b), hd = hand.getWorldPosition(_c);
      const mid = el.clone().lerp(hd, 0.5);
      const worst = [el, mid, hd].map(p => [dressInside(p), p]).sort((x, y) => y[0] - x[0])[0];
      if (worst[0] <= 0) break;
      // swing the whole arm about the shoulder, moving the deepest point straight away from the body axis
      const out = W(worst[1].x, 0, worst[1].z - DRESS.zc).normalize();
      _ax.crossVectors(worst[1].clone().sub(sh), out);
      if (_ax.lengthSq() < 1e-10) break;
      // in proportion to the depth: fixed 3° steps made the result jump from one key to the next
      const turn = new THREE.Quaternion().setFromAxisAngle(_ax.normalize(), Math.min(0.05, 0.02 + worst[0] * 0.6));
      const pw = arm.parent.getWorldQuaternion(new THREE.Quaternion());
      const aw = arm.getWorldQuaternion(new THREE.Quaternion());
      arm.quaternion.copy(pw.invert().multiply(turn.multiply(aw)));
    }
  }
}
// The tail gives way to the legs: when a knee or foot swings back behind the hips (a run's back-kick, a clip's stride),
// the tail's base lifts toward passing over it, quickly up and slowly down (the vertex push does the rest).
// Measured in the hips' own frame, so it holds for any clip or move.
function yieldTail(dt) {
  const hips = B.mixamorigHips, tail = B.Tail1, tip = B.Tail3;
  if (!hips || !tail || !tip) return;
  hips.updateMatrixWorld(true);
  const rest = restWorld.get(hips).q, frame = hips.getWorldQuaternion(new THREE.Quaternion()).multiply(rest.clone().invert()).invert();
  const root = tail.getWorldPosition(new THREE.Vector3());
  const local = b => b.getWorldPosition(new THREE.Vector3()).sub(root).applyQuaternion(frame);
  // elevation above straight back, seen from the side
  const elev = v => Math.atan2(v.y, -v.z);
  state.tailRest ??= elev(local(tip));
  let need = 0;
  for (const S of ['Left', 'Right']) for (const n of ['Leg', 'Foot']) {
    const v = local(B['mixamorig' + S + n]);
    if (v.z > -0.02) continue;                           // not behind the tail's root
    const clear = Math.asin(Math.min(1, 0.07 / Math.hypot(v.y, v.z)));      // the leg's and the tail's thickness
    need = Math.max(need, elev(v) + clear - state.tailRest);
  }
  need = THREE.MathUtils.clamp(need, 0, 0.15);        // a little: its root is under the dress, it cannot rise through the hem
  const cur = state.tailLift ?? 0;
  state.tailLift = cur + (need - cur) * (1 - Math.exp(-dt * (need > cur ? 14 : 2.5)));
  if (state.tailLift > 1e-3) pose('Tail1', [RIGHT, state.tailLift]);
}
// A gait is the same on both sides half a cycle apart; a capture is not always (the Xbot run carries the right arm
// high in front of the shoulder, never swinging it back, so on her it lives inside the apron strap). Rewrite the other
// arm of a looping clip as the mirror image of the `good` one half a cycle later: shoulder, upper arm and forearm
// directions are read in the chest's frame, flipped left-right and aimed.
function mirrorArm(clip, good) {
  const other = good === 'Left' ? 'Right' : 'Left', P = n => B['mixamorig' + n], parts = ['Shoulder', 'Arm', 'ForeArm'];
  const child = {Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand'};
  const src = clip.tracks.find(t => t.name.endsWith(good + 'Arm.quaternion'));
  if (!src) return;
  const times = Array.from(src.times), T = clip.duration, tmp = new THREE.AnimationMixer(model), action = tmp.clipAction(clip);
  const wq = o => o.getWorldQuaternion(new THREE.Quaternion()), wp = o => o.getWorldPosition(new THREE.Vector3());
  const at = t => {
    for (const [b, r] of restLocal) { b.quaternion.copy(r.q); b.position.copy(r.p); }
    action.reset().play(); tmp.setTime(t);
    model.updateMatrixWorld(true);
  };
  // how far the chest has turned from rest: its own frame, in which left-right is x
  const chest = () => wq(P('Spine2')).multiply(restWorld.get(P('Spine2')).q.clone().invert());
  const values = Object.fromEntries(parts.map(n => [n, []]));
  for (const t of times) {
    at((t + T / 2) % T);
    // the good arm's directions, in the chest's frame
    const inv = chest().invert();
    const dirs = parts.map(n => wp(P(good + child[n])).sub(wp(P(good + n))).normalize().applyQuaternion(inv));
    at(t);
    const q = chest();
    parts.forEach((n, i) => {
      const bone = P(other + n), d = dirs[i].clone();
      d.x = -d.x;
      d.applyQuaternion(q);
      const cur = wp(P(other + child[n])).sub(wp(bone)).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(cur, d);
      bone.quaternion.copy(wq(bone.parent).invert().multiply(turn.multiply(wq(bone))));
      bone.updateMatrixWorld(true);
      values[n].push(...bone.quaternion.toArray());
    });
  }
  for (const n of parts) {
    const name = P(other + n).name + '.quaternion', track = new THREE.QuaternionKeyframeTrack(name, times, values[n]);
    const i = clip.tracks.findIndex(t => t.name === name);
    if (i >= 0) clip.tracks[i] = track; else clip.tracks.push(track);
  }
  action.stop(); tmp.uncacheClip(clip);
  for (const [b, r] of restLocal) { b.quaternion.copy(r.q); b.position.copy(r.p); }
  model.updateMatrixWorld(true);
}
// What the keys themselves say a clip is. A "pose" (under 0.2 s: Xbot's sad_pose, sneak_pose are three keys of which the
// last differs by 38–55°) is held on its last key instead of flickering between them 15 times a second. A clip whose
// last pose is far from its first (a fall, getting up, a kneel, a salute: 80–104°) is not a cycle: it plays once and
// holds, instead of snapping back to its first pose every time round.
function shapeClip(clip) {
  const quats = clip.tracks.filter(t => t.name.endsWith('.quaternion')), n = quats[0].times.length;
  const ang = (v, i, j) => { let d = 0; for (let k = 0; k < 4; k++) d += v[i * 4 + k] * v[j * 4 + k]; return 2 * Math.acos(Math.min(1, Math.abs(d))); };
  if (clip.duration < 0.2) {
    for (const t of clip.tracks) { const w = t.getValueSize(); for (let i = 0; i < n - 1; i++) for (let k = 0; k < w; k++) t.values[i * w + k] = t.values[(n - 1) * w + k]; }
    clip.userData = {pose: true};
    return;
  }
  const seam = Math.max(...quats.map(t => ang(t.values, 0, n - 1)));
  clip.userData = {seam: +(seam * 57.3).toFixed(1), once: seam > 0.45};
}
async function loadClips() {
  const loader = new GLTFLoader(), srcs = {};
  await Promise.all(Object.entries(SOURCES).map(async ([k, f]) => { srcs[k] = await loader.loadAsync(f); }));
  mixer = new THREE.AnimationMixer(model);
  const sel = document.querySelector('#clip');
  for (const [name, c] of Object.entries(CLIPS)) {
    const g = srcs[c.src];
    const clip = g.animations.find(a => a.name === c.clip);
    if (!clip) continue;
    clips[name] = retargetClip(g.scene, clip, model, {...CHIBI, inPlace: c.inPlace, lift: c.lift ?? 1, name});
    if (c.mirrorArm) mirrorArm(clips[name], c.mirrorArm);
    shapeClip(clips[name]);
    sel?.append(new Option(c.label, name));
  }
}
// the move library read off the videos (scripts/build_moves.mjs → assets/moves.json)
async function loadMoves() {
  const list = await (await fetch('assets/moves.json')).json();
  MOVES = Object.fromEntries(list.map(m => [m.id, m]));
  picker = new Picker(MOVES);
  const sel = document.querySelector('#move');
  for (const m of list) sel?.append(new Option(m.cn, m.id));
}
export function play(name, fade = 0.35, autonomous = false) {
  if (!mixer) return;
  if (!autonomous) { clearRestPreview(); pet?.interrupt(8); }
  const next = name && clips[name] ? mixer.clipAction(clips[name]) : null;
  // The mixer blends a fading clip with the pose the bones had when the clip was first bound. That has to be the rest
  // pose (which every frame starts from), not whatever was on screen at this moment (gaze, breathing, a move): the
  // fade then ran toward that stale pose and snapped to rest when it ended (head 8°, hips 5 mm, after every clip).
  for (const [b, r] of restLocal) { b.quaternion.copy(r.q); b.position.copy(r.p); }
  if (state.clip && state.clip !== next) state.clip.fadeOut(fade);
  if (next) {
    const once = clips[name].userData?.once;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = !!once;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play(); if (fade) next.fadeIn(fade);
  }
  state.clip = next;
  state.track = next ? {kind: 'clip', name, label: CLIPS[name]?.label ?? name} : null;
  state.paused = false;
  const select = document.querySelector('#clip');
  if (select) select.value = next ? name : '';
}

// rotate a driven bone about a world axis (taken in its rest frame), on top of its rest pose
function drive(name, axis, angle, q = new THREE.Quaternion()) {
  const b = B[name], r = restWorld.get(b);
  const a = axis.clone().applyQuaternion(r.q.clone().invert());
  return q.setFromAxisAngle(a, angle);
}
function pose(name, ...rots) {
  // on top of the current pose: the rest pose, or the clip the mixer just applied
  const b = B[name];
  for (const [axis, angle] of rots) if (angle) b.quaternion.multiply(drive(name, axis, angle));
}

// the buttons' actions are moves like any other (docs/motions/move-specs.md)
const ACTIONS = {wave: 'wave', hop: 'hop', nod: 'nod_yes', shake: 'shake_no', wag: 'tail_wag'};
export function act(name) {
  if (!state.ready || !ACTIONS[name]) return;
  move(ACTIONS[name]);
}

const clock = new THREE.Clock();
// state.manual: the page stops stepping by itself; a test drives it with xj.tick() (scripts/move_sheet.mjs)
let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // a desktop pet runs all day: 30 frames a second, the full rate only while she is being carried
  if (state.pet && !state.petHeld && now - lastFrame < 30) return;
  lastFrame = now;
  if (!state.manual) tick();
  showTimeline();
}
// step: advance by exactly this many seconds (the timeline's scrubbing); draw: false to simulate without rendering
function tick(step = null, draw = true) {
  // state.fixedDt: step time by a fixed amount per rendered frame (slow software rendering in tests)
  const real = Math.min(clock.getDelta(), 0.1), dt = step ?? state.fixedDt ?? real;
  // state.paused (the timeline): the world stands still, the camera still orbits
  if (state.paused && step == null) { controls.update(); paint(); return; }
  // one app clock for everything (actions, face timing), so a fixed step keeps them in sync
  const t = state.time += dt;
  if (state.ready) {
    pet?.beforeUpdate(dt, t);
    for (const [b, r] of restLocal) { b.quaternion.copy(r.q); b.position.copy(r.p); }
    // state.hold: freeze the playing clip at a time (inspection, screenshots)
    if (state.clip && state.hold != null) state.clip.time = state.hold;
    mixer?.update(dt);
    // The mixer writes a bone only when its value differs from the frame before (PropertyMixer.apply). Every frame here
    // starts by putting the bones back to rest, so a bone a clip holds still for two frames was left at rest: a held
    // pose, the end of a one-shot, every stepped key of the SD clips dropped out for as long as it held (neck 11°,
    // spine 18°, a whole lying body back on its feet). So what the mixer computed is written every frame.
    if (mixer) for (let i = 0; i < mixer._nActiveBindings; i++) {
      const pm = mixer._bindings[i];
      pm.binding.setValue(pm.buffer, ((mixer._accuIndex ^ 1) + 1) * pm.valueSize);
    }
    // idle: breathing, a slow sway, glances, gaze follows the pointer
    const breathe = Math.sin(t * 2 * Math.PI / 3.4);
    if (Math.random() < dt * 0.25) state.glance = {x: (Math.random() - 0.5) * 0.8, y: (Math.random() - 0.5) * 0.3, until: t + 1.2};
    const g = state.glance && state.glance.until > t ? state.glance : {x: 0, y: 0};
    // a move's own look (down, away…) is for the eyes; the head follows it only a third of the way, the move poses the rest
    const ml = state.moveLook ?? [0, 0];
    state.look.lerp(W(state.lookTarget.x + g.x, state.lookTarget.y + g.y, 0), 1 - Math.exp(-dt * 5));
    state.eyes.lerp(W(ml[0], ml[1], 0), 1 - Math.exp(-dt * 9));
    const lx = THREE.MathUtils.clamp(state.look.x + state.eyes.x, -1, 1), ly = THREE.MathUtils.clamp(state.look.y + state.eyes.y, -1, 1);
    let yaw = THREE.MathUtils.clamp(state.look.x + 0.35 * state.eyes.x, -1, 1) * 0.55, pitch = -THREE.MathUtils.clamp(state.look.y + 0.35 * state.eyes.y, -1, 1) * 0.28;
    // the expression's head pose (face.js head channels) on top of gaze and nods
    yaw += face.value('headYaw'); pitch += face.value('headPitch');
    const roll = face.value('headRoll');
    pose('Neck', [UP, yaw * 0.3], [RIGHT, pitch * 0.3], [FWD, roll * 0.3]);
    pose('Head', [UP, yaw * 0.7], [RIGHT, pitch * 0.7], [FWD, Math.sin(t * 0.9) * 0.04 + roll * 0.7]);
    for (const s of springs) {
      const j = s.joints[0];
      if (!j.rest0) continue;
      const a = s.names[0] === 'Ahoge' ? 1.1 * face.value('ahogeDroop') : -0.45 * (face.value('earLift') + (state.moveEars ?? 0));
      j.rest.copy(j.rest0).multiply(new THREE.Quaternion().setFromAxisAngle(j.axis, a));
    }
    pose('Chest', [RIGHT, 0.025 * breathe]);
    pose('Spine', [FWD, Math.sin(t * 0.7) * 0.025]);
    // breathing lowers the hips a touch, in world space (the Mixamo hips sit in a rotated armature frame)
    B.Hips.parent.updateMatrixWorld(true);
    const hw = B.Hips.parent.localToWorld(B.Hips.position.clone()).add(W(0, -0.004 * (breathe + 1), 0));
    B.Hips.position.copy(B.Hips.parent.worldToLocal(hw));
    pose('Hips', [FWD, Math.sin(t * 0.7 + 0.5) * 0.015]);

    pose('LeftUpperArm', [FWD, 0.03 * breathe]);
    pose('RightUpperArm', [FWD, -0.03 * breathe]);
    // the tail: a slow idle swish, faster with the expression's tailWag, or as a move says ({wag, hz})
    const tw = face.value('tailWag'), mt = state.moveTail;
    const wagAmp = (mt ? 0.12 + 0.4 * (mt.wag ?? 0.5) : (state.pet ? .045 : .12) + 0.3 * tw)*(1-.85*(state.restWeight??0));
    state.wagPhase = (state.wagPhase ?? 0) + dt * (mt ? 2 * Math.PI * (mt.hz ?? 3) : 2.2 + 7 * tw);
    pose('Tail1', [UP, Math.sin(state.wagPhase) * wagAmp]);
    if (mover) {
      // idle habits every 6–15 s while nothing else is going on
      if (!state.pet && !state.clip && !state.restPreview && !(state.restWeight > 0) && !mover.busy && face.name === 'neutral' && t > (state.nextTic ?? 8)) {
        mover.play(TICS[Math.floor(Math.random() * TICS.length)], t, face);
        state.nextTic = t + 6 + Math.random() * 9;
      } else if (mover.busy) state.nextTic = Math.max(state.nextTic ?? 0, t + 6);
      const r = mover.update(dt, t, face);
      state.moveEars = r.ears; state.moveTail = r.tail; state.moveLook = r.look;
    }
    climber?.update(dt,t,state,camera,canvas);
    resting?.update(dt,t,state,face);
    restChatter(t);
    // Turn the whole posed skeleton after local gestures/IK, so their surface constraints stay in the same frame.
    // The bones reset next frame; the model root remains exclusively owned by the grab/pendulum physics.
    if (state.petHeading) {
      const hips = B.Hips, parent = hips.parent.getWorldQuaternion(new THREE.Quaternion());
      const turn = parent.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(UP, state.petHeading)).multiply(parent);
      hips.quaternion.premultiply(turn); hips.updateMatrixWorld(true);
    }
    pet?.update(dt, t);
    yieldTail(dt);
    face.gaze.set(lx * 0.9, ly * 0.8);
    face.update(dt, t);
    model.updateMatrixWorld(true);
    const ground=()=>state.restWeight>.01&&!state.petHeld ? .03-(1-state.restWeight)*.8:null;
    if (!state.noSpring) { for (const s of springs) {s.opts.floor=ground;s.update(dt, s.colliders ?? colliders);} hoop?.update(); }
    if(pusher)pusher.ground=ground;
    pusher?.update();
    resting?.props(state);
  }
  if (!draw) return;
  controls.update();
  paint();
  state.frameNo = (state.frameNo ?? 0) + 1;
}

// ---- timeline: pause, scrub and single-step the last clip, move or resting preview -------------------------------
// Where it is: a clip by its own time, a move by the time since it started. Seeking re-simulates rather than jumps,
// so hair, skirt and tail are where they would be at that moment: a clip from half a second earlier, a move from its
// start (moves are springs and timed steps, they have no pose-at-time).
const SIM = 1 / 60;
function trackNow() {
  const tr = state.track;
  if (!tr) return null;
  if (tr.kind === 'clip') {
    if (!state.clip) return null;
    const dur = state.clip.getClip().duration;
    return {...tr, dur, t: ((state.clip.time % dur) + dur) % dur};
  }
  if (tr.kind === 'rest') {
    tr.t = state.restPreview?.id === tr.name ? state.time - state.restPreview.start : tr.dur;
    return {...tr, t: Math.min(tr.t, tr.dur)};
  }
  const m = mover?.move;
  if (m && m.spec === tr.spec) { tr.dur = m.loop ? 12 : m.end; tr.t = state.time - m.t0; }
  else if (!state.paused && tr.t != null) tr.t = tr.dur;          // it ended
  return {...tr, t: Math.min(tr.t ?? 0, tr.dur ?? 0)};
}
export function seek(t) {
  const tr = trackNow();
  if (!tr) return;
  state.paused = true;
  t = THREE.MathUtils.clamp(t, 0, tr.dur);
  if (tr.kind === 'clip') {
    const lead = 0.5;
    state.clip.time = (((t - lead) % tr.dur) + tr.dur) % tr.dur;
    for (let i = 0; i < Math.round(lead / SIM); i++) tick(SIM, false);
    state.clip.time = t;
    tick(1e-4, false);
  } else if (tr.kind === 'rest') {
    // The pose is analytic; warm the secondary springs over the last half-second, as for clips.
    const lead = Math.min(t, 0.5), frames = Math.floor(lead / SIM);
    state.restPreview = {id: tr.name, start: state.time - (t - lead), duration: tr.dur};
    resting.seek(t - lead);
    for (let i = 0; i < frames; i++) tick(SIM, false);
    tick(Math.max(1e-6, lead - frames * SIM), false);
  } else {
    mover.stop(state.time);
    face.set('neutral', 0, state.time);
    for (let i = 0; i < 20; i++) tick(SIM, false);              // let the last pose go
    mover.play(tr.spec, state.time, face, tr.endFace);
    state.track.t = 0;
    for (let i = 0; i < Math.round(t / SIM); i++) tick(SIM, false);
  }
}
export function pause(on = !state.paused) {
  const tr = trackNow();
  // A finished move or resting preview plays again from the top.
  if (['move', 'rest'].includes(tr?.kind) && tr.t >= tr.dur - 1e-3) { seek(0); on = false; }
  state.paused = on;
}
export function stepFrame(dir) {
  const tr = trackNow();
  if (!tr) return;
  state.paused = true;
  if (dir > 0 && tr.t + 1 / 30 <= tr.dur) { tick(1 / 60, false); tick(1 / 60, false); }
  else seek(tr.kind === 'clip' ? (tr.t + dir / 30 + tr.dur) % tr.dur : tr.t + dir / 30);
}
const tl = {box: document.querySelector('#timeline'), play: document.querySelector('#tl-play'), bar: document.querySelector('#tl-bar'),
  time: document.querySelector('#tl-time'), name: document.querySelector('#tl-name')};
const previewButtons = [...document.querySelectorAll('[data-preview]')];
const previewStop = document.querySelector('#preview-stop');
function showTimeline() {
  const preview = state.restPreview?.id ?? (state.clip?.getClip().name === 'samba' ? 'samba' : null);
  for (const button of previewButtons) {
    button.disabled = !state.ready;
    button.setAttribute('aria-pressed', String(button.dataset.preview === preview));
  }
  if (previewStop) previewStop.disabled = !state.ready;
  if (!tl.box) return;
  const tr = trackNow();
  tl.box.classList.toggle('idle', !tr);
  tl.play.textContent = state.paused ? '▶' : '⏸';
  if (!tr) { tl.name.textContent = '选一个动作'; tl.time.textContent = ''; return; }
  if (!tl.dragging) tl.bar.value = tr.dur ? Math.round(1000 * tr.t / tr.dur) : 0;
  tl.name.textContent = tr.label;
  tl.time.textContent = `${tr.t.toFixed(2)} / ${tr.dur.toFixed(2)} s`;
}
if (tl.box) {
  tl.play.addEventListener('click', () => pause());
  document.querySelector('#tl-prev').addEventListener('click', () => stepFrame(-1));
  document.querySelector('#tl-next').addEventListener('click', () => stepFrame(1));
  tl.bar.addEventListener('pointerdown', () => { tl.dragging = true; });
  addEventListener('pointerup', () => { tl.dragging = false; });
  tl.bar.addEventListener('input', () => { const tr = trackNow(); if (tr) seek(tr.dur * tl.bar.value / 1000); });
  addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); pause(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
  });
}

// Split view (the 骨骼 box, or ?skel=1): the model on the left, its skeleton on the right (skeleton.js), one camera for both,
// so they turn and move together.
let skeleton = null;
function paint() {
  if (!state.split || !model) { renderer.render(scene, camera); return; }
  skeleton ??= new SkeletonView(model);
  const s = renderer.getSize(new THREE.Vector2()), w = Math.floor(s.x / 2);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, w, s.y); renderer.setScissor(0, 0, w, s.y);
  renderer.render(scene, camera);
  renderer.setViewport(w, 0, s.x - w, s.y); renderer.setScissor(w, 0, s.x - w, s.y);
  skeleton.render(renderer, scene, camera);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, s.x, s.y);
}
export function setSplit(on) {
  state.split = !!on;
  document.querySelector('#legend').style.display = on ? 'flex' : 'none';
  resize();
}
// pointer position inside whichever half it is over, −1…1
const halfX = (e, r) => { const w = state.split ? r.width / 2 : r.width; return ((e.clientX - r.left) % w) / w * 2 - 1; };
function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = (state.split ? r.width / 2 : r.width) / r.height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
frame();

// pointer: gaze follows, a click pokes whatever part was hit
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect();
  state.lookTarget.set(halfX(e, r), -((e.clientY - r.top) / r.height * 2 - 1) + 0.25);
});
let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !state.ready || state.petGrab) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(halfX(e, r), -((e.clientY - r.top) / r.height * 2 - 1));
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(mesh)[0];
  if (hit) poke(hit.point);
});

function poke(point) {
  const near = n => B[n].getWorldPosition(new THREE.Vector3()).distanceTo(point);
  const part = ['Head', 'Tail3', 'Chest', 'Hips', 'LeftHand', 'RightHand', 'EarL', 'EarR', 'Ahoge']
    .map(n => [n, near(n) - (n === 'Head' ? 0.12 : 0)]).sort((a, b) => a[1] - b[1])[0][0];
  const push = point.clone().sub(camera.position).setLength(0.03);
  for (const s of springs) if (s.joints.some(j => j.bone.getWorldPosition(new THREE.Vector3()).distanceTo(point) < 0.12)) s.kick(push);
  const now = state.time;
  if (['Head', 'EarL', 'EarR', 'Ahoge'].includes(part)) {
    for (const s of springs) if (/^(Ear|Ahoge)/.test(s.names[0])) s.kick(W(0, 0.04, 0));
    // patted on the head: eyes slowly close into bliss; tugged ahoge: > < then sulky; ears: startled
    if (part === 'Head') move('pat_melt');
    else if (part === 'Ahoge') { face.set('squeeze', 0, now); move('sulk_turn', 'sulky'); }
    else move('startle_giggle');
  } else if (part === 'Tail3') move('tail_wag');
  else if (part.endsWith('Hand')) move(Math.random() < 0.5 ? 'wave' : 'reach_hug');
  else move('poke_flinch');
  face.talk(0.9, now);
  say({Head: '呀，别摸头发～', EarL: '耳朵会痒！', EarR: '耳朵会痒！', Ahoge: '呆毛不能拔！', Tail3: '尾巴尾巴～',
    LeftHand: '你好呀！', RightHand: '你好呀！', Chest: '嗯？', Hips: '嘿！'}[part]);
}

const bubble = document.querySelector('#bubble');
let bubbleTimer;
function say(text, interactive = false, {whileMoving = false, whileResting = false} = {}) {
  if (!whileMoving && !whileResting) pet?.interrupt(5);
  state.restBubbleDrive = null;
  const content = String(t(text ?? '')).slice(0, 280);
  bubble.textContent = content;
  const canReply = interactive && !!window.webkit?.messageHandlers?.pet;
  bubble.classList.toggle('interactive', canReply);
  bubble.classList.toggle('thinking', whileResting);
  bubble.setAttribute('role', canReply ? 'button' : 'status');
  bubble.tabIndex = canReply ? 0 : -1;
  bubble.title = canReply ? t('点击回复小鲸') : '';
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  const duration = Math.min(18000, Math.max(2800, [...content].length * (getLanguage()==='en'?65:230)));
  state.bubbleUntil = state.time + duration / 1000;
  state.bubbleBlocking = !whileMoving && !whileResting;
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), duration);
}
const REST_LINES = [
  '你忙你的，我在这里发会儿呆。', '脑袋空空，肚子也有一点空。',
  '今天的发呆任务，完成得很认真。', '想到了！……好像又忘了。', '托着脸，等一个好玩的念头。',
];
function restChatter(now) {
  const drive = state.restPreview ?? state.petRest;
  if (state.restBubbleDrive && state.restBubbleDrive !== drive) {
    clearTimeout(bubbleTimer); bubble.classList.remove('show', 'thinking');
    state.bubbleUntil = 0; state.restBubbleDrive = null;
  }
  if (drive?.id !== 'brood' || drive.chatted || state.paused || now - drive.start < 4 ||
      now < (state.nextRestChatter ?? 0) || now < (state.bubbleUntil ?? 0) || now < (state.petAttendUntil ?? 0) ||
      state.petHeld || state.petGrab || state.petRoaming || face?.reaction ||
      (state.pet && (!state.petLife?.chatter || state.petLife?.visiting))) return;
  const choices = REST_LINES.filter(line => line !== state.lastRestLine);
  const line = choices[Math.floor(Math.random() * choices.length)];
  drive.chatted = true; state.lastRestLine = line; state.nextRestChatter = now + 60 + Math.random() * 30;
  say(line, false, {whileResting: true}); state.restBubbleDrive = drive;
  face?.talk(1.8, now);
}
function replyToBubble(e) {
  if (!bubble.classList.contains('interactive')) return;
  e.stopPropagation(); e.preventDefault();
  window.webkit?.messageHandlers?.pet?.postMessage({type: 'chat'});
}
bubble.addEventListener('click', replyToBubble);
bubble.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') replyToBubble(e); });
// The native bridge supplies data, never executable model output. Only these small motions are accepted.
function companionReply(reply) {
  if (!state.ready || state.petHeld || !reply || reply.speak !== true || typeof reply.text !== 'string') return false;
  pet?.interrupt(8);
  const name = ['neutral', 'smile', 'happy', 'curious', 'shy', 'touched', 'sleepy', 'surprised', 'pout'].includes(reply.emotion) ? reply.emotion : 'neutral';
  face.set(name, 4, state.time);
  if (['head_tilt', 'wave', 'nod_yes', 'think', 'clap', 'tail_wag'].includes(reply.motion)) move(reply.motion, name);
  face.talk(Math.min(6, reply.text.length * 0.13), state.time);
  say(reply.text.slice(0, getLanguage()==='en'?240:80), true);
  return true;
}

export function setStyle(style) {
  state.style = style;
  mesh.material = materials[style === 'flat' ? 'flat' : 'toon'];
}
export function setOutline(on) { outline.visible = on; }

for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => act(b.dataset.act));
// play a move by id; endFace: the expression to come back to afterwards
export function move(id, endFace = null) {
  const m = typeof id === 'string' ? MOVES[id] : id;
  if (mover && m) {
    clearRestPreview();
    pet?.interrupt(8);
    mover.play(m, state.time, face, endFace); state.lastMoveAt = state.time;
    // Keep the duration even if a grab/release interrupts this move before the timeline's first render.
    state.track = {kind: 'move', spec: m, endFace, label: m.cn ?? m.id, t: 0, dur: mover.move.loop ? 12 : mover.move.end};
    state.paused = false;
  }
}
// an expression with one of its moves (VARIANTS); autonomous ones are rationed, at most one every 5 s
export function emote(name, {force = false, hold = 0} = {}) {
  face.set(name, hold, state.time);
  if (!picker || (!force && state.time - (state.lastMoveAt ?? -99) < 5)) return;
  const m = picker.forFace(name);
  if (m) move(m, hold ? null : name);
}
document.querySelector('#move')?.addEventListener('change', e => { move(e.target.value); e.target.value = ''; });
const exprSel = document.querySelector('#expr');
if (exprSel) {
  for (const k of Object.keys(EXPRESSIONS)) exprSel.append(new Option(k, k));
  for (const k of Object.keys(SPECIALS)) exprSel.append(new Option(k === 'dizzy' ? '★ 转晕·吐白沫' : '★ ' + k, k));
  exprSel.addEventListener('change', e => face.set(e.target.value, 0, state.time));
}
// emotion scores (a dialogue model's output, see emotion.js) → special or intents → face
export function feel(dims, {intensity = 0.5, tempo = 0.5, sig = {}} = {}) {
  const now = state.time, sp = pickSpecial(dims);
  if (sp) return emote(sp, {force: true});
  face.setIntents(intentsFromDims(dims, {intensity, sig}), now, speed(tempo, dims.arousal ?? 0));
  // a body move whose emotion conditions these scores meet (move-specs.md), rationed like emote()
  if (picker && now - (state.lastMoveAt ?? -99) > 5 && (intensity > 0.4 || (dims.arousal ?? 0) > 0.5)) {
    const m = picker.forDims({...dims, ...sig});
    if (m) { mover.play(m, now, face, null); state.lastMoveAt = now; face.setIntents(intentsFromDims(dims, {intensity, sig}), now + 0.01, 1); }
  }
}
for (const b of document.querySelectorAll('[data-face]')) b.addEventListener('click', () => {
  if (b.dataset.face === 'talk') face.talk(2.5, state.time);
  else emote(b.dataset.face, {force: true});   // the expression with one of its moves
});
document.querySelector('#clip')?.addEventListener('change', e => play(e.target.value));
document.querySelector('#style').addEventListener('change', e => setStyle(e.target.value));
document.querySelector('#outline').addEventListener('change', e => setOutline(e.target.checked));
document.querySelector('#legend').innerHTML = LEGEND.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');
document.querySelector('#split').addEventListener('change', e => setSplit(e.target.checked));
if (new URLSearchParams(location.search).get('skel')) { document.querySelector('#split').checked = true; setSplit(true); }

// ?pet=1: the desktop pet (pet.js)
const pet = new URLSearchParams(location.search).get('pet')
  ? setupPet({state, scene, camera, controls, renderer, canvas, model: () => model, mover: () => mover, face: () => face, mesh: () => mesh, pose, move, say, resize,
    playClip: (name, fade) => play(name, fade, true), findMove: id => MOVES[id] ?? TICS.find(m => m.id === id),
    hitPoint: (cx, cy) => { const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1)); ray.setFromCamera(ndc, camera); return ray.intersectObject(mesh)[0]?.point ?? null; }}) : null;
function playRest(id){
  if(!state.ready||!RESTS[id])return;window.webkit?.messageHandlers?.pet?.postMessage({type:'restPlace'});pet?.interrupt(5);mover?.stop();play(null,.3,true);
  state.bubbleUntil=state.petAttendUntil=0;document.querySelector('#bubble').classList.remove('show');
  state.restPreview={id,start:state.time,duration:RESTS[id].duration};
  state.track={kind:'rest',name:id,label:RESTS[id].zh,dur:RESTS[id].duration,t:0};
  state.paused=false;
}
function clearRestPreview(){
  if(!state.restPreview&&state.track?.kind!=='rest')return;
  state.restPreview=null;
  if(state.track?.kind==='rest')state.track=null;
  state.nextTic=state.time+8;
}
function stopPreview(){
  clearRestPreview();mover?.stop();play(null);face?.set('neutral',0,state.time);
  state.nextTic=state.time+8;
}
for(const button of previewButtons)button.addEventListener('click',()=>{
  if(!state.ready)return;
  if(button.dataset.preview==='samba'){stopPreview();play('samba');}
  else playRest(button.dataset.preview);
});
previewStop?.addEventListener('click',stopPreview);
window.xj = {rest:playRest,restModes:RESTS,stopPreview,setLanguage, getLanguage, say, companionReply, setSplit, act, play, feel, move, emote, tick, render:paint, seek, pause, stepFrame, renderer, scene, tics: TICS, moves: () => MOVES, get mover() { return mover; }, clips: () => clips, get mixer() { return mixer; }, model: () => model, setStyle, setOutline, state, B, springs, camera, controls, clock, poke: p => poke(W(...p)), get face() { return face; }};
