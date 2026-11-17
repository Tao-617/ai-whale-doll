const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function area(s,size,f={x:0,y:0,width:1,height:1}) {const w=size.width*f.width,h=size.height*f.height;
 return {x:s.x+Math.min(8,Math.max(0,(s.width-w)/2))-size.width*f.x,y:s.y+Math.min(8,Math.max(0,(s.height-h)/2))-size.height*f.y,
  width:Math.max(0,s.width-w-16),height:Math.max(0,s.height-h-16)}; }
function bounded(p,a) { return {x:clamp(p.x,a.x,a.x+a.width),y:clamp(p.y,a.y,a.y+a.height)}; }
function edge(p,a) { const q=bounded(p,a); return [{x:q.x,y:a.y+a.height},{x:a.x,y:q.y},{x:a.x+a.width,y:q.y},{x:q.x,y:a.y}]
  .sort((u,v)=>Math.hypot(u.x-p.x,u.y-p.y)-Math.hypot(v.x-p.x,v.y-p.y))[0]; }
function onEdge(p,a) { const q=edge(p,a); return Math.hypot(p.x-q.x,p.y-q.y)<2; }
function position(p,a) { if(Math.abs(p.y-a.y-a.height)<.01)return p.x-a.x;
  if(Math.abs(p.x-a.x-a.width)<.01)return a.width+a.y+a.height-p.y;
  if(Math.abs(p.y-a.y)<.01)return a.width+a.height+a.x+a.width-p.x;
  return 2*a.width+a.height+p.y-a.y; }
function point(s,a) { const l=2*(a.width+a.height); if(!l)return {x:a.x,y:a.y}; const t=((s%l)+l)%l;
  if(t<=a.width)return{x:a.x+t,y:a.y+a.height};
  if(t<=a.width+a.height)return{x:a.x+a.width,y:a.y+a.height-(t-a.width)};
  if(t<=2*a.width+a.height)return{x:a.x+a.width-(t-a.width-a.height),y:a.y};
  return{x:a.x,y:a.y+t-2*a.width-a.height}; }
function target(p,a,f) { if(!onEdge(p,a))return edge(p,a); const l=2*(a.width+a.height),stride=Math.min(l*.45,Math.max(90,l*(.12+Math.abs(f-.5)*.4)));
  return point(position(edge(p,a),a)+(f<.5?-stride:stride),a); }
function resized(frame,size,screen,footprint) {const old=area(screen,frame,footprint),a=area(screen,size,footprint),p=edge(frame,old);
  const x=a.x+(old.width?(p.x-old.x)/old.width:0)*a.width,y=a.y+(old.height?(p.y-old.y)/old.height:0)*a.height;
  return {...edge({x,y},a),...size};}
function make(p,dest,a,now,scale,running,id,kind='stroll') {
  const start=bounded(p,a),end=kind==='observation'?bounded(dest,a):edge(dest,a),aa=edge(start,a),bb=edge(end,a),l=2*(a.width+a.height);
  let sa=position(aa,a),sb=position(bb,a); if(sb-sa>l/2)sb-=l;if(sa-sb>l/2)sb+=l;
  let corners=[-1,0,1].flatMap(t=>[0,a.width,a.width+a.height,2*a.width+a.height].map(x=>x+t*l))
    .filter(x=>x>Math.min(sa,sb)+.01&&x<Math.max(sa,sb)-.01).sort((a,b)=>a-b);if(sa>sb)corners.reverse();
  const raw=[start,aa,...corners.map(x=>point(x,a)),bb,end],points=raw.filter((p,i)=>!i||Math.hypot(p.x-raw[i-1].x,p.y-raw[i-1].y)>.01);
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y)),distance=lengths.reduce((a,b)=>a+b,0);
  if(distance<2)return null;
  const weights=points.slice(1).map((p,i)=>kind==='stroll'&&onEdge(start,a)&&Math.abs(p.y-points[i].y)>Math.abs(p.x-points[i].x)*2?4:1);
  const costs=lengths.map((n,i)=>n*weights[i]),cost=costs.reduce((a,b)=>a+b,0);
  return{points,lengths,distance,weights,costs,cost,start,end,now,duration:Math.max(1.8,1.5*cost/((running?155:85)*scale)),gait:running?'run':'walk',id,kind};
}
function sample(path,now) { const u=clamp((now-path.now-.4)/path.duration,0,1);let remain=path.cost*u*u*(3-2*u);
  for(let i=0;i<path.lengths.length;i++){if(remain<=path.costs[i]||i===path.lengths.length-1){const p=path.points[i],q=path.points[i+1],f=Math.min(1,remain/path.costs[i]);
    return {x:p.x+(q.x-p.x)*f,y:p.y+(q.y-p.y)*f,dx:q.x-p.x,dy:-(q.y-p.y),speed:path.cost/path.weights[i]*6*u*(1-u)/path.duration,done:u===1};}remain-=path.costs[i];}
  return{...path.end,dx:0,dy:0,speed:0,done:true}; }
function destination(focus,window,screen,size) {const p={x:window.x+window.width*focus.x,y:window.y+window.height*focus.y};
  if(p.x<screen.x||p.x>screen.x+screen.width||p.y<screen.y||p.y>screen.y+screen.height)return null;
  return bounded({x:p.x<screen.x+screen.width/2?p.x+24:p.x-size.width-24,y:p.y-size.height/2},area(screen,size));}
module.exports={area,bounded,edge,onEdge,target,resized,make,sample,destination};
