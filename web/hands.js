// The imported finger rig points back into the sleeves. Measure real wrist pivots and leave cuffs
// on the forearms. Cheek support blends to relaxed open palms; all other poses keep the source hands.
import * as THREE from 'three';
import {supportHandGeometry} from './support-hand.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion();
const wp=b=>b.getWorldPosition(V());
const mean=points=>points.reduce((a,p)=>a.add(p),V()).multiplyScalar(1/points.length);
function frame(fingers,palm){
 const y=fingers.clone().normalize(),z=palm.clone().addScaledVector(y,-palm.dot(y)).normalize();
 return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(y.clone().cross(z).normalize(),y,z));
}
function thinAxis(points){
 const center=mean(points),a=Array.from({length:3},()=>[0,0,0]),v=[[1,0,0],[0,1,0],[0,0,1]];
 for(const p of points){const d=p.clone().sub(center).toArray();for(let i=0;i<3;i++)for(let j=0;j<3;j++)a[i][j]+=d[i]*d[j];}
 for(let k=0;k<20;k++){
  let p=0,q=1;for(const [i,j]of[[0,2],[1,2]])if(Math.abs(a[i][j])>Math.abs(a[p][q])){p=i;q=j;}
  if(Math.abs(a[p][q])<1e-12)break;
  const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<3;i++){const x=a[i][p],y=a[i][q];a[i][p]=c*x-s*y;a[i][q]=s*x+c*y;}
  for(let j=0;j<3;j++){const x=a[p][j],y=a[q][j];a[p][j]=c*x-s*y;a[q][j]=s*x+c*y;}
  for(let i=0;i<3;i++){const x=v[i][p],y=v[i][q];v[i][p]=c*x-s*y;v[i][q]=s*x+c*y;}
 }
 const i=[0,1,2].sort((i,j)=>a[i][i]-a[j][j])[0];return V(v[0][i],v[1][i],v[2][i]);
}
function shells(mesh,forearm,pixels,width,height){
 const g=mesh.geometry,si=g.attributes.skinIndex,sw=g.attributes.skinWeight,pos=g.attributes.position,uv=g.attributes.uv,idx=g.index;
 const joint=mesh.skeleton.bones.indexOf(forearm),parents=new Map(),weld=new Map();
 const root=i=>{while(parents.get(i)!==i){parents.set(i,parents.get(parents.get(i)));i=parents.get(i);}return i;};
 const join=(a,b)=>{if(parents.has(a)&&parents.has(b))parents.set(root(a),root(b));};
 for(let i=0;i<si.count;i++){
  let weight=0;for(let k=0;k<4;k++)if(si.getComponent(i,k)===joint)weight+=sw.getComponent(i,k);
  if(weight<.9)continue;parents.set(i,i);
  const key=[0,1,2].map(k=>Math.round(pos.getComponent(i,k)*1e5)).join(',');
  if(weld.has(key))join(i,weld.get(key));else weld.set(key,i);
 }
 for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);join(a,b);join(b,c);join(c,a);}
 const groups=new Map();for(const i of parents.keys()){const k=root(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);}
 return [...groups.values()].filter(ids=>{
  if(ids.length<100)return false;
  const rgb=[0,0,0];for(const i of ids){const x=Math.min(width-1,Math.max(0,Math.floor(uv.getX(i)*width))),y=Math.min(height-1,Math.max(0,Math.floor(uv.getY(i)*height))),p=(y*width+x)*4;for(let k=0;k<3;k++)rgb[k]+=pixels[p+k]/ids.length;}
  // Select a complete skin shell, not individual texels: seams and shaded fingertips stay attached.
  return rgb[0]>170&&rgb[1]>150&&rgb[0]-rgb[1]>9&&rgb[0]-rgb[2]>12;
 }).flat();
}
export class Hands {
 constructor(mesh,mover){
  this.sides={};this.mesh=mesh;const image=mesh.material.map?.image;if(!image)return;
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  mesh.updateMatrixWorld(true);const original=mesh.skeleton,bones=original.bones.slice(),inverses=original.boneInverses.slice();
  const sets=['Left','Right'].map(S=>shells(mesh,mover.B[S+'ForeArm'],pixels,canvas.width,canvas.height));
  this.bindError=0;const collapsed=mesh.geometry.attributes.position.clone();
  for(const [n,S]of ['Left','Right'].entries()){
   const ids=sets[n];if(!ids.length)continue;
   const parent=mover.B[S+'ForeArm'],points=ids.map(i=>mesh.getVertexPosition(i,V()).applyMatrix4(mesh.matrixWorld)),center=mean(points);
   const direction=center.clone().sub(wp(parent)).normalize(),ordered=points.slice().sort((a,b)=>a.dot(direction)-b.dot(direction));
   const wrist=mean(ordered.slice(0,Math.max(8,Math.round(ordered.length*.12))));
   const fingers=center.clone().sub(wrist).normalize(),palm=thinAxis(points);if(palm.z>0)palm.negate();
   const bone=new THREE.Bone();bone.name='mixamorig'+S+'HandSupport';bone.position.copy(parent.worldToLocal(wrist.clone()));parent.add(bone);bone.updateMatrixWorld(true);
   const bind=bone.getWorldQuaternion(Q()),source=frame(fingers,palm),basis=bind.clone().invert().multiply(source);
   const tip=new THREE.Bone();tip.name=bone.name+'Tip';tip.userData.hideRig=true;tip.position.copy(bone.worldToLocal(mean(ordered.slice(-Math.max(8,Math.round(ordered.length*.12))))));bone.add(tip);
   const localCenter=bone.worldToLocal(center.clone()),thickness=Math.max(.009,Math.min(.018,(Math.max(...points.map(p=>p.dot(palm)))-Math.min(...points.map(p=>p.dot(palm))))*.5));
   this.sides[n?'R':'L']={bone,tip,basis,localCenter,thickness,ids,points,sourceFingers:fingers.clone().applyQuaternion(bind.clone().invert()),sourcePalm:palm.clone().applyQuaternion(bind.clone().invert())};
   const hand=this.sides[n?'R':'L'];
   hand.toon=new THREE.MeshToonMaterial({color:0xd0bebb,gradientMap:mesh.material.gradientMap});hand.flat=new THREE.MeshBasicMaterial({color:0xd0bebb});
   const shape=new THREE.Mesh(supportHandGeometry(n?-1:1),hand.toon);
   shape.name=S+'RelaxedPalm';shape.quaternion.copy(basis);bone.add(shape);shape.visible=false;hand.shape=shape;
   hand.supportCenter=V(0,.027,0).applyQuaternion(basis);hand.joints=[];
   for(const [i,p]of shape.geometry.userData.tips.entries()){
    const joint=new THREE.Bone();joint.name=bone.name+'Digit'+i;joint.position.copy(p).applyQuaternion(basis);joint.userData.supportHand=shape;bone.add(joint);hand.joints.push(joint);
   }
   // Collapse only the old closed-hand shell into the sleeve while the open hand appears.
   // At zero influence every original vertex and every other action retains its exact bind shape.
   const rawWrist=wrist.clone().applyMatrix4(mesh.matrixWorld.clone().multiply(mesh.bindMatrixInverse).multiply(parent.matrixWorld).multiply(original.boneInverses[original.bones.indexOf(parent)]).multiply(mesh.bindMatrix).invert());
   for(const i of ids)collapsed.setXYZ(i,rawWrist.x,rawWrist.y,rawWrist.z);
   // This asset's saved bind pose differs from its displayed rest pose. Preserve the forearm's original
   // skin transform, rather than assuming its inverse bind is the inverse of today's world matrix.
   const index=bones.length;bones.push(bone);
   inverses.push(bone.matrixWorld.clone().invert().multiply(parent.matrixWorld).multiply(original.boneInverses[original.bones.indexOf(parent)]));
   const parentIndex=original.bones.indexOf(parent);
   for(const [k,i]of ids.entries()){
    const weight=THREE.MathUtils.smoothstep(points[k].clone().sub(wrist).dot(fingers),.002,.018);
    mesh.geometry.attributes.skinIndex.setXYZW(i,index,parentIndex,0,0);mesh.geometry.attributes.skinWeight.setXYZW(i,weight,1-weight,0,0);
   }
   // These unused imported joints protrude beyond the real hand. Keep animation compatibility, hide their
   // misleading display lines; the wrist-to-fingertip segment above shows the actual driven hand instead.
   for(const old of original.bones)if(old.name.startsWith('mixamorig'+S+'Hand'))old.userData.hideRig=true;
  }
  mesh.bind(new THREE.Skeleton(bones,inverses),mesh.bindMatrix);
  mesh.updateMatrixWorld(true);mesh.skeleton.update();
  mesh.geometry.attributes.skinIndex.needsUpdate=mesh.geometry.attributes.skinWeight.needsUpdate=true;
  for(const hand of Object.values(this.sides))hand.ids.forEach((i,k)=>{this.bindError=Math.max(this.bindError,mesh.getVertexPosition(i,V()).applyMatrix4(mesh.matrixWorld).distanceTo(hand.points[k]));});
  this.morphIndex=(mesh.geometry.morphAttributes.position??=[]).length;collapsed.name='relaxedHandSupport';mesh.geometry.morphAttributes.position.push(collapsed);mesh.updateMorphTargets();
 }
 open(weight){
  if(this.morphIndex==null)return;
  const amount=THREE.MathUtils.smoothstep(weight,.12,.72);this.mesh.morphTargetInfluences[this.morphIndex]=amount;
  for(const h of Object.values(this.sides)){h.shape.visible=amount>.001;h.shape.scale.setScalar(amount);}
 }
 setStyle(style){for(const h of Object.values(this.sides))h.shape.material=style==='flat'?h.flat:h.toon;}
 support(side,anchor,head,weight){
  const hand=this.sides[side];if(!hand)return null;
  const surface=head.surface(anchor.clone().applyMatrix4(head.toRest));
  surface.p.applyMatrix4(head.toWorld);surface.n.transformDirection(head.toWorld);
  // The coarse lower-face shell has a steep downward normal. Use a consistent cupping tilt:
  // fingertips rise along the cheek, with the palm supporting it rather than lying flat below it.
  const normal=surface.n.clone().negate();normal.y=0;normal.normalize();normal.y=.577;normal.normalize();
  const fingers=V(0,1,0).addScaledVector(normal,-normal.y).normalize();
  const rotation=frame(fingers,normal).multiply(hand.basis.clone().invert());
  const center=surface.p.clone().addScaledVector(surface.n,.009);
  const target=center.sub(hand.supportCenter.clone().applyQuaternion(rotation));
  return {target,tip:hand.bone.position.clone(),radius:.011,pole:V(side==='L'?.25:-.25,-1.5,.3),weight,rotation};
 }
 pose(side,rotation,weight){
  const hand=this.sides[side];if(!hand)return;
  const local=hand.bone.parent.getWorldQuaternion(Q()).invert().multiply(rotation);
  hand.bone.quaternion.identity().slerp(local,weight);hand.bone.updateMatrixWorld(true);
 }
}
