import * as THREE from 'three/webgpu'
import gsap from 'gsap'
import { color, normalWorld, uniform } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { CanyonTerrain } from './CanyonTerrain.js'
import { Grass } from './Grass.js'
import { Trees } from './Trees.js'
import { WindLines } from './WindLines.js'
import { Leaves } from './Leaves.js'
import { RainLines } from './RainLines.js'
import { Snow } from './Snow.js'
import { Lightnings } from './Lightnings.js'

const STATIC_PROPS = {
    '完整高楼': { resource: 'campTower', collision: true, occluder: true },
    '斜断高楼': { resource: 'campTowerBroken', collision: true, occluder: true },
    '矮楼': { resource: 'campLowBuilding', collision: true, occluder: true },
    '废弃集装箱': { resource: 'campContainer', collision: true, occluder: true },
    '生锈汽油桶': { resource: 'campBarrel', collision: true },
    '长椅': { resource: 'campBench', collision: true },
    '直行道': { resource: 'campRoadStraight', collision: false },
    '弯道': { resource: 'campRoadCurve', collision: false },
    '玄武岩_01': { resource: 'campBasalt01', collision: true },
    '玄武岩_02': { resource: 'campBasalt02', collision: true },
    '越野车_天线': { resource: 'campAntenna', collision: true },
}

const TREE_COLORS = {
    oak: { visual: 'oakTreesVisualModel', colorA: '#b4b536', colorB: '#d8cf3b', name: 'Canyon Oak' },
    cherry: { visual: 'cherryTreesVisualModel', colorA: '#ff6d6d', colorB: '#ff9990', name: 'Canyon Cherry' },
}

export class CanyonLevel
{
    constructor()
    {
        this.game = Game.getInstance()
        this.layout = this.game.levelLayout

        this.terrain = new CanyonTerrain()
        this.grass = new Grass()
        this.game.world.grass = this.grass

        this.windLines = new WindLines()
        this.leaves = new Leaves()
        this.rain = new RainLines()
        this.snow = new Snow()
        this.lightnings = new Lightnings()

        this.occluders = new Map()
        this.addTrees()
        this.addProps()
        this.addBricks()
        this.addLanterns()
        this.addCrates()
    }

    addTrees()
    {
        const groups = { oak: [], cherry: [] }

        for(const item of this.layout.objects)
        {
            let species = null
            if(item.name === '橡树')
                species = 'oak'
            else if(item.name === '樱花树')
                species = 'cherry'

            if(!species)
                continue

            const [x, , z] = item.position
            const y = this.terrain.heightAt(x, z)

            const reference = new THREE.Object3D()
            reference.position.set(x, y, z)
            reference.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])
            reference.scale.fromArray(item.scale)
            reference.updateMatrix()
            reference.updateMatrixWorld(true)

