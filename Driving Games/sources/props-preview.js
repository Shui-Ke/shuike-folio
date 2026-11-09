import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const items = [
    { file: 'caltrop', title: '铁蒺藜', detail: '四向尖刺 · 纯深灰', colors: ['#3e3e3e'] },
    { file: 'missile', title: '导弹', detail: '八面弹体 · 十字尾翼', colors: ['#fff0ce', '#ff842e', '#e94243'] },
    { file: 'jetpack', title: '喷气背包', detail: '双罐结构 · 双喷口', colors: ['#e94243', '#352b42', '#ffcc58'] },
    { file: 'shield', title: '护盾', detail: '灰色盾面 · 棱面金属', colors: ['#999999', '#555555', '#3e3e3e'] },
    { file: 'power-plus', title: 'POWER+', detail: '橙色立体字 · 深色描边', colors: ['#fff0ce', '#ff842e', '#352b42'] },
    { file: 'jump-times-two', title: 'JUMP×2', detail: '青色立体字 · 深色描边', colors: ['#fff0ce', '#56c9bd', '#352b42'] },
    { file: 'speed-plus', title: 'SPEED+', detail: '金色立体字 · 深色描边', colors: ['#fff0ce', '#ffcc58', '#352b42'] },
]
window.propsPreviewState = { ready: false, models: [], errors: [] }
const loader = new GLTFLoader()
const grid = document.querySelector('.grid')

await Promise.all(items.map(async (item, index) => {
    const card = document.createElement('article')
    card.className = 'card'
    card.innerHTML = `<div class="label"><span class="number">0${index + 1}</span><h2>${item.title}</h2></div><div class="viewer" aria-label="${item.title}，可旋转的三维模型"></div><div class="caption"><span>${item.detail}</span><span class="swatches">${item.colors.map(color => `<i style="background:${color}"></i>`).join('')}</span></div>`
    grid.append(card)
    const viewport = card.querySelector('.viewer')
    try {
        const { scene: model } = await loader.loadAsync(`./models/powerups/${item.file}.glb`)
        const scene = new THREE.Scene()
        scene.background = new THREE.Color('#f4ead6')
        const bounds = new THREE.Box3().setFromObject(model)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        model.traverse(child => { if(child.isMesh) { child.castShadow = true; child.receiveShadow = true } })
        scene.add(model)
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFSoftShadowMap
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.25
        viewport.append(renderer.domElement)
        scene.add(new THREE.HemisphereLight('#fff1d5', '#72607e', 2.8))
        const sun = new THREE.DirectionalLight('#fff2d6', 3.2)
        sun.position.set(-3, 6, 5)
        sun.castShadow = true
        sun.shadow.mapSize.set(1024, 1024)
        sun.shadow.camera.left = sun.shadow.camera.bottom = -4
        sun.shadow.camera.right = sun.shadow.camera.top = 4
        sun.shadow.normalBias = 0.025
        scene.add(sun)
        const fill = new THREE.DirectionalLight('#afa0e5', 1.5)
        fill.position.set(4, 2, -3)
        scene.add(fill)
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#443147', opacity: 0.2 }))
        ground.rotation.x = -Math.PI / 2
        ground.position.y = -0.035
        ground.receiveShadow = true
        scene.add(ground)
        const camera = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.01, 100)
        const isText = index >= 4
        camera.position.copy(center).add(new THREE.Vector3(isText ? 2 : 3, isText ? 1.8 : 2.4, 7))
        camera.lookAt(center)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.target.copy(center)
        controls.update()
        controls.enablePan = false
        controls.minZoom = 0.65
        controls.maxZoom = 3
        controls.addEventListener('change', () => renderer.render(scene, camera))
        const resize = () => {
            const width = viewport.clientWidth, height = viewport.clientHeight, aspect = width / height
            const span = Math.max(size.y * 1.45, size.x / aspect * 1.35, isText ? 1.25 : 1.85)
            camera.left = -span * aspect / 2; camera.right = span * aspect / 2
            camera.top = span / 2; camera.bottom = -span / 2
            camera.updateProjectionMatrix()
            renderer.setSize(width, height)
            renderer.render(scene, camera)
        }
        new ResizeObserver(resize).observe(viewport)
        resize()
        window.propsPreviewState.models.push({ name: item.file, dimensions: size.toArray() })
    } catch(error) {
        viewport.textContent = '模型暂时无法加载'
        window.propsPreviewState.errors.push(error.message)
    }
}))
window.propsPreviewState.ready = true
