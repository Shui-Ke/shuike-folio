import * as THREE from 'three/webgpu'
import { color } from 'three/tsl'
import { terrainHeight } from './Terrain.js'

/**
 * “烂模型”区：树干是 6 边圆柱，树冠是 1 级细分二十面体，房子/箱子/石头全是方块。
 * 没有任何贴图、没有法线细节、没有 LOD。
 *
 * 之所以最后看起来还行，靠的是后面几招：
 *   树冠外面套一层 alpha 卡片（Foliage）、地面盖满草（Grass）、
 *   三色打光 + 紫影（Look）、雾把远处糊掉。
 */
export function buildProps(look, scene)
{
    const group = new THREE.Group()
    const canopies = []
    const lanterns = []

    const material = (hex, options = {}) => look.createMaterial({
        colorNode: color(hex),
        ...options,
    })

    const trunkMaterial = material('#6b3a4e')
    const cherryMaterial = material('#a8442f')
    const oliveMaterial = material('#8d7c33')
    const rockMaterial = material('#c2705c', { hasLightBounce: false })
    const rockLightMaterial = material('#dfa189', { hasLightBounce: false })
    const wallMaterial = material('#f0c39c')
    const roofMaterial = material('#b03c2c')
    const crateMaterial = material('#cf4f2c')
    const fenceMaterial = material('#e2a97f')
    const lanternMaterial = new THREE.MeshBasicNodeMaterial()
    lanternMaterial.colorNode = color('#ffcf6e').mul(3)

    const add = (mesh, castShadow = true, receiveShadow = true) =>
    {
        mesh.castShadow = castShadow
        mesh.receiveShadow = receiveShadow
        group.add(mesh)
        return mesh
    }

    /* ---------------------------------------------------------------- */
    /*  假的接触阴影：一张径向渐变贴图，贴在地上                          */
    /*  低模场景里这一步很关键：它把物体“钉”在地面上                      */
    /* ---------------------------------------------------------------- */

    const contactCanvas = document.createElement('canvas')
    contactCanvas.width = contactCanvas.height = 128
    const contactContext = contactCanvas.getContext('2d')
    const contactGradient = contactContext.createRadialGradient(64, 64, 2, 64, 64, 64)
    contactGradient.addColorStop(0, 'rgba(40, 12, 24, 0.85)')
    contactGradient.addColorStop(0.45, 'rgba(40, 12, 24, 0.45)')
    contactGradient.addColorStop(1, 'rgba(40, 12, 24, 0)')
    contactContext.fillStyle = contactGradient
    contactContext.fillRect(0, 0, 128, 128)

    const contactTexture = new THREE.CanvasTexture(contactCanvas)
    contactTexture.colorSpace = THREE.SRGBColorSpace

    const contactGeometry = new THREE.PlaneGeometry(1, 1)
    contactGeometry.rotateX(- Math.PI * 0.5)

    const addContactShadow = (x, z, radius, opacity = 0.6) =>
    {
        const material = new THREE.MeshBasicMaterial({
            map: contactTexture,
            transparent: true,
            depthWrite: false,
            opacity,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        })
        const mesh = new THREE.Mesh(contactGeometry, material)
        mesh.position.set(x, terrainHeight(x, z) + 0.03, z)
        mesh.scale.setScalar(radius * 2)
        mesh.renderOrder = 1
        group.add(mesh)
    }

    /* ---------------------------------------------------------------- */
    /*  树                                                                */
    /* ---------------------------------------------------------------- */

    const makeTree = (x, z, type) =>
    {
        const y = terrainHeight(x, z)
        const height = 2.4 + Math.random() * 0.5

        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, height, 6, 1), trunkMaterial)
        trunk.position.set(x, y + height * 0.5, z)
        trunk.rotation.y = Math.random() * Math.PI
        add(trunk)

        // 原版每棵树有 6 个 treeLeaves 占位球（60 顶点），这里用 3 个错开的球心，
        // 让树冠不是一颗规整的球
        const canopyY = y + height + 0.55

        for(let b = 0; b < 3; b++)
        {
            const angle = Math.random() * Math.PI * 2
            const offset = b === 0 ? 0 : 0.55 + Math.random() * 0.35

            canopies.push({
                position: new THREE.Vector3(
                    x + Math.cos(angle) * offset,
                    canopyY + (b === 0 ? 0.2 : -0.15 + Math.random() * 0.5),
                    z + Math.sin(angle) * offset
                ),
                radius: (b === 0 ? 1.2 : 0.85) + Math.random() * 0.2,
                type,
            })
        }

        addContactShadow(x, z, 1.5, 0.5)
    }

    makeTree(-4.4, -3.2, 'cherry')
    makeTree(3.6, -5.6, 'olive')
    makeTree(6.4, 2.4, 'cherry')
    makeTree(-7.2, 4.8, 'olive')

    /* ---------------------------------------------------------------- */
    /*  石头                                                              */
    /* ---------------------------------------------------------------- */

    const rockPositions = [
        [-2.2, 1.6, 0.75], [1.4, 2.2, 0.45], [5.2, 4.4, 0.6], [-6.5, -1.2, 0.5],
        [2.6, -1.6, 0.35], [-1.6, -6.4, 0.55], [7.4, -1.2, 0.42], [-4.8, 7.6, 0.65],
    ]

    for(let i = 0; i < rockPositions.length; i++)
    {
        const [x, z, scale] = rockPositions[i]
        const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(scale, 0),
            i % 2 ? rockMaterial : rockLightMaterial
        )
        rock.position.set(x, terrainHeight(x, z) + scale * 0.45, z)
        rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
        rock.scale.y = 0.7 + Math.random() * 0.4
        add(rock)
        addContactShadow(x, z, scale * 1.4, 0.55)
    }

    /* ---------------------------------------------------------------- */
    /*  房子                                                              */
    /* ---------------------------------------------------------------- */

    {
        const x = -8.2
        const z = -5.4
        const y = terrainHeight(x, z)

        const walls = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.8), wallMaterial)
        walls.position.set(x, y + 1.1, z)
        add(walls)

        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.5, 4), roofMaterial)
        roof.position.set(x, y + 2.95, z)
        roof.rotation.y = Math.PI * 0.25
        add(roof)

        // 门窗只是两块深色方块
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.1), material('#5e3348'))
        door.position.set(x + 0.4, y + 0.65, z + 1.42)
        add(door, false, false)

        const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.1), lanternMaterial)
        windowMesh.position.set(x - 1.0, y + 1.4, z + 1.42)
        add(windowMesh, false, false)

        addContactShadow(x, z, 2.2, 0.55)
    }

    /* ---------------------------------------------------------------- */
    /*  箱子 / 栅栏 / 路灯                                                 */
    /* ---------------------------------------------------------------- */

    const cratePositions = [[1.0, -1.0], [1.7, -0.4], [1.2, -0.3]]
    for(const [x, z] of cratePositions)
    {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), crateMaterial)
        crate.position.set(x, terrainHeight(x, z) + 0.4, z)
        crate.rotation.y = Math.random() * 0.6
        add(crate)
        addContactShadow(x, z, 0.65, 0.5)
    }

    for(let i = 0; i < 7; i++)
    {
        const x = -11 + i * 1.5
        const z = 2.6
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), fenceMaterial)
        post.position.set(x, terrainHeight(x, z) + 0.5, z)
        add(post)

        if(i < 6)
        {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.1), fenceMaterial)
            rail.position.set(x + 0.75, terrainHeight(x, z) + 0.75, z)
            add(rail)
        }
    }

    const makeLantern = (x, z) =>
    {
        const y = terrainHeight(x, z)

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 5), material('#4b2b45'))
        pole.position.set(x, y + 1.1, z)
        add(pole)

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.34), lanternMaterial)
        head.position.set(x, y + 2.35, z)
        add(head, false, false)

        const light = new THREE.PointLight('#ffb35a', 6, 9, 2)
        light.position.set(x, y + 2.3, z)
        scene.add(light)

        // 加法混合的“光晕”，没有 bloom 也能亮
        const glowCanvas = document.createElement('canvas')
        glowCanvas.width = glowCanvas.height = 128
        const context = glowCanvas.getContext('2d')
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
        gradient.addColorStop(0, 'rgba(255, 205, 120, 0.95)')
        gradient.addColorStop(0.35, 'rgba(255, 150, 80, 0.42)')
        gradient.addColorStop(1, 'rgba(255, 120, 60, 0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, 128, 128)

        const glowTexture = new THREE.CanvasTexture(glowCanvas)
        glowTexture.colorSpace = THREE.SRGBColorSpace

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 0.85,
        }))
        glow.scale.setScalar(2.6)
        glow.position.set(x, y + 2.35, z)
        scene.add(glow)

        lanterns.push({ light, glow, base: 6, phase: Math.random() * 10 })
    }

    makeLantern(-1.6, 3.0)
    makeLantern(8.0, -3.4)

    scene.add(group)

    return {
        group,
        canopies,
        update(elapsed)
        {
            for(const lantern of lanterns)
            {
                const flicker = 0.88 + Math.sin(elapsed * 9 + lantern.phase) * 0.06 + Math.sin(elapsed * 23.7 + lantern.phase) * 0.04
                lantern.light.intensity = lantern.base * flicker
                lantern.glow.material.opacity = 0.75 * flicker
            }
        },
    }
}
