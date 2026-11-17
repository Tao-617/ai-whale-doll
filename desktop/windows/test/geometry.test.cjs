const test=require('node:test'),assert=require('node:assert/strict'),G=require('../geometry.cjs');
test('the visible character touches the edge, even when the transparent window does not',()=>{
 const screen={x:-1920,y:-150,width:1920,height:1080},ink={x:.21,y:.17,width:.58,height:.65};
 for(const width of [260,360,520]){const size={width,height:Math.round(width*4/3)},a=G.area(screen,size,ink);
  for(const side of [0,1,2,3]){const p=G.edge(side===0?{x:a.x,y:a.y+a.height/2}:side===1?{x:a.x+a.width,y:a.y+a.height/2}:side===2?{x:a.x+a.width/2,y:a.y}:{x:a.x+a.width/2,y:a.y+a.height},a);
   const r={left:p.x+ink.x*size.width,top:p.y+ink.y*size.height,right:p.x+(ink.x+ink.width)*size.width,bottom:p.y+(ink.y+ink.height)*size.height};
   const gap=[r.left-screen.x,screen.x+screen.width-r.right,r.top-screen.y,screen.y+screen.height-r.bottom][side];assert(Math.abs(gap-8)<1e-7);
   assert(r.left>=screen.x&&r.right<=screen.x+screen.width&&r.top>=screen.y&&r.bottom<=screen.y+screen.height);
  }
 }
});
test('climbing is slower than walking, with the actual speed reported to the renderer',()=>{
 const a={x:0,y:0,width:1000,height:600},start={x:0,y:600};
 for(const scale of [260/360,1,520/360])for(const running of [false,true]){
  const climb=G.make(start,{x:0,y:300},a,0,scale,running,1),walk=G.make(start,{x:300,y:600},a,0,scale,running,2);
  const visit=G.make(start,{x:0,y:300},a,0,scale,running,3,'observation');
  assert.equal(climb.duration,walk.duration*4);assert.equal(visit.duration,walk.duration);
  const mid=.4+climb.duration/2,s=G.sample(climb,mid),before=G.sample(climb,mid-.001),after=G.sample(climb,mid+.001);
  assert(s.dy>0);assert(Math.abs(s.speed-Math.hypot(after.x-before.x,after.y-before.y)/.002)<.001);
  assert(Math.abs(s.speed-(running?155:85)*scale/4)<1e-8);
 }
});
test('all random travel remains on four edges, including small and negative displays',()=>{
 for(const s of [{x:0,y:0,width:1470,height:956},{x:-1920,y:-200,width:1920,height:1080}])for(const size of [{width:260,height:346},{width:360,height:480},{width:520,height:692}]){
  const a=G.area(s,size);for(let i=0;i<=40;i++){const p=G.edge({x:a.x+a.width*i/40,y:a.y+a.height*i/40},a),dest=G.target(p,a,i/40),route=G.make(p,dest,a,0,size.width/360,true,i);
   assert(G.onEdge(dest,a));if(route)for(let j=0;j<=100;j++)assert(G.onEdge(G.sample(route,.4+route.duration*j/100),a));}}
});
test('resize reanchors immediately on the same display, even mid-trip',()=>{const s={x:-1920,y:-100,width:1920,height:1080};for(const old of [260,360,520])for(const width of [260,360,520]){
 const size={width,height:Math.round(width*4/3)},f={x:-1000,y:300,width:old,height:Math.round(old*4/3)},r=G.resized(f,size,s);assert(G.onEdge(r,G.area(s,size)));assert(r.x>=s.x&&r.x+r.width<=s.x+s.width);}
});
test('only observation can move to the interior, and recovery heads to nearest edge',()=>{const a={x:8,y:8,width:1000,height:400},middle={x:508,y:208};
 const visit=G.make({x:8,y:408},middle,a,0,1,true,1,'observation');assert.deepEqual(G.sample(visit,1000).x,middle.x);assert.deepEqual(G.sample(visit,1000).y,middle.y);
 const ordinary=G.make({x:8,y:408},middle,a,0,1,true,2);assert(G.onEdge(G.sample(ordinary,1000),a));assert.deepEqual(G.target(middle,a,.9),G.edge(middle,a));});
