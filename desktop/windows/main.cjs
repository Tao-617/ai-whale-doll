'use strict';
const {app,BrowserWindow,Tray,Menu,ipcMain,screen,protocol,net,powerMonitor,safeStorage,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const I=require('./i18n.cjs'),T=I.t;
const G=require('./geometry.cjs'),{NativeWindow}=require('./native.cjs'),{Observation,same,denied}=require('./observation.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'xj',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
if(!app.requestSingleInstanceLock())app.quit();
let pet,tray,trayMenu,panel,store,storeFile,native,brain,ready=false,awake=true,menuOpen=false,dragging=false,hitPending=false,trip=null,visit=null,visitArrivedUntil=0;
let footprint={x:0,y:0,width:1,height:1};
let shift={x:0,y:0},origin={x:0,y:0},lastPointer={x:0,y:0},pointerIntentUntil=0,tripID=0,lastHost='',lastSource=null,tickCount=0;
const sizes=[{width:260,height:346},{width:360,height:480},{width:520,height:692}],now=()=>performance.now()/1000;
function save(){fs.mkdirSync(path.dirname(storeFile),{recursive:true});fs.writeFileSync(storeFile,JSON.stringify(store),{mode:0o600});}
function changeLanguage(code){I.setLanguage(code);store.language=I.getLanguage();save();brain.cancel();brain.status(brain.enabled?'等待你停下来，再看一眼':'观察已暂停');
 if(panel&&!panel.isDestroyed()){panel.setTitle(T(panel.__mode==='settings'?'小鲸 · 模型设置':'和小鲸聊一句'));panel.webContents.send('language',{language:I.getLanguage(),messages:I.english});}host();rebuild();}
function settings(){openPanel('settings');}
function config(){try{if(!store.key||!safeStorage.isEncryptionAvailable())return null;return{baseUrl:store.baseUrl,model:store.model,apiKey:safeStorage.decryptString(Buffer.from(store.key,'base64'))};}catch{return null;}}
function js(fn,...args){if(!ready||!pet||pet.isDestroyed())return Promise.resolve(null);return pet.webContents.executeJavaScript('window.xjPet && '+fn+'('+args.map(a=>JSON.stringify(a)).join(',')+')').catch(()=>null);}
function display(){return screen.getDisplayMatching(pet.getBounds());}
function area(){return G.area(display().workArea,pet.getBounds(),footprint);}
function canWander(){return ready&&awake&&store.lively!==false&&!dragging&&!menuOpen&&(!panel||!panel.isVisible());}
function adopt(){const f=pet.getBounds();origin={x:f.x-shift.x,y:f.y-shift.y};}
function place(){pet.setPosition(Math.round(origin.x+shift.x),Math.round(origin.y+shift.y),false);}
function savePlace(){store.position=pet.getBounds();save();}
function stop(arrived=false){if(!trip&&!visit)return;const done=visit?.done;if(visit)visitArrivedUntil=arrived?now()+30:0;trip=null;visit=null;savePlace();host();done?.(arrived);}
function host(){if(!ready)return;const a=area(),s=trip?G.sample(trip,now()):null;
 const f=pet.getBounds(),screenBounds=display().workArea;
 const data={floor:Math.abs(f.y-a.y-a.height)<3,language:I.getLanguage(),visiting:!!visit||(!!brain.pending&&now()<visitArrivedUntil),viewport:{left:Math.max(0,screenBounds.x-f.x),right:Math.min(f.width,screenBounds.x+screenBounds.width-f.x),top:Math.max(0,screenBounds.y-f.y),bottom:Math.min(f.height,screenBounds.y+screenBounds.height-f.y)},active:canWander(),chatter:store.chatter!==false&&!brain.busy&&!brain.pending,parked:a.width+a.height<45||G.onEdge(pet.getBounds(),a),
  travel:trip?{id:trip.id,gait:trip.gait,dx:s.dx,dy:s.dy,speed:s.speed,kind:trip.kind,
   facing:Math.abs(s.dy)>Math.abs(s.dx)*2?(pet.getBounds().x<area().x+area().width/2?-1:1):Math.sign(s.dx||1)}:null};
 const json=JSON.stringify(data);if(json===lastHost)return;lastHost=json;js('xjPet.host',data);}
function wander(running){if(!canWander()||trip||visit)return;const a=area(),p=pet.getBounds(),recover=!G.onEdge(p,a);
 if(a.width+a.height<45||(!recover&&(brain.busy||brain.pending))||(brain.pending&&now()<visitArrivedUntil))return;
 trip=G.make(p,G.target(p,a,Math.random()),a,now(),p.width/360,running,++tripID,recover?'return':'stroll');if(trip){trip.area=JSON.stringify(a);pet.setPosition(Math.round(trip.start.x),Math.round(trip.start.y));adopt();host();}}
function approach(source,focus,done){if(!canWander()||!brain.enabled)return false;
 const bounds=screen.screenToDipRect(null,source.bounds),f=pet.getBounds(),target=G.destination(focus,bounds,display().workArea,f);if(!target)return false;
 stop();const token=++tripID;visit={token,source,done};js('xjPet.prepareVisit').then(()=>{if(visit?.token!==token)return;
  const a=area(),p=pet.getBounds();trip=G.make(p,target,a,now(),p.width/360,true,token,'observation');
  if(!trip||trip.duration>=18){stop(true);return;}trip.area=JSON.stringify(a);adopt();host();});return true;}
function speak(reply){stop();visitArrivedUntil=0;js('xj.companionReply',reply);if(panel&&!panel.isDestroyed())panel.webContents.send('reply',{text:reply.text});}
function setSize(i){if(!sizes[i])return;const f=pet.getBounds(),s=display().workArea;stop();js('xjPet.interrupt',6);pet.setBounds(round(G.resized(f,sizes[i],s,footprint)));adopt();store.size=i;savePlace();host();rebuild();}
function round(r){return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Math.round(v)]));}
function home(){stop();js('xjPet.interrupt',4);const a=area();pet.setPosition(Math.round(a.x+a.width),Math.round(a.y+a.height));adopt();savePlace();host();}
function prepareRest(id){if(dragging||visit)return;stop();const s=display().workArea,a=area(),f=pet.getBounds();pet.setPosition(Math.round(Math.min(s.x+s.width-f.width-8,Math.max(s.x+8,f.x))),Math.round(a.y+a.height));adopt();savePlace();host();if(id)js('xj.rest',id);}
function openPanel(mode){stop();if(panel&&!panel.isDestroyed()){panel.close();panel=null;}
 panel=new BrowserWindow({width:550,height:560,title:mode==='settings'?T('小鲸 · 模型设置'):T('和小鲸聊一句'),autoHideMenuBar:true,
  webPreferences:{preload:path.join(__dirname,'panel-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));panel.webContents.on('will-navigate',e=>e.preventDefault());
 panel.__mode=mode;const opened=panel;panel.loadFile(path.join(__dirname,'panel.html'),{hash:mode});panel.on('closed',()=>{if(panel===opened)panel=null;host();});host();}
function rebuild(){if(!tray)return;const source=lastSource,canAllow=source&&source.pid!==process.pid&&!denied.test(source.app);
 const items=[{label:'Language / 语言',submenu:['zh','en'].map(code=>({label:code==='zh'?'简体中文':'English',type:'radio',checked:I.getLanguage()===code,click:()=>changeLanguage(code)}))},{label:brain.state,enabled:false},{label:brain.enabled?T('暂停观察'):T('开启观察'),type:'checkbox',checked:brain.enabled,click:()=>brain.toggle()},
  {label:canAllow?T('允许观察：{0}',source.app):T('允许观察当前应用（先切到目标窗口）'),type:'checkbox',checked:!!source&&store.allowed.includes(source.exe),enabled:!!canAllow,click:()=>{const id=source.exe;store.allowed=store.allowed.includes(id)?store.allowed.filter(x=>x!==id):[...store.allowed,id];save();brain.cancel();rebuild();}},
  {label:T('已允许的应用'),submenu:store.allowed.length?store.allowed.map(exe=>({label:path.win32.basename(exe),type:'checkbox',checked:true,click:()=>{store.allowed=store.allowed.filter(x=>x!==exe);save();brain.cancel();rebuild();}})):[{label:T('尚未选择'),enabled:false}]},
  {label:T('看一眼当前窗口'),enabled:brain.enabled,click:()=>brain.tick(true)},
  {label:T('只看允许的当前窗口 · 内容发送到配置的模型'),enabled:false},{label:T('每分钟一次 · 无操作时安静'),enabled:false},{type:'separator'},
  {label:T('和小鲸聊一句…'),click:()=>openPanel('chat')},{label:T('模型设置…'),click:settings},
  {label:T('自由活动（沿四周边缘）'),type:'checkbox',checked:store.lively!==false,click:()=>{store.lively=store.lively===false;stop();save();host();rebuild();}},
  {label:T('散步、发呆时偶尔闲聊'),type:'checkbox',checked:store.chatter!==false,click:()=>{store.chatter=store.chatter===false;save();host();rebuild();}},
  {label:T('截图后主动靠近内容（说完回边缘）'),type:'checkbox',checked:store.approach===true,click:()=>{store.approach=!store.approach;if(visit)stop();save();rebuild();}},
  {label:T('休息动作'),submenu:[['brood','蹲下托腮发呆'],['rice','坐下吃白饭'],['sleep','躺下睡大觉']].map(([id,key])=>({label:T(key),click:()=>prepareRest(id)}))},
  ...sizes.map((s,i)=>({label:T('大小：')+[T('小'),T('中'),T('大')][i],type:'radio',checked:store.size===i,click:()=>setSize(i)})),
  {type:'separator'},{label:T('回到右下角'),click:home},{label:T('退出'),click:()=>app.quit()}];
 const menu=Menu.buildFromTemplate(items);menu.on('menu-will-show',()=>{menuOpen=true;stop();host();});menu.on('menu-will-close',()=>{menuOpen=false;host();});
 trayMenu=menu;tray.setToolTip(T('小鲸')+' · '+brain.state);pet?.setTitle(T('小鲸')+' · '+T('观察')+': '+(brain.enabled?T('开启'):T('暂停'))+' · '+brain.state);}
async function updateSource(){try{const r=await native.request({kind:'info'});if(r.ok&&!denied.test(r.info.app)){lastSource=r.info;rebuild();}return r;}catch{return null;}}
ipcMain.on('pet',(event,m)=>{if(event.sender!==pet?.webContents||!m)return;
 switch(m.type){case'ready':ready=true;host();break;
 case'footprint':if(['x','y','width','height'].every(k=>Number.isFinite(m[k]))&&m.x>=0&&m.y>=0&&m.width>.1&&m.height>.1&&m.x+m.width<=1.001&&m.y+m.height<=1.001){
  footprint={x:m.x,y:m.y,width:m.width,height:m.height};if(!dragging&&!visit){stop();const p=G.edge(pet.getBounds(),area());pet.setPosition(Math.round(p.x),Math.round(p.y));adopt();savePlace();}host();}break;
 case'grab':dragging=true;stop();lastPointer=screen.getCursorScreenPoint();pet.setIgnoreMouseEvents(false);break;
 case'release':if(dragging){dragging=false;js('xjPet.release');adopt();savePlace();}break;
 case'shift':if(Number.isFinite(m.x)&&Number.isFinite(m.y)){shift={x:m.x,y:-m.y};place();}break;
 case'restPlace':prepareRest();break;
 case'wander':wander(m.running!==false);break;
 case'roamStop':if(trip?.id===m.id)stop();break;
 case'chat':openPanel('chat');break;
 }});
function panelSender(e){return panel&&!panel.isDestroyed()&&e.sender===panel.webContents;}
ipcMain.handle('settings-read',e=>{if(!panelSender(e))throw Error();return{baseUrl:store.baseUrl,model:store.model,hasKey:!!store.key,language:I.getLanguage(),messages:I.english};});
ipcMain.handle('settings-save',(e,d)=>{if(!panelSender(e))throw Error();const {endpoint}=require(modelPath());endpoint(String(d.baseUrl));if(!String(d.model||'').trim()||!safeStorage.isEncryptionAvailable())throw Error();
 const key=String(d.apiKey||'').trim();if(!key&&!store.key)throw Error();if(key)store.key=safeStorage.encryptString(key).toString('base64');store.baseUrl=String(d.baseUrl).trim();store.model=String(d.model).trim();brain.pause();save();return true;});
ipcMain.handle('chat',(e,t)=>{if(!panelSender(e)||typeof t!=='string'||!t.trim()||t.length>500)throw Error();return brain.chat(t.trim());});
function modelPath(){return app.isPackaged?path.join(process.resourcesPath,'companion','model.cjs'):path.resolve(__dirname,'../../companion/model.cjs');}
app.whenReady().then(()=>{
 storeFile=path.join(app.getPath('userData'),'settings.json');try{store=JSON.parse(fs.readFileSync(storeFile,'utf8'));}catch{store={};}
 I.setLanguage(store.language||app.getLocale());
 store.allowed=Array.isArray(store.allowed)?store.allowed.filter(x=>typeof x==='string'):[];store.size=[0,1,2].includes(store.size)?store.size:1;
 const root=app.isPackaged?path.join(process.resourcesPath,'web'):path.resolve(__dirname,'../../web');
 protocol.handle('xj',request=>{const u=new URL(request.url),name=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname),file=path.resolve(root,'.'+name);
  if(u.host!=='app'||!file.startsWith(root+path.sep))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(file).href);});
 const size=sizes[store.size],saved=store.position||{},s=screen.getDisplayNearestPoint({x:Number(saved.x)||0,y:Number(saved.y)||0}).workArea;
 const initial=round(G.resized({x:Number(saved.x)||s.x+s.width,y:Number(saved.y)||s.y+s.height,...size},size,s));
 pet=new BrowserWindow({...initial,transparent:true,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,focusable:false,show:false,hasShadow:false,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 pet.webContents.setWindowOpenHandler(()=>({action:'deny'}));pet.webContents.on('will-navigate',e=>e.preventDefault());pet.setIgnoreMouseEvents(true,{forward:true});adopt();
 pet.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
 native=new NativeWindow(app.isPackaged?path.join(process.resourcesPath,'native'):path.join(__dirname,'native'));
 brain=new Observation({native,generate:require(modelPath()).generate,config,settings,language:I.getLanguage,allowed:()=>store.allowed,approach:()=>store.approach===true,awake:()=>awake&&ready,
  changed:()=>{rebuild();host();},source:s=>{if(s&&!denied.test(s.app))lastSource=s;},cancelVisit:()=>{if(visit)stop();},visit:approach,speak,
  interacting:()=>dragging||menuOpen||!!panel?.isVisible()||(trip&&trip.kind!=='observation')||
   (store.lively!==false&&!G.onEdge(pet.getBounds(),area())&&!visit&&now()>visitArrivedUntil),
  chatError:error=>panel?.webContents.send('reply',{error})});
 tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'assets','tray.png')));rebuild();
 const showMenu=async()=>{await updateSource();tray.popUpContextMenu(trayMenu);};tray.on('click',showMenu);tray.on('right-click',showMenu);
 pet.loadURL('xj://app/index.html?pet=1');pet.once('ready-to-show',()=>pet.showInactive());
 setInterval(()=>{if(!ready||pet.isDestroyed())return;tickCount++;const p=screen.getCursorScreenPoint();
  if(Math.hypot(p.x-lastPointer.x,p.y-lastPointer.y)>1)pointerIntentUntil=now()+.5;
  if(dragging){const dx=p.x-lastPointer.x,dy=p.y-lastPointer.y;origin.x+=dx;origin.y+=dy;place();if(dx||dy)js('xjPet.dragBy',dx,dy);}
  lastPointer=p;if(!canWander()&&!dragging)stop();
  if(trip){if(trip.area!==JSON.stringify(area())){stop();const f=pet.getBounds();pet.setBounds(round(G.resized(f,f,display().workArea,footprint)));adopt();}else{
   const step=G.sample(trip,now());origin={x:step.x-shift.x,y:step.y-shift.y};place();if(step.done)stop(true);}}
  if(tickCount%3)return;host();if(hitPending||dragging)return;hitPending=true;const f=pet.getBounds(),intent=now()<pointerIntentUntil;
  js('xjPet.hit',p.x-f.x,p.y-f.y,intent).then(hit=>{hitPending=false;if(dragging||pet.isDestroyed())return;pet.setIgnoreMouseEvents(!hit,{forward:true});if(hit&&intent)stop();});
 },1000/60);
 setInterval(()=>brain.tick(),2000);
 setInterval(async()=>{if(!visit&&!dragging)return;try{const r=await native.request({kind:'info'});if(dragging&&r?.ok&&!r.info.leftDown){dragging=false;js('xjPet.release');adopt();savePlace();}
  if(visit&&(!r?.ok||!same(r.info,visit.source)||!brain.enabled||!brain.permitted(r.info)))stop();}catch{if(visit)stop();}},300);
 for(const event of ['suspend','lock-screen'])powerMonitor.on(event,()=>{awake=false;brain.cancel();stop();host();});
 for(const event of ['resume','unlock-screen'])powerMonitor.on(event,()=>{awake=true;brain.stable=Date.now();host();});
 screen.on('display-metrics-changed',()=>{const f=pet.getBounds();stop();pet.setBounds(round(G.resized(f,f,display().workArea,footprint)));adopt();host();});
});
app.on('window-all-closed',()=>{});app.on('before-quit',()=>{native?.stop();brain?.cancel();});
