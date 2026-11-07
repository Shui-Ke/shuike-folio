import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(path.join(base,'package.json'))
const {NodeIO,Document}=require('@gltf-transform/core')
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions')
const {copyToDocument,getBounds}=require('@gltf-transform/functions')
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await require('draco3dgltf').createDecoderModule()})
const folder=path.join(base,'static/wasteland/library/道具')
const sources={
 '长椅':'benches/benches.glb',
 '砖块':'bricks/bricks.glb',
 '木栅栏':'fences/fences.glb',
 '爆炸木箱':'explosiveCrates/explosiveCrates.glb',
 '灯笼':'lanterns/lanterns.glb',
 '路灯':'poleLights/poleLights.glb',
 '灌木_参考':'bushes/bushesReferences.glb',
 '花丛_参考':'flowers/flowersReferences.glb'
}
const pending=[]
for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.glb'))){
 const name=path.basename(file,'.glb'),native=sources[name]
 const source=await io.read(native?path.join(base,'static',native):path.join(folder,file))
 const oldScene=source.getRoot().listScenes()[0],roots=oldScene.listChildren()
 const doc=new Document()
 for(const ext of source.getRoot().listExtensionsUsed()){
  if(ext.extensionName==='KHR_draco_mesh_compression')continue
  doc.createExtension(ext.constructor).setRequired(ext.isRequired())
 }
 const selected=native?[roots[0]]:roots
 if(native)selected[0].traverse(node=>{
  if(node!==selected[0] && /^(cuboid|hull|trimesh|ball|tube)/i.test(node.getName())){
   node.setMesh(null)
   node.setExtras({...node.getExtras(),collisionReference:true})
  }
 })
 const copies=copyToDocument(doc,source,selected)
 const scene=doc.createScene(name)
 const root=doc.createNode(name).setExtras({singleAsset:true,referenceOnly:name.endsWith('_参考')})
 scene.addChild(root)
 for(const n of selected)root.addChild(copies.get(n))
 if(native)copies.get(selected[0]).setTranslation([0,0,0]).setRotation([0,0,0,1])
 const bounds=getBounds(root)
 root.setTranslation([-(bounds.min[0]+bounds.max[0])/2,-bounds.min[1],-(bounds.min[2]+bounds.max[2])/2])
 const originalExtras=oldScene.getExtras()
 scene.setExtras({...originalExtras,units:'metres',upAxis:'Y',bounds:getBounds(scene),singleAsset:true})
 if(native)doc.getRoot().getAsset().copyright='Original model (c) 2025 Bruno Simon. MIT.'
 else doc.getRoot().getAsset().copyright=source.getRoot().getAsset().copyright
 const bytes=await io.writeBinary(doc)
 const result=await require('gltf-validator').validateBytes(bytes)
 if(result.issues.numErrors)throw Error(file+' '+JSON.stringify(result.issues))
 const reloaded=await io.readBinary(bytes),rootNodes=reloaded.getRoot().listScenes()[0].listChildren()
 if(rootNodes.length!==1)throw Error('Multiple asset roots in '+file)
 const expected=selected.reduce((sum,n)=>{n.traverse(node=>{if(node.getMesh())sum++});return sum},0)
 let actual=0
 rootNodes[0].traverse(n=>{if(n.getMesh())actual++})
 if(actual!==expected)throw Error('Missing component in '+file)
 const finalBounds=getBounds(rootNodes[0])
 if(Math.abs(finalBounds.min[1])>1e-5)throw Error('Ground mismatch in '+file)
 pending.push({file,bytes})
 console.log(JSON.stringify({file,originalInstances:native?roots.length:1,finalInstances:1,components:actual,embeddedTextures:reloaded.getRoot().listTextures().length,errors:result.issues.numErrors}))
}
for(const {file,bytes} of pending)fs.writeFileSync(path.join(folder,file),bytes)
