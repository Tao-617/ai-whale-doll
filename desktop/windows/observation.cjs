// Same cadence and cancellation rules as the native Mac companion. No raw key/text monitoring.
const same=(a,b)=>a&&b&&a.handle===b.handle&&a.exe===b.exe&&a.pid===b.pid&&['x','y','width','height'].every(k=>a.bounds[k]===b.bounds[k]);
const denied=/^(xiaojing|electron|systemsettings|credentialuibroker|logonui|lockapp|consent|keepass.*|1password|bitwarden|dashlane|lastpass|windowssecurity|taskmgr)$/i;
class Observation {
  constructor(h){this.h=h;this.enabled=false;this.busy=false;this.pending=null;this.history=[];this.context='';this.epoch=0;this.lastRequest=-Infinity;this.lastSpeech=-Infinity;this.stable=0;this.target=null;this.state='观察已暂停';}
  status(s){this.state=s;this.h.changed();}
  permitted(s){return s&&s.pid!==process.pid&&!denied.test(s.app)&&this.h.allowed().includes(s.exe);}
  cancel(){this.epoch++;this.controller?.abort();this.controller=null;this.pending=null;this.busy=false;this.h.cancelVisit();}
  pause(message='观察已暂停'){this.enabled=false;this.cancel();this.context='';this.history=[];this.status(message);}
  toggle(){if(this.enabled){this.pause();return;}if(!this.h.config()){this.status('先填写模型设置');this.h.settings();return;}if(!this.h.allowed().length){this.status('先允许观察一个应用');return;}
    this.enabled=true;this.lastRequest=this.lastSpeech=-Infinity;this.stable=Date.now();this.status('等待你停下来，再看一眼');}
  async tick(manual=false){if(this.ticking)return;this.ticking=true;try{await this.check(manual);}finally{this.ticking=false;}}
  async check(manual){if(!this.enabled||!this.h.awake())return;
    let r;try{r=await this.h.native.request({kind:'info'});}catch{this.pause('窗口检查未完成，已暂停');return;}
    const s=r.ok?r.info:null,now=Date.now();this.h.source(s);
    if(!same(this.target,s)){this.target=s;this.stable=now;this.pending=null;this.context='';this.h.cancelVisit();}
    if(!this.permitted(s)){if(!this.busy)this.status('当前应用不在观察名单里');return;}
    const quiet=s.idle>=4&&s.idle<60;
    if(this.pending){const p=this.pending;if(now-p.created>30000){this.pending=null;this.h.cancelVisit();return;}
      if(!quiet||this.h.interacting()||(!p.manual&&now-this.lastSpeech<60000)||p.arriving)return;
      if(!p.approached&&this.h.approach()&&p.reply.focus){p.approached=true;p.arriving=true;
        if(this.h.visit(s,p.reply.focus,ok=>{if(this.pending!==p)return;p.arriving=false;if(!ok)this.pending=null;})){this.status('到旁边看看，再和你说');return;}p.arriving=false;}
      this.pending=null;this.present(p.reply);this.status('在旁边陪着你');return;}
    if(this.busy||this.h.interacting()||(!manual&&(!quiet||now-this.stable<8000||now-this.lastRequest<60000))||(manual&&now-this.lastRequest<5000))return;
    this.lastRequest=now;this.busy=true;const epoch=++this.epoch;this.status('正在看一眼「'+s.app+'」');
    let capture;try{capture=await this.h.native.request({kind:'capture',handle:s.handle,exe:s.exe});}catch{}
    if(epoch!==this.epoch)return;
    if(!capture?.ok||!same(capture.info,s)||!this.permitted(capture.info)){this.busy=false;this.status('当前窗口无法截图，稍后再看');return;}
    this.controller=new AbortController();
    try{const reply=await this.h.generate({kind:manual?'peek':'observe',observation:{app:s.app,locate:this.h.approach()},image:{media_type:'image/jpeg',data:capture.image},history:this.history,recent_context:this.context},this.h.config(),{signal:this.controller.signal});
      if(epoch!==this.epoch)return;this.busy=false;
      const again=await this.h.native.request({kind:'info'});
      if(!this.enabled||!this.h.awake()||!again.ok||!same(again.info,s)||!this.permitted(again.info)){this.status('画面已变化，跳过这次评论');return;}
      this.context=reply.context;if(reply.speak){this.pending={reply,created:Date.now(),manual,approached:false,arriving:false};this.status('等你停下来再说');}else this.status('看过了，安静陪着');
    }catch{if(epoch===this.epoch)this.pause('连接未完成，已暂停；不会自动重试');}}
  present(reply){this.lastSpeech=Date.now();this.history.push({role:'assistant',text:reply.text});this.history=this.history.slice(-8);this.h.speak(reply);}
  async chat(text){if(this.busy)return{accepted:false,error:'小鲸正在想，请稍等。'};if(!this.h.config())return{accepted:false,error:'请先在托盘菜单填写模型设置。'};
    this.cancel();this.busy=true;const epoch=this.epoch;this.controller=new AbortController();this.history.push({role:'user',text});this.history=this.history.slice(-8);
    this.h.generate({kind:'chat',text,history:this.history,recent_context:this.context},this.h.config(),{signal:this.controller.signal}).then(r=>{if(epoch!==this.epoch)return;this.busy=false;this.present(r);}).catch(()=>{if(epoch!==this.epoch)return;this.pause('连接未完成，已暂停；不会自动重试');this.h.chatError(this.state);});
    return{accepted:true};}
}
module.exports={Observation,same,denied};
