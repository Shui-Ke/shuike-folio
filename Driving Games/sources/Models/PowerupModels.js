import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// Original, texture-free low-poly props. Y is up; units match the game world.
const palette = {
    charcoal: '#352b42', metal: '#626479', steel: '#c9d1d4', cream: '#fff0ce',
    orange: '#ff842e', red: '#e94243', gold: '#ffcc58', teal: '#56c9bd',
    darkGray: '#3e3e3e', shieldGray: '#999999', shieldRim: '#555555',
}
const material = color => new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.08, flatShading: true })
const materials = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, material(value)]))
materials.glow = new THREE.MeshStandardMaterial({ color: '#ffe6a0', emissive: '#ff9a2f', emissiveIntensity: 0.75, roughness: 0.7 })

function mesh(group, name, geometry, mat, position = [0, 0, 0]) {
    const item = new THREE.Mesh(geometry, mat)
    item.name = name
    item.position.set(...position)
    item.castShadow = item.receiveShadow = true
    group.add(item)
    return item
}
function box(group, name, size, mat, position, bevel = 0.035) {
    return mesh(group, name, new RoundedBoxGeometry(...size, 1, bevel), mat, position)
}
function cylinder(group, name, top, bottom, height, mat, position, segments = 8) {
    return mesh(group, name, new THREE.CylinderGeometry(top, bottom, height, segments, 1), mat, position)
}
function finalize(group, name) {
    group.name = name
    group.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(group)
    const center = bounds.getCenter(new THREE.Vector3())
    for(const child of group.children) {
        child.position.x -= center.x
        child.position.y -= bounds.min.y
        child.position.z -= center.z
    }
    group.userData = { prop: name, style: 'low-poly', upAxis: 'Y', anchor: 'ground-center' }
    group.updateMatrixWorld(true)
    return group
}

export function createCaltrop() {
    const group = new THREE.Group()
    mesh(group, 'forged-center', new THREE.IcosahedronGeometry(0.23, 0), materials.darkGray)
    const directions = [new THREE.Vector3(0, 1, 0)]
    for(let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3 + Math.PI / 6
        directions.push(new THREE.Vector3(Math.cos(angle) * Math.sqrt(8 / 9), -1 / 3, Math.sin(angle) * Math.sqrt(8 / 9)))
    }
    directions.forEach((direction, index) => {
        const shaft = cylinder(group, `spike-${index}`, 0.045, 0.15, 0.6, materials.darkGray, direction.clone().multiplyScalar(0.38).toArray(), 5)
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
        const point = mesh(group, `sharpened-tip-${index}`, new THREE.ConeGeometry(0.046, 0.26, 5), materials.darkGray, direction.clone().multiplyScalar(0.81).toArray())
        point.quaternion.copy(shaft.quaternion)
        const collar = cylinder(group, `forged-collar-${index}`, 0.14, 0.16, 0.12, materials.darkGray, direction.clone().multiplyScalar(0.14).toArray(), 5)
        collar.quaternion.copy(shaft.quaternion)
    })
    return finalize(group, 'caltrop')
}

