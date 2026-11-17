// Surface-level collision, adaptive: one set of body proxies and one set of rules serve every motion.
//
// Body proxy: a capsule per body segment (torso, chest, upper arms, forearms, hands, thighs, shins), its radius
// measured on the mesh (fitCapsule), so it follows this model's surface rather than guessed numbers.
// Rules come from what each soft part hangs on: hair and side locks hang on the head, so the rest of the body (chest,
// arms) pushes them; the skirt and apron hang on the hips, so the legs push them, outward from the body's vertical axis
// (cloth must end up outside a leg, never behind it). The same proxies feed the spring chains (spring.js) and, as the
// last word, the vertex shader, which pushes each marked vertex out after skinning, so nothing shows through even
// between two chains. Pushes are soft and order-keeping, s → s0 + k·ln(1 + e^((s − s0)/k)) (growing with s, so
// layers stay in order), and capped (a big move is the springs' job; a long push here flattens the cloth).
import * as THREE from 'three';

// a capsule around bone a → b whose radius is the `pct` percentile of the distance from the segment to the vertices
// mostly weighted to `a` and within `far` of it (call right after loading, with the skeleton at rest)
export function fitCapsule(mesh, a, b, pct = 0.75, far = 0.12) {
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const bones = mesh.skeleton.bones, ia = bones.indexOf(a);
  const A = a.getWorldPosition(new THREE.Vector3()), Bp = b.getWorldPosition(new THREE.Vector3()), AB = Bp.clone().sub(A);
  const v = new THREE.Vector3(), d = [];
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    let best = 0, w = 0;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); best = si.getComponent(i, k); }
    if (best !== ia || w < 0.6) continue;
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);      // skinned: the raw positions are not in world space
    const t = THREE.MathUtils.clamp(v.clone().sub(A).dot(AB) / AB.lengthSq(), 0, 1);
    if (t <= 0.02 || t >= 0.98) continue;          // the joints' ends belong to their neighbours too
    const dist = v.distanceTo(A.clone().addScaledVector(AB, t));
    if (dist < far) d.push(dist);      // Tripo's weights put a few far-off vertices on a limb bone; they are not its surface
  }
  d.sort((x, y) => x - y);
  return {a, b, radius: d.length ? d[Math.floor(d.length * pct)] : 0.03, count: d.length};
}

// per-vertex group id (aPush): the first group whose bone pattern any of the vertex's weights matches, else 0
export function markVertices(mesh, patterns) {
  const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = mesh.skeleton.bones;
  const hit = patterns.map(re => bones.map(b => re.test(b.name)));
  const a = new Float32Array(si.count), counts = patterns.map(() => 0);
  for (let i = 0; i < si.count; i++) {
    for (let p = 0; p < patterns.length && !a[i]; p++)
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0.01 && hit[p][si.getComponent(i, k)]) { a[i] = p + 1; counts[p]++; break; }
  }
  g.setAttribute('aPush', new THREE.BufferAttribute(a, 1));
  return counts;
}

// take vertices out of `group` (aPush value) that already sit within `margin` of one of the capsules in the bind pose:
// what touches a limb at rest (the cloth round a shoulder) is part of the joint and stays as it is, so rest never changes
export function unmarkNear(mesh, group, caps, margin = 0.03) {
  const pos = mesh.geometry.attributes.position, a = mesh.geometry.attributes.aPush, v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  const segs = caps.map(c => {
    const A = c.a.getWorldPosition(new THREE.Vector3()), d = c.b.getWorldPosition(new THREE.Vector3()).sub(A);
    return {A: A.clone().addScaledVector(d, c.from ?? 0), d: d.clone().multiplyScalar(1 + (c.ext ?? 0) - (c.from ?? 0)), r: c.radius + margin};
  });
  let kept = 0;
  for (let i = 0; i < pos.count; i++) {
    if (a.getX(i) !== group) continue;
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);      // skinned: the raw positions are not in world space
    const near = segs.some(s => {
      const t = THREE.MathUtils.clamp(v.clone().sub(s.A).dot(s.d) / s.d.lengthSq(), 0, 1);
      return v.distanceTo(s.A.clone().addScaledVector(s.d, t)) < s.r;
    });
    if (near) a.setX(i, 0); else kept++;
  }
  a.needsUpdate = true;
  return kept;
}

