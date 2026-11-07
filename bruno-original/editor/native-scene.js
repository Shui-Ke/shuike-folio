import '../sources/threejs-override.js'
import * as T from 'three/webgpu'
import {Fn, texture, vec2, vec4, color, attribute, normalWorld, uv} from 'three/tsl'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js'
import {TransformControls} from 'three/addons/controls/TransformControls.js'
import CameraControls from 'camera-controls'
import {Game} from '../sources/Game/Game.js'
import {View} from '../sources/Game/View.js'
import {Grass} from '../sources/Game/World/Grass.js'
import {WaterSurface} from '../sources/Game/World/WaterSurface.js'
import {MeshDefaultMaterial} from '../sources/Game/Materials/MeshDefaultMaterial.js'
import {terrainGeometry,waterGeometry} from './terrain-mesh.js'
import {sample} from './terrain-data.js'
import {validateLayout,DEFAULT_TERRAIN} from './scene-format.js'

const host=parent.editorHost,status=document.querySelector('#native-status')
const loader=new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'))
let game,base,pickBase,editing=true,placement=null,selected=null,gizmo,layout,queue=Promise.resolve()
const items=new Map(),bodies=[],ray=new T.Raycaster(),point=new T.Vector2()
let originalWorldView=null,spawn=null
function editorMaterial(old) {
    const node=old.map?texture(old.map,uv()).rgb.mul(color(old.color)):color(old.color)
    return new MeshDefaultMaterial({colorNode:node,normalNode:normalWorld,hasWater:false,hasCoreShadows:false,hasLightBounce:false,side:old.side})
}
async function loadModel(asset,normalize=true){
    const gltf=await loader.loadAsync('/'+asset),root=new T.Group(),source=gltf.scene
    source.traverse(n=>{
        if(n.userData.collisionReference||/^(cuboid|hull|trimesh|tube|ball)[.0-9]/i.test(n.name))n.visible=false
        if(n.isMesh){n.material=Array.isArray(n.material)?n.material.map(editorMaterial):editorMaterial(n.material);n.castShadow=n.receiveShadow=true}
    })
    root.add(source)
    if(normalize){
        const bounds=new T.Box3().setFromObject(root),center=bounds.getCenter(new T.Vector3())
        source.position.sub(new T.Vector3(center.x,source.userData.placementPivot==='deck'?0:bounds.min.y,center.z))
    }
    return root
}
function collider(root){
    root.updateMatrixWorld(true)
    const positions=[],indices=[],v=new T.Vector3()
    root.traverse(n=>{
        if(!n.isMesh||n.userData.noPlacement)return
        let ancestor=n;while(ancestor){if(!ancestor.visible)return;ancestor=ancestor.parent}
        const a=n.geometry.attributes.position;if(!a)return
        const offset=positions.length/3
        for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld);positions.push(v.x,v.y,v.z)}
        const ix=n.geometry.index
        for(let i=0;i<(ix?ix.count:a.count);i++)indices.push(offset+(ix?ix.getX(i):i))
    })
    if(!indices.length)return
    const body=game.physics.world.createRigidBody(game.RAPIER.RigidBodyDesc.fixed())
    const desc=game.RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices))
    desc.setFriction(.8).setCollisionGroups(game.physics.categories.floor)
    game.physics.world.createCollider(desc,body);bodies.push(body)
}
function rebuildColliders(){
    for(const body of bodies)game.physics.world.removeRigidBody(body)
    bodies.length=0
    if(layout.terrain!=='bruno')collider(base)
    for(const object of items.values())collider(object)
}
function rayPoint(x,y){
    point.set(x*2-1,1-y*2);ray.setFromCamera(point,game.view.camera)
    const hit=ray.intersectObject(pickBase,true).find(h=>!h.object.userData.noPlacement)
    return hit?.point.toArray()??null
}
function height(x,z,includeObjects=false){
    const down=new T.Raycaster(new T.Vector3(x,10000,z),new T.Vector3(0,-1,0))
    const hit=down.intersectObjects([pickBase,...(includeObjects?[...items.values()]:[])],true).find(h=>!h.object.userData.noPlacement)
    return hit?.point.y??null
}
function select(id){
    selected=items.get(id)||null;gizmo.detach()
    if(selected&&editing)gizmo.attach(selected)
}
async function apply(data){
    validateLayout(data)
    // Serialized updates keep a late asset load from resurrecting deleted objects.
    queue=queue.catch(()=>{}).then(async()=>{
        layout=structuredClone(data)
        for(const [id,object] of items)if(!data.objects.some(o=>o.id===id)){object.removeFromParent();items.delete(id)}
        for(const item of data.objects){
            let object=items.get(item.id)
            if(object&&object.userData.asset!==item.asset){object.removeFromParent();items.delete(item.id);object=null}
            if(!object){object=await loadModel(item.asset);object.userData.editorId=item.id;object.userData.asset=item.asset;items.set(item.id,object);game.scene.add(object)}
            object.position.fromArray(item.position);object.rotation.set(...item.rotation);object.scale.fromArray(item.scale);object.updateMatrixWorld(true)
        }
        if(selected&&!items.has(selected.userData.editorId))select(null)
    })
    return queue
}
function frame(id){
    const target=id?items.get(id):pickBase
    if(!target)return
    const b=new T.Box3().setFromObject(target),c=b.getCenter(new T.Vector3()),s=b.getSize(new T.Vector3()),d=Math.max(s.x,s.y,s.z,8)*1.05
    game.view.freeMode.setLookAt(c.x+d,c.y+d*.9,c.z+d,c.x,c.y,c.z,false)
}
async function play(active){
    await queue
    editing=!active;placement=null;gizmo.detach();gizmo.enabled=editing
    game.inputs.filters.clear();game.inputs.filters.add(active?'wandering':'editor')
    game.quality.changeLevel(active?0:1)
    game.view.camera.fov=active?25:45;game.view.camera.updateProjectionMatrix()
    if(originalWorldView){
        const {floor,grass,water,geometry,size,fragmentSize,waterScale}=originalWorldView
        floor.mesh.geometry=editing?originalWorldView.editGeometry:geometry
        grass.size=editing?192:size;grass.fragmentSize=editing?192/grass.subdivisions:fragmentSize;grass.sizeUniform.value=grass.size
        grass.geometry.dispose();grass.setGeometry();grass.mesh.geometry=grass.geometry
        water.mesh.scale.setScalar(editing?192:waterScale)
    }
    if(active){
        rebuildColliders()
        if(layout.terrain!=='bruno'){
            let x=0,z=0
            const boxes=[...items.values()].map(o=>new T.Box3().setFromObject(o).expandByScalar(3))
            const extent=layout.terrain==='custom'?layout.terrainData.size/2:65
            outer:for(let r=0;r<extent;r+=4)for(const p of [[r,0],[-r,0],[0,r],[0,-r]]) {
                if(boxes.some(b=>p[0]>=b.min.x&&p[0]<=b.max.x&&p[1]>=b.min.z&&p[1]<=b.max.z))continue
                if(layout.terrain==='custom'&&sample(layout.terrainData,...p,'water')>.1)continue
                const ground=height(...p);if(ground===null)continue
                ;[x,z]=p;break outer
            }
            const y=(height(x,z)??0)+2
            spawn=new T.Vector3(x,y,z)
            game.physicalVehicle.moveTo(new T.Vector3(x,y,z))
            game.player.position.set(x,y,z)
            game.physicalVehicle.chassis.physical.initialState.position={x,y,z}
        }
        game.view.setMode(View.MODE_DEFAULT);game.view.focusPoint.isTracking=true
        game.editorPaused=false
    }else{
        game.editorPaused=true;game.view.setMode(View.MODE_FREE)
        if(selected)gizmo.attach(selected)
    }
    status.textContent=active?'WASD 驾驶 · Shift 加速 · Esc 返回编辑':'Bruno 原版底图 · 原有物件锁定 · 可添加新素材'
}
function setupCustomEnvironment(data){
    const n=data.segments+1,pixels=new Uint8Array(n*n*4),heights=new Float32Array(data.heights.length)
    for(let i=0;i<data.heights.length;i++){
        pixels[i*4+1]=Math.round(data.grass[i]*(1-data.water[i])*255)
        pixels[i*4+2]=Math.round(Math.min(1,Math.max(0,(data.waterLevel-data.heights[i])/1.5))*data.water[i]*255)
        pixels[i*4+3]=255;heights[i]=data.heights[i]
    }
    const tex=new T.DataTexture(pixels,n,n,T.RGBAFormat),htex=new T.DataTexture(heights,n,n,T.RedFormat,T.FloatType)
    for(const t of [tex,htex]){t.minFilter=t.magFilter=T.LinearFilter;t.needsUpdate=true}
    const coords=p=>p.div(data.size).add(.5).mul(data.segments/n).add(.5/n)
    game.terrain.terrainNode=Fn(([p])=>{
        const q=p.div(data.size).add(.5),inside=q.x.greaterThanEqual(0).and(q.x.lessThanEqual(1)).and(q.y.greaterThanEqual(0)).and(q.y.lessThanEqual(1))
        return texture(tex,coords(p)).mul(inside)
    })
    game.terrain.heightNode=Fn(([p])=>texture(htex,coords(p)).r)
    game.water.surfaceElevation=data.waterLevel;game.water.surfaceElevationUniform.value=data.waterLevel
    game.world.grass=new Grass()
    // Reuse Bruno's ripple, shoreline and weather code, bounded to painted water cells.
    game.world.waterSurface=new WaterSurface()
    const water=game.world.waterSurface
    water.mesh.geometry.dispose();water.mesh.geometry=waterGeometry(T,data);water.mesh.scale.setScalar(1);water.mesh.position.set(0,0,0)
    const update=water.update.bind(water)
    water.update=()=>{update();water.mesh.scale.setScalar(1);water.mesh.position.set(0,0,0);water.ice.physical.body.setEnabled(false)}
    water.mesh.userData.noPlacement=true
    game.editorWaterDepth=position=>sample(data,position.x,position.z,'water')>.05?Math.max(0,data.waterLevel-position.y):0
}
async function start(){
    if(!host)throw Error('请从场景编辑器进入。')
    layout=host.layout();validateLayout(layout)
    game=new Game({editorLayout:layout});await game.ready
    for(const camera of [game.view.camera,game.view.defaultCamera,game.view.freeCamera]){camera.far=2500;camera.updateProjectionMatrix()}
    game.view.freeCamera.fov=45;game.view.freeCamera.updateProjectionMatrix()
    const fogUpdate=game.fog.update.bind(game.fog)
    game.fog.update=()=>{fogUpdate();if(editing){game.fog.near.value=1800;game.fog.far.value=2400}}
    game.escMenu.applyTime(.1,0)
    game.reveal.distance.value=100000;game.reveal.intensity.value=0
    game.world.intro.circle.mesh.visible=false;game.world.intro.label.visible=false;game.world.grid.mesh.visible=false
    game.view.zoom.baseRatio=game.view.zoom.smoothedRatio=0
    game.inputs.filters.clear();game.inputs.filters.add('editor')
    game.view.setMode(View.MODE_FREE)
    if(layout.terrain==='bruno'){
        pickBase=new T.Group()
        const ground=new T.Mesh(game.resources.terrainModel.scene.children[0].geometry,new T.MeshBasicMaterial())
        pickBase.add(ground);pickBase.updateMatrixWorld(true)
        for(const description of (game.world.vermilionCrossing?.colliders ?? []).filter(c=>c.category==='floor')) {
            let geometry
            if(description.shape==='trimesh'){
                geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(description.parameters[0],3));geometry.setIndex(Array.from(description.parameters[1]))
            }else if(description.shape==='cuboid')geometry=new T.BoxGeometry(...description.parameters.map(v=>v*2))
            if(!geometry)continue
            const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial())
            if(description.position)mesh.position.copy(description.position)
            pickBase.add(mesh)
        }
        pickBase.updateMatrixWorld(true)
        base=pickBase
        const floor=game.world.floor,grass=game.world.grass,water=game.world.waterSurface
        const editGeometry=new T.PlaneGeometry(192,192,128,128);editGeometry.rotateX(-Math.PI/2);editGeometry.deleteAttribute('normal')
        originalWorldView={floor,grass,water,geometry:floor.mesh.geometry,editGeometry,size:grass.size,fragmentSize:grass.fragmentSize,waterScale:water.mesh.scale.x}
        const floorUpdate=floor.update.bind(floor),grassUpdate=grass.update.bind(grass),waterUpdate=water.update.bind(water)
        floor.update=()=>{floorUpdate();if(editing)floor.mesh.position.set(0,0,0)}
        grass.update=()=>{grassUpdate();if(editing)grass.center.value.set(0,0)}
        water.update=()=>{waterUpdate();if(editing){water.mesh.position.x=water.mesh.position.z=0;water.mesh.scale.setScalar(192)}}
    }else{
        if(layout.terrain==='custom'){
            base=new T.Mesh(terrainGeometry(T,layout.terrainData),new MeshDefaultMaterial({colorNode:attribute('color'),normalNode:normalWorld,hasWater:false,hasCoreShadows:false}))
            setupCustomEnvironment(layout.terrainData)
        }else if(layout.terrain==='canyon')base=await loadModel(DEFAULT_TERRAIN,false)
        else{const g=new T.PlaneGeometry(300,300);g.rotateX(-Math.PI/2);base=new T.Mesh(g,new MeshDefaultMaterial({colorNode:color('#b5ac86'),hasWater:false}))}
        game.scene.add(base);base.updateMatrixWorld(true);pickBase=base
    }
    gizmo=new TransformControls(game.view.camera,game.canvasElement);gizmo.setSize(.8);game.scene.add(gizmo.getHelper())
    gizmo.addEventListener('dragging-changed',e=>game.view.freeMode.enabled=editing&&!e.value)
    gizmo.addEventListener('objectChange',()=>selected?.scale.clampScalar(.01,100))
    gizmo.addEventListener('mouseUp',()=>{if(selected)host.transform(selected.userData.editorId,{position:selected.position.toArray(),rotation:[selected.rotation.x,selected.rotation.y,selected.rotation.z],scale:selected.scale.toArray()})})
    let down=null,shiftPan=false,savedLeft
    game.canvasElement.addEventListener('pointerdown',e=>{
        if(editing&&e.button===0&&e.shiftKey){
            shiftPan=true;savedLeft=game.view.freeMode.mouseButtons.left
            game.view.freeMode.mouseButtons.left=CameraControls.ACTION.TRUCK
            gizmo.enabled=false
        }
    },true)
    const endPan=()=>{if(!shiftPan)return;shiftPan=false;game.view.freeMode.mouseButtons.left=savedLeft;gizmo.enabled=editing}
    window.addEventListener('pointerup',endPan);window.addEventListener('pointercancel',endPan);window.addEventListener('blur',endPan)
    game.canvasElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,gizmo:!!gizmo.axis,pan:e.shiftKey}})
    game.canvasElement.addEventListener('pointerup',e=>{
        if(!editing||e.button!==0||!down||down.pan||down.gizmo||gizmo.axis||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return
        const p=rayPoint(e.clientX/innerWidth,e.clientY/innerHeight)
        if(placement&&p){const asset=placement;placement=null;host.place(asset,p);return}
        const hit=ray.intersectObjects([...items.values()],true)[0];let object=hit?.object
        while(object&&!object.userData.editorId)object=object.parent
        host.select(object?.userData.editorId??null)
    })
    window.addEventListener('dragover',e=>{if(editing&&e.dataTransfer.types.includes('application/x-bruno-asset'))e.preventDefault()})
    window.addEventListener('drop',e=>{e.preventDefault();if(!editing)return;const p=rayPoint(e.clientX/innerWidth,e.clientY/innerHeight);if(p)host.place(e.dataTransfer.getData('application/x-bruno-asset'),p)})
    window.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(!editing)host.stop();else{placement=null;host.shortcut(e.key,false,false)};return}
        if(!editing&&e.key.toLowerCase()==='r'&&spawn){e.preventDefault();e.stopImmediatePropagation();game.physicalVehicle.moveTo(spawn);return}
        if(editing&&(e.ctrlKey||['w','e','r','f','Delete','Backspace'].includes(e.key))){e.preventDefault();host.shortcut(e.key,e.ctrlKey,e.shiftKey)}
    },true)
    window.sceneEditor={apply,select,point:rayPoint,height,frame,play,placement:asset=>placement=asset,mode:mode=>gizmo.setMode(mode),snap:on=>{gizmo.setTranslationSnap(on?1:null);gizmo.setRotationSnap(on?Math.PI/12:null);gizmo.setScaleSnap(on?.1:null)},get game(){return game},get items(){return items}}
    await apply(layout);await play(host.playing());if(editing)frame(null)
    host.ready()
}
start().catch(error=>{console.error(error);status.textContent='载入失败：'+error.message;host?.error(error.message)})