export function createMissile() {
    const group = new THREE.Group()
    const alongX = item => { item.rotation.z = -Math.PI / 2; return item }
    alongX(cylinder(group, 'missile-body', 0.22, 0.22, 1.35, materials.cream, [0, 0, 0]))
    alongX(cylinder(group, 'nose-collar', 0.23, 0.23, 0.1, materials.charcoal, [0.69, 0, 0]))
    alongX(mesh(group, 'faceted-warhead', new THREE.ConeGeometry(0.225, 0.62, 8), materials.orange, [1.04, 0, 0]))
    alongX(cylinder(group, 'safety-stripe', 0.226, 0.226, 0.16, materials.orange, [-0.36, 0, 0]))
    alongX(cylinder(group, 'tail-housing', 0.225, 0.18, 0.28, materials.charcoal, [-0.81, 0, 0]))
    alongX(cylinder(group, 'exhaust-rim', 0.19, 0.19, 0.1, materials.metal, [-0.99, 0, 0]))
    alongX(cylinder(group, 'exhaust-core', 0.13, 0.13, 0.012, materials.glow, [-1.046, 0, 0]))
    const finShape = new THREE.Shape()
    finShape.moveTo(-0.96, 0.16); finShape.lineTo(-0.99, 0.49); finShape.lineTo(-0.68, 0.49); finShape.lineTo(-0.36, 0.17); finShape.closePath()
    for(let i = 0; i < 4; i++) {
        const geometry = new THREE.ExtrudeGeometry(finShape, { depth: 0.055, bevelEnabled: false })
        geometry.translate(0, 0, -0.0275)
        const fin = mesh(group, `stabilizer-${i}`, geometry, [materials.red, materials.charcoal])
        fin.rotation.x = i * Math.PI / 2 + Math.PI / 4
    }
    box(group, 'top-identification', [0.28, 0.018, 0.1], materials.charcoal, [0.18, 0.22, 0], 0.005)
    return finalize(group, 'missile')
}

export function createJetpack() {
    const group = new THREE.Group()
    box(group, 'harness-backplate', [1.02, 0.87, 0.2], materials.charcoal, [0, 0.68, -0.2], 0.075)
    box(group, 'center-control-box', [0.28, 0.55, 0.37], materials.metal, [0, 0.74, 0.03], 0.04)
    box(group, 'power-light', [0.13, 0.16, 0.035], materials.glow, [0, 0.85, 0.23], 0.015)
    for(const x of [-0.38, 0.38]) {
        const side = x < 0 ? 'left' : 'right'
        cylinder(group, `${side}-fuel-tank`, 0.235, 0.235, 0.87, materials.red, [x, 0.78, 0.04])
        cylinder(group, `${side}-shoulder-cap`, 0.13, 0.235, 0.18, materials.orange, [x, 1.305, 0.04])
        cylinder(group, `${side}-valve`, 0.07, 0.07, 0.12, materials.charcoal, [x, 1.45, 0.04])
        for(const y of [0.51, 1.06]) cylinder(group, `${side}-tank-brace-${y}`, 0.25, 0.25, 0.09, materials.charcoal, [x, y, 0.04])
        box(group, `${side}-tank-label`, [0.15, 0.25, 0.022], materials.cream, [x, 0.79, 0.275], 0.012)
        cylinder(group, `${side}-engine`, 0.19, 0.25, 0.24, materials.metal, [x, 0.22, 0.04])
        cylinder(group, `${side}-nozzle-rim`, 0.26, 0.26, 0.1, materials.charcoal, [x, 0.06, 0.04])
        cylinder(group, `${side}-hot-core`, 0.18, 0.18, 0.018, materials.glow, [x, 0.002, 0.04])
        const strapPath = new THREE.CatmullRomCurve3([
            new THREE.Vector3(x, 1.03, -0.32), new THREE.Vector3(x, 0.97, -0.65),
            new THREE.Vector3(x, 0.44, -0.65), new THREE.Vector3(x, 0.32, -0.32),
        ])
        mesh(group, `${side}-shoulder-strap`, new THREE.TubeGeometry(strapPath, 8, 0.055, 4, false), materials.charcoal)
    }
    box(group, 'lower-cross-brace', [1.05, 0.12, 0.15], materials.orange, [0, 0.36, 0.02], 0.02)
    return finalize(group, 'jetpack')
}