// Cloth that lies on a limb at rest (the apron strap and its ruffle over the shoulder) stays on it: per vertex of
// `group`, aWrap = (its rest distance from the nearest of the capsules `idx` of that group, that capsule's index, how
// much it belongs to the limb: 1 lying on it, fading to 0 `fade` further out). The shader then keeps that distance
// from the limb's axis at least: a shoulder that swings into the cloth lifts it and the cloth stretches over the
// sleeve; a shoulder that swings away leaves it where the skinning put it.
export function wrapVertices(mesh, group, caps, idx, fade = [0.002, 0.02]) {
  const g = mesh.geometry, a = g.attributes.aPush, n = a.count, wrap = new Float32Array(n * 3), v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  const segs = idx.map(i => { const A = caps[i].a.getWorldPosition(new THREE.Vector3()); return {i, A, d: caps[i].b.getWorldPosition(new THREE.Vector3()).sub(A), r: caps[i].radius}; });
  let count = 0;
  for (let i = 0; i < n; i++) {
    wrap[i * 3 + 1] = -1;
    if (a.getX(i) !== group) continue;
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    let best = null, bd = Infinity;
    for (const s of segs) {
      const t = THREE.MathUtils.clamp(v.clone().sub(s.A).dot(s.d) / s.d.lengthSq(), 0, 1), d = v.distanceTo(s.A.clone().addScaledVector(s.d, t));
      if (d - s.r < bd) { bd = d - s.r; best = s; wrap[i * 3] = d; }
    }
    const k = 1 - THREE.MathUtils.smoothstep(bd, fade[0], fade[1]);
    wrap[i * 3 + 1] = best.i; wrap[i * 3 + 2] = k;
    if (k > 0) count++;
  }
  g.setAttribute('aWrap', new THREE.BufferAttribute(wrap, 3));
  return count;
}

