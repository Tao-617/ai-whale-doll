const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
class NativeWindow {
  constructor(root){this.root=root;this.next=0;this.pending=new Map();this.buffer='';}
  start(){if(this.child)return;if(process.platform!=='win32')throw Error('windows_required');
    const script=fs.readFileSync(path.join(this.root,'window.ps1'),'utf8');
    this.child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{this.buffer+=chunk;if(this.buffer.length>3100000){this.stop();return;}
      let nl;while((nl=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,nl);this.buffer=this.buffer.slice(nl+1);try{const r=JSON.parse(line),p=this.pending.get(r.id);if(p){clearTimeout(p.timer);this.pending.delete(r.id);p.resolve(r);}}catch{}}});
    this.child.on('error',()=>this.stop());this.child.on('exit',()=>this.stop());this.child.stdin.on('error',()=>this.stop());}
  request(data){return new Promise((resolve,reject)=>{try{this.start();const id=++this.next,timer=setTimeout(()=>this.stop(),10000);
    this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...data,id})+'\n');}catch(e){reject(e);}});}
  stop(){const c=this.child;this.child=null;if(c){c.removeAllListeners();c.kill();}for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('native_unavailable'));}this.pending.clear();this.buffer='';}
}
module.exports={NativeWindow};