            groups[species].push(reference)
        }

        this.trees = []
        for(const species of ['oak', 'cherry'])
        {
            if(!groups[species].length)
                continue

            const definition = TREE_COLORS[species]
            this.trees.push(new Trees(
                definition.name,
                this.game.resources[definition.visual].scene,
                groups[species],
                definition.colorA,
                definition.colorB
            ))
        }
    }

    addProps()
    {
        for(const item of this.layout.objects)
        {
            const definition = STATIC_PROPS[item.name]
            if(!definition)
                continue

            this.addStatic(item, definition.resource, definition.collision, definition.occluder)
        }
    }

    addStatic(item, resourceKey, collision, occluder = false)
    {
        const x = item.position[0]
        const y = item.position[1]
        const z = item.position[2]
        const rotation = new THREE.Euler(item.rotation[0], item.rotation[1], item.rotation[2])
        const root = this.createModel(resourceKey, item.scale)

        if(!collision)
        {
            root.position.set(x, y, z)
            root.rotation.copy(rotation)
            root.updateMatrixWorld(true)
            this.game.objects.add({ model: root, updateMaterials: true })
            return
        }

        root.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(root)
        const size = bounds.getSize(new THREE.Vector3())
        const half = new THREE.Vector3(size.x * 0.5, size.y * 0.5, size.z * 0.5)

        root.position.set(x, y, z)
        root.rotation.copy(rotation)

        const object = this.game.objects.add(
            { model: root, updateMaterials: true },
            {
                type: 'fixed',
                position: { x, y, z },
                rotation: new THREE.Quaternion().setFromEuler(rotation),
                friction: 0.8,
                colliders: [ {
                    shape: 'cuboid',
                    parameters: [ half.x, half.y, half.z ],
                    position: { x: 0, y: half.y, z: 0 },
                    category: 'object'
                } ]
            }
        )

        if(occluder)
            this.registerOccluder(object, root)
    }

    registerOccluder(object, root)
    {
        const entries = []

        root.traverse((child) =>
        {
            if(!child.isMesh || !child.material)
                return

            const originals = Array.isArray(child.material) ? child.material : [child.material]
            const materials = originals.map((original) =>
            {
                const alpha = uniform(1)
                const material = new MeshDefaultMaterial({
                    colorNode: original._colorNode ?? color(original.color ?? 0xffffff),
                    normalNode: original._normalNode ?? normalWorld,
                    alphaNode: alpha,
                    side: original.side ?? THREE.FrontSide,
                    transparent: true,
                    depthWrite: false,
                    hasCoreShadows: original.hasCoreShadows ?? true,
                    hasDropShadows: original.hasDropShadows ?? true,
                    hasLightBounce: original.hasLightBounce ?? false,
                    hasWater: original.hasWater ?? false,
                    hasFog: original.hasFog ?? true,
                    hasReveal: original.hasReveal ?? true,
                    alphaTest: original.alphaTest ?? 0.1
                })
                material.name = original.name
                entries.push({ alpha })
                return material
            })

            child.material = Array.isArray(child.material) ? materials : materials[0]
        })

        this.occluders.set(object, entries)
    }

    updateOccluders(activeObject, delta)
    {
        const factor = 1 - Math.exp(-10 * delta)

        for(const [object, entries] of this.occluders)
        {
            const target = object === activeObject ? 0.18 : 1

            for(const entry of entries)
                entry.alpha.value += (target - entry.alpha.value) * factor
        }
    }

    addBricks()
    {
        for(const item of this.layout.objects)
        {
            if(item.name !== '砖块')
                continue

            const [x, y, z] = item.position
            const root = this.createModel('campBrick', item.scale)
            root.position.set(x, y, z)
            root.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])

            this.game.objects.add(
                { model: root, updateMaterials: true },
                {
                    type: 'dynamic',
                    position: { x, y, z },
                    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(item.rotation[0], item.rotation[1], item.rotation[2])),
                    friction: 0.7,
                    mass: 0.1,
                    sleeping: true,
                    colliders: [ { shape: 'cuboid', parameters: [ 0.75 * 0.75, 0.5 * 0.75, 1 * 0.75 ], category: 'object' } ],
                    waterGravityMultiplier: -1,
                    contactThreshold: 15,
                    onCollision: (force, position) =>
                    {
                        this.game.audio.groups.get('hitBrick').playRandomNext(force, position)
                    }
                }
            )
        }
    }

    addLanterns()
    {
        for(const item of this.layout.objects)
        {
            if(item.name !== '灯笼')
                continue

            const [x, y, z] = item.position
            const root = this.createModel('campLantern', item.scale)
            root.position.set(x, y, z)
            root.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])

            this.game.objects.add(
                { model: root, updateMaterials: true },
                {
                    type: 'dynamic',
                    position: { x, y, z },
                    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(item.rotation[0], item.rotation[1], item.rotation[2])),
                    friction: 0.7,
                    mass: 0.1,
                    sleeping: true,
                    colliders: [ { shape: 'cuboid', parameters: [ 0.7 * 0.5, 1 * 0.5, 0.7 * 0.5 ], category: 'object' } ],
                    waterGravityMultiplier: -1,
                    contactThreshold: 10,
                    onCollision: (force, position) =>
                    {
                        this.game.audio.groups.get('hitMetal').playRandomNext(force, position)
                    }
                }
            )
        }
    }

    addCrates()
    {
        this.crates = []
        this.setCrateSounds()

        for(const item of this.layout.objects)
        {
            if(item.name !== '爆炸木箱')
                continue

            const [x, y, z] = item.position
            const root = this.createModel('campCrate', item.scale)
            root.position.set(x, y, z)
            root.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])

            const crate = {
                id: this.crates.length,
                exploded: false,
                position: new THREE.Vector3(x, y, z),
                object: null
            }

            crate.object = this.game.objects.add(
                { model: root, updateMaterials: true },
                {
                    type: 'dynamic',
                    position: { x, y, z },
                    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(item.rotation[0], item.rotation[1], item.rotation[2])),
                    friction: 0.7,
                    mass: 0.02,
                    sleeping: true,
                    colliders: [ { shape: 'cuboid', parameters: [ 0.5, 0.5, 0.5 ], category: 'object' } ],
                    waterGravityMultiplier: -1,
                    contactThreshold: 0,
                    onCollision: () =>
                    {
                        this.explodeCrate(crate)
                    }
                }
            )

            this.crates.push(crate)
        }

        this.game.world.explosiveCrates = {
            reset: () => this.resetCrates()
        }
    }

    setCrateSounds()
    {
        this.sounds = {}

        this.sounds.triggerClick = this.game.audio.register({
            path: 'sounds/clicks/Source Metal Clicks Delicate Light Sharp Clip Mid 07.mp3',
            autoplay: false,
            loop: false,
            volume: 0.4,
            antiSpam: 0.1,
            positions: new THREE.Vector3(),
            onPlay: (item, coordinates) =>
            {
                item.positions[0].copy(coordinates)
                item.volume = 1
                item.rate = 0.7 + Math.random() * 1.3
            }
        })

        const paths = [
            'sounds/explosions/SmallImpactMediumE PE281202.mp3',
            'sounds/explosions/SmallImpactMediumE PE281203.mp3'
        ]

        this.sounds.explosions = []
        for(const path of paths)
        {
            this.sounds.explosions.push(this.game.audio.register({
                path,
                autoplay: false,
                loop: false,
                volume: 0.4,
                antiSpam: 0.2,
                positions: new THREE.Vector3(),
                distanceFade: 25,
                onPlay: (item, coordinates) =>
                {
                    item.positions[0].copy(coordinates)
                    item.volume = 1
                    item.rate = 0.9 + Math.random() * 0.3
                }
            }))
        }
    }

    explodeCrate(crate)
    {
        if(crate.exploded)
            return

        crate.exploded = true
        this.sounds.triggerClick.play(crate.position)

        gsap.delayedCall(0.4, () =>
        {
            this.sounds.explosions[Math.floor(Math.random() * this.sounds.explosions.length)].play(crate.position)
            this.game.world.fireballs.create(crate.object.physical.body.translation())
            this.game.objects.disable(crate.object)
            crate.object.visual.object3D.position.y += 100
            crate.object.visual.object3D.needsUpdate = true
            this.game.achievements.setProgress('explosiveCrates', crate.id)
        })
    }

    resetCrates()
    {
        for(const crate of this.crates)
        {
            this.game.objects.resetObject(crate.object)
            crate.exploded = false
            this.game.ticker.wait(2, () =>
            {
                crate.object.physical.body.setEnabled(true)
            })
        }

        this.game.objects.list.forEach((object) =>
        {
            if(
                object.physical &&
                (object.physical.type === 'dynamic' || object.physical.type === 'kinematicPositionBased') &&
                object.physical.body.isEnabled()
            )
            {
                object.physical.body.setEnabled(false)

                this.game.ticker.wait(1, () =>
                {
                    object.physical.body.setEnabled(true)

                    if(object.physical.initialState.sleeping)
                        object.physical.body.sleep()
                })
            }
        })
    }

    createModel(resourceKey, scale)
    {
        const source = this.game.resources[resourceKey].scene.clone(true)

        source.traverse((child) =>
        {
            if(!child.isMesh)
                return

            if(child.userData.collisionReference || /^(cuboid|hull|trimesh|tube|ball)[.0-9]/i.test(child.name))
            {
                child.visible = false
                return
            }

            child.castShadow = true
            child.receiveShadow = true
        })

        source.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(source)
        const center = bounds.getCenter(new THREE.Vector3())

        source.position.x -= center.x
        source.position.z -= center.z
        source.position.y -= bounds.min.y

        const root = new THREE.Group()
        root.add(source)
        root.scale.fromArray(scale)

        return root
    }
}
