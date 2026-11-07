import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(path.join(base,'package.json'))
const T=require('three'),sharp=require('sharp'),{Document,NodeIO}=require('@gltf-transform/core')
const io=new NodeIO(),out=path.join(base,'static/wasteland/library/道具')
const v=(x,y,z)=>new T.Vector3(x,y,z)
let seed=8041,faces=[],parts=new Map(),group='Body',renderScale=1,offset=v(0,0,0),record=true
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
const pick=a=>a[Math.floor(random()*a.length)]
function triangle(a,b,c,col){
 const n=b.clone().sub(a).cross(c.clone().sub(a))
 if(n.lengthSq()<1e-14)return
 n.normalize();faces.push({p:[a,b,c].map(p=>p.clone().multiplyScalar(renderScale).add(offset)),normal:n,col})
 if(!record)return
 const key=group+col
 if(!parts.has(key))parts.set(key,{group,col,positions:[],normals:[],indices:[],vertices:new Map()})
 const p=parts.get(key)
 for(const point of [a,b,c]){
  const key=[...point.toArray(),...n.toArray()].map(x=>Math.round(x*1e6)).join(',')
  if(!p.vertices.has(key)){p.vertices.set(key,p.vertices.size);p.positions.push(...point.toArray());p.normals.push(...n.toArray())}
  p.indices.push(p.vertices.get(key))
 }
}
function quad(a,b,c,d,col){triangle(a,b,c,col);triangle(a,c,d,col)}
function geometry(geo,pos,col,quat){
 const points=geo.attributes.position,ids=geo.index?.array??Array.from({length:points.count},(_,i)=>i)
 const transformed=Array.from({length:points.count},(_,i)=>{
  const p=v(points.getX(i),points.getY(i),points.getZ(i))
  if(quat)p.applyQuaternion(quat)
  return p.add(pos)
 })
 for(let i=0;i<ids.length;i+=3)triangle(transformed[ids[i]],transformed[ids[i+1]],transformed[ids[i+2]],col)
}
function box(x,y,z,w,h,d,col){geometry(new T.BoxGeometry(w,h,d),v(x,y,z),col)}
function ellipsoid(pos,size,col,detail=1){
 const g=new T.IcosahedronGeometry(1,detail);g.scale(...size.toArray());geometry(g,pos,col)
}
function rod(a,b,r1,r2,col,sides=6){
 const delta=b.clone().sub(a)
 geometry(new T.CylinderGeometry(r2,r1,delta.length(),sides),a.clone().lerp(b,.5),col,new T.Quaternion().setFromUnitVectors(v(0,1,0),delta.normalize()))
}
function line(points,r,col,sides=5){
 for(let i=1;i<points.length;i++)rod(points[i-1],points[i],r*(1-(i-1)/points.length*.65),r*(1-i/points.length*.65),col,sides)
}
function torus(p,r,tube,col,quaternion){
 geometry(new T.TorusGeometry(r,tube,5,16),p,col,quaternion)
}
async function save(name,extra={}){
 const doc=new Document(),buf=doc.createBuffer(),scene=doc.createScene(name),mats=new Map(),groups=new Map()
 const bounds=new T.Box3()
 const asset=doc.createNode(name).setExtras({singleAsset:true})
 scene.addChild(asset)
 const acc=(type,array)=>doc.createAccessor().setBuffer(buf).setType(type).setArray(array)
 for(const p of parts.values()){
  if(!groups.has(p.group)){const mesh=doc.createMesh(p.group);asset.addChild(doc.createNode(p.group).setMesh(mesh));groups.set(p.group,mesh)}
  if(!mats.has(p.col))mats.set(p.col,doc.createMaterial(p.col).setBaseColorFactor([...new T.Color('#'+p.col).toArray(),1]).setRoughnessFactor(.92))
  groups.get(p.group).addPrimitive(doc.createPrimitive().setMaterial(mats.get(p.col)).setAttribute('POSITION',acc('VEC3',new Float32Array(p.positions))).setAttribute('NORMAL',acc('VEC3',new Float32Array(p.normals))).setIndices(acc('SCALAR',new Uint32Array(p.indices))))
  for(let i=0;i<p.positions.length;i+=3)bounds.expandByPoint(v(...p.positions.slice(i,i+3)))
 }
 // Ground-centred origin, plus explicit metadata for future placement.
 const shift=v(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,-(bounds.min.z+bounds.max.z)/2)
 asset.setTranslation(shift.toArray())
 scene.setExtras({units:'metres',upAxis:'Y',singleAsset:true,bounds:{min:bounds.min.clone().add(shift).toArray(),max:bounds.max.clone().add(shift).toArray()},...extra})
 const bytes=await io.writeBinary(doc),report=await require('gltf-validator').validateBytes(bytes)
 if(report.issues.numErrors)throw Error(JSON.stringify(report.issues))
 fs.writeFileSync(path.join(out,name+'.glb'),bytes)
 console.log(name,JSON.stringify({triangles:report.info.totalTriangleCount,bytes:bytes.length,errors:report.issues.numErrors}))
 parts.clear()
}
// A dented petrol drum. The patches follow the faceted steel surface.
offset=v(-4.8,0,3.4);renderScale=2.9
const drumRadius=.305
function drumPoint(angle,y,push=0){
 const dent=-.023*Math.exp(-(((angle-2.2)/.36)**2+((y-.47)/.2)**2))
 return v(Math.cos(angle)*(drumRadius+dent+push),y,Math.sin(angle)*(drumRadius+dent+push))
}
group='Dented shell'
for(let i=0;i<24;i++)for(let j=0;j<12;j++){
 const a=i*Math.PI/12,b=(i+1)*Math.PI/12,y=.035+j*.0685,ny=y+.0685
 quad(drumPoint(a,y),drumPoint(a,ny),drumPoint(b,ny),drumPoint(b,y),pick(['a25c3b','ad6c43','965536','b5774a']))
}
const horizontal=new T.Quaternion().setFromAxisAngle(v(1,0,0),Math.PI/2)
group='Rims and hoops'
for(const y of [.035,.30,.61,.865]){
 const g=new T.CylinderGeometry(.321,.321,.027,24)
 geometry(g,v(0,y,0),y>.8?'665044':'684a3c')
 torus(v(0,y+.0135,0),.308,.009,'c18c58',horizontal)
}
geometry(new T.CylinderGeometry(.302,.302,.016,24),v(0,.856,0),'916341')
geometry(new T.CylinderGeometry(.302,.302,.018,24),v(0,.012,0),'624938')
group='Filler caps'
for(const [x,z,r] of [[.145,.08,.04],[-.145,-.08,.022]]){
 geometry(new T.CylinderGeometry(r,r,.018,8),v(x,.875,z),'4a413c')
 torus(v(x,.884,z),r,.006,'c5a275',horizontal)
 box(x,.887,z,r*1.1,.006,.009,'9d8a70')
}
group='Flaking paint'
for(let i=0;i<105;i++){
 const angle=Math.floor(random()*24)*Math.PI/12,y=.05+random()*.77
 const a=drumPoint(angle,y,.0018),b=drumPoint(angle+Math.PI/12,y,.0018)
 const h=.012+random()**2*.14
 quad(a,a.clone().add(v(0,h,0)),b.clone().add(v(0,h*(.3+random()*.65),0)),b,pick(['674436','75442e','c38a55','dac49a']))
}
group='Faded fuel label'
for(let i=0;i<5;i++){
 const a=.42+i*.105,b=a+.105
 quad(drumPoint(a,.375,.003),drumPoint(a,.55,.003),drumPoint(b,.55,.003),drumPoint(b,.375,.003),'c7b48a')
}
triangle(drumPoint(.52,.405,.005),drumPoint(.78,.405,.005),drumPoint(.65,.519,.005),'4a413c')
await save('生锈汽油桶')

