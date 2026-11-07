import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { SCENE_FORMAT, SCENE_VERSION, DEFAULT_TERRAIN, validateLayout } from './scene-format.js'
import { newTerrain, brush } from './terrain-data.js'
import { terrainGeometry, updateTerrainGeometry, waterGeometry } from './terrain-mesh.js'

const $ = id => document.getElementById(id)
const viewport = $('viewport')
const storageKey = 'bruno-scene-editor-draft-v1'
const loader = new GLTFLoader()
const draco = new DRACOLoader().setDecoderPath('/draco/')
loader.setDRACOLoader(draco)
const templates = new Map()
let catalog = []
let activeCategory = '全部'
let objects = []
let selected = null
let terrain = null
let terrainKind = 'canyon'
let placementAsset = null
let busy = false
let saving = false
let dirty = false
let revision = null
let savedName = null
let history = []
let historyIndex = -1
let draftTimer
let toastTimer
let terrainData = null
let brushStroke = null
let brushPoint = null
let shiftPanning = false
let nativeFrame = null
let playing = false
const nativeAPI = () => nativeFrame?.contentWindow?.sceneEditor

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setClearColor(0xbcbcaf)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12
viewport.prepend(renderer.domElement)
renderer.domElement.tabIndex = 0
const scene = new THREE.Scene()
function addEnvironment(target, targetRenderer) {
    const room = new RoomEnvironment()
    const generator = new THREE.PMREMGenerator(targetRenderer)
    target.environment = generator.fromScene(room, .04).texture
    target.environmentIntensity = .85
    room.dispose()
    generator.dispose()
}
addEnvironment(scene, renderer)
const camera = new THREE.PerspectiveCamera(45, 1, .1, 2500)
camera.position.set(135, 150, 190)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, -12, 0)
controls.enableDamping = true
controls.minDistance = 1
controls.maxDistance = 900
scene.add(new THREE.HemisphereLight(0xfff3dd, 0x78858d, 2.1))
const sun = new THREE.DirectionalLight(0xffe2be, 3)
sun.position.set(-70, 130, 80)
scene.add(sun)
const grid = new THREE.GridHelper(300, 60, 0x7e8b7b, 0x989e8c)
grid.position.y = -.02
scene.add(grid)
const transform = new TransformControls(camera, renderer.domElement)
transform.setSize(.8)
scene.add(transform.getHelper())
transform.addEventListener('dragging-changed', e => { controls.enabled = !e.value })
transform.addEventListener('objectChange', () => {
    if (selected) selected.scale.clampScalar(.01, 100)
    updateSelectionBox()
    updateFields()
})
transform.addEventListener('mouseUp', () => commit())
const selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xc1e49b)
selectionBox.visible = false
scene.add(selectionBox)
const cursor = new THREE.Mesh(new THREE.RingGeometry(.45, .62, 32), new THREE.MeshBasicMaterial({ color: 0xe8ffd4, side: THREE.DoubleSide, depthTest: false }))
cursor.rotation.x = -Math.PI / 2
cursor.visible = false
cursor.renderOrder = 10
scene.add(cursor)
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect()
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
}).observe(viewport)
let lastFrame = performance.now()
renderer.setAnimationLoop(() => {
    const now=performance.now(),dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now
    if(brushStroke && brushPoint && !busy) {
        brush(terrainData,brushPoint.x,brushPoint.z,brushSettings(),dt)
        refreshSculptedTerrain()
    }
    controls.update()
    if(!nativeFrame)renderer.render(scene, camera)
})

