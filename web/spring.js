// Spring bones (the VRM spring-bone scheme): each bone's tail is a point that keeps its inertia, is pulled back to the
// rest direction by `stiffness`, falls by `gravity` (m/s, as in VRM), is pushed out of sphere colliders, and the bone is aimed at it.
import * as THREE from 'three';

const SAMPLES = [0.4, 0.7];
const _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Quaternion();
const AXIS = new THREE.Vector3(0, 1, 0); // glTF bones exported from Blender point along local +Y

export class SpringChain {
  // bones: root → tip; opts: {stiffness, drag, gravity (world vector), radius (tip size for colliders),
  //   maxAngle (radians a bone may swing away from its rest direction), axis (() => {o, up}: collide outward from it)}
  constructor(bones, opts) {
    this.opts = {stiffness: 1, drag: 0.4, gravity: new THREE.Vector3(), radius: 0.01, ...opts};
    this.joints = bones.map((bone, i) => {
      const next = bones[i + 1];
      // tip bones have no child: reuse the previous segment's length
      const len = next ? next.position.length() : (i ? bones[i].position.length() : 0.06);
      return {bone, rest: bone.quaternion.clone(), len, tail: new THREE.Vector3(), prev: new THREE.Vector3()};
    });
    this.reset();
  }

  reset() {
    for (const j of this.joints) {
      j.bone.quaternion.copy(j.rest);
      j.bone.updateMatrixWorld(true);
      j.bone.localToWorld(j.tail.copy(AXIS).multiplyScalar(j.len));
      j.prev.copy(j.tail);
    }
  }

  // push every tail by a world-space offset (pokes, hops)
  kick(offset, from = 0) {
    for (const j of this.joints.slice(from)) j.tail.add(offset);
  }

  update(dt, colliders) {
    const {stiffness, drag, gravity, radius, maxAngle} = this.opts;
    for (const j of this.joints) {
      const parent = j.bone.parent;
      parent.updateMatrixWorld(true);
      const head = j.bone.getWorldPosition(_w);
      parent.getWorldQuaternion(_p);
      const restWorld = _q.copy(_p).multiply(j.rest);
      const next = _v.copy(j.tail).sub(j.prev).multiplyScalar(1 - drag).add(j.tail)
        .addScaledVector(AXIS.clone().applyQuaternion(restWorld), stiffness * dt)
        .addScaledVector(gravity, dt);
      next.sub(head).setLength(j.len).add(head);
      // the swing limit first, the colliders last: nothing may pull the bone back into a leg
      if (maxAngle) {
        const rest = AXIS.clone().applyQuaternion(restWorld), d = next.clone().sub(head).normalize();
        const ang = rest.angleTo(d);
        if (ang > maxAngle) {
          const axis = new THREE.Vector3().crossVectors(rest, d);
          if (axis.lengthSq() > 1e-12) next.copy(head).addScaledVector(rest.applyAxisAngle(axis.normalize(), maxAngle), j.len);
        }
      }
      this.collide(head, next, j.len, colliders);
      j.prev.copy(j.tail);
      j.tail.copy(next);
      this.aim(j);
    }
  }

  // push the tail (and points along the bone: a knee in the middle of a skirt panel) out of the colliders.
  // With opts.axis (a skirt), capsules push outward from the body's vertical axis, so the cloth always ends up outside
  // the leg, never behind it; the push from the capsule's own centre would shove the panel behind a knee that is
  // already in front of it.
  collide(head, next, len, colliders) {
    const {radius, axis} = this.opts;
    const ax = axis?.();
    for (let it = 0; it < 3; it++) for (const c of colliders) {
      // Limbs inside the dress push it outward. An external tail only separates a local contact;
      // forcing the cloth to the far side of that tail flips the hem between two solutions.
      if (ax && c.a && !c.contactOnly) {
        for (const f of [1, ...SAMPLES]) {
          const q = _s.copy(head).lerp(next, f);
          const out = outwardExit(q, ax.o, ax.up, c, radius * f);
          if (out) next.addScaledVector(out.u, out.push / f).sub(head).setLength(len).add(head);
        }
        continue;
      }
      const center = c.closest(next);
      const d = next.distanceTo(center), min = c.radius + radius;
      if (d < min) next.sub(center).setLength(min).add(center).sub(head).setLength(len).add(head);
      for (const f of SAMPLES) {
        const q = _s.copy(head).lerp(next, f), o = c.closest(q), dq = q.distanceTo(o), mq = c.radius + radius * f;
        if (dq < mq && dq > 1e-6) next.addScaledVector(q.sub(o).normalize(), (mq - dq) / f).sub(head).setLength(len).add(head);
      }
    }
    const floor=this.opts.floor?.();
    if(floor!=null&&next.y<floor+radius){
      const dy=THREE.MathUtils.clamp(floor+radius-head.y,-len,len),horizontal=Math.sqrt(Math.max(0,len*len-dy*dy));
      const d=next.clone().sub(head);d.y=0;if(d.lengthSq()<1e-9)d.set(0,0,1);
      next.copy(head).add(d.setLength(horizontal));next.y=head.y+dy;
    }
  }