const MAX = 12;
// groups: [{caps: [{a, b, radius, from?, ext?}], axis: bone | null, maxPush}] — group i acts on vertices marked i + 1;
// with `axis` the push is outward from the vertical axis through that bone (cloth), else away from each capsule (hair);
// `inward` with an axis: toward the axis instead, to just under the capsule (the clothes on the chest lie under an arm
// that crosses them, they do not come through the sleeve)
export class Pusher {
  constructor(mesh, groups, margin = 0.004) {
    this.mesh = mesh;
    this.groups = groups.map(g => ({...g, caps: g.caps.slice(0, MAX),
      axisUpLocal: g.axis ? new THREE.Vector3(0, 1, 0).applyQuaternion(g.axis.getWorldQuaternion(new THREE.Quaternion()).invert()) : null}));
    this.margin = margin;
    this.uniforms = {uGround:{value:new THREE.Vector4(0,1,0,1e6)}};
    this.groups.forEach((g, n) => Object.assign(this.uniforms, {
      ['uA' + n]: {value: Array.from({length: MAX}, () => new THREE.Vector3())},
      ['uB' + n]: {value: Array.from({length: MAX}, () => new THREE.Vector3())},
      ['uR' + n]: {value: new Float32Array(MAX)},
      ['uContact' + n]: {value: new Float32Array(MAX)},
      ['uN' + n]: {value: g.caps.length},
      ['uMax' + n]: {value: 0.03},
      ['uAxisO' + n]: {value: new THREE.Vector3()}, ['uAxisUp' + n]: {value: new THREE.Vector3(0, 1, 0)},
    }));
  }
  // chain into a material's onBeforeCompile
  patch(sh) {
    Object.assign(sh.uniforms, this.uniforms);
    const decl = this.groups.map((g, n) =>
      `uniform vec3 uA${n}[${MAX}], uB${n}[${MAX}]; uniform float uR${n}[${MAX}], uContact${n}[${MAX}], uMax${n}; uniform int uN${n}; uniform vec3 uAxisO${n}, uAxisUp${n};`).join('\n');
    const body = this.groups.map((g, n) => `
        if (abs(aPush - ${n + 1}.0) < 0.5) {
          ${g.axis && g.inward && g.wrap ? `
          if (aWrap.z > 0.0) {
            int j = int(aWrap.y + 0.5);
            vec3 ab = uB${n}[j] - uA${n}[j];
            vec3 c = uA${n}[j] + ab * clamp(dot(transformed - uA${n}[j], ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0), d = transformed - c;
            float l = length(d);
            // lifted by the limb, never dragged after it: only cloth that would sink into the sleeve moves, to lie on it
            if (l > 1e-6) transformed = c + d / l * max(l, mix(l, min(aWrap.x, uR${n}[j] + 0.008), aWrap.z));
          }
          transformed = mix(pushUnder(transformed, uA${n}, uB${n}, uR${n}, uN${n}, uAxisO${n}, uAxisUp${n}, uMax${n}), transformed, aWrap.z);`
          : g.axis && g.inward ? `transformed = pushUnder(transformed, uA${n}, uB${n}, uR${n}, uN${n}, uAxisO${n}, uAxisUp${n}, uMax${n});`
          : g.axis ? `transformed = pushAxis(transformed, uA${n}, uB${n}, uR${n}, uContact${n}, uN${n}, uAxisO${n}, uAxisUp${n}, uMax${n});`
                   : `transformed = pushRadial(transformed, uA${n}, uB${n}, uR${n}, uN${n}, uMax${n});`}
        }`).join('');
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', `
        attribute float aPush;
        uniform vec4 uGround;
        ${this.groups.some(g => g.wrap) ? 'attribute vec3 aWrap;' : ''}
        ${decl}
        const float K_PUSH = 0.012;
        // out along the horizontal ray from the axis through p, past every capsule that ray crosses
        vec3 pushAxis(vec3 p, vec3 A[${MAX}], vec3 B[${MAX}], float R[${MAX}], float C[${MAX}], int N, vec3 o, vec3 up, float mx) {
          vec3 O = o + up * dot(p - o, up), w = p - O;
          float sv = length(w);
          if (sv < 1e-5) return p;
          vec3 u = w / sv;
          float sOut = -1e9;
          float contactPush = 0.0;
          for (int i = 0; i < ${MAX}; i++) {
            if (i >= N) break;
            vec3 d2 = B[i] - A[i], r = O - A[i];
            float b = dot(u, d2), c = dot(u, r), e = dot(d2, d2), f = dot(d2, r);
            float t = clamp((f - b * c) / max(e - b * b, 1e-9), 0.0, 1.0);
            float s = t * b - c;
            t = clamp(dot(O + u * s - A[i], d2) / max(e, 1e-9), 0.0, 1.0);
            s = dot(A[i] + d2 * t - O, u);
            float h = length(O + u * s - A[i] - d2 * t);
            if (h < R[i]) {
              float end = s + sqrt(R[i] * R[i] - h * h);
              if (C[i] > 0.5) {
                float d = length(p - A[i] - d2 * clamp(dot(p - A[i], d2) / max(e, 1e-9), 0.0, 1.0));
                float contact = 1.0 - smoothstep(R[i] - K_PUSH, R[i] + K_PUSH, d);
                if (sv < end + 4.0 * K_PUSH)
                  contactPush = max(contactPush, min(K_PUSH * log(1.0 + exp((sv - end) / K_PUSH)) + end - sv, mx) * contact);
              } else {
                sOut = max(sOut, end);
              }
            }
          }
          if (sOut > 0.0 && sv < sOut + 4.0 * K_PUSH)
            contactPush = max(contactPush, min(K_PUSH * log(1.0 + exp((sv - sOut) / K_PUSH)) + sOut - sv, mx));
          return p + u * contactPush;
        }
        // in along the same ray, to just under a capsule it crosses. The capsule is taken a little fatter (F_UNDER)
        // and the push eases off across that rim, so the cloth beside the limb dips with the cloth under it instead
        // of tearing along the limb's edge; it also fades toward the capsule's far side (a limb deeper than the
        // cloth is not something the cloth can duck under)
        vec3 pushUnder(vec3 p, vec3 A[${MAX}], vec3 B[${MAX}], float R[${MAX}], int N, vec3 o, vec3 up, float mx) {
          const float F_UNDER = 0.025;
          vec3 O = o + up * dot(p - o, up), w = p - O;
          float sv = length(w);
          if (sv < 1e-5) return p;
          vec3 u = w / sv;
          float push = 0.0;
          for (int i = 0; i < ${MAX}; i++) {
            if (i >= N) break;
            vec3 d2 = B[i] - A[i], r = O - A[i];
            float b = dot(u, d2), c = dot(u, r), e = dot(d2, d2), f = dot(d2, r);
            float t = clamp((f - b * c) / max(e - b * b, 1e-9), 0.0, 1.0);
            float s = t * b - c;
            t = clamp(dot(O + u * s - A[i], d2) / max(e, 1e-9), 0.0, 1.0);
            s = dot(A[i] + d2 * t - O, u);
            float h = length(O + u * s - A[i] - d2 * t), Rf = R[i] + F_UNDER;
            if (h >= Rf) continue;
            float half_ = sqrt(Rf * Rf - h * h), sIn = s - half_, sFar = s + half_;
            if (sFar < 0.0 || sv > sFar) continue;
            float target = sIn - K_PUSH * log(1.0 + exp(min((sIn - sv) / K_PUSH, 30.0)));
            float rim = 1.0 - smoothstep(R[i] - 0.01, Rf, h);
            push = max(push, min(sv - target, mx) * rim * clamp((sFar - sv) / (0.35 * (sFar - sIn)), 0.0, 1.0));
          }
          return O + u * (sv - push);
        }
        // away from each capsule's own axis
        vec3 pushRadial(vec3 p, vec3 A[${MAX}], vec3 B[${MAX}], float R[${MAX}], int N, float mx) {
          for (int i = 0; i < ${MAX}; i++) {
            if (i >= N) break;
            vec3 ab = B[i] - A[i];
            float t = clamp(dot(p - A[i], ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
            vec3 c = A[i] + ab * t, d = p - c;
            float l = length(d);
            if (l > 1e-6 && l < R[i] + 4.0 * K_PUSH)
              p = c + d / l * (l + min(K_PUSH * log(1.0 + exp((l - R[i]) / K_PUSH)) + R[i] - l, mx));
          }
          return p;
        }
        void main() {`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>${body}
        float floorDepth=dot(uGround.xyz,transformed)+uGround.w;
        if(aPush>0.5&&floorDepth<0.0) transformed-=uGround.xyz*floorDepth/max(dot(uGround.xyz,uGround.xyz),1e-9);
      `);
  }
  // capsule ends into the mesh's local space; call every frame after the skeleton is posed
  update() {
    const floor=this.ground?.(),m=this.mesh.matrixWorld.elements;
    this.uniforms.uGround.value.set(m[1],m[5],m[9],floor==null?1e6:m[13]-floor);
    const inv = this.mesh.matrixWorld.clone().invert(), s = this.mesh.matrixWorld.getMaxScaleOnAxis();
    this.groups.forEach((g, n) => {
      const U = this.uniforms;
      g.caps.forEach((c, i) => {
        const A = U['uA' + n].value[i], B = U['uB' + n].value[i];
        c.a.getWorldPosition(A); c.b.getWorldPosition(B);
        const d = B.clone().sub(A);
        if (c.ext) B.addScaledVector(d, c.ext);
        if (c.from) A.addScaledVector(d, c.from);
        A.applyMatrix4(inv); B.applyMatrix4(inv);
        U['uR' + n].value[i] = (c.radius + this.margin) / s;
        U['uContact' + n].value[i] = c.contactOnly ? 1 : 0;
      });
      U['uMax' + n].value = (g.maxPush ?? 0.03) / s;
      if (g.axis) {
        g.axis.getWorldPosition(U['uAxisO' + n].value).applyMatrix4(inv);
        U['uAxisUp' + n].value.copy(g.axisUpLocal).applyQuaternion(g.axis.getWorldQuaternion(new THREE.Quaternion())).transformDirection(inv);
      }
    });
  }
}

// ---- the body's surface for the hands -------------------------------------------------------------------------------
// The hands are placed on the body and kept out of it by measurement, not by numbers typed per pose or per motion:
// restVertices reads the skinned mesh once, a Shell is a star-shaped surface fitted to some of those vertices (the
// head as a ball around its centre; the chest and the dress as columns around a vertical axis), fitBall finds the fist.

// vertex positions at rest (world) and share(i, re): how much of vertex i's weight sits on bones whose name matches
export function restVertices(mesh) {
  const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = mesh.skeleton.bones;
  const n = g.attributes.position.count, pos = new Float32Array(n * 3), v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
  const hits = new Map();
  const share = (i, re) => {
    let hit = hits.get(re);
    if (!hit) hits.set(re, hit = bones.map(b => re.test(b.name)));
    let s = 0;
    for (let k = 0; k < 4; k++) if (hit[si.getComponent(i, k)]) s += sw.getComponent(i, k);
    return s;
  };
  // the vertices at least `min` on the bones matching re (and passing `where`), as points
  const pick = (re, min = 0.5, where = null) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (share(i, re) < min) continue;
      const p = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      if (!where || where(p)) out.push(p);
    }
    return out;
  };
  return {n, pos, share, pick};
}

// robust middle of a cloud of points: halfway between its 3% and 97% bounds on each axis
export function middle(points, lo = 0.03) {
  const mid = k => { const a = points.map(p => p.getComponent(k)).sort((x, y) => x - y); return (a[Math.floor(a.length * lo)] + a[Math.floor(a.length * (1 - lo))]) / 2; };
  return new THREE.Vector3(mid(0), mid(1), mid(2));
}

// the ball at the far end of a limb's surface (her mitten fist; the hand joint itself lies past it): how thick the last
// `len` of the surface along `dir` from `origin` is around its own middle, as a ball touching the tip
export function fitTip(points, origin, dir, len = 0.03, pct = 0.75) {
  const rel = points.map(p => p.clone().sub(origin)), ts = rel.map(p => p.dot(dir)).sort((x, y) => x - y);
  if (ts.length < 8) return null;
  const tip = ts[Math.floor(ts.length * 0.99)];
  const side = rel.filter(p => p.dot(dir) > tip - len).map(p => p.addScaledVector(dir, -p.dot(dir)));   // off the axis
  const mid = side.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / side.length);
  const d = side.map(p => p.distanceTo(mid)).sort((x, y) => x - y);
  const radius = d[Math.floor(d.length * pct)];
  return {centre: origin.clone().addScaledVector(dir, tip - radius).add(mid), radius, count: side.length};
}