// A 20-foot corrugated steel container, with two closed separate door leaves.
offset=v(-.2,0,-2.1);renderScale=1
group='Container frame'
box(0,.075,0,6.06,.15,2.44,'4b5552')
box(0,2.50,0,6.06,.14,2.44,'557e7d')
const panelZ=x=>1.17+(.055*(.5+.5*Math.cos(x*Math.PI/.15)))
group='Corrugated side panels'
for(const side of [-1,1]){
 for(let i=0;i<80;i++){
  const x=-2.96+i*.074,x1=x+.074,z=side*panelZ(x),z1=side*panelZ(x1)
  const patch=(a,b,c,d,tint)=>side>0?quad(a,b,c,d,tint):quad(d,c,b,a,tint)
  const col=pick(['557b78','527674','5b807a','648680'])
  if(side>0)quad(v(x,.18,z),v(x1,.18,z1),v(x1,2.43,z1),v(x,2.43,z),col)
  else quad(v(x,2.43,z),v(x1,2.43,z1),v(x1,.18,z1),v(x,.18,z),col)
  if(i%3===0){
   const h=.09+random()**2*.55,y=2.42-h
   patch(v(x,y,z+side*.002),v(x1,y+h*.28,z1+side*.002),v(x1,2.43,z1+side*.002),v(x,2.43,z+side*.002),'a36644')
  }
  if(i%2===0){
   const h=.08+random()**2*.42
   patch(v(x,.18,z+side*.004),v(x1,.18,z1+side*.004),v(x1,.18+h,z1+side*.004),v(x,.18+h*.63,z+side*.004),pick(['a36644','80553d','b57e55']))
  }
 }
}
group='Corrugated roof'
box(0,2.48,0,5.9,.12,2.3,'577976')
for(let i=0;i<23;i++)box(-2.85+i*.25,2.56,0,.065,.045,2.27,i%4===0?'967054':'708b81')
for(const x of [-2.98,2.98])for(const z of [-1.17,1.17]){
 box(x,1.30,z,.16,2.6,.16,'486764')
 for(const y of [.14,2.47]){
  box(x,y,z,.19,.25,.22,'65685b')
  box(x+(x>0?.099:-.099),y,z,.008,.09,.115,'353e3b')
 }
}
group='Rear wall'
box(-2.95,1.29,0,.12,2.35,2.27,'4d7270')
for(let i=0;i<8;i++)box(-3.02,1.29,-1.02+i*.29,.055,2.3,.075,'719087')
group='Double doors'
for(const side of [-1,1]){
 box(3.02,1.28,side*.574,.11,2.33,1.10,'425a57')
 box(3.085,1.28,side*.574,.045,2.22,1.035,side>0?'618783':'597c77')
 for(const z of [side*.20,side*.91]){
  rod(v(3.15,.22,z),v(3.15,2.38,z),.022,.022,'9b9a81',8)
  for(const y of [.40,1.35,2.20])box(3.16,y,z,.055,.13,.11,'947858')
  rod(v(3.20,1.13,z),v(3.20,1.13,z+.21),.02,.02,'b8ae91')
 }
 for(const y of [.45,1.3,2.1])box(3.14,y,side*1.06,.11,.095,.25,'ab8f6d')
 for(let i=0;i<3;i++)box(3.115,.47+i*.67,side*.58,.025,.038,.82,'88a097')
}
await save('废弃集装箱')

