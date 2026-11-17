'use strict';
const fs = require('node:fs');
const path = require('node:path');
const SYSTEM = fs.readFileSync(path.join(__dirname, 'system.txt'), 'utf8');
const faces = new Set(['neutral','smile','happy','curious','shy','touched','sleepy','surprised','pout']);
const motions = new Set(['','head_tilt','wave','nod_yes','think','clap','tail_wag']);
const short = (v, n) => typeof v === 'string' ? [...v.trim()].slice(0, n).join('') : '';
function endpoint(base) {
  const u = new URL(base);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw Error('invalid_model_address');
  u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/v1(?:\/messages)?$/, '') + '/v1/messages';
  return u.href;
}
function prepare(data) {
  if (!data || !['chat','observe','peek'].includes(data.kind)) throw Error('invalid_input');
  const context = {kind: data.kind, recent_context: short(data.recent_context, 100), history: (Array.isArray(data.history) ? data.history : []).slice(-8)
    .filter(r => r && ['user','assistant'].includes(r.role)).map(r => ({role:r.role,text:short(r.text,500)}))};
  const content = [];
  if (data.kind === 'chat') {
    context.user_text = short(data.text,500); if (!context.user_text) throw Error('empty_message');
  } else {
    const im = data.image;
    if (!im || !['image/jpeg','image/png'].includes(im.media_type) || typeof im.data !== 'string' || im.data.length > 2800000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(im.data) || im.data.length % 4) throw Error('invalid_image');
    const bytes = Buffer.from(im.data,'base64'), sig = im.media_type === 'image/png' ? Buffer.from([137,80,78,71,13,10,26,10]) : Buffer.from([255,216,255]);
    if (!bytes.subarray(0,sig.length).equals(sig)) throw Error('invalid_image');
    content.push({type:'image',source:{type:'base64',media_type:im.media_type,data:im.data}});
    context.observation = {app:short(data.observation?.app,80),locate:data.observation?.locate === true};
  }
  content.push({type:'text',text:JSON.stringify(context)}); return content;
}
function parse(text, data) {
  let r;
  try { r = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); } catch { throw Error('invalid_model_reply'); }
  if (!r || typeof r.speak !== 'boolean') throw Error('invalid_model_reply');
  const said = r.speak ? short(r.text,80) : '';
  if (r.speak && !said) throw Error('invalid_model_reply');
  const f = r.focus, valid = said && data.kind !== 'chat' && data.observation?.locate === true && f &&
    ['x','y'].every(k => typeof f[k] === 'number' && Number.isFinite(f[k]) && f[k] >= 0 && f[k] <= 1);
  return {ok:true,speak:!!said,text:said,emotion:faces.has(r.emotion)?r.emotion:'neutral',motion:said && motions.has(r.motion)?r.motion:'',
    context:data.kind === 'chat'?'':short(r.context,100),focus:valid?{x:f.x,y:f.y}:null};
}
async function generate(data, config, {signal, fetchImpl = fetch} = {}) {
  const content = prepare(data);
  if (!config?.apiKey || !config.model) throw Error('model_not_configured');
  const url = endpoint(config.baseUrl);
  const timeout = AbortSignal.timeout(45000);
  let response;
  try {
    response = await fetchImpl(url,{method:'POST',redirect:'error',signal:signal ? AbortSignal.any([signal,timeout]) : timeout,
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.apiKey,'x-api-key':config.apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:config.model,max_tokens:500,system:SYSTEM,messages:[{role:'user',content}]})});
  } catch { throw Error('model_result_uncertain'); }
  if (!response.ok) throw Error('model_http_'+response.status);
  let result;
  try {
    const reader = response.body.getReader(); let total = 0, parts = [];
    while (true) { const {done,value} = await reader.read(); if (done) break; total += value.length;
      if (total > 256000) { await reader.cancel(); throw Error(); } parts.push(Buffer.from(value)); }
    result = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { throw Error('model_result_uncertain'); }
  if (result.stop_reason !== 'end_turn') throw Error('model_result_incomplete');
  return parse((result.content || []).filter(c=>c.type==='text').map(c=>c.text).join(''),data);
}
module.exports = {endpoint, prepare, parse, generate};