const TAU = 2 * Math.PI;
// Star-shaped surface riding on `bone`: per direction, how far the outermost of `points` (rest pose, world) lies
//   kind 'ball':   from `centre`, by longitude × latitude
//   kind 'column': from the vertical axis through `centre`, by azimuth × height between y0 and y1
// Longitude / azimuth: 0 straight ahead (+z), growing toward her left (+x).
export class Shell {
  constructor(bone, points, {kind = 'ball', centre, y0 = 0, y1 = 1, nu = 36, nv = kind === 'ball' ? 18 : 10} = {}) {
    Object.assign(this, {bone, kind, centre: centre.clone(), y0, y1, nu, nv});
    this.rest = bone.matrixWorld.clone();
    this.restInv = this.rest.clone().invert();
    this.toRest = new THREE.Matrix4();
    this.toWorld = new THREE.Matrix4();
    const grid = this.grid = new Float32Array(nu * nv);
    for (const p of points) {
      const c = this.coords(p);
      if (c.v < 0 || c.v >= nv) continue;
      const k = Math.min(nu - 1, Math.floor(c.u)) + nu * Math.floor(c.v);
      if (c.r > grid[k]) grid[k] = c.r;
    }
    // a lone spike (a stray strand, a bow's tip) does not make the surface: at most 1.25 × the median of the cells around
    const med = grid.slice();
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = [];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = j + dj;
        if (jj < 0 || jj >= nv) continue;
        const r = grid[(i + di + nu) % nu + nu * jj];
        if (r) a.push(r);
      }
      a.sort((x, y) => x - y);
      if (a.length > 2 && grid[i + nu * j]) med[i + nu * j] = Math.min(grid[i + nu * j], 1.25 * a[a.length >> 1]);
    }
    grid.set(med);
    // directions nothing was seen in (the neck hole under the head) take their neighbours' mean
    for (let pass = 0; pass < nu + nv && grid.some(r => !r); pass++) {
      const next = grid.slice();
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        if (grid[i + nu * j]) continue;
        let s = 0, c = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jj = j + dj;
          if (jj < 0 || jj >= nv) continue;
          const r = grid[(i + di + nu) % nu + nu * jj];
          if (r) { s += r; c++; }
        }
        if (c) next[i + nu * j] = s / c;
      }
      grid.set(next);
    }
    this.sync();
  }
  // once a frame, after the skeleton is posed
  sync() {
    this.toWorld.multiplyMatrices(this.bone.matrixWorld, this.restInv);
    this.toRest.copy(this.toWorld).invert();
  }
  // q in the rest frame → cell coordinates (u along longitude, v along latitude / height), distance r, outward unit `out`
  coords(q) {
    const d = q.clone().sub(this.centre);
    if (this.kind === 'column') d.y = 0;
    const r = d.length() || 1e-9, out = d.multiplyScalar(1 / r);
    const u = ((Math.atan2(out.x, out.z) / TAU + 1) % 1) * this.nu;
    const v = this.kind === 'ball' ? (Math.asin(THREE.MathUtils.clamp(out.y, -1, 1)) / Math.PI + 0.5) * this.nv
      : (q.y - this.y0) / (this.y1 - this.y0) * this.nv;
    return {u, v, r, out};
  }
  // surface radius at cell coordinates, bilinear between cell centres; a column ends softly half a cell past its range
  radius(u, v) {
    const {nu, nv, grid} = this;
    let fade = 1;
    if (this.kind === 'column') {
      if (v < -0.5 || v > nv + 0.5) return 0;
      fade = Math.min(1, (v + 0.5) * 2, (nv + 0.5 - v) * 2);
    }
    const fu = u - 0.5, fv = THREE.MathUtils.clamp(v - 0.5, 0, nv - 1);
    const i0 = Math.floor(fu), j0 = Math.min(nv - 2, Math.floor(fv)), a = fu - i0, b = fv - j0;
    const g = (i, j) => grid[((i % nu) + nu) % nu + nu * Math.max(0, j)];
    return fade * ((g(i0, j0) * (1 - a) + g(i0 + 1, j0) * a) * (1 - b) + (g(i0, j0 + 1) * (1 - a) + g(i0 + 1, j0 + 1) * a) * b);
  }
  // the surface point at cell coordinates (rest frame, world)
  at(u, v) {
    const R = this.radius(u, v), lon = u / this.nu * TAU;
    if (this.kind === 'column')
      return new THREE.Vector3(this.centre.x + Math.sin(lon) * R, this.y0 + v / this.nv * (this.y1 - this.y0), this.centre.z + Math.cos(lon) * R);
    const lat = (v / this.nv - 0.5) * Math.PI, k = Math.cos(lat) * R;
    return new THREE.Vector3(Math.sin(lon) * k, Math.sin(lat) * R, Math.cos(lon) * k).add(this.centre);
  }
  // where the surface lies in the direction of q (rest frame, world; a ball looks from its centre, a column from its
  // axis at q's height): the point p there and the outward normal n, from the cells around
  surface(q) {
    const c = this.coords(q), v = this.kind === 'column' ? THREE.MathUtils.clamp(c.v, 1, this.nv - 1) : c.v;
    const du = this.at(c.u + 1, v).sub(this.at(c.u - 1, v)), dv = this.at(c.u, v + 1).sub(this.at(c.u, v - 1));
    const n = du.cross(dv).normalize();
    if (n.dot(c.out) < 0) n.negate();
    return {p: this.at(c.u, c.v), n};
  }
  // a ball's front surface straight ahead of (x, y) (rest frame, world), e.g. a spot on the face
  front(x, y) {
    const q = new THREE.Vector3(x, y, this.centre.z + 0.1);
    for (let i = 0; i < 12; i++) q.z = this.at(this.coords(q).u, this.coords(q).v).z;
    return this.surface(q);
  }
  // a column's surface at an azimuth (radians, 0 ahead, + toward her left) and a height fraction 0..1
  around(az, h) {
    const y = this.y0 + h * (this.y1 - this.y0);
    return this.surface(new THREE.Vector3(this.centre.x + Math.sin(az), y, this.centre.z + Math.cos(az)));
  }
  // how far a world point is inside the surface grown by `margin` (≤ 0: outside)
  depth(p, margin = 0) {
    const c = this.coords(p.clone().applyMatrix4(this.toRest)), R = this.radius(c.u, c.v);
    return R ? R + margin - c.r : -1;
  }
  // move a world point out to the surface grown by `margin`; returns how far it was inside
  push(p, margin = 0) {
    const q = p.clone().applyMatrix4(this.toRest), c = this.coords(q), R = this.radius(c.u, c.v);
    const d = R ? R + margin - c.r : -1;
    if (d > 0) p.copy(q.addScaledVector(c.out, d)).applyMatrix4(this.toWorld);
    return d;
  }
}