function notify(message, persistent = false) {
    clearTimeout(toastTimer)
    $('toast').textContent = message
    $('toast').hidden = false
    if (!persistent) toastTimer = setTimeout(() => { $('toast').hidden = true }, 4500)
}
function setBusy(value, message = '正在载入…') {
    busy = value
    $('loading').hidden = !value
    $('loading').textContent = message
    for (const id of ['save-scene', 'open-scene', 'import-scene', 'export-scene', 'terrain'])
        $(id).disabled = value || (id === 'save-scene' && saving)
}
async function template(asset) {
    if (!templates.has(asset)) {
        const pending = loader.loadAsync('/' + asset).then(gltf => {
            gltf.scene.traverse(node => {
                if (node.userData.collisionReference || /^(cuboid|trimesh|hull|tube|ball)[.0-9]/i.test(node.name)) node.visible = false
                if (node.isMesh) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material]
                    for (const mat of mats) {
                        if (mat.map && mat.name === 'palette') {
                            mat.map.minFilter = mat.map.magFilter = THREE.NearestFilter
                            mat.map.needsUpdate = true
                        }
                    }
                }
            })
            return gltf.scene
        }).catch(error => { templates.delete(asset); throw error })
        templates.set(asset, pending)
    }
    return templates.get(asset)
}
function modelRoot(source) {
    const wrapper = new THREE.Group()
    const child = clone(source)
    wrapper.add(child)
    wrapper.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(child)
    const centre = bounds.getCenter(new THREE.Vector3())
    wrapper.userData.placementPivot = source.userData.placementPivot
    child.position.sub(new THREE.Vector3(centre.x, source.userData.placementPivot==='deck'?0:bounds.min.y, centre.z))
    wrapper.updateMatrixWorld(true)
    return wrapper
}
async function makeTerrain(kind, data = null) {
    if (kind === 'canyon') return clone(await template(DEFAULT_TERRAIN))
    if (kind === 'bruno') return new THREE.Group()
    if (kind === 'custom') {
        const group=new THREE.Group()
        const ground=new THREE.Mesh(terrainGeometry(THREE,data),new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}))
        ground.name='Sculpted ground'
        const water=new THREE.Mesh(waterGeometry(THREE,data),new THREE.MeshStandardMaterial({color:0x4ea9a5,transparent:true,opacity:.7,roughness:.3,depthWrite:false}))
        water.name='Painted water';water.userData.noPlacement=true
        group.add(ground,water);return group
    }
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0xb5ac86, roughness: 1 }))
    plane.rotation.x = -Math.PI / 2
    return plane
}
function layout() {
    return {
        format: SCENE_FORMAT, version: SCENE_VERSION, name: $('scene-name').value.trim() || '未命名场景',
        units: 'metres', terrain: terrainKind,
        terrainAsset: terrainKind === 'canyon' ? DEFAULT_TERRAIN : null,
        ...(terrainKind === 'custom' ? {terrainData} : {}),
        objects: objects.map(o => ({
            id: o.userData.id, name: o.userData.name, asset: o.userData.asset,
            position: o.position.toArray(), rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
            scale: o.scale.toArray(), collision: o.userData.collision ?? null
        }))
    }
}
function persistDraft() {
    clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify({ layout: layout(), revision, savedName, dirty }))
            $('save-state').textContent = dirty ? '草稿已自动保存 · 待保存到项目' : '已保存到本地项目'
        } catch { notify('浏览器草稿空间不足，请点击“保存场景”保存到项目。', true) }
    }, 250)
}
function commit() {
    const next = JSON.stringify(layout())
    if (history[historyIndex] === next) return
    history = history.slice(0, historyIndex + 1)
    history.push(next)
    if (history.length > 80) history.shift()
    historyIndex = history.length - 1
    dirty = true
    updateHistory()
    updateList()
    persistDraft()
    syncNative()
}
function updateHistory() {
    $('undo').disabled = busy || historyIndex <= 0
    $('redo').disabled = busy || historyIndex >= history.length - 1
}
async function applyLayout(data) {
    validateLayout(data)
    const nextTerrain = await makeTerrain(data.terrain, data.terrainData)
    const nextObjects = await Promise.all(data.objects.map(async item => {
        const object = modelRoot(await template(item.asset))
        object.userData = { ...object.userData, id: item.id, name: item.name, asset: item.asset, collision: item.collision ?? null }
        object.position.fromArray(item.position)
        object.rotation.set(...item.rotation)
        object.scale.fromArray(item.scale)
        return object
    }))
    select(null)
    if (terrain) scene.remove(terrain)
    objects.forEach(o => scene.remove(o))
    terrain = nextTerrain
    terrainKind = data.terrain
    terrainData = data.terrainData ? structuredClone(data.terrainData) : null
    objects = nextObjects
    scene.add(terrain, ...objects)
    grid.visible = terrainKind === 'flat'
    $('terrain').value = terrainKind
    $('scene-name').value = data.name
    updateList()
    updateTerrainTools()
    await updateNativeView()
}
async function travelHistory(delta) {
    if (busy || !history[historyIndex + delta]) return
    setBusy(true, '正在恢复布局…')
    try {
        await applyLayout(JSON.parse(history[historyIndex + delta]))
        historyIndex += delta
        dirty = true
        persistDraft()
    } catch (error) { notify('恢复失败，当前场景已保留。' + error.message) }
    finally { setBusy(false); updateHistory() }
}
function select(object) {
    selected = object
    transform.detach()
    if (object) transform.attach(object)
    $('properties').hidden = !object
    $('empty-selection').hidden = !!object
    selectionBox.visible = !!object
    if (object) {
        $('object-name').value = object.userData.name
        $('asset-name').textContent = object.userData.asset.split('/').at(-1)
        updateFields()
        updateSelectionBox()
    }
    updateList()
    nativeAPI()?.select(object?.userData.id ?? null)
}
function updateSelectionBox() {
    if (selected) {
        selected.updateMatrixWorld(true)
        selectionBox.box.setFromObject(selected)
    }
}
function updateFields() {
    if (!selected) return
    for (const input of document.querySelectorAll('[data-vector]')) {
        const value = selected[input.dataset.vector][input.dataset.axis]
        input.value = Number((input.dataset.vector === 'rotation' ? THREE.MathUtils.radToDeg(value) : value).toFixed(3))
    }
}
function updateList() {
    $('object-count').textContent = objects.length + ' 个物件'
    $('list-count').textContent = objects.length
    $('object-list').replaceChildren()
    for (const object of objects) {
        const row = document.createElement('button')
        row.className = 'object-row' + (object === selected ? ' active' : '')
        row.textContent = object.userData.name
        row.addEventListener('click', () => select(object))
        row.addEventListener('dblclick', () => frameObject(object))
        $('object-list').append(row)
    }
}
function pointOnTerrain(clientX, clientY) {
    if(terrainKind==='bruno' && nativeAPI()) {
        const rect=viewport.getBoundingClientRect(),p=nativeAPI().point((clientX-rect.left)/rect.width,(clientY-rect.top)/rect.height)
        return p?new THREE.Vector3(...p):null
    }
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    return terrain ? raycaster.intersectObject(terrain, true).find(h=>!h.object.userData.noPlacement)?.point.clone() : null
}
async function addAsset(asset, point) {
    if (busy) return
    setBusy(true, '正在放置模型…')
    try {
        const object = modelRoot(await template(asset))
        const name = catalog.find(a => a.asset === asset)?.name || asset.split('/').at(-1).replace('.glb', '')
        object.userData = { ...object.userData, id: crypto.randomUUID(), name, asset, collision: null }
        object.position.copy(point)
        if ($('snap').checked) {
            object.position.x = Math.round(object.position.x)
            object.position.z = Math.round(object.position.z)
        }
        scene.add(object)
        objects.push(object)
        object.updateMatrixWorld(true)
        groundObject(object)
        select(object)
        commit()
    } catch (error) { notify('模型载入失败。' + error.message) }
    finally { setBusy(false); updateHistory() }
}
function groundObject(object) {
    if(terrainKind==='bruno' && nativeAPI()) {
        const y=nativeAPI().height(object.position.x,object.position.z)
        if(y===null)return false
        const bounds=new THREE.Box3().setFromObject(object)
        object.position.y+=y-(object.userData.placementPivot==='deck'?object.position.y:bounds.min.y)
        updateFields();updateSelectionBox();return true
    }
    object.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(object)
    const origin = new THREE.Vector3(object.position.x, 10000, object.position.z)
    const groundRay = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0))
    const hit = groundRay.intersectObject(terrain, true).find(h=>!h.object.userData.noPlacement)
    if (!hit) return false
    object.position.y += hit.point.y - (object.userData.placementPivot==='deck'?object.position.y:bounds.min.y)
    object.updateMatrixWorld(true)
    updateSelectionBox()
    updateFields()
    return true
}
function frameObject(object) {
    if(terrainKind==='bruno' && nativeAPI()) { nativeAPI().frame(object===terrain?null:object.userData.id);return }
    const bounds = new THREE.Box3().setFromObject(object)
    const centre = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const distance = Math.max(size.x, size.y, size.z, 1) * 1.8
    const direction = camera.position.clone().sub(controls.target).normalize()
    controls.target.copy(centre)
    camera.position.copy(centre).addScaledVector(direction, distance)
    controls.update()
}
function cancelPlacement() {
    placementAsset = null
    cursor.visible = false
    cursor.scale.setScalar(1)
    $('placement').hidden = true
    for (const button of document.querySelectorAll('.asset')) button.setAttribute('aria-pressed', 'false')
    nativeAPI()?.placement(null)
}
function beginPlacement(asset, name) {
    if(playing)return
    $('brush-mode').value='select';updateBrushControls()
    cancelPlacement()
    placementAsset = asset
    $('placement').querySelector('span').textContent = '点击地面放置 · ' + name
    $('placement').hidden = false
    for (const button of document.querySelectorAll('.asset')) button.setAttribute('aria-pressed', String(button.dataset.asset === asset))
    nativeAPI()?.placement(asset)
}
let pointerDown = null
renderer.domElement.addEventListener('pointerdown', e => { pointerDown = { x: e.clientX, y: e.clientY, wasTransform: !!transform.axis, wasPan:e.shiftKey } })
renderer.domElement.addEventListener('pointerup', async e => {
    if(sculpting())return
    if (busy || e.button !== 0 || !pointerDown || pointerDown.wasPan || pointerDown.wasTransform || transform.axis || Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y) > 4) return
    const hit = pointOnTerrain(e.clientX, e.clientY)
    if (placementAsset) {
        if (!hit) return notify('请在地形表面放置模型。')
        const asset = placementAsset
        cancelPlacement()
        await addAsset(asset, hit)
        return
    }
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(objects, true)
    let object = hits[0]?.object
    while (object && !objects.includes(object)) object = object.parent
    select(object || null)
})
renderer.domElement.addEventListener('pointermove', e => {
    if (!placementAsset || busy) return
    const hit = pointOnTerrain(e.clientX,e.clientY)
    cursor.visible = !!hit
    if (hit) cursor.position.copy(hit).add(new THREE.Vector3(0,.08,0))
})
viewport.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('application/x-bruno-asset')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const hit = pointOnTerrain(e.clientX,e.clientY)
    cursor.visible = !!hit
    if (hit) cursor.position.copy(hit).add(new THREE.Vector3(0,.08,0))
})
viewport.addEventListener('dragleave', () => { cursor.visible = false })
viewport.addEventListener('drop', async e => {
    e.preventDefault()
    cursor.visible = false
    const asset = e.dataTransfer.getData('application/x-bruno-asset')
    if (!catalog.some(a => a.asset === asset)) return
    const hit = pointOnTerrain(e.clientX,e.clientY)
    cancelPlacement()
    if (hit) await addAsset(asset,hit)
    else notify('请把模型拖到地形表面。')
})
$('cancel-placement').onclick = cancelPlacement
$('undo').onclick = () => travelHistory(-1)
$('redo').onclick = () => travelHistory(1)
$('frame-all').onclick = () => frameObject(terrain)
$('frame-selected').onclick = () => selected && frameObject(selected)
$('ground').onclick = () => { if (selected && !busy) { if (groundObject(selected)) commit(); else notify('物件下方没有地形。') } }
$('delete').onclick = () => {
    if (!selected || busy) return
    const object = selected
    select(null)
    scene.remove(object)
    objects = objects.filter(o => o !== object)
    commit()
}
$('duplicate').onclick = () => {
    if (!selected || busy) return
    const object = selected.clone(true)
    object.userData = { ...selected.userData, id: crypto.randomUUID(), name: selected.userData.name + ' 副本' }
    object.position.x += 2
    scene.add(object)
    objects.push(object)
    groundObject(object)
    select(object)
    commit()
}
function setMode(mode) {
    $('brush-mode').value='select';updateBrushControls()
    transform.setMode(mode)
    nativeAPI()?.mode(mode)
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active',b.dataset.mode===mode))
}
document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode) })
$('snap').onchange = () => {
    nativeAPI()?.snap($('snap').checked)
    transform.setTranslationSnap($('snap').checked ? 1 : null)
    transform.setRotationSnap($('snap').checked ? Math.PI / 12 : null)
    transform.setScaleSnap($('snap').checked ? .1 : null)
}
for (const [key,label,unit] of [['position','位置','米'],['rotation','旋转','度'],['scale','缩放','倍']]) {
    const container = document.createElement('div')
    container.innerHTML = '<div class="transform-label">' + label + '<span>' + unit + '</span></div>'
    const vector = document.createElement('div')
    vector.className = 'vector'
    for (const axis of ['x','y','z']) {
        const field = document.createElement('label')
        const text = document.createElement('b')
        text.textContent = axis.toUpperCase()
        const input = document.createElement('input')
        input.type = 'number'
        input.step = key === 'rotation' ? 5 : .1
        input.dataset.vector = key
        input.dataset.axis = axis
        input.setAttribute('aria-label', label + ' ' + axis)
        input.onchange = () => {
            if (!selected || busy) return
            let value = Number(input.value)
            if (!Number.isFinite(value)) return updateFields()
            value = key === 'scale' ? THREE.MathUtils.clamp(value,.01,100) : THREE.MathUtils.clamp(value,-100000,100000)
            selected[key][axis] = key === 'rotation' ? THREE.MathUtils.degToRad(value) : value
            updateFields()
            updateSelectionBox()
            commit()
        }
        field.append(text,input)
        vector.append(field)
    }
    container.append(vector)
    $('transform-fields').append(container)
}
$('object-name').onchange = () => {
    if (selected && !busy) { selected.userData.name = $('object-name').value.trim() || '未命名物件'; commit() }
}
$('scene-name').onchange = () => { if ($('scene-name').value.trim() !== savedName) revision = null; commit() }
$('terrain').onchange = async () => {
    if (busy) return
    const next = $('terrain').value
    setBusy(true,'正在更换地形…')
    try {
        const data = next==='custom' ? (terrainData ?? newTerrain()) : null
        const model = await makeTerrain(next,data)
        scene.remove(terrain)
        terrain = model
        terrainKind = next
        if(data)terrainData = data
        scene.add(terrain)
        grid.visible = next === 'flat'
        updateTerrainTools()
        await updateNativeView()
        commit()
        frameObject(terrain)
        notify('地形已更换。可选中物件后点击“贴合地形”。')
    } catch (error) { $('terrain').value = terrainKind; notify('地形载入失败。' + error.message) }
    finally { setBusy(false); updateHistory() }
}
window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!busy && !$('open-dialog').open) { document.activeElement.blur(); save() }
        return
    }
    if (e.target.matches?.('input,select,textarea') || $('open-dialog').open || $('new-map-dialog').open || busy || playing) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); travelHistory(e.shiftKey ? 1 : -1) }
    else if (e.key === 'Escape') { cancelPlacement(); select(null) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('delete').click() }
    else if (e.key.toLowerCase() === 'f') { $('frame-selected').click() }
    else if (['w','e','r'].includes(e.key.toLowerCase())) setMode({w:'translate',e:'rotate',r:'scale'}[e.key.toLowerCase()])
})
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = '' } })

