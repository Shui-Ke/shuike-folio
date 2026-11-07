import * as THREE from 'three/webgpu'
import { Fn, color, mix, uniform, vec4, viewportUV } from 'three/tsl'
import { Look } from './src/Look.js'
import { createNoiseField } from './src/Noise.js'
import { Wind } from './src/Wind.js'
import { Terrain } from './src/Terrain.js'
import { buildProps } from './src/Models.js'
import { Grass } from './src/Grass.js'
import { Foliage } from './src/Foliage.js'
import { RainLines } from './src/RainLines.js'
import { Leaves } from './src/Leaves.js'

/* ------------------------------------------------------------------ */
/*  Renderer                                                           */
/* ------------------------------------------------------------------ */

const canvas = document.querySelector('.scene')
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.toneMapping = THREE.NoToneMapping

await renderer.init()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 260)

/* ------------------------------------------------------------------ */
/*  Sky / light                                                        */
/* ------------------------------------------------------------------ */

const look = new Look()
look.addTo(scene)

const skyTop = uniform(new THREE.Color('#ff9f6a'))
const skyBottom = uniform(new THREE.Color('#ffe0b0'))

scene.backgroundNode = Fn(() =>
{
    const ratio = viewportUV.y.smoothstep(0.02, 1)
    return vec4(mix(skyBottom, skyTop, ratio), 1)
})()

/* ------------------------------------------------------------------ */
/*  Shared noise / wind                                                */
/* ------------------------------------------------------------------ */

const noise = createNoiseField(256)
const wind = new Wind(noise)

/* ------------------------------------------------------------------ */
/*  World                                                              */
/* ------------------------------------------------------------------ */

const terrain = new Terrain(noise, look)
scene.add(terrain.mesh)

// 远处一圈低模山影：让地平线不是一条硬边，同时把视线留在场景里
const hillMaterial = look.createMaterial({
    colorNode: color('#b96b60'),
    hasCoreShadows: false,
    hasDropShadows: false,
    hasLightBounce: false,
})
const hillGeometry = new THREE.IcosahedronGeometry(1, 0)
for(let i = 0; i < 11; i++)
{
    const angle = (i / 11) * Math.PI * 2 + Math.random() * 0.2
    const distance = 42 + Math.random() * 12
    const hill = new THREE.Mesh(hillGeometry, hillMaterial)
    hill.position.set(Math.sin(angle) * distance, -3, Math.cos(angle) * distance)
    hill.scale.set(8 + Math.random() * 8, 4 + Math.random() * 4, 8 + Math.random() * 8)
    hill.rotation.y = Math.random() * Math.PI
    scene.add(hill)
}

const props = buildProps(look, scene)

const grass = new Grass(look, wind, noise, { size: 62, subdivisions: 360 })
scene.add(grass.mesh)

const foliageTexture = await new THREE.TextureLoader().loadAsync('./assets/foliageSDF.png')
foliageTexture.minFilter = THREE.NearestFilter
foliageTexture.magFilter = THREE.NearestFilter
foliageTexture.generateMipmaps = false
foliageTexture.colorSpace = THREE.NoColorSpace

const foliage = []
{
    // 每个树种一组（原版就是每个 Foliage 一种颜色），实例化所有同种树冠
    const groups = { cherry: [], olive: [] }
    for(const canopy of props.canopies)
        groups[canopy.type].push(canopy)

    const species = [
        { list: groups.cherry, colorA: '#ff6a43', colorB: '#ffb06a' },
        { list: groups.olive, colorA: '#c7b23f', colorB: '#e6da6a' },
    ]

    for(const item of species)
    {
        if(!item.list.length)
            continue

        const group = new Foliage(look, wind, foliageTexture, item.list, item.colorA, item.colorB, {
            // 原版的 see-through 是为了从车里看穿树叶；示例里没有车，默认关掉
            seeThrough: false,
        })
        scene.add(group.mesh)
        foliage.push(group)
    }
}

const rain = new RainLines(look, { count: 1400 })
scene.add(rain.mesh)

// 原版落叶挂在车上；这里用一个绕圈扫过的“风源”代替。
// 注意：bruno 的 physicalVehicle.velocity 是「每帧位移」，不是 m/s，
// 所以这里也喂每帧位移（下一步位置 - 上一步位置），否则推力会大两个数量级。
const leaves = new Leaves(look, wind, noise, {
    count: 2048,
    size: 30,
    renderer,
    compute: !!renderer.backend?.isWebGPUBackend,
})
scene.add(leaves.mesh)

