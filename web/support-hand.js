// A small, relaxed open hand for cheek support. The source asset has a closed fist and no usable
// finger weights. Blend this hand out of that fist during the pose, keeping the original cuff.
import * as THREE from 'three';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const union=(a,b,k=.0025)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
export function supportHandGeometry(thumbSide){
 const shapes=[];
 const ellipsoid=(c,r)=>shapes.push(p=>{const d=p.clone().sub(c),k0=d.clone().divide(r).length(),k1=d.clone().divide(r.clone().multiply(r)).length();return k1>1e-8?k0*(k0-1)/k1:-Math.min(r.x,r.y,r.z);});
 const capsule=(a,b,r)=>{const ba=b.clone().sub(a),l=ba.lengthSq();shapes.push(p=>{const d=p.clone().sub(a);return d.addScaledVector(ba,-THREE.MathUtils.clamp(d.dot(ba)/l,0,1)).length()-r;});};
 ellipsoid(V(0,.027,0),V(.020,.025,.010));
 ellipsoid(V(0,.004,0),V(.012,.018,.009));
 // Index to little finger: close together, gently curled toward the cheek, with distinct tips.
 const tips=[];
 for(const [i,length]of [.028,.032,.029,.022].entries()){
  const x=(.015-i*.010)*thumbSide,r=i===3?.0046:.0052;
  const a=V(x,.043,0),b=V(x,.043+length*.56,.002),c=V(x,.043+length,.008);
  capsule(a,b,r);capsule(b,c,r*.94);tips.push(c);
 }
 const ta=V(thumbSide*.014,.019,.002),tb=V(thumbSide*.026,.028,.006),tc=V(thumbSide*.027,.042,.012);
 capsule(ta,tb,.007);capsule(tb,tc,.006);tips.push(tc);
 const field=p=>shapes.reduce((d,f)=>union(d,f(p)),Infinity);
 // Marching tetrahedra keeps the palm/finger junctions one smooth surface rather than stacked balls.
 const step=.0025,origin=V(-.04,-.018,-.018),nx=33,ny=43,nz=20,values=new Float32Array(nx*ny*nz),at=(x,y,z)=>x+nx*(y+ny*z);
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values[at(x,y,z)]=field(V(x*step,y*step,z*step).add(origin));
 const positions=[],normals=[],corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
 const gradient=p=>{const e=.0003;return V(field(p.clone().add(V(e)))-field(p.clone().sub(V(e))),field(p.clone().add(V(0,e)))-field(p.clone().sub(V(0,e))),field(p.clone().add(V(0,0,e)))-field(p.clone().sub(V(0,0,e)))).normalize();};
 const triangle=(a,b,c)=>{const n=gradient(a.clone().add(b).add(c).multiplyScalar(1/3));if(b.clone().sub(a).cross(c.clone().sub(a)).dot(n)<0)[b,c]=[c,b];for(const p of [a,b,c]){positions.push(...p.toArray());normals.push(...gradient(p).toArray());}};
 for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
  const d=corners.map(([dx,dy,dz])=>values[at(x+dx,y+dy,z+dz)]);if(d.every(v=>v>0)||d.every(v=>v<0))continue;
  const p=corners.map(([dx,dy,dz])=>V((x+dx)*step,(y+dy)*step,(z+dz)*step).add(origin));
  for(const t of tetra){const points=[];for(const [a,b]of edges){const i=t[a],j=t[b];if((d[i]<0)!==(d[j]<0))points.push(p[i].clone().lerp(p[j],d[i]/(d[i]-d[j])));}if(points.length<3)continue;
   if(points.length===4){const c=points.reduce((a,p)=>a.add(p),V()).multiplyScalar(.25),n=gradient(c),u=points[0].clone().sub(c).normalize(),v=n.clone().cross(u);points.sort((a,b)=>Math.atan2(a.clone().sub(c).dot(v),a.clone().sub(c).dot(u))-Math.atan2(b.clone().sub(c).dot(v),b.clone().sub(c).dot(u)));}
   triangle(points[0],points[1],points[2]);if(points.length===4)triangle(points[0],points[2],points[3]);
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.userData.tips=tips;return geometry;
}
