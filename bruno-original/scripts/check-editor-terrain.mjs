import assert from 'node:assert/strict'
import {newTerrain,brush,sample,validateTerrain} from '../editor/terrain-data.js'
import {validateLayout,SCENE_FORMAT,SCENE_VERSION} from '../editor/scene-format.js'
import * as T from 'three'
import {terrainGeometry} from '../editor/terrain-mesh.js'
const t=newTerrain(128),options={mode:'raise',radius:8,strength:5}
brush(t,0,0,options,1)
assert.equal(sample(t,0,0),5)
assert.equal(sample(t,20,20),0)
brush(t,0,0,{...options,mode:'lower'},1)
assert.equal(sample(t,0,0),0)
brush(t,0,0,{...options,mode:'flatten',level:12},1)
assert.equal(sample(t,0,0),12)
brush(t,0,0,{...options,mode:'smooth'},.2)
assert.ok(sample(t,0,0)<=12)
brush(t,0,0,{...options,mode:'grass'},1)
assert.equal(sample(t,0,0,'grass'),1)
brush(t,0,0,{...options,mode:'river',depth:4},1)
assert.ok(Math.abs(sample(t,0,0)+4.3)<1e-10)
assert.equal(sample(t,0,0,'water'),1)
assert.equal(sample(t,0,0,'grass'),0)
brush(t,0,0,{...options,mode:'eraseWater'},1)
assert.equal(sample(t,0,0,'water'),0)
assert.ok(Math.abs(sample(t,0,0)+4.3)<1e-10)
validateTerrain(t)
const geometry=terrainGeometry(T,t),mesh=new T.Mesh(geometry,new T.MeshBasicMaterial())
mesh.updateMatrixWorld(true)
for(const [x,z] of [[.3,.2],[-1.4,.6],[3.4,-2.1],[63.9,63.9]]) {
 const hit=new T.Raycaster(new T.Vector3(x,200,z),new T.Vector3(0,-1,0)).intersectObject(mesh)[0]
 assert.ok(Math.abs(hit.point.y-sample(t,x,z))<1e-5,'height sampling differs from collision triangles')
}
const layout={format:SCENE_FORMAT,version:SCENE_VERSION,name:'测试地图',terrain:'custom',terrainData:t,objects:[]}
validateLayout(JSON.parse(JSON.stringify(layout)))
assert.throws(()=>validateLayout({...layout,terrainData:{...t,heights:[]}}))
assert.throws(()=>validateLayout({...layout,terrainData:{...t,size:Infinity}}))
assert.throws(()=>validateLayout({...layout,terrainData:{...t,waterLevel:NaN}}))
console.log('Terrain brushes, sampling against collision triangles, serialization and invalid-data checks passed')
