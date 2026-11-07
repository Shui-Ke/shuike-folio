import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { lerp, smoothstep } from '../sources/Game/utilities/maths.js'
import { closeBasalt } from './close-basalt.mjs'

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(path.join(base,'package.json'))
const T=require('three'),sharp=require('sharp')
const {NodeIO,Document}=require('@gltf-transform/core')
const {KHRDracoMeshCompression}=require('@gltf-transform/extensions')
const {copyToDocument,getBounds}=require('@gltf-transform/functions')
const io=new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({'draco3d.decoder':await require('draco3dgltf').createDecoderModule()})
const out=path.join(base,'static/wasteland/library/地形/嶙峋峡谷')
fs.mkdirSync(out,{recursive:true})
const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('Jagged canyon crossing')
const v=(x,y,z)=>new T.Vector3(x,y,z)
let seed=71433
const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
const faces=[],materialCache=new Map()
const terrainRoot=doc.createNode('Terrain'),bridgeRoot=doc.createNode('Vermilion bridge'),roadRoot=doc.createNode('Original road approaches')
for(const n of [terrainRoot,bridgeRoot,roadRoot])scene.addChild(n)
function material(hex){
 if(!materialCache.has(hex))materialCache.set(hex,doc.createMaterial(hex).setBaseColorFactor([...new T.Color('#'+hex).toArray(),1]).setRoughnessFactor(.94))
 return materialCache.get(hex)
}
const accessor=(data,type)=>doc.createAccessor().setBuffer(buffer).setArray(data).setType(type)
function meshFromTriangles(name,triangles){
 const buckets=new Map()
 for(const [a,b,c,hex] of triangles){
  const normal=b.clone().sub(a).cross(c.clone().sub(a))
  if(normal.lengthSq()<1e-12)continue
  normal.normalize()
  if(!buckets.has(hex))buckets.set(hex,{p:[],n:[]})
  const bkt=buckets.get(hex)
  for(const p of [a,b,c]){bkt.p.push(...p.toArray());bkt.n.push(...normal.toArray())}
 }
 const mesh=doc.createMesh(name)
 for(const [hex,b] of buckets)mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION',accessor(new Float32Array(b.p),'VEC3')).setAttribute('NORMAL',accessor(new Float32Array(b.n),'VEC3')).setMaterial(material(hex)))
 return mesh
}
function display(mesh,transform){
 for(const prim of mesh.listPrimitives()){
  const pos=prim.getAttribute('POSITION'),ix=prim.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i)
  const col=new T.Color().fromArray(prim.getMaterial().getBaseColorFactor()).getHexString()
  const pts=Array.from({length:pos.getCount()},(_,i)=>v(...pos.getElement(i,[])).applyMatrix4(transform))
  for(let i=0;i<ix.length;i+=3){
   const p=[pts[ix[i]],pts[ix[i+1]],pts[ix[i+2]]],normal=p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize()
   faces.push({p,normal,col})
  }
 }
}
function place(mesh,parent,name,position=v(0,0,0),scale=v(1,1,1),rotation=new T.Quaternion()){
 const n=doc.createNode(name).setMesh(mesh).setTranslation(position.toArray()).setScale(scale.toArray()).setRotation(rotation.toArray())
 parent.addChild(n)
 display(mesh,new T.Matrix4().compose(position,rotation,scale))
 return n
}
const palette=await sharp(path.join(base,'static/palette.png')).removeAlpha().raw().toBuffer()
function paletteColor(uv){const x=Math.min(127,Math.max(0,Math.floor(uv[0]*128))),y=Math.min(3,Math.max(0,Math.floor(uv[1]*4)));return [...palette.subarray((y*128+x)*3,(y*128+x)*3+3)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function readTriangles(node,matrix=new T.Matrix4(),withChildren=true){
 const transform=matrix.clone().multiply(new T.Matrix4().fromArray(node.getMatrix())),tris=[]
 for(const p of node.getMesh()?.listPrimitives()??[]){
  const pos=p.getAttribute('POSITION'),uv=p.getAttribute('TEXCOORD_0'),ids=p.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i)
  const pts=Array.from({length:pos.getCount()},(_,i)=>v(...pos.getElement(i,[])).applyMatrix4(transform))
  const mat=p.getMaterial(),hex=new T.Color().fromArray(mat?.getBaseColorFactor()??[.5,.5,.5]).getHexString()
  for(let i=0;i<ids.length;i+=3)tris.push([pts[ids[i]],pts[ids[i+1]],pts[ids[i+2]],uv?paletteColor(uv.getElement(ids[i],[])):hex])
 }
 if(withChildren)for(const c of node.listChildren())tris.push(...readTriangles(c,transform))
 return tris
}
function orientedQuad(target,a,b,c,d,col,normal){
 if(b.clone().sub(a).cross(c.clone().sub(a)).dot(normal)<0)[b,d]=[d,b]
 trianglesFromQuad(target,a,b,c,d,col)
}
function trianglesFromQuad(target,a,b,c,d,col,up=false){
 if(up&&b.clone().sub(a).cross(c.clone().sub(a)).y<0)[b,d]=[d,b]
 target.push([a,b,c,col],[a,c,d,col])
}
// Two asymmetric banks, fractured ledges and a dry canyon floor.
const count=56,xs=Array.from({length:count+1},(_,i)=>lerp(-84,84,i/count))
const banks=[[],[]],terraces=[67,46,31,27,24,21,18,12]
const baseHeight=[-.05,-.05,.1,-4.5,-19,-34,-45,-48]
const terrainTriangles=[]
for(let side=0;side<2;side++){
 const sign=side===0?-1:1
 for(let k=0;k<terraces.length;k++){
  banks[side][k]=xs.map((x,i)=>{
   const central=1-smoothstep(Math.abs(x),7,16)
   const noise=Math.sin(x*.23+side*1.7)+Math.sin(x*.62+side)*.58
   const edgeNoise=k>0&&k<7?(1.5*Math.sin(x*.13+side)+noise*.9):0
   let z=sign*(terraces[k]+edgeNoise*(1-central))
   let y=baseHeight[k]+(k>1?noise*(k===2?1.65:.68):0)
   if(k<=2)y=lerp(y,-.05,central)
   // Rock spurs carry the bridge's original pier feet.
   if(k===3)y=lerp(y,-9.95,central)
   if(k===4)y=lerp(y,-9.95,central)
   return v(x,y,z)
  })
 }
 const colors=['c4ab85','b99b75','ae8464','bd9872','8f7561','a88a6a','c7ad87']
 for(let k=0;k<terraces.length-1;k++)for(let i=0;i<count;i++){
  const col=colors[k]
  trianglesFromQuad(terrainTriangles,banks[side][k][i],banks[side][k][i+1],banks[side][k+1][i+1],banks[side][k+1][i],col,true)
 }
 // Exposed outer cut edges and the section at each end of the canyon.
 for(const i of [0,count])for(let k=0;k<terraces.length-1;k++){
  const a=banks[side][k][i],b=banks[side][k+1][i],c=b.clone().setY(-51),d=a.clone().setY(-51)
  orientedQuad(terrainTriangles,a,b,c,d,'8b725e',v(i===0?-1:1,0,0))
 }
 for(let i=0;i<count;i++){
  const a=banks[side][0][i],b=banks[side][0][i+1]
  orientedQuad(terrainTriangles,a,b,b.clone().setY(-51),a.clone().setY(-51),'ad8c69',v(0,0,sign))
 }
}
for(let i=0;i<count;i++)trianglesFromQuad(terrainTriangles,banks[0][7][i],banks[0][7][i+1],banks[1][7][i+1],banks[1][7][i],'cbb694',true)
for(const i of [0,count]){
 const a=banks[0][7][i],b=banks[1][7][i]
 orientedQuad(terrainTriangles,a,b,b.clone().setY(-51),a.clone().setY(-51),'8b725e',v(i===0?-1:1,0,0))
}
orientedQuad(terrainTriangles,v(-84,-51,-67),v(84,-51,-67),v(84,-51,67),v(-84,-51,67),'8b725e',v(0,-1,0))
place(meshFromTriangles('Stratified canyon',terrainTriangles),terrainRoot,'Stratified canyon')
// Exact interpolated triangles give rock placements a solid footing.
function heightAt(x,z){
 const i=Math.min(count-1,Math.max(0,Math.floor((x+84)/3))),t=(x-xs[i])/3,rows=banks[z<0?0:1]
 for(let k=0;k<rows.length-1;k++){
  const a=rows[k][i].clone().lerp(rows[k][i+1],t),b=rows[k+1][i].clone().lerp(rows[k+1][i+1],t)
  if(Math.abs(z)<=Math.abs(a.z)&&Math.abs(z)>=Math.abs(b.z))return lerp(a.y,b.y,(z-a.z)/(b.z-a.z))
 }
 return Math.abs(z)<16?-48:-.05
}
const sourceDoc=await io.read(path.join(base,'static/wasteland/library/地形/岩石场景.glb'))
const templates=sourceDoc.getRoot().listNodes().filter(n=>/^basalt/.test(n.getName())).map((n,i)=>{
 const identity=new T.Matrix4().fromArray(n.getMatrix()).invert()
 const triangles=readTriangles(n,identity,false),bounds=new T.Box3()
 for(const t of triangles)for(const p of t.slice(0,3))bounds.expandByPoint(p)
 const offset=v((bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2)
 for(const t of triangles)for(let k=0;k<3;k++)t[k]=t[k].clone().sub(offset)
 return meshFromTriangles('Bruno basalt '+i,closeBasalt(triangles))
})
// Export each original basalt shape once, without scattering instances in the terrain.
const rockFolder=path.join(base,'static/wasteland/library/岩石')
fs.mkdirSync(rockFolder,{recursive:true})
const rockEntries=[]
for(const [i,mesh] of templates.entries()){
 const name='玄武岩_'+String(i+1).padStart(2,'0'),asset=new Document()
 const copied=copyToDocument(asset,doc,[mesh]).get(mesh)
 const root=asset.createNode(name).setMesh(copied).setExtras({singleAsset:true})
 const assetScene=asset.createScene(name).addChild(root)
 const bounds=getBounds(root)
 root.setTranslation([-(bounds.min[0]+bounds.max[0])/2,-bounds.min[1],-(bounds.min[2]+bounds.max[2])/2])
 assetScene.setExtras({units:'metres',singleAsset:true,bounds:getBounds(root)})
 asset.getRoot().getAsset().copyright='Original basalt geometry (c) 2025 Bruno Simon. MIT license.'
 const data=await io.writeBinary(asset)
 const validation=await require('gltf-validator').validateBytes(data)
 if(validation.issues.numErrors)throw Error(JSON.stringify(validation.issues))
 fs.writeFileSync(path.join(rockFolder,name+'.glb'),data)
 rockEntries.push({中文名:name,文件:'岩石/'+name+'.glb',用途:'原生玄武岩单件模型，可独立拖放、旋转和缩放',碰撞建议:'静态凸包或简化网格'})
}
// These templates are now standalone assets; discard their unused canyon geometry.
for(const mesh of templates){
 for(const primitive of mesh.listPrimitives()){
  for(const semantic of primitive.listSemantics())primitive.getAttribute(semantic).dispose()
  primitive.dispose()
 }
 mesh.dispose()
}
const manifestPath=path.join(base,'static/wasteland/library/素材清单.json')
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
manifest.目录.岩石=rockEntries
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n')
// Import the bridge without rebuilding its geometry.
const bridgeDoc=await io.read(path.resolve(base,'../vermilion-bridge/Vermilion.glb'))
const turn=new T.Matrix4().makeRotationY(-Math.PI/2)
for(const n of bridgeDoc.getRoot().listScenes()[0].listChildren())place(meshFromTriangles(n.getName(),readTriangles(n,turn)),bridgeRoot,n.getName())
// Paired under-deck arches spring from the canyon walls and support the deck.
const supportRoot=doc.createNode('Under-deck supporting arches')
bridgeRoot.addChild(supportRoot)
const archTriangles=[],supportTriangles=[]
const halfSpan=26
const archTop=z=>-.9-24.1*(z/halfSpan)**2
function supportBox(x,y,z,width,height,depth,tint){
 const geometry=new T.BoxGeometry(width,height,depth)
 const p=geometry.attributes.position,indices=geometry.index.array
 const points=Array.from({length:p.count},(_,i)=>v(p.getX(i)+x,p.getY(i)+y,p.getZ(i)+z))
 for(let i=0;i<indices.length;i+=3)supportTriangles.push([points[indices[i]],points[indices[i+1]],points[indices[i+2]],tint])
}
for(const x of [-3.6,3.6]){
 const edge=0.78,thickness=2.3,sections=36
 for(let i=0;i<sections;i++){
  const z0=lerp(-halfSpan,halfSpan,i/sections),z1=lerp(-halfSpan,halfSpan,(i+1)/sections)
  const y0=archTop(z0),y1=archTop(z1)
  const tint=i%3===0?'c8c2b4':'b5ac97'
  const a=v(x-edge,y0,z0),b=v(x+edge,y0,z0),c=v(x+edge,y1,z1),d=v(x-edge,y1,z1)
  const e=a.clone().add(v(0,-thickness,0)),f=b.clone().add(v(0,-thickness,0)),g=c.clone().add(v(0,-thickness,0)),h=d.clone().add(v(0,-thickness,0))
  orientedQuad(archTriangles,a,b,c,d,tint,v(0,1,0))
  orientedQuad(archTriangles,e,f,g,h,'988f7c',v(0,-1,0))
  orientedQuad(archTriangles,a,d,h,e,tint,v(-1,0,0))
  orientedQuad(archTriangles,b,c,g,f,tint,v(1,0,0))
  if(i===0)orientedQuad(archTriangles,a,b,f,e,tint,v(0,0,-1))
  if(i===sections-1)orientedQuad(archTriangles,d,c,g,h,tint,v(0,0,1))
 }
 for(const z of [-24,-18,-12,-6,6,12,18,24]){
  const bottom=archTop(z)-.17,top=-.58
  supportBox(x,(bottom+top)/2,z,.83,top-bottom,.98,'b5ac97')
  supportBox(x,-.77,z,1.4,.42,1.65,'c8c2b4')
 }
 for(const z of [-halfSpan,halfSpan])
  supportBox(x,-25.85,z,3.1,5.1,4.6,'988f7c')
}
for(const z of [-18,-12,-6,0,6,12,18]){
 supportBox(0,archTop(z)-1.02,z,7.9,.64,.78,'a49886')
 supportBox(0,-.72,z,8.3,.4,1.08,'b5ac97')
}
place(meshFromTriangles('Segmented concrete arch ribs',archTriangles),supportRoot,'Segmented concrete arch ribs')
place(meshFromTriangles('Spandrel columns and crossbeams',supportTriangles),supportRoot,'Spandrel columns and crossbeams')
const roadDoc=await io.read(path.join(base,'static/wasteland/library/道路/直行道.glb'))
for(const sign of [-1,1]){
 const rotation=new T.Matrix4().makeRotationY(sign<0?Math.PI:0)
 const matrix=new T.Matrix4().makeTranslation(0,.025,sign*32).multiply(rotation).scale(v(.74,1,1))
 for(const n of roadDoc.getRoot().listScenes()[0].listChildren()){
  if(!n.getMesh())continue
  place(meshFromTriangles(n.getName(),readTriangles(n,matrix)),roadRoot,(sign<0?'South ':'North ')+n.getName())
 }
}
doc.getRoot().getAsset().copyright='Original rock and road geometry (c) 2025 Bruno Simon. MIT license.'
scene.setExtras({units:'metres',canyonAxis:'X',bridgeAxis:'Z',deckHeight:0,roadWidth:7.4,canyonDepth:48})
const bytes=await io.writeBinary(doc),check=await require('gltf-validator').validateBytes(bytes)
if(check.issues.numErrors)throw Error(JSON.stringify(check.issues))
fs.writeFileSync(path.join(out,'嶙峋峡谷与朱红大桥.glb'),bytes)
fs.copyFileSync(path.join(base,'license.md'),path.join(out,'LICENSE-Bruno.txt'))
console.log(JSON.stringify({rocks:0,standaloneRockVariants:templates.length,triangles:check.info.totalTriangleCount,bytes:bytes.length,errors:check.issues.numErrors}))
// A neutral floor is included only in the rendered preview.
const ground=meshFromTriangles('Preview background',[[v(-900,-51.2,-900),v(-900,-51.2,900),v(900,-51.2,900),'e5dac3'],[v(-900,-51.2,-900),v(900,-51.2,900),v(900,-51.2,-900),'e5dac3']])
display(ground,new T.Matrix4())
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
const sun=camera(light,v(0,-15,0),7.7,ss,ss)
for(const f of faces){f.shadow=f.p.map(sun);raster(f.shadow,ss,ss,(i,z)=>{if(z>shadow[i])shadow[i]=z})}
const closeView=process.argv.includes('--detail')
const width=2400,height=1850,eye=closeView?v(145,82,79):v(91,128,146),view=camera(eye,closeView?v(0,-8,0):v(0,-17,0),closeView?23:10.5,width,height)
const pixels=Buffer.alloc(width*height*3,248),depth=new Float32Array(width*height).fill(-Infinity)
for(const f of faces){
 const n=f.normal.clone();if(n.dot(eye)<0)n.negate()
 const rgb=[0,2,4].map(i=>parseInt(f.col.slice(i,i+2),16)),lit=.76+.25*Math.max(0,n.dot(light))+.04*n.y
 const [a,b,c]=f.shadow
 raster(f.p.map(view),width,height,(i,z,s,t)=>{
  if(z<=depth[i])return;depth[i]=z
  const sx=Math.round(a[0]+(b[0]-a[0])*s+(c[0]-a[0])*t),sy=Math.round(a[1]+(b[1]-a[1])*s+(c[1]-a[1])*t),sz=a[2]+(b[2]-a[2])*s+(c[2]-a[2])*t
  let occluded=0
  for(const offset of [-ss-1,-ss+1,ss-1,ss+1])if(sx>1&&sx<ss-2&&sy>1&&sy<ss-2&&shadow[sy*ss+sx+offset]>sz+.16)occluded+=.25
  for(let k=0;k<3;k++)pixels[i*3+k]=Math.min(255,rgb[k]*lit*(1-occluded*[.23,.24,.18][k])+[5,3,3][k])
 })
}
await sharp(pixels,{raw:{width,height,channels:3}}).resize(1800).png().toFile(path.join(out,closeView?'桥底拱门预览.png':'峡谷预览.png'))

