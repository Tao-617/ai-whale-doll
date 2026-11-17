// Four-contact climbing. Reach targets come from the character's measured limbs, not a human-sized animation.
// Only one limb changes hold at a time; planted targets slide against the body's travel, feet push and hands pull.
import * as THREE from 'three';
import {twoBone, turnWorld} from './moves.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z), Q=()=>new THREE.Quaternion();
const RIGHT=V(1,0,0), FWD=V(0,0,1);
const wp=b=>b.getWorldPosition(V()), wq=b=>b.getWorldQuaternion(Q());
const SWING=.20, HOLD=1-SWING, TAU=Math.PI*2;

export function climbContact(phase,offset=0){
 const q=((phase+offset)%1+1)%1;
 if(q>=SWING)return{height:.5-(q-SWING)/HOLD,lift:0,planted:true};
 const t=q/SWING,t2=t*t,t3=t2*t,m=-SWING/HOLD;
 // Hermite endpoint speeds match the planted phase; contact does not snap at take-off or landing.
 return{height:-.5*(2*t3-3*t2+1)+.5*(-2*t3+3*t2)+m*(2*t3-3*t2+t),
  lift:Math.sin(Math.PI*t)**2,planted:false};
}

export class Climber {
 constructor(B,mover){
  this.B=B;this.mover=mover;this.phase=.22;this.weight=0;this.direction=1;
  this.hip=wp(B.Hips);this.hipLocal=B.Hips.position.clone();this.limbs={};
  for(const [side,S,sx,handPhase,footPhase] of [['L','Left',1,0,.25],['R','Right',-1,.5,.75]]){
   const shoulder=wp(B[S+'Arm']),elbow=wp(B[S+'ForeArm']),fist=mover.body.fist[side].centre;
   const foot=wp(B[S+'Foot']),knee=wp(B[S+'Leg']);
   this.limbs[side]={S,sx,handPhase,footPhase,shoulder,foot,footQ:wq(B[S+'Foot']),
    armLength:shoulder.distanceTo(elbow)+elbow.distanceTo(fist),legLength:wp(B[S+'UpLeg']).distanceTo(knee)+knee.distanceTo(foot)};
  }
  this.stride=Math.min(...Object.values(this.limbs).map(l=>l.armLength))*.60;
 }
 update(dt,t,state,camera,canvas){
  const drive=state.petClimb;
  if(state.petHeld||state.petGrab){this.weight=0;state.climbPose=null;return;}
  this.weight+=(Number(!!drive)-this.weight)*(1-Math.exp(-dt*10));
  if(this.weight<.002){this.weight=0;state.climbPose=null;return;}
  if(drive){
   this.direction=drive.direction;
   const metresPerPixel=2*camera.position.distanceTo(V(0,.52,0))*Math.tan(camera.fov*Math.PI/360)/canvas.clientHeight;
   // Travel speed, including acceleration/deceleration, advances the cycle. Zero speed holds the grips still.
   this.phase+=dt*drive.speed*metresPerPixel*HOLD/this.stride*this.direction;
  }
  const {B}=this,w=this.weight,shift=B.Hips.parent.localToWorld(this.hipLocal.clone()).sub(this.hip);
  const a=this.phase*TAU,base=this.hip.clone().add(shift);
  const hip=base.clone().add(V(-.008*Math.cos(a),-.012+.008*Math.sin(a*2),-.008));
  B.Hips.position.copy(B.Hips.parent.worldToLocal(wp(B.Hips).lerp(hip,w)));B.Hips.updateMatrixWorld(true);
  turnWorld(B.Hips,FWD,.035*Math.cos(a)*w);
  for(const n of ['Spine','Spine1','Spine2'])turnWorld(B[n],RIGHT,.10*w/3);
  turnWorld(B.Head,RIGHT,-.14*w);
  const hands={},contacts={},targets={};
  for(const [side,l] of Object.entries(this.limbs)){
   const {S,sx}=l,h=climbContact(this.phase,l.handPhase),f=climbContact(this.phase,l.footPhase);
   const hand=l.shoulder.clone().add(shift).add(V(sx*l.armLength*.66,l.armLength*.31+this.stride*h.height,l.armLength*(.42-.20*h.lift)));
   hands[side]={target:hand,pole:V(sx,-.8,-.3),weight:w};
   const foot=l.foot.clone().add(shift).add(V(sx*l.legLength*(.14+.08*f.lift),l.legLength*.34+this.stride*f.height,l.legLength*(.34-.15*f.lift)));
   twoBone(B[S+'UpLeg'],B[S+'Leg'],B[S+'Foot'],foot,V(sx*.85,.05,1),w);
   const footQ=Q().setFromAxisAngle(RIGHT,-Math.PI*.32).multiply(l.footQ);
   const desired=wq(B[S+'Foot'].parent).invert().multiply(footQ);
   B[S+'Foot'].quaternion.slerp(desired,w);B[S+'Foot'].updateMatrixWorld(true);
   contacts[side+'Hand']=h.planted;contacts[side+'Foot']=f.planted;
   targets[side+'Hand']=hand.toArray();targets[side+'Foot']=foot.toArray();
  }
  // The same measured-shell clearance, elbow continuity and shoulder-lift limits used by every gesture.
  this.mover.arms(dt,t,hands);
  state.climbPose={phase:this.phase,weight:w,direction:this.direction,stride:this.stride,contacts,targets};
 }
}
