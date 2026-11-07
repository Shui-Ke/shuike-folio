import {NodeIO} from '@gltf-transform/core'
const io=new NodeIO()
for(let n=1;n<=5;n++){
 const d=await io.read('static/wasteland/library/岩石/玄武岩_0'+n+'.glb'),edges=new Map(),positions=new Map()
 for(const m of d.getRoot().listMeshes())for(const p of m.listPrimitives()){
  const a=p.getAttribute('POSITION'),ix=p.getIndices()?.getArray()??Array.from({length:a.getCount()},(_,i)=>i)
  const k=i=>{const xyz=a.getElement(i,[]),key=xyz.map(x=>Math.round(x*10000)).join(',');positions.set(key,xyz);return key}
  for(let i=0;i<ix.length;i+=3)for(let j=0;j<3;j++){const v=[k(ix[i+j]),k(ix[i+(j+1)%3])],key=[...v].sort().join('|');if(edges.has(key))edges.get(key).count++;else edges.set(key,{v,count:1})}
 }
 const boundary=[...edges.values()].filter(e=>e.count===1),next=new Map(boundary.map(e=>[e.v[0],e.v[1]])),loops=[]
 while(next.size){let start=next.keys().next().value,key=start,loop=[];do{loop.push(positions.get(key));const nextKey=next.get(key);next.delete(key);key=nextKey;if(!key)throw Error('Open boundary')}while(key!==start);loops.push(loop)}
 if(loops.length||[...edges.values()].some(e=>e.count!==2))throw Error('Basalt '+n+' is not closed')
 console.log('玄武岩_0'+n+': closed, every edge belongs to two faces')
}
