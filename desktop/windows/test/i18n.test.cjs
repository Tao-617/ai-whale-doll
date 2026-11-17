const test=require('node:test'),assert=require('node:assert/strict'),I=require('../i18n.cjs'),M=require('../../../companion/model.cjs');
test('language normalizes, translates, and switches back without losing source labels',()=>{
 I.setLanguage('en-US');assert.equal(I.t('模型设置…'),'Model settings…');assert.equal(I.t('正在看一眼「{0}」','Editor'),'Taking a look at Editor');
 assert(!Object.values(I.english).some(v=>/\p{Script=Han}/u.test(v)&&!v.includes('语言')));
 I.setLanguage('zh-CN');assert.equal(I.t('模型设置…'),'模型设置…');assert.equal(I.normalize('fr-FR'),'en');
});
test('English output is not truncated to the Chinese limit, and locale is trusted system context',async()=>{
 const line='That little illustration looks like a good starting point. I will keep you company while you work on it.';
 const data={kind:'chat',text:'hi',language:'en'};
 const r=await M.generate(data,{baseUrl:'https://example.invalid',model:'offline-test',apiKey:'offline-test'},{fetchImpl:async(_url,opt)=>{
  const body=JSON.parse(opt.body);assert(body.system.includes('Reply in English'));assert(!body.system.includes('用简体中文短句陪伴用户'));
  return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({speak:true,text:line})}]}));
 }});assert.equal(r.text,line);assert(M.parse(JSON.stringify({speak:true,text:line}),{kind:'chat',language:'zh'}).text.length<=80);
});
