import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE?pathToFileURL(process.env.PLAYWRIGHT_CORE).href:'playwright-core');
const out=new URL('../reports/2026-11-17-rest/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const errors=[],poses=[];
try{const p=await b.newPage({viewport:{width:360,height:480}});p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
await p.addInitScript(()=>{window.webkit={messageHandlers:{pet:{postMessage(){}}}}});await p.goto('http://127.0.0.1:8812/?pet=1');await p.waitForFunction(()=>window.xj?.state.ready,null,{timeout:120000});
await p.evaluate(()=>{xj.state.manual=true;window.step=n=>{for(let i=0;i<n;i++)xj.tick(1/30,false);xj.render();}});
for(const width of [260,360,520]){await p.setViewportSize({width,height:Math.round(width*4/3)});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 for(const id of ['brood','rice','sleep']){
  const result=await p.evaluate(id=>{xjPet.interrupt(0);xj.rest(id);step(210);const B=xj.mover.B,wp=b=>b.getWorldPosition(b.position.clone()),knees=['Left','Right'].map(S=>{const k=wp(B[S+'Leg']);return Math.PI-wp(B[S+'UpLeg']).sub(k).angleTo(wp(B[S+'Foot']).sub(k));});
   const bones=xj.springs.filter(s=>/^(Skirt|Tail)/.test(s.names[0])).flatMap(s=>s.joints.map(j=>j.bone));
   let previous=bones.map(b=>b.quaternion.clone()),maxStep=0,worstBone='';
   for(let i=0;i<240;i++){xj.tick(1/30,false);bones.forEach((b,j)=>{const degrees=b.quaternion.angleTo(previous[j])*180/Math.PI;if(degrees>maxStep){maxStep=degrees;worstBone=b.name;}previous[j].copy(b.quaternion);});}xj.render();
   const gl=xj.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);let left=w,right=0,top=h,bottom=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(a[(y*w+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,h-1-y);bottom=Math.max(bottom,h-1-y);}
   return{id,weight:xj.state.restWeight,knees,eyes:xj.face.value('open'),maxStep,worstBone,bounds:{left:left/w,right:right/w,top:top/h,bottom:bottom/h},finite:Object.values(B).every(b=>b.quaternion.toArray().every(Number.isFinite))};},id);
  console.log(JSON.stringify({width,...result}));await p.screenshot({path:out+id+'-'+width+'.png',omitBackground:true});assert(result.finite&&result.weight>.98);assert(result.bounds.left>.005&&result.bounds.right<.995&&result.bounds.bottom<.995,'pose is clipped by the canvas');
  if(id==='sleep')assert(result.eyes<.02);else assert(result.knees.every(k=>k>.8));
  assert(result.maxStep<5,`${id}: ${result.worstBone} jumped ${result.maxStep} degrees in a resting frame`);
  poses.push({width,...result});await p.screenshot({path:out+id+'-'+width+'.png',omitBackground:true});
  await p.evaluate(()=>{xjPet.interrupt(0);step(90);});assert(await p.evaluate(()=>xj.state.restWeight===0));
 }
}
const hands=await p.evaluate(async()=>{
 const T=await import('./vendor/three.module.min.js'),rig=xj.mover.hands;
 const neutral=()=>rig.mesh.morphTargetInfluences[rig.morphIndex]===0&&Object.values(rig.sides).every(h=>!h.shape.visible&&h.bone.quaternion.angleTo(new T.Quaternion())<1e-6);
 const before=neutral();xj.rest('brood');step(180);
 const sides=Object.fromEntries(Object.entries(rig.sides).map(([side,h])=>{
  const q=h.shape.getWorldQuaternion(new T.Quaternion()),palm=new T.Vector3(0,0,1).applyQuaternion(q),up=new T.Vector3(0,1,0).applyQuaternion(q),center=h.bone.localToWorld(h.supportCenter.clone());
  const head=xj.mover.body.head;head.sync();const contact=head.surface(center.clone().applyMatrix4(head.toRest));contact.n.transformDirection(head.toWorld);
  const palmPoint=h.shape.localToWorld(new T.Vector3(0,.027,.010)),touch=head.surface(palmPoint.clone().applyMatrix4(head.toRest));touch.p.applyMatrix4(head.toWorld);touch.n.transformDirection(head.toWorld);
  return [side,{vertices:h.ids.length,fingers:h.joints.length,up:up.y,inward:palm.dot(contact.n.clone().negate()),gap:palmPoint.sub(touch.p).dot(touch.n),visible:h.shape.visible,finite:Array.from(h.shape.geometry.attributes.position.array).every(Number.isFinite)}];
 }));
 let maxWristStep=0,previous=Object.values(rig.sides).map(h=>h.bone.getWorldQuaternion(new T.Quaternion()));
 for(let i=0;i<180;i++){xj.tick(1/30,false);Object.values(rig.sides).forEach((h,j)=>{const q=h.bone.getWorldQuaternion(new T.Quaternion());maxWristStep=Math.max(maxWristStep,q.angleTo(previous[j])*180/Math.PI);previous[j]=q;});}
 xj.stopPreview();step(90);const stopped=neutral();
 const otherPoses={};for(const id of ['rice','sleep']){xj.rest(id);step(100);otherPoses[id]=neutral();xj.stopPreview();step(90);}
 for(const id of ['walk','samba']){xj.play(id);step(100);otherPoses[id]=neutral();xj.play(null);step(60);}
 return{bindError:rig.bindError,before,sides,maxWristStep,stopped,otherPoses};
});
assert(hands.bindError<1e-6,'adding the wrist rig must preserve the original bind shape');assert(hands.before&&hands.stopped);
for(const side of Object.values(hands.sides)){assert(side.vertices>450&&side.fingers===5&&side.visible&&side.finite);assert(side.up>.8&&side.inward>.4,'fingers point upward and palms face the cheek');assert(Math.abs(side.gap)<.012,'the palm touches the cheek instead of hovering or sinking into it');}
assert(hands.maxWristStep<5,'wrist orientation must stay continuous');for(const ok of Object.values(hands.otherPoses))assert(ok,'other actions retain the original hands');
const sleep=await p.evaluate(async()=>{
 const T=await import('./vendor/three.module.min.js'),B=xj.mover.B,wp=b=>b.getWorldPosition(new T.Vector3());
 xj.stopPreview();step(90);const camera=xj.camera.position.clone(),target=xj.controls.target.clone();
 xj.rest('sleep');step(180);
 const cues=xj.model().getObjectByName('SleepEffects'),bubble=cues.getObjectByName('SleepNoseBubble'),drool=cues.getObjectByName('SleepDrool');
 const axis=wp(B.Head).sub(wp(B.Hips)).normalize(),front=new T.Vector3(0,0,1).applyQuaternion(cues.getWorldQuaternion(new T.Quaternion()));
 const spread=['Left','Right'].map(S=>Math.abs(wp(B[S+'Hand']).z-wp(B[S+'Arm']).z));
 const feet=Math.abs(wp(B.LeftFoot).z-wp(B.RightFoot).z),sizes=[],mouths=[];let attached=true;
 for(let i=0;i<150;i++){step(1);sizes.push(bubble.scale.x);mouths.push(xj.face.parts.mouth.material.userData.uniforms.uOpen.value);attached&&=bubble.position.length()<bubble.geometry.parameters.radius*bubble.scale.x;}
 const visible=cues.visible&&drool.visible,bubbleRange=Math.max(...sizes)-Math.min(...sizes),mouthRange=Math.max(...mouths)-Math.min(...mouths);
 xj.stopPreview();step(120);const stopped=!cues.visible&&xj.state.sleepWeight===0&&xj.camera.position.distanceTo(camera)<1e-4&&xj.controls.target.distanceTo(target)<1e-4;
 xj.rest('sleep');step(150);xj.companionReply({speak:true,text:'Hello!',emotion:'happy',motion:''});step(120);const awakened=!cues.visible&&!xj.state.restPreview;
 xj.state.bubbleUntil=xj.state.petAttendUntil=0;xj.rest('sleep');step(150);
 const head=wp(B.Head).project(xj.camera),cx=(head.x+1)*innerWidth/2,cy=(1-head.y)*innerHeight/2;let point;
 for(const dy of [0,-8,8,-16,16]){for(const dx of [0,-8,8,-16,16])if(xjPet.hit(cx+dx,cy+dy)){point=[cx+dx,cy+dy];break;}if(point)break;}
 if(point)xjPet.begin(...point);step(1);const grabbed=!!point&&xjPet.held()&&!cues.visible&&!xj.state.restPreview;
 xjPet.release();step(120);
 return{axis:axis.toArray(),front:front.toArray(),spread,feet,visible,attached,bubbleRange,mouthRange,stopped,awakened,grabbed};
});
console.log(JSON.stringify({sleep}));assert(sleep.axis[0]<-.85&&sleep.front[1]>.85,'head-to-hip axis is horizontal and face points up');
assert(sleep.spread.every(d=>d>.12)&&sleep.feet>.20,'both arms and legs spread to the sides');
assert(sleep.bubbleRange>.5&&sleep.mouthRange>.06,'bubble and mouth breathe');for(const key of ['visible','attached','stopped','awakened','grabbed'])assert(sleep[key],key);
const viewer=await b.newPage({viewport:{width:1100,height:760}});viewer.on('pageerror',e=>errors.push(String(e)));
await viewer.goto('http://127.0.0.1:8812/');await viewer.waitForFunction(()=>window.xj?.state.ready,null,{timeout:120000});
const preview=await viewer.evaluate(()=>{
 xj.state.manual=true;xj.state.nextTic=Infinity;const step=n=>{for(let i=0;i<n;i++)xj.tick(1/30,false);};
 xj.camera.position.set(.3,.9,2.4);xj.controls.target.set(.05,.45,0);xj.controls.update();
 const camera=xj.camera.position.clone(),target=xj.controls.target.clone(),restored=()=>xj.camera.position.distanceTo(camera)<1e-5&&xj.controls.target.distanceTo(target)<1e-5;
 xj.rest('sleep');step(120);const elevated=xj.camera.position.y>2; xj.stopPreview();step(100);const stopped=restored();
 xj.rest('sleep');step(120);xj.rest('rice');step(120);const switched=restored();
 xj.rest('sleep');xj.state.restPreview.start=xj.state.time-101;step(120);const expired=restored();return{elevated,stopped,switched,expired};
});for(const [key,value]of Object.entries(preview))assert(value,key);await viewer.close();
const chatter=await p.evaluate(()=>{
 const bubble=document.querySelector('#bubble');
 const start=(host={})=>{xj.stopPreview();step(60);xj.state.nextRestChatter=0;xjPet.host({active:false,parked:true,floor:true,chatter:true,...host});xj.rest('brood');};
 xj.setLanguage('en');start();step(150);
 const shown=bubble.classList.contains('show')&&bubble.classList.contains('thinking')&&!/[\u4e00-\u9fff]/.test(bubble.textContent)&&bubble.textContent.length>0;
 const keepsPose=xj.state.restPreview?.id==='brood'&&xj.state.restWeight>.98&&xj.state.bubbleBlocking===false;
 const firstUntil=xj.state.bubbleUntil,cooldown=xj.state.nextRestChatter-xj.state.time;step(300);
 const once=xj.state.bubbleUntil===firstUntil;
 xj.stopPreview();step(1);const stopClears=!bubble.classList.contains('show');
 start({chatter:false});step(150);const muted=!bubble.classList.contains('show')&&!xj.state.restPreview.chatted;
 start({visiting:true});step(150);const visitingQuiet=!bubble.classList.contains('show');
 start();xj.seek(10);const seekingQuiet=!bubble.classList.contains('show');xj.pause(false);step(1);
 xj.companionReply({speak:true,text:'Hello from a real reply.',emotion:'happy',motion:''});step(1);
 const replyPreserved=bubble.classList.contains('show')&&bubble.textContent==='Hello from a real reply.'&&!bubble.classList.contains('thinking')&&!xj.state.restPreview;
 xj.state.bubbleUntil=0;bubble.classList.remove('show');xj.setLanguage('zh');xjPet.host({active:false,parked:true,floor:true,chatter:false});step(90);
 return{shown,keepsPose,once,cooldown,stopClears,muted,visitingQuiet,seekingQuiet,replyPreserved};
});for(const [key,value]of Object.entries(chatter))assert(key==='cooldown'?value>=59:value,key);
const dance=await p.evaluate(()=>{
 const l=xj.state.petLife;
 const attempt=(host={})=>{
  xjPet.interrupt(0);xj.mover.stop();xj.state.bubbleUntil=xj.state.petAttendUntil=0;
  xjPet.host({active:true,parked:true,floor:true,...host});l.next=xj.state.time;l.nextWalk=Infinity;l.nextDance=0;
  const random=Math.random;Math.random=()=>0;step(1);Math.random=random;
 };
 attempt({floor:false});const noAirDance=!l.danceUntil;
 attempt({visiting:true});const noVisitDance=!l.danceUntil;
 attempt({active:false});const disabled=!l.danceUntil;
 attempt();const started=!!l.danceUntil&&xj.state.clip?.getClip().name==='samba',cooldown=l.nextDance-xj.state.time;
 step(90);const finite=Object.values(xj.mover.B).every(b=>b.quaternion.toArray().every(Number.isFinite));
 step(165);const ended=!l.danceUntil&&!xj.state.clip&&l.next>xj.state.time;
 xjPet.interrupt(0);xj.mover.stop();l.next=xj.state.time;const random=Math.random;Math.random=()=>0;step(1);Math.random=random;const cooledDown=!l.danceUntil;
 attempt();xj.companionReply({speak:true,text:'Hello!',emotion:'happy',motion:''});step(1);const speechStops=!l.danceUntil&&!xj.state.clip;
 attempt();xjPet.host({active:false});step(1);const toggleStops=!l.danceUntil&&!xj.state.clip;
 return{noAirDance,noVisitDance,disabled,started,cooldown,finite,ended,cooledDown,speechStops,toggleStops};
});for(const [key,value] of Object.entries(dance))assert(key==='cooldown'?value>=479.9:value,key);
const schedule=await p.evaluate(async()=>{
 const {PetLife}=await import('./life.js');let seed=617,random=Math.random;Math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const state={time:0},trips=[],rests=new Set();let trip=null;
 const mover={busy:false,playing:null,stop(){this.busy=false;this.playing=null},play(spec){this.playing=spec.id;this.busy=true;this.until=state.time+3;}};
 const life=new PetLife({state,post:m=>{if(m.type==='wander'){trip={id:trips.length+1,gait:'walk',dx:300,dy:0,speed:85,kind:'stroll',until:state.time+6};trips.push(state.time)}},mover:()=>mover,face:()=>({set(){}}),settling:()=>false,playClip(){},scale:()=>1,findMove:id=>({id}),say(){}});
 for(let i=0;i<1200;i++){state.time=i*.5;if(trip&&state.time>=trip.until)trip=null;if(mover.busy&&state.time>=mover.until)mover.stop();if(state.petRest){rests.add(state.petRest.id);if(state.time-state.petRest.start>=state.petRest.duration)state.petRest=null;}
  life.host({active:true,parked:true,floor:true,travel:trip});life.update(.5,state.time);}
 Math.random=random;return{trips,rests:[...rests]};
});assert(schedule.trips.length>=1&&schedule.trips.length<=4);assert(schedule.trips[0]>=90);assert(schedule.rests.length>=2);for(let i=1;i<schedule.trips.length;i++)assert(schedule.trips[i]-schedule.trips[i-1]>=120);
assert.deepEqual(errors,[]);await writeFile(out+'verified.json',JSON.stringify({poses,hands,sleep,preview,chatter,dance,schedule,errors},null,2));console.log(JSON.stringify({poses,hands,sleep,preview,chatter,dance,schedule,errors}));
}finally{await b.close()}