const pusher = {
    angle: 0,
    radius: 9,
    position: new THREE.Vector3(0, 0.6, 0),
    previous: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
}

/* ------------------------------------------------------------------ */
/*  Floating dust                                                      */
/* ------------------------------------------------------------------ */

const dustCount = 160
const dustPositions = new Float32Array(dustCount * 3)
const dustSeeds = new Float32Array(dustCount * 3)

for(let i = 0; i < dustCount; i++)
{
    dustSeeds[i * 3 + 0] = Math.random() * Math.PI * 2
    dustSeeds[i * 3 + 1] = Math.random() * Math.PI * 2
    dustSeeds[i * 3 + 2] = 0.2 + Math.random() * 0.8

    dustPositions[i * 3 + 0] = (Math.random() - 0.5) * 26
    dustPositions[i * 3 + 1] = Math.random() * 5
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 26
}

const dustGeometry = new THREE.BufferGeometry()
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))

const dustCanvas = document.createElement('canvas')
dustCanvas.width = dustCanvas.height = 64
const dustContext = dustCanvas.getContext('2d')
const dustGradient = dustContext.createRadialGradient(32, 32, 0, 32, 32, 32)
dustGradient.addColorStop(0, 'rgba(255, 236, 200, 1)')
dustGradient.addColorStop(0.4, 'rgba(255, 200, 140, 0.5)')
dustGradient.addColorStop(1, 'rgba(255, 180, 120, 0)')
dustContext.fillStyle = dustGradient
dustContext.fillRect(0, 0, 64, 64)

const dustTexture = new THREE.CanvasTexture(dustCanvas)

const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
    map: dustTexture,
    size: 0.16,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.5,
    color: '#ffd9a8',
}))
dust.frustumCulled = false
scene.add(dust)

/* ------------------------------------------------------------------ */
/*  Camera                                                             */
/* ------------------------------------------------------------------ */

const orbit = {
    yaw: 0.6,
    pitch: 0.45,
    distance: 28,
    target: new THREE.Vector3(0, 1.8, 0),
    dragging: false,
    lastX: 0,
    lastY: 0,
    autoRotate: true,
}

function updateCamera()
{
    const horizontal = Math.cos(orbit.pitch) * orbit.distance
    camera.position.set(
        orbit.target.x + Math.sin(orbit.yaw) * horizontal,
        orbit.target.y + Math.sin(orbit.pitch) * orbit.distance,
        orbit.target.z + Math.cos(orbit.yaw) * horizontal
    )
    camera.lookAt(orbit.target)
}

updateCamera()

canvas.addEventListener('pointerdown', (event) =>
{
    orbit.dragging = true
    orbit.autoRotate = false
    orbit.lastX = event.clientX
    orbit.lastY = event.clientY
    canvas.setPointerCapture(event.pointerId)
})

canvas.addEventListener('pointermove', (event) =>
{
    if(!orbit.dragging)
        return

    orbit.yaw -= (event.clientX - orbit.lastX) * 0.006
    orbit.pitch = Math.max(0.08, Math.min(1.1, orbit.pitch + (event.clientY - orbit.lastY) * 0.004))
    orbit.lastX = event.clientX
    orbit.lastY = event.clientY
    updateCamera()
})

canvas.addEventListener('pointerup', (event) =>
{
    orbit.dragging = false
    canvas.releasePointerCapture(event.pointerId)
})

canvas.addEventListener('wheel', (event) =>
{
    event.preventDefault()
    orbit.distance = Math.max(9, Math.min(34, orbit.distance + event.deltaY * 0.01))
    updateCamera()
}, { passive: false })

/* ------------------------------------------------------------------ */
/*  Toggles                                                            */
/* ------------------------------------------------------------------ */

const state = { grass: true, foliage: true, rain: true, leaves: true, preset: 'day' }

function applyState()
{
    grass.mesh.visible = state.grass
    for(const group of foliage)
        group.mesh.visible = state.foliage
    rain.mesh.visible = state.rain
    leaves.mesh.visible = state.leaves

    const preset = look.presets[state.preset]
    look.setPreset(state.preset)
    skyTop.value.copy(preset.skyTop)
    skyBottom.value.copy(preset.skyBottom)

    document.querySelectorAll('[data-toggle]').forEach((element) =>
    {
        element.classList.toggle('is-on', state[element.dataset.toggle])
    })
    document.querySelectorAll('[data-preset]').forEach((element) =>
    {
        element.classList.toggle('is-on', state.preset === element.dataset.preset)
    })
}

