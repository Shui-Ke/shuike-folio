import * as THREE from 'three/webgpu'
import { color } from 'three/tsl'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

const centerX = 44
const deckY = 2.4
const startZ = 64
const endZ = startZ + 64

export class VermilionCrossing
{
    constructor(game)
    {
        this.game = game
        this.materials = new Map()
        this.colliders = []
        this.addBridge()
        this.addApproach(43, startZ, 0.025, deckY)
        this.addApproach(endZ, 148, deckY, 0.945)
        this.addIsland()
        this.plantBanks()
        game.objects.add(null, {
            type: 'fixed', friction: 0.6, restitution: 0,
            colliders: this.colliders
        })
    }

    material(value)
    {
        const key = new THREE.Color(value).getHex()
        if(!this.materials.has(key))
            this.materials.set(key, new MeshDefaultMaterial({ colorNode: color(key) }))
        return this.materials.get(key)
    }

    surface(vertices, indices, tint, solid = false)
    {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(geometry, this.material(tint))
        mesh.receiveShadow = true
        this.game.scene.add(mesh)
        if(solid) this.addMeshCollider(mesh, 'floor')
    }

    addMeshCollider(mesh, category)
    {
        mesh.updateWorldMatrix(true, false)
        const points = mesh.geometry.getAttribute('position').clone().applyMatrix4(mesh.matrixWorld)
        const indices = mesh.geometry.index?.array ?? Uint32Array.from({ length: points.count }, (_, i) => i)
        this.colliders.push({ shape: 'trimesh', parameters: [points.array, new Uint32Array(indices)], category })
    }

    box(x, y, z, halfWidth, halfHeight, halfLength, category)
    {
        this.colliders.push({ shape: 'cuboid', parameters: [halfWidth, halfHeight, halfLength], position: { x, y, z }, category })
    }

    addBridge()
    {
        const model = this.game.resources.vermilionBridge.scene
        const middleZ = (startZ + endZ) / 2
        model.position.set(centerX, deckY, middleZ)
        model.rotation.y = -Math.PI / 2
        this.game.scene.add(model)
        model.traverse(mesh => {
            if(!mesh.isMesh) return
            mesh.material = this.material(mesh.material.color)
            mesh.castShadow = mesh.receiveShadow = true
            // Exact triangles preserve the open space between arches, lamps and upper braces.
            if(!/^Deck/.test(mesh.parent.name) && !/^Deck/.test(mesh.name))
                this.addMeshCollider(mesh, 'object')
        })
        this.box(centerX, deckY - 0.45, middleZ, 4.3, 0.45, 32, 'floor')
        for(const side of [-1, 1])
            this.box(centerX + side * 3.85, deckY + 0.52, middleZ, 0.19, 0.52, 32, 'object')
    }

    addApproach(from, to, firstY, lastY)
    {
        const vertices = [], indices = [], marks = [], markIndices = []
        const steps = 12
        for(let i = 0; i <= steps; i++)
        {
            const t = i / steps
            const z = THREE.MathUtils.lerp(from, to, t)
            const y = THREE.MathUtils.lerp(firstY, lastY, t * t * (3 - 2 * t))
            vertices.push(centerX - 3.7, y, z, centerX + 3.7, y, z)
            const j = i * 2
            if(i < steps) indices.push(j, j+2, j+1, j+1, j+2, j+3)
            marks.push(centerX - 0.07, y + 0.012, z, centerX + 0.07, y + 0.012, z)
            if(i < steps && i % 2 === 0) markIndices.push(j, j+2, j+1, j+1, j+2, j+3)
        }
        this.surface(vertices, indices, 0x575a5e, true)
        this.surface(marks, markIndices, 0xebd1a3)
        // Earth shoulders share the exact paved edge at every ramp station.
        for(const side of [-1, 1])
        {
            const edge = [], faces = []
            for(let i = 0; i <= steps; i++)
            {
                const y = vertices[i*6+1], z = vertices[i*6+2]
                edge.push(centerX + side*3.7, y, z, centerX + side*(6 + y), -1.53, z)
                const j = i*2
                if(i < steps) faces.push(...(side > 0 ? [j,j+2,j+1,j+1,j+2,j+3] : [j,j+1,j+2,j+1,j+3,j+2]))
            }
            this.surface(edge, faces, 0xb39870, true)
        }
    }

    addIsland()
    {
        const count = 16, middleZ = 153, vertices = [], indices = []
        for(const [scale, y] of [[1, 0.92], [1.1, 0.2], [1.18, -1.8]])
        {
            for(let i = 0; i < count; i++)
            {
                const a = 2 * Math.PI * i / count
                const radius = scale * (1 + 0.05 * Math.sin(3*a))
                vertices.push(centerX + 15*radius*Math.cos(a), y, middleZ + 21*radius*Math.sin(a))
            }
        }
        for(let i = 1; i < count - 1; i++) indices.push(0,i+1,i)
        this.surface(vertices, indices, 0xb4b536, true)
        for(let ring = 0; ring < 2; ring++)
        {
            const faces = []
            for(let i = 0; i < count; i++)
            {
                const a = ring*count+i, b = ring*count+(i+1)%count
                faces.push(a,b,b+count, a,b+count,a+count)
            }
            this.surface(vertices, faces, ring ? 0xad8069 : 0xebc49a, true)
        }
    }

    plantBanks()
    {
        const resources = this.game.resources
        const birches = resources.birchTreesReferencesModel.scene
        // Move the original shore birch to the side of the new entrance.
        for(const tree of birches.children)
        {
            if(Math.abs(tree.position.x-centerX)<4 && tree.position.z>43 && tree.position.z<64)
                tree.position.x = centerX - 7
        }
        birches.updateMatrixWorld(true)
        for(const source of [resources.bushesReferences.scene, resources.flowersReferencesModel.scene])
            for(const item of [...source.children])
                if(Math.abs(item.position.x-centerX)<4.5 && item.position.z>=43 && item.position.z<=128)
                    source.remove(item)
        const oaks = resources.oakTreesReferencesModel.scene
        for(const [dx,dz,scale] of [[-8,0,.72],[9,3,.62],[5,12,.8],[-6,11,.5]])
        {
            const tree = new THREE.Object3D()
            tree.position.set(centerX+dx, 0.92, 153+dz)
            tree.scale.setScalar(scale)
            oaks.add(tree)
        }
        oaks.updateMatrixWorld(true)
    }
}
