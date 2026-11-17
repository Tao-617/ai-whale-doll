const test=require('node:test'),assert=require('node:assert/strict');const M=require('../../../companion/model.cjs');
test('chat never includes an unsolicited screenshot',()=>{const c=M.prepare({kind:'chat',text:'hi',image:{data:'SECRET'}});assert.equal(c.length,1);assert(!JSON.stringify(c).includes('SECRET'));});
test('focus is bounded, numeric, optional, and impossible on text chat',()=>{const reply={speak:true,text:'嘿',emotion:'evil',motion:'eval',focus:{x:.2,y:.6,z:'ignored'}};
 assert.equal(M.parse(JSON.stringify(reply),{kind:'chat'}).focus,null);
 const data={kind:'observe',observation:{locate:true}},valid=M.parse(JSON.stringify(reply),data);assert.deepEqual(valid.focus,{x:.2,y:.6});assert.equal(valid.motion,'');
 for(const value of [true,'0.5',-1,2,null])assert.equal(M.parse(JSON.stringify({...reply,focus:{x:value,y:.5}}),data).focus,null);
});
test('request is made once, rejects redirects, and never exposes upstream text',async()=>{let n=0;await assert.rejects(M.generate({kind:'chat',text:'hi'},{baseUrl:'https://example.com/v1',model:'test',apiKey:'test-only'},
 {fetchImpl:async(_u,opt)=>{n++;assert.equal(opt.redirect,'error');throw Error('secret-upstream-body');}}),/model_result_uncertain/);assert.equal(n,1);
 assert.throws(()=>M.endpoint('http://example.com'),/invalid/);assert.equal(M.endpoint('https://example.com/direct/v1'),'https://example.com/direct/v1/messages');});
