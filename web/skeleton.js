// The skeleton as a 3D figure of its own (the split view's right half): every bone as a line from its parent's joint to
// its own, a dot on every joint, coloured by what the bone belongs to, read from the live bones every frame, so it moves
// exactly as the model does. Drawn in a scene of its own, over a faint ghost of the model, through the same camera.
import * as THREE from 'three';

const GROUPS = [
  [/^mixamorig(Hips|Spine\d?|Neck|Head)/, 0xffffff, '躯干和头'],
  [/^mixamorig(Left|Right)(Shoulder|Arm|ForeArm|Hand)/, 0xffc247, '手臂'],
  [/^mixamorig(Left|Right)(UpLeg|Leg|Foot|Toe)/, 0x6ee37a, '腿'],
  [/^(Hair|Lock|Ahoge)/, 0x5aa9ff, '头发'],
  [/^Ear/, 0xc79bff, '耳朵'],
  [/^Skirt/, 0xff7fb0, '裙子'],
  [/^Tail/, 0xff8a3c, '尾巴'],
];
const groupOf = name => GROUPS.findIndex(g => g[0].test(name));

export class SkeletonView {
  constructor(model) {
    this.scene = new THREE.Scene();
    this.model = model;
    this.bones = [];
    model.traverse(o => { if (o.isBone && groupOf(o.name) >= 0 && !/Hand(Thumb|Index|Middle|Ring|Pinky)[2-4]/.test(o.name)) this.bones.push(o); });
    const set = new Set(this.bones);
    this.pairs = this.bones.filter(b => set.has(b.parent)).map(b => [b.parent, b]);
    const col = new THREE.Color(), lc = new Float32Array(this.pairs.length * 6), pc = new Float32Array(this.bones.length * 3);
    this.pairs.forEach(([, b], i) => { col.set(GROUPS[groupOf(b.name)][1]); col.toArray(lc, i * 6); col.toArray(lc, i * 6 + 3); });
    this.bones.forEach((b, i) => col.set(GROUPS[groupOf(b.name)][1]).toArray(pc, i * 3));
    const lg = new THREE.BufferGeometry(), pg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pairs.length * 6), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.bones.length * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({vertexColors: true, depthTest: false}));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({vertexColors: true, size: 7, sizeAttenuation: false, depthTest: false}));
    this.lines.frustumCulled = this.points.frustumCulled = false;
    const grid = new THREE.GridHelper(1.6, 16, 0x3a4668, 0x2a3350);
    this.scene.add(grid, this.lines, this.points);
    // the model itself, see-through, so one can tell where a joint sits in the body
    this.ghost = new THREE.MeshBasicMaterial({color: 0x9fb4e8, transparent: true, opacity: 0.13, depthWrite: false});
    this.background = new THREE.Color(0x141a2c);
    this.v = new THREE.Vector3();
  }
  update() {
    const lp = this.lines.geometry.attributes.position, pp = this.points.geometry.attributes.position, v = this.v;
    this.pairs.forEach(([a, b], i) => { a.getWorldPosition(v).toArray(lp.array, i * 6); b.getWorldPosition(v).toArray(lp.array, i * 6 + 3); });
    this.bones.forEach((b, i) => b.getWorldPosition(v).toArray(pp.array, i * 3));
    lp.needsUpdate = pp.needsUpdate = true;
  }
  // draw into the current viewport: background, ghost of `scene`, the skeleton on top
  render(renderer, scene, camera) {
    this.update();
    const bg = scene.background, om = scene.overrideMaterial, auto = renderer.autoClear;
    renderer.setClearColor(this.background, 1); renderer.clear();
    renderer.autoClear = false;
    scene.background = null; scene.overrideMaterial = this.ghost;
    const hid = scene.children.filter(c => c !== this.model && c.visible);      // the floor disc and its shadow are not her
    for (const c of hid) c.visible = false;
    renderer.render(scene, camera);
    for (const c of hid) c.visible = true;
    scene.background = bg; scene.overrideMaterial = om;
    renderer.clearDepth();
    renderer.render(this.scene, camera);
    renderer.autoClear = auto; renderer.setClearColor(0x000000, 0);
  }
}
export const LEGEND = GROUPS.map(g => ['#' + g[1].toString(16).padStart(6, '0'), g[2]]);