addEventListener('keydown', (event) =>
{
    if(event.code === 'KeyG') state.grass = !state.grass
    else if(event.code === 'KeyF') state.foliage = !state.foliage
    else if(event.code === 'KeyR') state.rain = !state.rain
    else if(event.code === 'KeyL') state.leaves = !state.leaves
    else if(event.code === 'KeyE') leaves.explode(new THREE.Vector3(pusher.position.x, 0, pusher.position.z), 5)
    else if(event.code === 'Digit1') state.preset = 'day'
    else if(event.code === 'Digit2') state.preset = 'dusk'
    else if(event.code === 'Digit3') state.preset = 'night'
    else return

    applyState()
})

document.querySelectorAll('[data-toggle]').forEach((element) =>
{
    element.addEventListener('click', () =>
    {
        state[element.dataset.toggle] = !state[element.dataset.toggle]
        applyState()
    })
})

document.querySelectorAll('[data-preset]').forEach((element) =>
{
    element.addEventListener('click', () =>
    {
        state.preset = element.dataset.preset
        applyState()
    })
})

applyState()

/* ------------------------------------------------------------------ */
/*  Loop                                                               */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock()
let elapsed = 0
const rainCenter = new THREE.Vector2()
const focusScreen = new THREE.Vector3()

function frame()
{
    const dt = Math.min(clock.getDelta(), 0.05)
    elapsed += dt

    if(orbit.autoRotate && !orbit.dragging)
    {
        orbit.yaw += dt * 0.035
        updateCamera()
    }

    wind.update(dt)
    rain.update(dt, rainCenter)

    // 移动的风源：位置/速度喂给落叶的车推
    pusher.angle += dt * 1.4
    pusher.previous.copy(pusher.position)
    pusher.position.set(
        Math.cos(pusher.angle) * pusher.radius,
        0.6,
        Math.sin(pusher.angle * 1.7) * pusher.radius
    )
    // 每帧位移，直接对应 bruno 的 physicalVehicle.velocity
    pusher.velocity.copy(pusher.position).sub(pusher.previous)

    if(state.leaves)
        leaves.update(dt, orbit.target, pusher.position, pusher.velocity)

    // 树冠的 see-through：把“焦点”投到屏幕上，叶子在它附近会变透
    focusScreen.set(
        pusher.position.x,
        pusher.position.y,
        pusher.position.z
    ).project(camera)
    focusScreen.set(focusScreen.x * 0.5 + 0.5, focusScreen.y * 0.5 + 0.5)
    for(const group of foliage)
        group.update(camera.position, focusScreen, orbit.distance)

    props.update(elapsed)

    // 灰尘飘动
    const position = dustGeometry.attributes.position
    for(let i = 0; i < dustCount; i++)
    {
        const phaseA = dustSeeds[i * 3 + 0]
        const phaseB = dustSeeds[i * 3 + 1]
        const speed = dustSeeds[i * 3 + 2]

        position.array[i * 3 + 0] += Math.sin(elapsed * 0.3 * speed + phaseA) * dt * 0.16
        position.array[i * 3 + 1] += (Math.sin(elapsed * 0.5 * speed + phaseB) * 0.5 + 0.35) * dt * 0.2
        position.array[i * 3 + 2] += Math.cos(elapsed * 0.27 * speed + phaseA) * dt * 0.14

        if(position.array[i * 3 + 1] > 5.5)
            position.array[i * 3 + 1] = 0
    }
    position.needsUpdate = true

    look.update(camera)

    renderer.render(scene, camera)
}

renderer.setAnimationLoop(frame)

/* ------------------------------------------------------------------ */
/*  Resize                                                             */
/* ------------------------------------------------------------------ */

addEventListener('resize', () =>
{
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// 方便在控制台里调
window.shuikeLook = {
    scene, camera, renderer, look, grass, foliage, rain, leaves, terrain, props, orbit,
    setState(partial)
    {
        Object.assign(state, partial)
        applyState()
    },
    setCamera(partial)
    {
        Object.assign(orbit, partial)
        orbit.autoRotate = false
        updateCamera()
    },
}
