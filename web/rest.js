// Quiet floor poses with measured limb targets; the bowl and rice are lightweight procedural props.
import * as THREE from 'three';
import {twoBone,turnWorld} from './moves.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion();
const X=V(1,0,0),Z=V(0,0,1),UP=V(0,1,0),wp=b=>b.getWorldPosition(V());
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export const RESTS={brood:{zh:'蹲下抱头发呆',en:'Crouch and brood',face:'grumpy',duration:40},rice:{zh:'坐下吃白饭',en:'Sit and eat rice',face:'smile',duration:50},sleep:{zh:'躺下睡大觉',en:'Lie down and sleep',face:'asleep',duration:100}};
export class Resting {
 constructor(B,mover,scene){
  this.B=B;this.mover=mover;this.weight=0;this.kind=null;this.hip=wp(B.Hips);this.feet={Left:wp(B.LeftFoot),Right:wp(B.RightFoot)};
  this.mouth=B.Head.worldToLocal(mover.body.face.mouth.clone());
  this.bowl=new THREE.Group();scene.add(this.bowl);this.bowl.visible=false;
  const ceramic=new THREE.MeshToonMaterial({color:0xe8f4ff,side:THREE.DoubleSide}),blue=new THREE.MeshToonMaterial({color:0x5180b0}),white=new THREE.MeshToonMaterial({color:0xfffcf0});
  const profile=[[0,-.032],[.025,-.031],[.044,-.022],[.058,0],[.061,.012],[.055,.012],[.050,.002],[.032,-.017],[0,-.021]].map(([x,y])=>new THREE.Vector2(x,y));
  this.bowl.add(new THREE.Mesh(new THREE.LatheGeometry(profile,32),ceramic));
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.058,.003,8,36),blue);rim.rotation.x=Math.PI/2;rim.position.y=.012;this.bowl.add(rim);
  const rice=new THREE.Mesh(new THREE.SphereGeometry(.05,20,12),white);rice.scale.y=.34;rice.position.y=.011;this.bowl.add(rice);
  const grainGeo=new THREE.SphereGeometry(1,6,4);
  for(let i=0;i<45;i++){const g=new THREE.Mesh(grainGeo,white),a=i*2.39996,r=.047*Math.sqrt((i+.5)/45);g.scale.set(.006,.003,.004);g.position.set(Math.cos(a)*r,.014+.015*Math.sqrt(1-r*r/.0025),Math.sin(a)*r);g.rotation.y=a;this.bowl.add(g);}
  this.spoon=new THREE.Group();scene.add(this.spoon);this.spoon.visible=false;
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.002,.002,.075,8),blue);handle.position.y=.0375;this.spoon.add(handle);
  const scoop=new THREE.Mesh(new THREE.SphereGeometry(.012,10,6),white);scoop.scale.set(1,.55,1.4);scoop.position.y=.081;this.spoon.add(scoop);
 }
 anchor(pose,side){const a=this.mover.anchor[pose][side];return a.bone.localToWorld(a.at.clone());}
 update(dt,t,state,face){
  let drive=state.restPreview??state.petRest;
  if(drive&&t-drive.start>=drive.duration){if(state.restPreview===drive)state.restPreview=null;if(state.petRest===drive)state.petRest=null;drive=null;}
  if(state.petHeld||state.petGrab){drive=null;state.restPreview=state.petRest=null;this.weight=0;}
  if(drive&&RESTS[drive.id]){if(this.kind!==drive.id||this.started!==drive.start){this.kind=drive.id;this.started=drive.start;face.set(RESTS[this.kind].face,0,t);}}
  const target=drive?1:0;this.weight+=(target-this.weight)*(1-Math.exp(-dt*(target?2.8:5)));
  state.restWeight=this.weight;
  if(this.weight<.002){if(this.kind&&face.name===RESTS[this.kind]?.face)face.set('neutral',0,t);this.kind=null;this.weight=0;state.restWeight=0;return;}
  const B=this.B,w=this.weight,age=t-this.started,kind=this.kind;
  const hip=this.hip.clone().add(kind==='sleep'?V(.14,-.13,0):kind==='rice'?V(0,-.17,0):V(0,-.14,-.015));
  hip.y+=.002*Math.sin(age*1.2);
  B.Hips.position.copy(B.Hips.parent.worldToLocal(wp(B.Hips).lerp(hip,w)));B.Hips.updateMatrixWorld(true);
  if(kind!=='sleep'){
   for(const name of ['Spine','Spine1','Spine2'])turnWorld(B[name],X,(kind==='brood'?.12:.04)*w/3);
   turnWorld(B.Head,X,(kind==='brood'?.10:.06)*w);
  }
  for(const [S,sx] of [['Left',1],['Right',-1]]){
   const goal=this.feet[S].clone().add(kind==='rice'?V(sx*.035,0,.16):kind==='sleep'?V(sx*.025,.065,.07):V(sx*.02,0,.035));
   twoBone(B[S+'UpLeg'],B[S+'Leg'],B[S+'Foot'],goal,V(sx*.8,.05,1),w);
  }
  const hands={};this.scoopPhase=smooth((Math.sin(age*1.7-.9)+1)/2);
  for(const [side,sx] of [['L',1],['R',-1]]){
   let goal=this.anchor(kind==='brood'?'head':kind==='sleep'?'cheeks':'clasp',side);
   if(kind==='brood')goal.add(V(0,.015,-.055));
   if(kind==='rice'&&side==='R'){
    const low=this.anchor('clasp','L').add(V(-.07,-.045,.025));
    goal=low.lerp(this.anchor('mouth','R'),this.scoopPhase);
   }
   hands[side]={target:goal,pole:V(sx,-.8,-.2),weight:w};
  }
  this.mover.arms(dt,t,hands);
  if(kind==='sleep'){
   turnWorld(B.Hips,Z,1.35*w);
   for(const S of ['Left','Right']){
    const goal=wp(B[S+'Foot']),pole=wp(B[S+'Leg']).sub(wp(B[S+'UpLeg']));goal.y=Math.max(.075,goal.y);
    twoBone(B[S+'UpLeg'],B[S+'Leg'],B[S+'Foot'],goal,pole,w);
   }
  }
  if(kind==='rice'&&this.scoopPhase>.85)face.talk(.18,t);
  // Match the standing sole plane, including the boot/cloth surface below the joints.
  B.Hips.position.copy(B.Hips.parent.worldToLocal(wp(B.Hips).add(V(0,.015*w,0))));B.Hips.updateMatrixWorld(true);
 }
 props(state){
  const show=this.kind==='rice'&&this.weight>.02&&!state.petHeld;
  this.bowl.visible=this.spoon.visible=show;if(!show)return;
  const fist=(S,s)=>this.B[S+'ForeArm'].localToWorld(this.mover.fist[s].local.clone());
  this.bowl.position.copy(fist('Left','L')).add(V(-.045,-.036,.02));this.bowl.scale.setScalar(this.weight);
  const mouth=this.B.Head.localToWorld(this.mouth.clone()),aim=this.bowl.position.clone().add(V(0,.02,0)).lerp(mouth,this.scoopPhase);
  this.spoon.position.copy(fist('Right','R'));this.spoon.quaternion.setFromUnitVectors(UP,aim.sub(this.spoon.position).normalize());this.spoon.scale.setScalar(this.weight);
 }
}
