// Desktop-pet mode (?pet=1; desktop/main.swift wraps the page in a transparent window): no controls, clear background,
// 30 fps, and she can be picked up. Holding the mouse on her and moving grabs her: the window follows the pointer (moved
// by the native shell; in a plain browser the canvas is shifted instead) and she hangs from the very point she was taken
// by (the ray's hit on the mesh), as a rigid pendulum about it: her centre of mass (the mean of her vertices; the big
// head puts it at her chin) falls to straight under the hand and swings there, slower the further from it she is held.
// By the bow on her head she hangs upright and barely turns; by an arm she hangs askew. A grab below her centre stays
// upright until the hand lifts it; pulling it down brings her upright again. The hand's acceleration drives the swing,
// so she trails behind it and swings on when it
// stops. The window is kept centred on her (its shift is cancelled by moving the camera), the legs pedal, then dangle,
// the arms go stiff, hair, skirt and tail are thrown about by the same motion (the model's root really moves, so the
// spring bones feel it). Shaken hard she squeezes her eyes shut; let go, she drops, lands with a dip and complains.
import * as THREE from 'three';
import {PetLife} from './life.js';
import {setLanguage,getLanguage} from './i18n.js';

const RIGHT = new THREE.Vector3(1, 0, 0), FWD = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp, pick = a => a[Math.floor(Math.random() * a.length)];
const HELD = first => ({id: 'held', cn: '被抓住', repeat: 'loop', steps: first
  ? [{t: 0, face: 'shocked', arms: {both: 'cheer'}, ears: 1}, {t: 0.9, face: 'scared', arms: {both: 'stiff'}}, {t: 11}]
  : [{t: 0, face: 'scared', arms: {both: 'stiff'}}, {t: 11}]});
const LAND = dizzy => ({id: 'land', cn: '落地', steps: [{t: 0, body: {up: -1}, arms: {both: 'out'}, face: dizzy ? 'squeeze' : 'surprised'},
  {t: 0.28, body: {up: 0}, arms: {both: 'down'}}, {t: 0.9, face: dizzy ? 'sulky' : 'pout'}, {t: 2.4}]});

