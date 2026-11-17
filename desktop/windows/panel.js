const $=id=>document.getElementById(id),mode=location.hash==='#settings'?'settings':'chat';$(mode).hidden=false;
let language='zh',messages={},notice='',history=[];
const t=key=>language==='en'?(messages[key]??key):key;
function showNotice(key){notice=key;$('notice').textContent=t(key);}
function renderHistory(){const box=$('history');box.replaceChildren();for(const item of history){const p=document.createElement('p');p.textContent=t(item.who)+': '+item.text;box.append(p);}box.lastChild?.scrollIntoView();}
function localize(c){language=c.language;messages=c.messages;document.documentElement.lang=language==='en'?'en':'zh-CN';document.title=t(mode==='settings'?'小鲸 · 模型设置':'和小鲸聊一句');
 document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));document.querySelectorAll('[data-placeholder]').forEach(e=>e.placeholder=t(e.dataset.placeholder));showNotice(notice);renderHistory();}
window.panelAPI.settings().then(c=>{localize(c);if(mode==='settings'){$('baseUrl').value=c.baseUrl||'https://api.anthropic.com';$('model').value=c.model||'';showNotice(c.hasKey?'已有本机密钥。':'');}});
window.panelAPI.onLanguage(c=>{notice='';localize(c);$('send').disabled=false;});
$('save').onclick=async()=>{try{await window.panelAPI.save({baseUrl:$('baseUrl').value,model:$('model').value,apiKey:$('apiKey').value});$('apiKey').value='';showNotice('已保存，可以打开聊天试用。');}catch{showNotice('保存失败，请检查 HTTPS 地址、模型名称和密钥。');}};
function line(who,text){history.push({who,text});renderHistory();}
$('send').onclick=async()=>{const text=$('text').value.trim();if(!text)return;$('send').disabled=true;try{const r=await window.panelAPI.chat(text);if(r.accepted){line('我',text);$('text').value='';showNotice('小鲸正在想…');}else showNotice(r.error);}catch{showNotice('请求未完成。');}finally{$('send').disabled=false;}};
window.panelAPI.onReply(r=>{if(r.text){line('小鲸',r.text);showNotice('');}else showNotice(r.error||'');});