  // after something else moved the tails (Hoop): collide again and re-aim, root to tip
  settle(colliders) {
    for (const j of this.joints) {
      j.bone.parent.updateMatrixWorld(true);
      const head = j.bone.getWorldPosition(new THREE.Vector3());
      j.tail.sub(head).setLength(j.len).add(head);
      this.collide(head, j.tail, j.len, colliders);
      this.aim(j);
    }
  }

  // aim the bone at its tail: rotation from the rest axis to the new direction, in the parent's rest frame
  aim(j) {
    j.bone.parent.updateMatrixWorld(true);
    const head = j.bone.getWorldPosition(new THREE.Vector3());
    const restWorld = j.bone.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(j.rest);
    j.tail.sub(head).setLength(j.len).add(head);
    const dir = j.tail.clone().sub(head).applyQuaternion(restWorld.invert()).normalize();
    j.bone.quaternion.copy(j.rest).multiply(new THREE.Quaternion().setFromUnitVectors(AXIS, dir));
    j.bone.updateMatrixWorld(true);
  }
}

// sphere collider fixed to a bone; offset is in the bone's local space
export function boneCollider(bone, offset, radius) {
  const local = offset.clone(), out = new THREE.Vector3();
  return {radius, closest: () => bone.localToWorld(out.copy(local)), center: () => bone.localToWorld(out.copy(local))};
}

// capsule collider between two bones' pivots (an upper arm: from the arm bone to the forearm bone); `ext` lengthens it
// past the second bone by that fraction (a hand beyond the wrist)
// past the second bone by that fraction (a hand beyond the wrist); `from` starts it part way along (a thigh's top is
// inside the dress's waist and must not push the skirt)
export function capsuleCollider(a, b, radius, ext = 0, from = 0) {
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), ab = new THREE.Vector3(), out = new THREE.Vector3();
  const ends = (A, Bv) => {
    a.getWorldPosition(A); b.getWorldPosition(Bv);
    const d = ab.subVectors(Bv, A);
    if (ext) Bv.addScaledVector(d, ext);
    if (from) A.addScaledVector(d, from);
  };
  return {radius, a, b, ends, closest(p) {
    ends(pa, pb);
    ab.subVectors(pb, pa);
    const t = THREE.MathUtils.clamp(out.subVectors(p, pa).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
    return out.copy(pa).addScaledVector(ab, t);
  }};
}

// A ring of chains that keep their spacing (a stiff skirt): after the chains have moved, each level's tails are pulled
// back toward their rest distances from the neighbours, so a knee pushing one panel carries the panels beside it and
// the bell keeps its shape. `stiffness` 0..1 is how much of the error is removed per pass.
export class Hoop {
  constructor(chains, stiffness = 0.6, passes = 3) {
    this.chains = chains; this.k = stiffness; this.passes = passes;
    const n = chains.length, levels = Math.min(...chains.map(c => c.joints.length));
    this.rest = [];
    for (let l = 0; l < levels; l++)
      this.rest.push(chains.map((c, i) => c.joints[l].tail.distanceTo(chains[(i + 1) % n].joints[l].tail)));
  }
  update() {
    const n = this.chains.length, d = new THREE.Vector3();
    this.rest.forEach((rest, l) => {
      for (let p = 0; p < this.passes; p++) for (let i = 0; i < n; i++) {
        const a = this.chains[i].joints[l].tail, b = this.chains[(i + 1) % n].joints[l].tail;
        d.subVectors(b, a);
        const len = d.length();
        if (len < 1e-6) continue;
        d.multiplyScalar((len - rest[i]) / len * 0.5 * this.k);
        a.add(d); b.sub(d);
      }
      for (const c of this.chains) c.aim(c.joints[l]);
    });
    // the colliders have the last word
    for (const c of this.chains) c.settle(c.colliders ?? []);
  }
}

// how far point q must move outward (horizontally, away from the vertical axis through o) to clear capsule c:
// the ray from the axis through q leaves the capsule at s_out; q at s_q < s_out + extra is moved out to it
export function outwardExit(q, o, up, c, extra = 0) {
  const O = o.clone().addScaledVector(up, q.clone().sub(o).dot(up));
  const w = q.clone().sub(O), sq = w.length();
  if (sq < 1e-6) return null;
  const u = w.divideScalar(sq);
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  c.ends(A, B);
  const s = rayCapsuleExit(O, u, A, B, c.radius + extra);
  return s > sq ? {u, push: s - sq} : null;
}
// far exit distance of the ray O + s·u (u unit) from capsule A–B of radius R, or -Infinity
export function rayCapsuleExit(O, u, A, B, R) {
  const d2 = B.clone().sub(A), r = O.clone().sub(A);
  const b = u.dot(d2), c = u.dot(r), e = d2.dot(d2), f = d2.dot(r);
  const den = e - b * b;
  let t = den > 1e-9 ? THREE.MathUtils.clamp((f - b * c) / den, 0, 1) : 0;
  let s = t * b - c;
  // refine once: closest segment point to the ray point
  t = THREE.MathUtils.clamp(O.clone().addScaledVector(u, s).sub(A).dot(d2) / Math.max(e, 1e-9), 0, 1);
  s = A.clone().addScaledVector(d2, t).sub(O).dot(u);
  const h = O.clone().addScaledVector(u, s).distanceTo(A.clone().addScaledVector(d2, t));
  return h < R ? s + Math.sqrt(R * R - h * h) : -Infinity;
}