export function createShield() {
    const group = new THREE.Group()
    const edge = [[0,0], [0.43,0.32], [0.61,0.78], [0.61,1.43], [0.36,1.49], [0,1.6], [-0.36,1.49], [-0.61,1.43], [-0.61,0.78], [-0.43,0.32]]
    const shell = new THREE.ExtrudeGeometry(outline(edge), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 1 })
    mesh(group, 'shield-rim-and-back', shell, materials.shieldRim)
    // A raised center and broad triangular faces give the shield its angular silhouette.
    const inset = edge.map(([x, y]) => [x * 0.84, (y - 0.8) * 0.84 + 0.8])
    const vertices = []
    for(let i = 0; i < inset.length; i++) {
        const a = inset[i], b = inset[(i + 1) % inset.length]
        vertices.push(0, 0.86, 0.29, a[0], a[1], 0.16, b[0], b[1], 0.16)
    }
    const panel = new THREE.BufferGeometry()
    panel.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    panel.computeVertexNormals()
    mesh(group, 'faceted-shield-face', panel, materials.shieldGray)
    const boss = cylinder(group, 'hexagonal-center-boss', 0.13, 0.19, 0.09, materials.shieldRim, [0, 0.86, 0.3], 6)
    boss.rotation.x = Math.PI / 2
    for(const [x, y] of [[-0.51,1.32], [0.51,1.32], [-0.39,0.43], [0.39,0.43]]) {
        const rivet = cylinder(group, `rim-rivet-${x}-${y}`, 0.034, 0.043, 0.024, materials.shieldGray, [x, y, 0.16], 6)
        rivet.rotation.x = Math.PI / 2
    }
    for(const x of [-0.24, 0.24]) {
        const path = new THREE.CatmullRomCurve3([
            new THREE.Vector3(x, 1.1, 0), new THREE.Vector3(x, 1.02, -0.22),
            new THREE.Vector3(x, 0.6, -0.22), new THREE.Vector3(x, 0.52, 0),
        ])
        mesh(group, `rear-grip-${x}`, new THREE.TubeGeometry(path, 6, 0.055, 4, false), materials.darkGray)
    }
    return finalize(group, 'shield')
}

