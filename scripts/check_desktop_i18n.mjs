import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const core=process.env.PLAYWRIGHT_CORE;
const {chromium}=await import(core?pathToFileURL(core).href:'playwright-core');
const require=createRequire(import.meta.url),G=require('../desktop/windows/geometry.cjs');
const out=new URL('../reports/2026-11-17-i18n/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const english=JSON.parse(await readFile(new URL('../web/locales/en.json',import.meta.url),'utf8'));
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],results=[];
try{
 const p=await browser.newPage({viewport:{width:360,height:480}});p.on('pageerror',e=>errors.push(String(e)));
 await p.addInitScript(()=>{window.bridge=[];window.webkit={messageHandlers:{pet:{postMessage:m=>bridge.push(m)}}};});
 await p.goto('http://127.0.0.1:8812/?pet=1');await p.waitForFunction(()=>window.xj?.state.ready&&bridge.some(m=>m.type==='footprint'),null,{timeout:120000});
 await p.evaluate(()=>{xj.state.manual=true;window.steps=n=>{for(let i=0;i<n;i++)xj.tick(1/30,false);xj.render();};});
 for(const width of [260,360,520]){
  const height=Math.round(width*4/3);await p.setViewportSize({width,height});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const footprint=await p.evaluate(()=>{xjPet.host({active:false,language:'en'});steps(20);return bridge.filter(m=>m.type==='footprint').at(-1);});
  const screen={x:0,y:0,width:1440,height:900},a=G.area(screen,{width,height},footprint);
  for(const side of ['left','right','top','bottom']){
   const pos=side==='left'?{x:a.x,y:a.y+a.height/2}:side==='right'?{x:a.x+a.width,y:a.y+a.height/2}:side==='top'?{x:a.x+a.width/2,y:a.y}:{x:a.x+a.width/2,y:a.y+a.height};
   const viewport={left:Math.max(0,-pos.x),right:Math.min(width,1440-pos.x),top:Math.max(0,-pos.y),bottom:Math.min(height,900-pos.y)};
   const bubble=await p.evaluate(viewport=>{
    xjPet.host({active:false,language:'en',viewport});xj.say('我沿着边边巡逻。',true);steps(5);const b=document.querySelector('#bubble'),r=b.getBoundingClientRect();return{text:b.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hint:b.dataset.reply};
   },viewport);
   assert.equal(bubble.text,'Patrolling the edges.');assert.equal(bubble.hint,'Click to reply');assert(bubble.left>=viewport.left-1&&bubble.right<=viewport.right+1);assert(bubble.top>=viewport.top-1&&bubble.bottom<=viewport.bottom+1);
  }
  results.push({width,footprint});await p.screenshot({path:out+`english-pet-${width}.png`,omitBackground:true});
 }
 const recovery=await p.evaluate(()=>{
  xjPet.host({active:true,parked:false,language:'zh'});xj.state.bubbleUntil=0;xj.state.petAttendUntil=0;xj.mover.stop();const l=xj.state.petLife;l.next=1e9;l.ownedMove='think';xj.move('think');
  const before=bridge.filter(m=>m.type==='wander').length;steps(2);const returned=bridge.filter(m=>m.type==='wander').length>before;
  xjPet.host({active:true,parked:false,visiting:true});l.nextRecovery=0;const b=bridge.filter(m=>m.type==='wander').length;steps(100);const visitProtected=bridge.filter(m=>m.type==='wander').length===b;
  xj.say('我沿着边边巡逻。');return{returned,visitProtected,chinese:document.querySelector('#bubble').textContent};
 });assert.deepEqual(recovery,{returned:true,visitProtected:true,chinese:'我沿着边边巡逻。'});
 const panel=await browser.newPage({viewport:{width:550,height:560}});panel.on('pageerror',e=>errors.push(String(e)));
 await panel.route('http://panel.local/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'panel.html';await route.fulfill({path:new URL('../desktop/windows/'+name,import.meta.url).pathname,contentType:name.endsWith('.js')?'text/javascript':'text/html'});});
 await panel.addInitScript(english=>{window.panelAPI={settings:async()=>({language:'en',messages:english,hasKey:false}),save:async()=>true,chat:async()=>({accepted:true}),onReply:cb=>window.reply=cb,onLanguage:cb=>window.change=cb};},english);
 for(const mode of ['settings','chat']){
  await panel.goto('about:blank');await panel.goto('http://panel.local/panel.html#'+mode);await panel.waitForFunction(()=>document.documentElement.lang==='en');
  const visible=await panel.locator('#'+mode).innerText();assert(!/\p{Script=Han}/u.test(visible));await panel.screenshot({path:out+`english-${mode}.png`});
  await panel.evaluate(english=>change({language:'zh',messages:english}),english);assert(/\p{Script=Han}/u.test(await panel.locator('#'+mode).innerText()));
 }
 assert.deepEqual(errors,[]);await writeFile(out+'results.json',JSON.stringify({results,recovery,errors},null,2));console.log(JSON.stringify({results,recovery,errors}));
}finally{await browser.close();}
