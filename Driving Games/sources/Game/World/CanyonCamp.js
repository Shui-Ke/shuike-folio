import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { Trees } from './Trees.js'
import { MAP_SCALE } from '../WorldLayout.js'

const CAMP_CENTER = { x: 31.3, z: 70.4 }
const CAMP_OFFSET = { x: -14, z: -72 }

/**
 * Camp layout saved from the scene editor.
 * Trees use the game's native tree bodies and Bruno's Foliage leaf clusters,
 * so their canopies are built from the foliage SDF cards rather than the
 * coarse leaf meshes that ship with the wasteland library.
 */
const TREES = [
    // Camp grove, moved from the removed Vermilion island to the north shore
    { species: 'cherry', position: [48.9592580750744, 0, 146.1502512627938], scale: [1, 1, 1], camp: true },
    { species: 'oak', position: [54.298121758703346, 0, 141.5633246618125], scale: [1, 1, 1], camp: true },
    { species: 'oak', position: [38.710401620751696, 0, 138.3399135453247], scale: [1, 1, 1], camp: true },
    { species: 'birch', position: [36.27103367227169, 0, 146.39966593555562], scale: [1, 1, 1], camp: true },

    // Remaining layout trees on the main map
    { species: 'birch', position: [-45.98184714982662, -1.026962516258874, -37.76762923571087], scale: [2.1966875919572035, 1.1035265225498607, 1.5183042353613112] },
    { species: 'cherry', position: [77.91288236552073, -0.11277117321151253, -25.940166924701213], scale: [1, 1, 1] },
]

const PROPS = [
    { resource: 'campBrick', type: 'brick', position: [74.03458493819198, 0.013955003584665393, -23.779750946486175] },
    { resource: 'campBrick', type: 'brick', position: [72.92444422836019, -0.07058770040501461, -23.42936224858797] },
    { resource: 'campBrick', type: 'brick', position: [71.8842614908573, -0.011787704614071887, -24.540409157709036] },
    { resource: 'campBrick', type: 'brick', position: [72.89660035290655, -0.3769807262797258, -24.58183273461681] },
    { resource: 'campBrick', type: 'brick', position: [75.24639572353776, 0, -24.131349069713167] },
    { resource: 'campBasalt02', type: 'rock', position: [72.85030473826505, -2.5487936922947063, -28.89392622659997] },
    { resource: 'campBasalt01', type: 'rock', position: [78.0750261407667, -1.0120396796373825, -26.81536212645387] },
]

const TREE_DEFINITIONS = {
    birch: { visual: 'birchTreesVisualModel', colorA: '#ff4f2b', colorB: '#ff903f', name: 'Camp Birch' },
    oak: { visual: 'oakTreesVisualModel', colorA: '#b4b536', colorB: '#d8cf3b', name: 'Camp Oak' },
    cherry: { visual: 'cherryTreesVisualModel', colorA: '#ff6d6d', colorB: '#ff9990', name: 'Camp Cherry' },
}

export class CanyonCamp
{
    static prepare(game)
    {
        // Remove the cherry that already sits in the new camp clearing so the
        // layout's cherry replaces it instead of overlapping it.
        const references = game.resources.cherryTreesReferencesModel.scene
        for(const child of [...references.children])
        {
            if(Math.hypot(child.position.x - CAMP_CENTER.x * MAP_SCALE, child.position.z - CAMP_CENTER.z * MAP_SCALE) < 7)
                references.remove(child)
        }
    }

    constructor()
    {
        this.game = Game.getInstance()

        this.raycaster = new THREE.Raycaster()
        this.down = new THREE.Vector3(0, -1, 0)
        this.origin = new THREE.Vector3()
        this.terrainPick = new THREE.Mesh(
            this.game.resources.terrainModel.scene.children[0].geometry,
            new THREE.MeshBasicMaterial()
        )
        this.terrainPick.updateMatrixWorld(true)

        this.addTrees()
        for(const item of PROPS)
            this.addProp(item)

        this.campCenter = new THREE.Vector3(CAMP_CENTER.x * MAP_SCALE, 0, CAMP_CENTER.z * MAP_SCALE)
    }

    groundHeight(x, z)
    {
        this.origin.set(x, 100, z)
        this.raycaster.set(this.origin, this.down)
        const hit = this.raycaster.intersectObject(this.terrainPick, false)[0]
        return hit ? hit.point.y : 0
    }

    addTrees()
    {
        const groups = { birch: [], oak: [], cherry: [] }

        for(const item of TREES)
        {
            const x = (item.position[0] + (item.camp ? CAMP_OFFSET.x : 0)) * MAP_SCALE
            const z = (item.position[2] + (item.camp ? CAMP_OFFSET.z : 0)) * MAP_SCALE
            const y = item.camp ? this.groundHeight(x, z) : item.position[1]

            const reference = new THREE.Object3D()
            reference.position.set(x, y, z)
            reference.rotation.set(0, 0, 0)
            reference.scale.fromArray(item.scale)
            reference.updateMatrix()
            reference.updateMatrixWorld(true)

            groups[item.species].push(reference)
        }

        this.trees = []
        for(const species of ['birch', 'oak', 'cherry'])
        {
            if(!groups[species].length)
                continue

            const definition = TREE_DEFINITIONS[species]
            this.trees.push(new Trees(
                definition.name,
                this.game.resources[definition.visual].scene,
                groups[species],
                definition.colorA,
                definition.colorB
            ))
        }
    }

    addProp(item)
    {
        const x = item.position[0] * MAP_SCALE
        const y = item.position[1]
        const z = item.position[2] * MAP_SCALE

        const root = this.createVisual(item.resource)
        const bounds = new THREE.Box3().setFromObject(root)
        const size = bounds.getSize(new THREE.Vector3())
        const half = new THREE.Vector3(size.x * 0.5, size.y * 0.5, size.z * 0.5)

        root.position.set(x, y, z)

        this.game.objects.add(
            {
                model: root,
                updateMaterials: true,
                castShadow: true,
                receiveShadow: true
            },
            {
                type: 'fixed',
                position: { x, y, z },
                rotation: new THREE.Quaternion(),
                colliders: [ {
                    shape: 'cuboid',
                    parameters: [ half.x, half.y, half.z ],
                    position: { x: 0, y: half.y, z: 0 },
                    friction: 0.8,
                    category: 'object'
                } ]
            }
        )
    }

    createVisual(resourceKey)
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

        return root
    }
}
