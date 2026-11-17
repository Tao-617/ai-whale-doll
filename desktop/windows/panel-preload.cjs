const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panelAPI',{
  settings:()=>ipcRenderer.invoke('settings-read'),save:d=>ipcRenderer.invoke('settings-save',d),
  chat:t=>ipcRenderer.invoke('chat',t),onReply:cb=>ipcRenderer.on('reply',(_e,d)=>cb(d))
});
