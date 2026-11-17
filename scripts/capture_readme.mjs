// Capture the real local test page for the README. No cloud model or desktop screenshots.
// Start `python3 scripts/serve.py`, install playwright-core (and Chromium), or set PLAYWRIGHT_CORE.
// Requires ffmpeg on PATH. `--stills` skips animation capture.
import {mkdir, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const core=process.env.PLAYWRIGHT_CORE;
const {chromium}=await import(core?pathToFileURL(core).href:'playwright-core');
const out=new URL('../docs/media/',import.meta.url).pathname;
const report=new URL('../reports/readme-media/',import.meta.url).pathname;
await mkdir(out,{recursive:true});await mkdir(report,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errors=[];
async function openPage(pet,width,height){
 const p=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
 p.on('pageerror',e=>errors.push(String(e)));
 await p.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 if(pet)await p.addInitScript(()=>{window.webkit={messageHandlers:{pet:{postMessage(){}}}};});
 await p.goto('http://127.0.0.1:8812/'+(pet?'?pet=1':''));
 await p.waitForFunction(pet?()=>window.xj?.state.ready&&xjPet.state.com:()=>window.xj?.state.ready,null,{timeout:120000});
 await p.evaluate(()=>{
  xj.state.manual=true;xj.state.nextTic=Infinity;xj.state.lookTarget.set(0,0);xj.state.look.set(0,0);xj.state.glance=null;
  window.steps=(n=1)=>{for(let i=0;i<n;i++)xj.tick(1/30,i===n-1);
   document.querySelector('#bubble').classList.toggle('show',xj.state.time<(xj.state.bubbleUntil??0));};steps(90);
 });
 return p;
}
async function movie(page,name,seconds,prepare,frame){
 await page.evaluate(prepare);
 const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','15','-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',out+name+'.mp4'],{stdio:['pipe','ignore','inherit']});
 const done=once(child,'close');
 for(let i=0;i<seconds*15;i++){
  await page.evaluate(frame,i);
  const png=await page.screenshot({animations:'allow'});
  if(!child.stdin.write(png))await once(child.stdin,'drain');
  if(i>0&&i%30===0)console.log(name+': '+i+'/'+seconds*15+' frames');
 }
 child.stdin.end();const [code]=await done;assert.equal(code,0);
 console.log('Recorded '+name+'.mp4');
 const gif=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',out+name+'.mp4','-filter_complex','fps=12,scale=400:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle','-loop','0',out+name+'.gif'],{stdio:['ignore','ignore','inherit']});
 assert.equal((await once(gif,'close'))[0],0);console.log('Encoded '+name+'.gif');
}
try{
 const viewer=await openPage(false,1200,800);
 await viewer.evaluate(()=>{xj.move('wave');steps(35);});
 await viewer.screenshot({path:out+'test-page.png'});console.log('Captured test-page.png');
 const pet=await openPage(true,600,640);
 await pet.addStyleTag({content:'html.pet,html.pet body{background:radial-gradient(ellipse at 50% 30%,#f7faff 0%,#e6edfc 60%,#d5e2f7 100%)}html.pet #bubble{top:28px;font-size:17px;padding:10px 18px}'});
 await pet.evaluate(()=>{xj.companionReply({speak:true,text:'你好呀，我是小鲸～',emotion:'happy',motion:'wave'});steps(40);});
 await pet.waitForTimeout(300);await pet.screenshot({path:out+'hello.png'});console.log('Captured hello.png');
 if(!process.argv.includes('--stills')){
  await movie(pet,'walk-climb',8,()=>{
   xjPet.interrupt(0);xj.mover.stop();xj.state.bubbleUntil=0;document.querySelector('#bubble').classList.remove('show');xj.state.petAttendUntil=0;
   xjPet.host({active:true,chatter:false,parked:true});
  },i=>{
   const climb=i>=60;xjPet.host({active:true,chatter:false,parked:true,travel:{id:10,gait:'walk',dx:climb?0:300,dy:climb?200:0,speed:climb?80:110,kind:'stroll',facing:climb?-1:1}});steps(2);
  });
  await movie(pet,'expressions',10,()=>{
   xjPet.host({active:false});xjPet.interrupt(0);xj.mover.stop();xj.state.bubbleUntil=0;xj.state.petAttendUntil=0;steps(50);
  },i=>{
   if(i===0)xj.companionReply({speak:true,text:'你好呀，我是小鲸～',emotion:'happy',motion:'wave'});
   if(i===45)xj.companionReply({speak:true,text:'咦，让我看看～',emotion:'curious',motion:'head_tilt'});
   if(i===90){xj.mover.stop();xj.face.react('dizzy',3.5,xj.state.time);xj.say('转、转晕啦……');}
   steps(2);
  });
 }
 assert.deepEqual(errors,[]);
 await writeFile(report+'capture.json',JSON.stringify({source:'http://127.0.0.1:8812/',fixedDemoText:true,cloudRequests:false,desktopCapture:false,simulationFps:30,videoFps:15,errors},null,2)+'\n');
 console.log('Capture complete; no page errors or external requests.');
}finally{await browser.close();}
