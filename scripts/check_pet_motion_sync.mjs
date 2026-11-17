// Renderer/host agreement: a route without actual window movement must not pedal in place.
import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_CORE??new URL('../../voice-coding-butler/node_modules/playwright-core/index.mjs',import.meta.url).pathname).href);
const out=new URL('../reports/2026-11-17-motion-sync/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:360,height:480}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.webkit={messageHandlers:{pet:{postMessage(){}}}};});
 await page.goto('http://127.0.0.1:8812/?pet=1');await page.waitForFunction(()=>xj?.state.ready&&xjPet?.state.com,null,{timeout:120000});
 const result=await page.evaluate(()=>{
  xj.state.manual=true;xj.state.nextRestChatter=Infinity;
  const step=n=>{for(let i=0;i<n;i++)xj.tick(1/30,false);};
  const travel={id:77,gait:'run',dx:300,dy:0,kind:'stroll'};
  const host=(speed,extra={})=>xjPet.host({active:true,parked:true,chatter:false,travel:{...travel,speed,...extra}});
  xjPet.interrupt(0);host(0);step(30);const turningStill=!xj.state.clip;
  host(100);step(30);const walking=xj.state.clip?.getClip().name==='run';
  const before=xj.state.clip?.time;step(6);const advances=xj.state.clip?.time!==before;
  host(0);step(30);const stopped=!xj.state.clip&&!!xj.state.petLife.travel;
  host(60);step(12);const resumes=xj.state.clip?.getClip().name==='run';
  host(.2);step(30);const subpixelStill=!xj.state.clip;
  host(40,{gait:'walk',dx:0,dy:200});step(30);const climbing=!!xj.state.climbPose;
  host(0,{gait:'walk',dx:0,dy:200});step(3);const phase=xj.state.climbPose?.phase;step(30);const gripsHold=xj.state.climbPose?.phase===phase;
  host(45,{gait:'walk'});step(30);const switchesToWalk=xj.state.clip?.getClip().name==='walk';
  xjPet.host({active:true,travel:null});step(30);const arrived=!xj.state.clip&&!xj.state.petLife.travel&&!xj.state.climbPose;
  host(80);step(10);xjPet.host({active:false});step(30);const disabled=!xj.state.clip&&!xj.state.petLife.travel;
  return{turningStill,walking,advances,stopped,resumes,subpixelStill,climbing,gripsHold,switchesToWalk,arrived,disabled};
 });
 await writeFile(out+'renderer.json',JSON.stringify({result,errors},null,2));console.log(JSON.stringify({result,errors}));
 for(const [name,ok]of Object.entries(result))assert(ok,name);assert.deepEqual(errors,[]);
}finally{await browser.close();}