// A fixed per-asset seed keeps the branch layout independent of container edits.
seed=2972373457
// An open, irregular tangle of dry tapering stems.
offset=v(-1.75,0,3.45);renderScale=2.05
group='Dry branches'
const centre=v(0,.65,0)
for(let i=0;i<66;i++){
 const normal=v(random()-.5,random()-.5,random()-.5).normalize()
 const u=normal.clone().cross(v(.11,1,.08)).normalize(),w=normal.clone().cross(u).normalize()
 const radius=.32+random()*.29,phase=random()*Math.PI*2,points=[]
 for(let j=0;j<12;j++){
  const a=phase+j*.43,variation=1+.11*Math.sin(j*2.1+i)
  points.push(centre.clone().addScaledVector(u,Math.cos(a)*radius*variation).addScaledVector(w,Math.sin(a)*radius*variation))
 }
 line(points,.006+random()*.006,pick(['988165','a49876','b89b68','c2ab7c','847352']),4)
 for(const j of [3,6,9]){
  const a=points[j],direction=a.clone().sub(centre).normalize(),b=a.clone().addScaledVector(direction,.09+random()*.13).addScaledVector(normal,.04)
  rod(a,b,.004,.0014,'b9a175',4)
  rod(a,a.clone().lerp(b,.6).addScaledVector(w,.07),.0035,.0012,'aa8e5f',4)
 }
}
await save('风滚草',{pivot:'Ground centre. For rolling, use a parent pivot near [0, 0.65, 0].'})

