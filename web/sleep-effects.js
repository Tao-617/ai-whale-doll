// Small cartoon sleep cues, attached to the head in the model's measured face frame.
import * as THREE from 'three';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export class SleepEffects {
 constructor(head,body){
  this.root=new THREE.Group();this.root.name='SleepEffects';this.root.visible=false;
  const eyes=body.face.eyeL.clone().add(body.face.eyeR).multiplyScalar(.5),mouth=body.face.mouth;
  const nose=mouth.clone().lerp(eyes,.45);nose.z=body.head.front(nose.x,nose.y).p.z+.004;
  this.root.position.copy(head.worldToLocal(nose.clone()));this.root.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert());head.add(this.root);
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{opacity:{value:1}},
   vertexShader:'varying vec3 n,v; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);v=-p.xyz;gl_Position=projectionMatrix*p;}',
   fragmentShader:`varying vec3 n,v;uniform float opacity;void main(){
    vec3 normal=normalize(n);float rim=pow(1.0-abs(dot(normal,normalize(v))),2.0);
    float gleam=smoothstep(.965,.994,dot(normal,normalize(vec3(-.45,.55,1.0))));
    gl_FragColor=vec4(mix(vec3(.58,.82,.94),vec3(1.0),max(rim*.8,gleam)),opacity*(.12+.65*rim+.6*gleam));
    #include <colorspace_fragment>
   }`});
  this.bubble=new THREE.Mesh(new THREE.SphereGeometry(.035,28,20),material);this.bubble.name='SleepNoseBubble';this.bubble.renderOrder=4;this.root.add(this.bubble);
  const wet=new THREE.MeshToonMaterial({color:0xbcecff,transparent:true,opacity:.9});
  this.drool=new THREE.Group();this.drool.name='SleepDrool';this.root.add(this.drool);
  const points=[[-.008,-.002],[-.022,-.006],[-.035,-.013],[-.048,-.023]].map(([x,y])=>{
   const p=body.head.front(mouth.x+x,mouth.y+y);return p.p.addScaledVector(p.n,.007).sub(nose);
  });
  const curve=new THREE.CatmullRomCurve3(points);
  this.drool.add(new THREE.Mesh(new THREE.TubeGeometry(curve,18,.0026,8,false),wet));
  this.drop=new THREE.Mesh(new THREE.SphereGeometry(.0055,14,10),wet);this.drop.position.copy(points.at(-1));this.drop.scale.set(1.4,.9,.6);this.drool.add(this.drop);
  const glint=new THREE.Mesh(new THREE.SphereGeometry(.0021,8,6),new THREE.MeshBasicMaterial({color:0xffffff}));glint.position.copy(points.at(-1)).add(V(-.002,.002,.005));this.drool.add(glint);
 }
 update(weight,age){
  const amount=THREE.MathUtils.smoothstep(weight,.45,.95);this.root.visible=amount>.001;
  if(!this.root.visible)return;
  const breath=.5-.5*Math.cos(age*Math.PI*2/4.8),size=.62+.58*breath;
  // Keep the bubble's base touching the nose at every size, rather than floating off the face.
  this.bubble.scale.setScalar(size);this.bubble.position.set(.018*size,.006*size,.027*size);
  this.bubble.material.uniforms.opacity.value=amount;this.drool.scale.setScalar(amount);
  this.drop.scale.set(1.4+.08*Math.sin(age*1.3),.9,.6);
 }
}
