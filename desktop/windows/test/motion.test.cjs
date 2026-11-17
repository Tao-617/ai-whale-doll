const test=require('node:test'),assert=require('node:assert/strict'),{Motion}=require('../geometry.cjs');
test('actual window movement controls gait and blocked trips',()=>{
 const m=new Motion();m.reset({x:0,y:0},0);
 for(let i=1;i<=60;i++)m.update({x:0,y:0},i/60);
 assert.equal(m.confirmedSpeed(100,1),0);assert(m.stalled(100,1));
 m.reset({x:0,y:0},1);assert.equal(m.confirmedSpeed(100,1),0);
 for(let i=1;i<=60;i++)m.update({x:i*100/60,y:0},1+i/60);
 assert(Math.abs(m.confirmedSpeed(100,2)-100)<1e-6);assert(!m.stalled(100,2));
 for(let i=1;i<=60;i++)m.update({x:100,y:0},2+i/60);
 assert.equal(m.confirmedSpeed(100,3),0);assert(m.stalled(100,3));assert(!m.stalled(0,3));
 m.reset({x:0,y:0},4);for(let i=1;i<=60;i++)m.update({x:Math.round(i/6),y:0},4+i/60);
 assert(m.confirmedSpeed(10,5)>5);assert(!m.stalled(10,5));
});
