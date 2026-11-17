const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('webkit',{messageHandlers:{pet:{postMessage:m=>{
  if(m && ['ready','grab','release','shift','wander','roamStop','chat'].includes(m.type))ipcRenderer.send('pet',m);
}}}});
