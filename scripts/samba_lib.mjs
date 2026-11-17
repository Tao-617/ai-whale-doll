// Loads the SambaDance capture (web/assets/anims/Michelle.glb) in Node without a browser: the GLB's node tree becomes
// plain Object3Ds and its channels three.js keyframe tracks, so the clip can be sampled with an AnimationMixer.
// Used by the stream-dance analysis scripts (scripts/samba_*.mjs).
import { readFileSync } from 'node:fs';
import * as THREE from '../web/vendor/three.module.min.js';

export { THREE };
export const key = name => name.replace(/^mixamorig:?/, '');

export function loadGlb(file) {
  const b = readFileSync(file), len = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + len).toString());
  const bin = b.subarray(20 + len + 8);
  const acc = i => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], n = {SCALAR: 1, VEC3: 3, VEC4: 4}[a.type];
    const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
    return new Float32Array(bin.buffer.slice(off, off + a.count * n * 4));
  };
  const nodes = j.nodes.map(n => {
    const o = new THREE.Object3D(); o.name = (n.name || '').replace(':', '');   // three's track paths cannot hold ':'
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  j.nodes.forEach((n, i) => (n.children || []).forEach(c => nodes[i].add(nodes[c])));
  const root = new THREE.Object3D();
  for (const i of j.scenes[0].nodes) root.add(nodes[i]);
  const animations = j.animations.map(a => {
    const tracks = [];
    for (const c of a.channels) {
      if (c.target.path === 'scale') continue;
      const s = a.samplers[c.sampler], name = nodes[c.target.node].name;
      const T = c.target.path === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new T(`${name}.${c.target.path === 'rotation' ? 'quaternion' : 'position'}`, acc(s.input), acc(s.output)));
    }
    return new THREE.AnimationClip(a.name, -1, tracks);
  });
  root.updateMatrixWorld(true);
  return {root, animations};
}

export function bones(root) {
  const m = {};
  root.traverse(o => { if (/^mixamorig/.test(o.name)) m[key(o.name)] = o; });
  return m;
}

// Samples the clip at `fps`; calls fn(i, t) with the skeleton posed at each frame.
export function sample(root, clip, fps, fn) {
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const n = Math.round(clip.duration * fps) + 1;
  for (let i = 0; i < n; i++) {
    const t = Math.min(i / fps, clip.duration - 1e-4);
    mixer.setTime(t); root.updateMatrixWorld(true);
    fn(i, t);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  return n;
}

export const samba = () => {
  const g = loadGlb(new URL('../web/assets/anims/Michelle.glb', import.meta.url));
  return {...g, clip: g.animations.find(a => a.name === 'SambaDance'), B: bones(g.root)};
};
