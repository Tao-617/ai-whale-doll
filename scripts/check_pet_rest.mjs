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
   const gl=xj.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);let left=w,right=0,top=h,bottom=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(a[(y*w+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,h-1-y);bottom=Math.max(bottom,h-1-y);}
   return{id,weight:xj.state.restWeight,knees,eyes:xj.face.value('open'),bounds:{left:left/w,right:right/w,top:top/h,bottom:bottom/h},finite:Object.values(B).every(b=>b.quaternion.toArray().every(Number.isFinite))};},id);
  console.log(JSON.stringify({width,...result}));await p.screenshot({path:out+id+'-'+width+'.png',omitBackground:true});assert(result.finite&&result.weight>.98);assert(result.bounds.left>.005&&result.bounds.right<.995&&result.bounds.bottom<.995,'pose is clipped by the canvas');
  if(id==='sleep')assert(result.eyes<.02);else assert(result.knees.every(k=>k>.8));
  poses.push({width,...result});await p.screenshot({path:out+id+'-'+width+'.png',omitBackground:true});
  await p.evaluate(()=>{xjPet.interrupt(0);step(90);});assert(await p.evaluate(()=>xj.state.restWeight===0));
 }
}
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
assert.deepEqual(errors,[]);await writeFile(out+'verified.json',JSON.stringify({poses,dance,schedule,errors},null,2));console.log(JSON.stringify({poses,dance,schedule,errors}));
}finally{await b.close()}
