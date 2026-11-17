const $=id=>document.getElementById(id),mode=location.hash==='#settings'?'settings':'chat';$(mode).hidden=false;
if(mode==='settings')window.panelAPI.settings().then(c=>{$('baseUrl').value=c.baseUrl||'https://api.anthropic.com';$('model').value=c.model||'';$('notice').textContent=c.hasKey?'已有本机密钥。':'';});
$('save').onclick=async()=>{try{await window.panelAPI.save({baseUrl:$('baseUrl').value,model:$('model').value,apiKey:$('apiKey').value});$('apiKey').value='';$('notice').textContent='已保存，可以打开聊天试用。';}catch{$('notice').textContent='保存失败，请检查 HTTPS 地址、模型名称和密钥。';}};
function line(who,text){const p=document.createElement('p');p.textContent=who+'：'+text;$('history').append(p);p.scrollIntoView();}
$('send').onclick=async()=>{const text=$('text').value.trim();if(!text)return;$('send').disabled=true;try{const r=await window.panelAPI.chat(text);if(r.accepted){line('我',text);$('text').value='';$('notice').textContent='小鲸正在想…';}else{$('notice').textContent=r.error;}}catch{$('notice').textContent='请求未完成。';}finally{$('send').disabled=false;}};
window.panelAPI.onReply(r=>{if(r.text){line('小鲸',r.text);$('notice').textContent='';}else $('notice').textContent=r.error||'';});