// Hand-drawn block-letter outlines keep the models self-contained and editable.
const glyphs = {
    S: { w: 0.7, p: [[0,0.16],[0,0.31],[0.22,0.31],[0.22,0.22],[0.48,0.22],[0.48,0.4],[0.16,0.4],[0,0.56],[0,0.84],[0.16,1],[0.54,1],[0.7,0.84],[0.7,0.69],[0.48,0.69],[0.48,0.78],[0.22,0.78],[0.22,0.61],[0.54,0.61],[0.7,0.45],[0.7,0.16],[0.54,0],[0.16,0]] },
    D: { w: 0.72, p: [[0,0],[0,1],[0.47,1],[0.72,0.77],[0.72,0.23],[0.47,0]], holes: [[[0.22,0.22],[0.38,0.22],[0.5,0.34],[0.5,0.66],[0.38,0.78],[0.22,0.78]]] },
    P: { w: 0.68, p: [[0,0],[0,1],[0.52,1],[0.68,0.84],[0.68,0.55],[0.53,0.4],[0.22,0.4],[0.22,0]], holes: [[[0.22,0.62],[0.46,0.62],[0.46,0.78],[0.22,0.78]]] },
    O: { w: 0.7, p: [[0,0.16],[0,0.84],[0.16,1],[0.54,1],[0.7,0.84],[0.7,0.16],[0.54,0],[0.16,0]], holes: [[[0.22,0.26],[0.26,0.22],[0.44,0.22],[0.48,0.26],[0.48,0.74],[0.44,0.78],[0.26,0.78],[0.22,0.74]]] },
    W: { w: 1.06, p: [[0,1],[0.22,1],[0.32,0.32],[0.44,0.67],[0.62,0.67],[0.74,0.32],[0.84,1],[1.06,1],[0.91,0],[0.68,0],[0.53,0.35],[0.38,0],[0.15,0]] },
    E: { w: 0.64, p: [[0,0],[0,1],[0.64,1],[0.64,0.78],[0.22,0.78],[0.22,0.61],[0.56,0.61],[0.56,0.4],[0.22,0.4],[0.22,0.22],[0.64,0.22],[0.64,0]] },
    R: { w: 0.72, p: [[0,0],[0,1],[0.52,1],[0.68,0.84],[0.68,0.55],[0.51,0.4],[0.72,0],[0.46,0],[0.25,0.4],[0.22,0.4],[0.22,0]], holes: [[[0.22,0.62],[0.46,0.62],[0.46,0.78],[0.22,0.78]]] },
    '+': { w: 0.66, p: [[0,0.39],[0.22,0.39],[0.22,0.17],[0.44,0.17],[0.44,0.39],[0.66,0.39],[0.66,0.61],[0.44,0.61],[0.44,0.83],[0.22,0.83],[0.22,0.61],[0,0.61]] },
    J: { w: 0.65, p: [[0,0.3],[0.22,0.3],[0.22,0.22],[0.43,0.22],[0.43,0.78],[0.18,0.78],[0.18,1],[0.65,1],[0.65,0.16],[0.49,0],[0.16,0],[0,0.16]] },
    U: { w: 0.7, p: [[0,1],[0.22,1],[0.22,0.27],[0.27,0.22],[0.43,0.22],[0.48,0.27],[0.48,1],[0.7,1],[0.7,0.16],[0.54,0],[0.16,0],[0,0.16]] },
    M: { w: 0.88, p: [[0,0],[0,1],[0.23,1],[0.44,0.62],[0.65,1],[0.88,1],[0.88,0],[0.66,0],[0.66,0.61],[0.44,0.28],[0.22,0.61],[0.22,0]] },
    '×': { w: 0.66, p: [[0.02,0.26],[0.2,0.08],[0.33,0.32],[0.52,0.08],[0.66,0.26],[0.46,0.5],[0.66,0.74],[0.52,0.92],[0.33,0.68],[0.14,0.92],[0,0.74],[0.2,0.5]] },
    '2': { w: 0.7, p: [[0,0],[0,0.37],[0.45,0.72],[0.45,0.78],[0.23,0.78],[0.23,0.65],[0,0.65],[0,0.84],[0.16,1],[0.54,1],[0.7,0.84],[0.7,0.64],[0.24,0.28],[0.24,0.22],[0.7,0.22],[0.7,0]] },
}

function outline(points, Path = THREE.Shape) {
    const path = new Path()
    path.moveTo(...points[0])
    for(const point of points.slice(1)) path.lineTo(...point)
    path.closePath()
    return path
}
export function createTextProp(text, accent = 'orange') {
    const group = new THREE.Group()
    let cursor = 0
    for(const [index, character] of [...text].entries()) {
        const glyph = glyphs[character]
        const shape = outline(glyph.p)
        for(const hole of glyph.holes || []) shape.holes.push(outline(hole, THREE.Path))
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.17, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 1 })
        mesh(group, `letter-${index}-${character}`, geometry, [materials.cream, materials[accent]], [cursor, 0, 0])
        const backing = new THREE.ExtrudeGeometry(shape, { depth: 0.065, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.065, bevelSegments: 1, curveSegments: 1 })
        mesh(group, `outline-${index}`, backing, materials.charcoal, [cursor, 0, -0.09])
        cursor += glyph.w + 0.18
    }
    group.scale.setScalar(0.6)
    group.updateMatrixWorld(true)
    // Bake scale so GLB pivots and dimensions are consistent with the other props.
    for(const child of group.children) { child.geometry.scale(0.6, 0.6, 0.6); child.position.multiplyScalar(0.6) }
    group.scale.setScalar(1)
    const names = { 'POWER+': 'power-plus', 'JUMP×2': 'jump-times-two', 'SPEED+': 'speed-plus' }
    return finalize(group, names[text])
}

export function createPowerupModels() {
    return [createCaltrop(), createMissile(), createJetpack(), createShield(), createTextProp('POWER+', 'orange'), createTextProp('JUMP×2', 'teal'), createTextProp('SPEED+', 'gold')]
}
