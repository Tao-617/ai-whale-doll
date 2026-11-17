// Real model + skeleton review of the four-limb climb. No model calls or real desktop capture.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const core=process.env.PLAYWRIGHT_CORE;
const {chromium}=await import(core?pathToFileURL(core).href:'playwright-core');
const out=new URL('../reports/2026-11-17-climb/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const p=await browser.newPage({viewport:{width:1200,height:720}}),errors=[];p.on('pageerror',e=>errors.push(String(e)));
 await p.addInitScript(()=>{window.webkit={messageHandlers:{pet:{postMessage(){}}}};});
 await p.goto('http://127.0.0.1:8812/?pet=1');await p.waitForFunction(()=>window.xj?.state.ready&&xjPet.state.com,null,{timeout:120000});
 await p.evaluate(()=>{
  xj.state.manual=true;xj.state.nextTic=Infinity;
  window.hostClimb=(direction=1,speed=42)=>xjPet.host({active:true,parked:true,travel:{id:1,gait:'walk',dx:0,dy:direction*200,speed,kind:'stroll',facing:1}});
  window.stepClimb=n=>{for(let i=0;i<n;i++)xj.tick(1/30,false);};hostClimb();stepClimb(90);xj.setSplit(true);
 });
 const samples=[];
 for(const direction of [1,-1]){
  await p.evaluate(d=>{hostClimb(d);stepClimb(15);},direction);
  for(let i=0;i<120;i++){
   const sample=await p.evaluate(()=>{
    stepClimb(1);const B=xj.mover.B,wp=b=>b.getWorldPosition(b.position.clone()),h=wp(B.Hips),q=B.Hips.getWorldQuaternion(B.Hips.quaternion.clone()).invert();
    const joint=n=>wp(B[n]).sub(h).applyQuaternion(q).toArray();
    const fists=['L','R'].map((side,i)=>B[(i?'Right':'Left')+'ForeArm'].localToWorld(xj.mover.fist[side].local.clone()).sub(h).applyQuaternion(q).toArray());
    const lengths=['Left','Right'].flatMap(S=>[[S+'Arm',S+'ForeArm'],[S+'UpLeg',S+'Leg'],[S+'Leg',S+'Foot']].map(([a,b])=>wp(B[a]).distanceTo(wp(B[b]))));
    const knee=S=>{const k=wp(B[S+'Leg']);return Math.PI-wp(B[S+'UpLeg']).sub(k).angleTo(wp(B[S+'Foot']).sub(k));};
    return{...xj.state.climbPose,L:joint('LeftFoot'),R:joint('RightFoot'),fists,lengths,knees:[knee('Left'),knee('Right')],finite:Object.values(B).every(b=>b.quaternion.toArray().every(Number.isFinite))};
   });samples.push(sample);
   assert(sample.finite);assert(Object.values(sample.contacts).filter(Boolean).length>=3);
   if(direction===1&&i%30===0){
    for(const view of ['desktop','front','side']){
     await p.evaluate(view=>{const a=view==='desktop'?0:xj.state.petHeading+(view==='side'?Math.PI/2:0);xj.camera.position.set(3*Math.sin(a),.52,3*Math.cos(a));xj.camera.lookAt(0,.52,0);xj.render();},view);
     await p.screenshot({path:out+view+'-'+i+'.png'});
    }
   }
  }
 }
 for(const side of ['L','R']){
  const heights=samples.map(s=>s[side][1]);assert(Math.max(...heights)-Math.min(...heights)>.05,'feet must visibly step');
 }
 for(const side of [0,1]){const angles=samples.map(s=>s.knees[side]);assert(Math.max(...angles)-Math.min(...angles)>.30,'knees must bend and extend');}
 for(const side of [0,1]){const heights=samples.map(s=>s.fists[side][1]);assert(Math.max(...heights)-Math.min(...heights)>.03,'both visible fists must change holds');}
 for(const sample of samples)sample.lengths.forEach((n,i)=>assert(Math.abs(n-samples[0].lengths[i])<1e-6,'limbs must not stretch'));
 const transitions=await p.evaluate(()=>{
  hostClimb(1,0);stepClimb(3);const before=xj.state.climbPose.phase;stepClimb(30);const held=xj.state.climbPose.phase===before;
  xjPet.host({active:true,travel:{id:2,gait:'walk',dx:300,dy:0,speed:100,kind:'stroll'}});stepClimb(45);const walking=!!xj.state.clip&&!xj.state.climbPose;
  hostClimb(1);stepClimb(30);xj.state.petHeld=true;stepClimb(1);const grab=!xj.state.climbPose;xj.state.petHeld=false;
  return{held,walking,grab};
 });assert.deepEqual(transitions,{held:true,walking:true,grab:true});assert.deepEqual(errors,[]);
 const summary={samples:samples.length,minContacts:Math.min(...samples.map(s=>Object.values(s.contacts).filter(Boolean).length)),
  kneeDegrees:[0,1].map(i=>[Math.min(...samples.map(s=>s.knees[i]))*180/Math.PI,Math.max(...samples.map(s=>s.knees[i]))*180/Math.PI]),transitions,errors};
 await writeFile(out+'results.json',JSON.stringify({summary,samples},null,2));console.log(JSON.stringify(summary));
}finally{await browser.close();}