// A dry bovine-like skeleton, with separate skull, vertebrae, ribs and limb bones.
offset=v(2.20,0,3.50);renderScale=1.42
const ivory='e8d9b5',bone='d4c299',boneShade='b9a883',dark='716754'
group='Spine and pelvis'
for(let i=0;i<14;i++){
 const x=-.60+i*.112,y=.56+.19*Math.sin(i/13*Math.PI)
 ellipsoid(v(x,y,0),v(.086,.066,.082),i%3?ivory:bone,0)
 rod(v(x,y+.035,0),v(x+.015,y+.17,0),.025,.009,bone,5)
 rod(v(x,y,0),v(x,y+.04,.16),.027,.012,ivory)
 rod(v(x,y,0),v(x,y+.04,-.16),.027,.012,ivory)
}
for(const side of [-1,1]){
 const p=[v(.88,.55,side*.04),v(1.03,.55,side*.20),v(1.16,.41,side*.33),v(1.04,.25,side*.32),v(.85,.30,side*.20),v(.88,.55,side*.04)]
 line(p,.064,bone,7)
 ellipsoid(v(1.02,.34,side*.29),v(.08,.1,.095),ivory,0)
}
line([v(1.08,.44,0),v(1.28,.27,.06),v(1.52,.11,.11),v(1.69,.055,.18)],.031,bone,6)
group='Rib cage'
for(let i=0;i<8;i++){
 const x=-.49+i*.156,size=.32+.15*Math.sin(i/8*Math.PI),y=.61+.15*Math.sin(i/8*Math.PI)
 for(const side of [-1,1]){
  const pts=[v(x,y,side*.065),v(x-.045,y+.075,side*.23),v(x-.07,y-.01,side*size),v(x-.02,y-.24,side*(size+.05)),v(x+.03,.20,side*.35),v(x+.08,.145,side*.16)]
  if(i===5&&side===1)pts.splice(4)
  line(pts,.028, i%2?ivory:bone,7)
 }
}
line([v(-.52,.14,0),v(-.10,.14,0),v(.29,.14,0),v(.66,.18,0)],.032,bone,6)
group='Shoulder blades'
for(const side of [-1,1]){
 const p=[v(-.62,.63,side*.19),v(-.31,.67,side*.35),v(-.43,.26,side*.39)]
 triangle(...(side>0?p:[p[2],p[1],p[0]]),bone)
 triangle(p[2].clone().add(v(0,0,-.025*side)),p[1].clone().add(v(0,0,-.025*side)),p[0].clone().add(v(0,0,-.025*side)),boneShade)
 rod(p[0],p[2],.035,.028,ivory)
}
function limb(points){
 for(let i=1;i<points.length;i++){
  rod(points[i-1],points[i],.039,.032,ivory,7)
  ellipsoid(points[i-1],v(.060,.055,.056),bone,0)
 }
 ellipsoid(points.at(-1),v(.05,.04,.055),bone,0)
}
group='Scattered limb bones'
for(const side of [-1,1]){
 limb([v(-.48,.31,side*.26),v(-.25,.12,side*.68),v(-.94,.075,side*1.02)])
 limb([v(1.02,.31,side*.29),v(.79,.11,side*.72),v(1.46,.065,side*.99)])
 rod(v(1.45,.065,side*.99),v(1.65,.048,side*1.02),.028,.020,bone,6)
}
group='Skull'
line([v(-.60,.57,0),v(-.79,.41,0),v(-.95,.28,0)],.065,bone,7)
ellipsoid(v(-1.12,.27,0),v(.27,.19,.23),bone,1)
ellipsoid(v(-1.34,.205,0),v(.29,.115,.13),ivory,1)
for(const side of [-1,1]){
 // Inset dark sockets framed by raised bone rims.
 ellipsoid(v(-1.11,.30,side*.202),v(.088,.083,.022),dark,1)
 torus(v(-1.11,.30,side*.218),.09,.018,ivory)
 line([v(-1.08,.17,side*.23),v(-1.30,.08,side*.18),v(-1.64,.066,side*.115)],.027,bone,6)
 for(let i=0;i<5;i++)box(-1.28-i*.052,.113,side*.121,.034,.045,.036,'f3e6c6')
 const horn=[v(-.99,.37,side*.17),v(-.90,.48,side*.35),v(-.92,.60,side*.54),v(-1.08,.66,side*.68),v(-1.24,.68,side*.72)]
 for(let i=1;i<horn.length;i++)rod(horn[i-1],horn[i],.078*(1-(i-1)/4),.078*(1-i/4)+.002,i<3?bone:boneShade,8)
}
ellipsoid(v(-1.57,.22,0),v(.095,.07,.10),dark,0)
rod(v(-1.65,.27,0),v(-1.44,.28,0),.023,.032,ivory,6)
for(const side of [-1,1])rod(v(-1.64,.18,side*.07),v(-1.48,.27,side*.09),.02,.025,ivory,6)
await save('动物骸骨',{animal:'Stylized large horned herbivore'})
record=false;offset=v(0,0,0);renderScale=1
box(0,-.043,0,200,.05,200,'e5dac3')
function camera(dir,focus,scale,w,h){
 const forward=dir.clone().normalize(),right=v(0,1,0).cross(forward).normalize(),up=forward.clone().cross(right)
 return p=>{const q=p.clone().sub(focus);return [w/2+q.dot(right)*scale,h/2-q.dot(up)*scale,q.dot(forward)]}
}
function raster(p,w,h,put){
 const [a,b,c]=p, dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1],det=dx*ey-dy*ex
 if(Math.abs(det)<.00001)return
 const left=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),right=Math.min(w-1,Math.ceil(Math.max(a[0],b[0],c[0])))
 const top=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),bottom=Math.min(h-1,Math.ceil(Math.max(a[1],b[1],c[1])))
 for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
  const px=x+.5-a[0],py=y+.5-a[1],s=(px*ey-py*ex)/det,t=(dx*py-dy*px)/det
  if(s>=0&&t>=0&&s+t<=1)put(y*w+x,a[2]+s*(b[2]-a[2])+t*(c[2]-a[2]),s,t)
 }
}
const light=v(-.48,1,.37).normalize(),ss=1800,shadow=new Float32Array(ss*ss).fill(-Infinity)
const sun=camera(light,v(0,1,0),110,ss,ss)
for(const f of faces){f.shadow=f.p.map(sun);raster(f.shadow,ss,ss,(i,z)=>{if(z>shadow[i])shadow[i]=z})}
const width=2400,height=1650,eye=v(64,65,115),view=camera(eye,v(0,.8,1),145,width,height)
const pixels=Buffer.alloc(width*height*3,248),depth=new Float32Array(width*height).fill(-Infinity)
for(const f of faces){
 const n=f.normal.clone();if(n.dot(eye)<0)n.negate()
 const rgb=[0,2,4].map(i=>parseInt(f.col.slice(i,i+2),16)),lit=.76+.25*Math.max(0,n.dot(light))+.04*n.y
 const [a,b,c]=f.shadow
 raster(f.p.map(view),width,height,(i,z,s,t)=>{
  if(z<=depth[i])return;depth[i]=z
  const sx=Math.round(a[0]+(b[0]-a[0])*s+(c[0]-a[0])*t),sy=Math.round(a[1]+(b[1]-a[1])*s+(c[1]-a[1])*t),sz=a[2]+(b[2]-a[2])*s+(c[2]-a[2])*t
  let occluded=0
  for(const offset of [-ss-1,-ss+1,ss-1,ss+1])if(sx>1&&sx<ss-2&&sy>1&&sy<ss-2&&shadow[sy*ss+sx+offset]>sz+.025)occluded+=.25
  for(let k=0;k<3;k++)pixels[i*3+k]=Math.min(255,rgb[k]*lit*(1-occluded*[.23,.24,.18][k])+[5,3,3][k])
 })
}
await sharp(pixels,{raw:{width,height,channels:3}}).resize(1800).png().toFile(path.join(out,'废土道具预览.png'))