// x: {state, scene, camera, controls, renderer, canvas, model(), mover(), pose, move, say, resize}
export function setupPet(x) {
  const {state, camera, canvas, renderer} = x, native = window.webkit?.messageHandlers?.pet;
  const post = m => native?.postMessage(m);
  document.documentElement.classList.add('pet');
  x.scene.traverse(o => { if (o.geometry?.type === 'PlaneGeometry') o.visible = false; });     // the floor shadow
  x.controls.enabled = false;
  camera.position.set(0, 0.52, 3.0); x.controls.target.set(0, 0.52, 0); camera.lookAt(0, 0.52, 0);
  state.pet = true;
  const h = {held: false, w: 0, ax: 0, ay: 0, vx: 0, vy: 0, th: 0, thV: 0, tilt: 0, off: new THREE.Vector3(), offV: new THREE.Vector3(),
    pivotW: new THREE.Vector3(0, 0.6, 0.05), pivotL: new THREE.Vector3(0, 0.6, 0.05), com: null, L: 0.2, a0: 0,
    lower: false, lifted: false, liftMix: 0, dragY: 0, edgeY: 0, liftThreshold: 12,
    orbit: 0, bodySpin: 0, spinSick: false, spinSaidAt: -99,
    c: new THREE.Vector2(), flipped: false, t0: 0, shake: 0, dizzy: false, css: [0, 0], sh: [0, 0], pv: [0, 0], now: 0, ready: false};
  const metresPerPx = () => 2 * camera.position.distanceTo(x.controls.target) * Math.tan(camera.fov * Math.PI / 360) / canvas.clientHeight;
  const life = new PetLife({...x, post, scale: () => canvas.clientWidth / 360,
    settling: () => h.w > 0.02 || Math.abs(h.th) + Math.abs(h.thV) > 0.03});
  state.petLife = life;
  const attend = () => { state.petAttendUntil = state.time + 0.6; life.interrupt(3); };

  // is she drawn at this point of the window? (the shell asks 20 times a second and lets the mouse through elsewhere)
  const gl = renderer.getContext(), px = new Uint8Array(4);
  function hit(cx, cy, intentional = true) {
    const bubble = document.querySelector('#bubble.interactive.show');
    if (bubble) {
      const b = bubble.getBoundingClientRect();
      if (cx >= b.left && cx < b.right && cy >= b.top && cy < b.bottom) { if (intentional) attend(); return true; }
    }
    const r = canvas.getBoundingClientRect(), u = (cx - r.left) / r.width, v = (cy - r.top) / r.height;
    state.lookTarget.set(clamp(u * 2 - 1, -1.6, 1.6), clamp(-(v * 2 - 1) + 0.25, -1.2, 1.4));
    if (h.held) return true;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    gl.readPixels(Math.floor(u * canvas.width), Math.floor((1 - v) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const drawn = px[3] > 24;
    if (drawn && intentional) attend();
    return drawn;
  }
  const base = camera.position.clone(), baseT = x.controls.target.clone();
  let restPoints=null,footprintSize='';
  function reportFootprint(){
    const size=canvas.clientWidth+':'+canvas.clientHeight;
    if(!restPoints||size===footprintSize||!canvas.clientHeight)return;
    const cam=camera.clone();cam.position.copy(base);cam.lookAt(baseT);cam.updateMatrixWorld(true);cam.updateProjectionMatrix();
    const bounds={left:1,top:1,right:0,bottom:0};
    for(const point of restPoints){const v=point.clone().project(cam),u=(v.x+1)/2,y=(1-v.y)/2;
      bounds.left=Math.min(bounds.left,u);bounds.right=Math.max(bounds.right,u);bounds.top=Math.min(bounds.top,y);bounds.bottom=Math.max(bounds.bottom,y);}
    const x0=clamp(bounds.left,0,.45),y0=clamp(bounds.top,0,.45),x1=clamp(bounds.right,.55,1),y1=clamp(bounds.bottom,.55,1);
    footprintSize=size;post({type:'footprint',x:x0,y:y0,width:x1-x0,height:y1-y0});
  }
  function host(data){
    if(data.language&&getLanguage()!==data.language){setLanguage(data.language);state.bubbleUntil=0;document.querySelector('#bubble')?.classList.remove('show');}
    if(data.viewport){const v=data.viewport,b=document.querySelector('#bubble'),width=Math.max(80,v.right-v.left-16);
      b.style.left=(v.left+v.right)/2+'px';b.style.top=(v.top+8)+'px';b.style.maxWidth=Math.min(420,width)+'px';}
    life.host(data);
  }
  function begin(cx, cy) {
    if (h.held || !state.ready || !h.com) return;
    life.interrupt(8);
    const m = x.model(), r = canvas.getBoundingClientRect(), k = metresPerPx();
    m.updateMatrixWorld(true);
    // where she is held: the point of her under the pointer
    const p = x.hitPoint(cx, cy) ?? new THREE.Vector3(camera.position.x + (cx - r.left - r.width / 2) * k, camera.position.y - (cy - r.top - r.height / 2) * k, 0.05);
    h.pivotW.copy(p); h.pivotL.copy(m.worldToLocal(p.clone()));
    // the pendulum: from the hand to her centre of mass, in the plane of the screen; a0 = its angle from straight down
    // while she is upright (0 held from above, ±π held by a foot)
    const rx = h.com.x - h.pivotL.x, ry = h.com.y - h.pivotL.y;
    h.L = Math.max(0.07, Math.hypot(rx, ry)); h.a0 = Math.atan2(rx, -ry);
    Object.assign(h, {held: true, t0: h.now, shake: 0, dizzy: false, flipped: false, ax: 0, ay: 0,
      lower: ry > 0, lifted: false, liftMix: 0, dragY: 0, edgeY: 0, liftThreshold: clamp(0.03 / k, 8, 18),
      orbit: 0, bodySpin: 0, spinSick: false});
    state.petHeld = state.petGrab = true;
    x.mover()?.stop(); x.move(HELD(true));
    x.say(pick(['哇！', '诶诶诶？', '要、要去哪里呀']));
    post({type: 'grab'});
  }
  // the pointer moved this far (screen px, y down) since the last call
  function dragBy(dx, dy) {
    if (!h.held) return;
    h.ax += dx; h.ay += dy;
    if (h.lower) {
      // Screen y grows downward. Measure from the latest turning point, not the original grab: lifting after a long
      // downward drag should work too. A small dead band ignores hand tremor; stopping preserves the current mode.
      h.dragY += dy;
      h.edgeY = h.lifted ? Math.min(h.edgeY, h.dragY) : Math.max(h.edgeY, h.dragY);
      if ((!h.lifted && h.edgeY - h.dragY >= h.liftThreshold) ||
          (h.lifted && h.dragY - h.edgeY >= h.liftThreshold)) {
        h.lifted = !h.lifted; h.edgeY = h.dragY;
      }
    }
    if (!native) { h.css[0] += dx; h.css[1] += dy; canvas.style.transform = `translate(${h.css[0]}px,${h.css[1]}px)`; }
  }
  function release() {
    if (!h.held) return;
    h.held = false; state.petHeld = false;
    setTimeout(() => { state.petGrab = false; }, 300);       // the click that ends a drag is not a poke
    x.mover()?.stop(); x.move(LAND(h.dizzy));
    x.say(h.spinSick ? pick(['世界还在转……', '让我缓缓，呜……'])
      : h.dizzy ? pick(['晕、晕了…', '转圈圈…']) : pick(['呼…', '到啦？', '下次轻一点嘛']));
  }
  let cand = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !hit(e.clientX, e.clientY)) return;
    cand = {x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, timer: setTimeout(() => cand && begin(cand.x, cand.y), 220)};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!cand) return;
    if (!h.held && Math.hypot(e.screenX - cand.sx, e.screenY - cand.sy) > 4) begin(cand.x, cand.y);
    if (h.held && !native) dragBy(e.screenX - cand.sx, e.screenY - cand.sy);
    cand.sx = e.screenX; cand.sy = e.screenY;
  });
  const up = () => { if (cand) clearTimeout(cand.timer); cand = null; if (!native) release(); else if (h.held) post({type:'release'}); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  // A reply is also reachable when no bubble is showing, without opening the menu bar.
  canvas.addEventListener('contextmenu', e => {
    if (native && hit(e.clientX, e.clientY)) { e.preventDefault(); post({type: 'chat'}); }
  });

  const q = new THREE.Quaternion(), e3 = new THREE.Euler(), prev = [0, 0];
  // every frame, after the moves have posed her and before the spring bones
  function update(dt, t) {
    const m = x.model();
    if (!m || dt <= 0) return;
    if (!h.ready) { h.ready = true; post({type: 'ready'}); }
    h.now = t;
    if (!h.com) {      // her centre of mass: the mean of her vertices at rest
      const mesh = x.mesh(), v = new THREE.Vector3(), sum = new THREE.Vector3(), cnt = mesh.geometry.attributes.position.count;
      let c = 0;
      for (let i = 0; i < cnt; i += 23) { sum.add(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld)); c++; }
      h.com = sum.multiplyScalar(1 / c); h.com.z = 0.05;
      restPoints=[];
      for(let i=0;i<cnt;i++)restPoints.push(mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    }
    reportFootprint();
    const k = metresPerPx(), a = 1 - Math.exp(-dt * 18), oldVX = h.vx, oldVY = h.vy;
    h.vx += (h.ax * k / dt - h.vx) * a; h.vy += (-h.ay * k / dt - h.vy) * a; h.ax = h.ay = 0;
    // Count sustained, signed turns of the hand's velocity. Straight shakes reverse by ~π and are excluded;
    // a single lift/flip is far below the threshold. Either direction of circling works.
    const speed = Math.hypot(h.vx, h.vy), oldSpeed = Math.hypot(oldVX, oldVY);
    const turn = Math.atan2(oldVX * h.vy - oldVY * h.vx, oldVX * h.vx + oldVY * h.vy);
    const circling = h.held && speed > 0.16 && oldSpeed > 0.16 && Math.abs(turn) < 1.0;
    h.orbit = h.orbit * Math.exp(-dt / 6) + (circling ? turn : 0);
    h.shake = h.shake * Math.exp(-dt / 1.2) + Math.hypot(h.vx - prev[0], h.vy - prev[1]) * 0.15; prev[0] = h.vx; prev[1] = h.vy;
    if (h.held) {
      if (h.spinSick && !x.face()?.reaction) { h.spinSick = false; h.orbit = h.bodySpin = 0; }
      if (!h.dizzy && h.shake > 2.8) { h.dizzy = true; x.face()?.set('squeeze', 0, t, 3); x.say(pick(['呜哇哇哇', '别、别摇啦！'])); }
      if (x.mover() && x.mover().playing !== 'held') x.move(HELD(false));
    }
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), st = dt / n;
    const accX = clamp((h.vx - h.pv[0]) / dt, -30, 30), accY = clamp((h.vy - h.pv[1]) / dt, -30, 30); h.pv[0] = h.vx; h.pv[1] = h.vy;
    const offT = h.held ? new THREE.Vector3(clamp(-h.vx * 0.03, -0.05, 0.05), clamp(-h.vy * 0.03, -0.05, 0.05), 0) : new THREE.Vector3();
    h.liftMix += ((h.lifted ? 1 : 0) - h.liftMix) * (1 - Math.exp(-dt * 8));
    if (!h.held) h.th = Math.atan2(Math.sin(h.th), Math.cos(h.th));       // let go: upright again the short way round
    const beforeAngle = h.th;
    for (let i = 0; i < n; i++) {
      if (h.held) {
        if (h.lower) {
          // Support a low grab while pulling down; only an upward lift lets her hang from it. Blend the resting angle
          // and damp the turn so a reversal cannot snap or send her into a full spin. Keep a little sideways sway.
          const w0 = clamp(Math.sqrt(9.8 / h.L) * 1.25, 6, 12);
          const target = -h.a0 * h.liftMix + clamp(-accX * 0.012, -0.25, 0.25);
          h.thV += (w0 * w0 * (target - h.th) - 2 * 0.72 * w0 * h.thV) * st;
        } else {
          // Upper grabs keep the free pendulum: gravity and hand acceleration act on the centre of mass.
          const phi = h.a0 + h.th, w0 = Math.sqrt(9.8 / h.L);
          h.thV += (-(9.8 * Math.sin(phi) + accX * Math.cos(phi) + accY * Math.sin(phi)) / h.L - 2 * 0.17 * w0 * h.thV) * st;
        }
      } else h.thV += (121 * -h.th - 2 * 0.5 * 11 * h.thV) * st;
      h.th += h.thV * st;
      h.offV.addScaledVector(offT.clone().sub(h.off), 200 * st).multiplyScalar(Math.exp(-14 * st)); h.off.addScaledVector(h.offV, st);
    }
    if (h.held && !h.flipped && Math.abs(Math.atan2(Math.sin(h.th), Math.cos(h.th))) > 2.2) { h.flipped = true; x.say(pick(['倒、倒过来了！', '裙子、裙子！', '血要流到头上啦'])); }
    const bodyTurn = h.held ? h.th - beforeAngle : 0;
    h.bodySpin = h.bodySpin * Math.exp(-dt / 6) + bodyTurn;
    if (h.held && (Math.abs(h.orbit) > 8 || Math.abs(h.bodySpin) > 8)) {
      if (!h.spinSick) {
        h.spinSick = h.dizzy = true;
        if (t - h.spinSaidAt > 6) { h.spinSaidAt = t; x.say(pick(['转、转成奶昔了……', '眼前好多小鲸……', '咕噜咕噜……停一下……'])); }
        x.face()?.react('dizzy', 4, t);
      }
    }
    if (h.spinSick && h.held && ((circling && Math.abs(turn) > 0.01) || Math.abs(bodyTurn) / dt > 1.5)) x.face()?.react('dizzy', 4, t);
    h.w += ((h.held ? 1 : 0) - h.w) * (1 - Math.exp(-dt * (h.held ? 12 : 9)));
    h.tilt = 0.14 * h.w * Math.cos(h.th);
    const settled = !h.held && Math.abs(h.th) + Math.abs(h.thV) * 0.05 + h.off.length() + h.w < 2e-3;
    if (settled) {
      // back on her feet where she was put down: the leftover offset goes to the camera, so nothing is seen to move
      h.c.x -= m.position.x; h.c.y -= m.position.y;
      m.position.set(0, 0, 0); m.quaternion.identity(); h.th = h.thV = 0; h.pivotW.copy(h.pivotL);
    } else {
      q.setFromEuler(e3.set(h.tilt, 0, h.th));
      m.quaternion.copy(q);
      m.position.copy(h.pivotW).sub(h.pivotL.clone().applyQuaternion(q)).add(h.off);
    }
    // the window stays on her: the camera follows her centre of mass and the window is shifted by as much, which leaves
    // the held point under the pointer and her whole body in the window however she hangs
    const cw = h.com.clone().applyQuaternion(m.quaternion).add(m.position), f = 1 - Math.exp(-dt * 10);
    const nx = h.c.x + (cw.x - h.com.x - h.c.x) * f, ny = h.c.y + (cw.y - h.com.y - h.c.y) * f, dx = (nx - h.c.x) / k, dy = (ny - h.c.y) / k;
    h.c.set(nx, ny);
    const sleeping=state.sleepWeight??0,angle=.87*sleeping,distance=3+.4*sleeping;
    x.controls.target.set(baseT.x+nx,baseT.y+ny+.03*sleeping,baseT.z-.12*sleeping);
    camera.position.copy(x.controls.target).add(new THREE.Vector3(0,Math.sin(angle)*distance,Math.cos(angle)*distance));
    camera.lookAt(x.controls.target);
    if (Math.abs(dx) + Math.abs(dy) > 1e-3) {
      // the running total, not the step: the window sits on whole pixels, and steps of a fraction of one were lost
      // one after another (she slid away from the pointer the longer she was carried)
      h.sh[0] += dx; h.sh[1] += dy;
      if (native) post({type: 'shift', x: h.sh[0], y: h.sh[1]}); else { h.css[0] += dx; h.css[1] -= dy; canvas.style.transform = `translate(${h.css[0]}px,${h.css[1]}px)`; }
    }
    if (settled) return;
    // legs: off the ground they pedal in a panic (and again whenever she is moved fast), then hang and swing a beat behind
    const panic = Math.min(1, Math.exp(-(t - h.t0) / 1.3) + Math.hypot(h.vx, h.vy) * 0.5), side = clamp(-0.5 * Math.sin(h.a0 + h.th) - 0.035 * h.thV, -0.6, 0.6);
    for (const [S, ph] of [['Left', 0], ['Right', Math.PI]]) {
      const sw = Math.sin(t * 13 + ph) * 0.45 * panic;
      x.pose(`mixamorig${S}UpLeg`, [RIGHT, (-0.22 + sw) * h.w], [FWD, side * h.w]);
      x.pose(`mixamorig${S}Leg`, [RIGHT, (0.45 + 0.4 * Math.max(0, sw)) * h.w]);
    }
  }
  window.xjPet = {hit, dragBy, release, begin, held: () => h.held, state: h,
    host, interrupt: delay => life.interrupt(delay), prepareVisit: () => life.interrupt(4, false)};
  x.resize();
  return {update, beforeUpdate: (dt, t) => life.update(dt, t), interrupt: delay => life.interrupt(delay)};
}