async function api(url, options) {
    const response = await fetch(url,options)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '本地文件操作失败。')
    return body
}
async function save() {
    if (busy || saving) return
    const data = layout()
    try { validateLayout(data) } catch(e) { return notify(e.message) }
    saving = true
    $('save-scene').disabled = true
    try {
        const result = await api('/__scene-editor/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout:data,revision:data.name===savedName?revision:null})})
        revision = result.revision
        savedName = data.name
        dirty = JSON.stringify(layout()) !== JSON.stringify(data)
        persistDraft()
        notify('已保存到项目的 editor-scenes / ' + result.file)
    } catch (error) { notify(error.message,true) }
    finally { saving = false; $('save-scene').disabled = busy }
}
$('save-scene').onclick = save
$('export-scene').onclick = () => {
    const data = layout()
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
    const link = document.createElement('a')
    link.href = url
    link.download = data.name + '.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url),1000)
}
async function openLayout(data, rev = null, fileName = null) {
    if (dirty && !confirm('当前布局尚未保存到项目，确定打开另一个场景吗？')) return
    setBusy(true,'正在打开场景…')
    try {
        await applyLayout(data)
        revision = rev
        savedName = fileName
        dirty = !rev
        history = [JSON.stringify(layout())]
        historyIndex = 0
        persistDraft()
        frameObject(terrain)
        $('open-dialog').close()
    } catch(error) { notify('打开失败。' + error.message,true) }
    finally { setBusy(false); updateHistory() }
}
$('open-scene').onclick = async () => {
    $('saved-list').textContent = '正在读取…'
    $('open-dialog').showModal()
    try {
        const {files} = await api('/__scene-editor/scenes')
        $('saved-list').replaceChildren()
        if (!files.length) $('saved-list').textContent = '还没有保存的场景。'
        for (const file of files) {
            const b = document.createElement('button')
            b.textContent = file.replace('.json','')
            b.onclick = async () => {
                try {
                    const item = await api('/__scene-editor/scenes?file=' + encodeURIComponent(file))
                    await openLayout(item.layout,item.revision,item.layout.name)
                } catch(error) { notify(error.message) }
            }
            $('saved-list').append(b)
        }
    } catch(error) { $('saved-list').textContent = error.message }
}
$('close-dialog').onclick = () => $('open-dialog').close()
$('import-scene').onclick = () => $('layout-file').click()
$('layout-file').onchange = async () => {
    const file = $('layout-file').files[0]
    if (!file) return
    try { await openLayout(JSON.parse(await file.text())) } catch { notify('无法读取该布局文件。') }
    $('layout-file').value = ''
}

// Real model thumbnails share one small renderer and load only as cards enter view.
const thumbRenderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true })
thumbRenderer.setSize(192,144)
thumbRenderer.setPixelRatio(1)
thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping
thumbRenderer.toneMappingExposure = 1.2
const thumbScene = new THREE.Scene()
addEnvironment(thumbScene, thumbRenderer)
thumbScene.add(new THREE.HemisphereLight(0xfff4dc,0x8193a2,2.3))
const thumbLight = new THREE.DirectionalLight(0xffffff,2.8)
thumbLight.position.set(-3,7,5)
thumbScene.add(thumbLight)
const thumbCamera = new THREE.PerspectiveCamera(38,192/144,.01,10000)
const thumbnails = new Map()
let thumbQueue = Promise.resolve()
const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target)
        const img = entry.target
        thumbQueue = thumbQueue.then(async () => {
            if (thumbnails.has(img.dataset.asset)) { img.src = thumbnails.get(img.dataset.asset); return }
            try {
                const model = modelRoot(await template(img.dataset.asset))
                const bounds = new THREE.Box3().setFromObject(model)
                const center = bounds.getCenter(new THREE.Vector3())
                const size = bounds.getSize(new THREE.Vector3())
                const extent = Math.max(size.x,size.y,size.z,.2)
                thumbCamera.position.copy(center).addScaledVector(new THREE.Vector3(1,.8,1.3).normalize(),extent*2.3)
                thumbCamera.near = extent/100
                thumbCamera.far = extent*20
                thumbCamera.lookAt(center)
                thumbCamera.updateProjectionMatrix()
                thumbScene.add(model)
                thumbRenderer.render(thumbScene,thumbCamera)
                thumbScene.remove(model)
                const image = thumbRenderer.domElement.toDataURL('image/png')
                thumbnails.set(img.dataset.asset,image)
                img.src = image
            } catch { img.alt = '预览暂不可用' }
        })
    }
},{root:$('assets'),rootMargin:'50px'})
function renderCatalog() {
    observer.disconnect()
    $('assets').replaceChildren()
    const query = $('search').value.trim()
    const items = catalog.filter(a => (activeCategory==='全部'||a.category===activeCategory) && a.name.includes(query))
    $('asset-count').textContent = items.length + ' 件'
    for (const asset of items) {
        const button = document.createElement('button')
        button.className = 'asset'
        button.draggable = true
        button.dataset.asset = asset.asset
        button.setAttribute('aria-label','放置' + asset.name)
        button.setAttribute('aria-pressed',String(placementAsset===asset.asset))
        button.title = asset.description
        const img = document.createElement('img')
        img.alt = asset.name
        img.dataset.asset = asset.asset
        img.draggable = false
        const label = document.createElement('span')
        label.textContent = asset.name
        button.append(img,label)
        button.onclick = () => beginPlacement(asset.asset,asset.name)
        button.ondragstart = e => { e.dataTransfer.setData('application/x-bruno-asset',asset.asset); e.dataTransfer.effectAllowed='copy' }
        $('assets').append(button)
        observer.observe(img)
    }
    if (!items.length) {
        const empty = document.createElement('div')
        empty.className = 'no-results'
        empty.textContent = '没有匹配的素材'
        $('assets').append(empty)
    }
}
$('search').oninput = renderCatalog
async function init() {
    setBusy(true,'正在载入峡谷与素材库…')
    try {
        const response = await fetch('/wasteland/library/素材清单.json')
        if (!response.ok) throw new Error('素材清单读取失败。')
        const manifest = await response.json()
        for (const [category,items] of Object.entries(manifest.目录)) {
            for (const item of items) {
                if (category==='地形' && !['细山峰','山体','大山峰'].includes(item.中文名)) continue
                if (/参考|碰撞/.test(item.中文名)) continue
                catalog.push({name:item.中文名.replace('_视觉',''),asset:'wasteland/library/'+item.文件,category,description:item.用途})
            }
        }
        for (const category of ['全部',...new Set(catalog.map(a=>a.category))]) {
            const button = document.createElement('button')
            button.textContent = category
            button.classList.toggle('active',category===activeCategory)
            button.onclick = () => {
                activeCategory = category
                for (const b of $('categories').children) b.classList.toggle('active',b===button)
                renderCatalog()
            }
            $('categories').append(button)
        }
        renderCatalog()
        let draft = null
        try { draft=JSON.parse(localStorage.getItem(storageKey)); if(draft) validateLayout(draft.layout) } catch { draft=null }
        const initial=draft?.layout ?? {format:SCENE_FORMAT,version:SCENE_VERSION,name:'峡谷营地',terrain:'canyon',objects:[]}
        await applyLayout(initial)
        revision=draft?.revision??null
        savedName=draft?.savedName??null
        dirty=draft?.dirty??false
        history=[JSON.stringify(layout())]
        historyIndex=0
        frameObject(terrain)
        $('save-state').textContent=draft?'已恢复上次布局':'从左侧拖入模型开始布置'
        if(draft) notify('已恢复上次的场景布局。')
    } catch(error) { notify('载入失败。'+error.message,true) }
    finally { setBusy(false); updateHistory() }
}
function sculpting(){return terrainKind==='custom'&&$('brush-mode').value!=='select'&&!playing}
function brushSettings(){return {mode:$('brush-mode').value,radius:Math.max(2,Math.min(64,Number($('brush-radius').value)||12)),strength:Math.max(.1,Math.min(30,Number($('brush-strength').value)||5)),level:Math.max(-100,Math.min(100,Number($('brush-level').value)||0)),depth:Math.max(.5,Math.min(30,Number($('river-depth').value)||3))}}
function updateTerrainTools(){
    $('terrain-tools').hidden=terrainKind!=='custom'
    $('brush-mode').value='select'
    if(terrainData)$('water-level').value=terrainData.waterLevel
    updateBrushControls()
}
function updateBrushControls(){
    controls.enableRotate=!sculpting()
    transform.enabled=!sculpting();transform.getHelper().visible=!sculpting()&&!!selected
    if(sculpting()){cancelPlacement();select(null)}
    cursor.visible=false
}
$('brush-mode').onchange=updateBrushControls
$('water-level').onchange=()=>{
    if(!terrainData)return
    terrainData.waterLevel=Math.max(-80,Math.min(80,Number($('water-level').value)||0))
    refreshSculptedTerrain();commit()
}
function refreshSculptedTerrain(){
    updateTerrainGeometry(THREE,terrain.children[0].geometry,terrainData)
    const water=terrain.children[1];water.geometry.dispose();water.geometry=waterGeometry(THREE,terrainData)
}
renderer.domElement.addEventListener('pointerdown',e=>{
    if(e.shiftKey&&e.button===0&&!busy){shiftPanning=true;transform.enabled=false;controls.enabled=true;return}
    if(!sculpting()||e.button!==0||busy)return
    brushPoint=pointOnTerrain(e.clientX,e.clientY)
    if(!brushPoint)return
    brushStroke=true;controls.enabled=false
    renderer.domElement.setPointerCapture(e.pointerId)
    brush(terrainData,brushPoint.x,brushPoint.z,brushSettings(),.05);refreshSculptedTerrain()
},true)
renderer.domElement.addEventListener('pointermove',e=>{
    if(shiftPanning){cursor.visible=false;return}
    if(!sculpting()||busy)return
    brushPoint=pointOnTerrain(e.clientX,e.clientY)
    cursor.visible=!!brushPoint
    if(brushPoint){cursor.scale.setScalar(brushSettings().radius/.62);cursor.position.copy(brushPoint).add(new THREE.Vector3(0,.15,0))}
})
function endStroke(){if(!brushStroke)return;brushStroke=null;controls.enabled=true;commit()}
renderer.domElement.addEventListener('pointerup',endStroke)
renderer.domElement.addEventListener('pointercancel',endStroke)
window.addEventListener('blur',endStroke)
function endShiftPan(){if(!shiftPanning)return;shiftPanning=false;transform.enabled=!sculpting()}
window.addEventListener('pointerup',endShiftPan)
window.addEventListener('pointercancel',endShiftPan)
window.addEventListener('blur',endShiftPan)
$('new-map').onclick=()=>{if(!busy&&!playing)$('new-map-dialog').showModal()}
$('close-new-map').onclick=()=>$('new-map-dialog').close()
$('create-map').onclick=async()=>{
    const name=$('new-map-name').value.trim()||'我的地图'
    await openLayout({format:SCENE_FORMAT,version:SCENE_VERSION,name,terrain:'custom',terrainData:newTerrain(Number($('new-map-size').value)),objects:[]})
    $('new-map-dialog').close()
}
let nativeReadyResolve,nativeReadyReject
window.editorHost={
    layout:()=>structuredClone(layout()),
    playing:()=>playing,
    ready:()=>nativeReadyResolve?.(),
    error:message=>{nativeReadyReject?.(new Error(message));notify('原版场景载入失败：'+message,true)},
    place:async(asset,point)=>{if(catalog.some(a=>a.asset===asset)&&!playing){cancelPlacement();await addAsset(asset,new THREE.Vector3(...point))}},
    select:id=>select(objects.find(o=>o.userData.id===id)||null),
    transform:(id,value)=>{
        const object=objects.find(o=>o.userData.id===id);if(!object)return
        object.position.fromArray(value.position);object.rotation.set(...value.rotation);object.scale.fromArray(value.scale)
        updateFields();updateSelectionBox();commit()
    },
    shortcut:(key,ctrl,shift)=>window.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:ctrl,shiftKey:shift})),
    stop:()=>togglePlay(false)
}
async function updateNativeView(force=false){
    const needed=terrainKind==='bruno'||playing
    if(!needed){nativeFrame?.remove();nativeFrame=null;renderer.domElement.hidden=false;return}
    if(nativeFrame&&!force&&nativeFrame.dataset.kind===terrainKind){await nativeAPI()?.apply(layout());return}
    nativeFrame?.remove()
    nativeFrame=document.createElement('iframe');nativeFrame.id='native-frame';nativeFrame.title='Bruno 场景编辑与试玩';nativeFrame.dataset.kind=terrainKind
    const ready=new Promise((resolve,reject)=>{nativeReadyResolve=resolve;nativeReadyReject=reject})
    nativeFrame.src='./bruno.html';viewport.prepend(nativeFrame);renderer.domElement.hidden=true
    let timer
    try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('原版地图载入超时，请重试。')),120000)})])}
    catch(error){nativeFrame.remove();nativeFrame=null;renderer.domElement.hidden=false;throw error}
    finally{clearTimeout(timer);nativeReadyResolve=nativeReadyReject=null}
}
function syncNative(){
    const api=nativeAPI()
    if(api&&!playing)api.apply(layout()).then(()=>api.select(selected?.userData.id??null)).catch(e=>notify(e.message,true))
}
async function togglePlay(value=!playing){
    if(busy)return
    endStroke();cancelPlacement();playing=value
    document.body.classList.toggle('is-playing',playing)
    $('play-scene').textContent=playing?'返回编辑':'驾车试玩'
    $('terrain').disabled=playing
    setBusy(true,playing?'正在准备地图与驾驶碰撞…':'正在返回编辑…')
    try {
        await updateNativeView()
        await nativeAPI()?.play(playing)
        nativeFrame?.focus()
        notify(playing?'WASD 驾驶 · Shift 加速 · Esc 返回编辑。试玩位置不会改写布局。':'已返回编辑。')
    } catch(e){playing=false;document.body.classList.remove('is-playing');$('play-scene').textContent='驾车试玩';notify(e.message,true)}
    finally{
        setBusy(false)
        for(const id of ['terrain','new-map','open-scene','import-scene','scene-name'])$(id).disabled=playing
        updateHistory()
    }
}
$('play-scene').onclick=()=>togglePlay()
init()
