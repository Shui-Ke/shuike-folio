import * as THREE from 'three/webgpu'
import { color } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * 黄沙废土地形测试层。
 *
 * 现在是一个 80 × 80 的程序化沙地 + 一个碰撞箱。
 * 等你把 `static/wasteland/wasteland.glb` 放进来并注册资源后，
 * 在 setWorldModel() 里把视觉/碰撞模型接上即可。
 */
export class WastelandWorld
{
    constructor()
    {
        this.game = Game.getInstance()

        const spawn = this.game.respawns?.getDefault?.()?.position
        this.center = spawn ? new THREE.Vector3(spawn.x, 0, spawn.z) : new THREE.Vector3()

        this.hasWorldModel = !!this.game.resources.wastelandModel?.scene

        // 没有注册 wasteland.glb 时，使用程序化测试地面和碰撞箱。
        if(!this.hasWorldModel)
        {
            this.setGround()
            this.setTestBox()
        }

        this.setWorldModel()
    }

    setGround()
    {
        const size = 80
        const segments = 48

        const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
        geometry.rotateX(-Math.PI / 2)

        const position = geometry.attributes.position
        const vertex = new THREE.Vector3()

        for(let i = 0; i < position.count; i++)
        {
            vertex.fromBufferAttribute(position, i)
            const distance = Math.hypot(vertex.x, vertex.z)
            const edge = THREE.MathUtils.smoothstep(distance, 6, 26)

            const dune =
                Math.sin(vertex.x * 0.16) * 0.45 +
                Math.cos(vertex.z * 0.13) * 0.35 +
                Math.sin((vertex.x + vertex.z) * 0.07) * 0.55

            position.setY(i, dune * edge)
        }

        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()

        const material = new MeshDefaultMaterial({
            colorNode: color('#c9a46a'),
            hasLightBounce: false,
            hasWater: false
        })
        material.flatShading = true

        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'wasteland-test-ground'
        mesh.position.copy(this.center)
        mesh.receiveShadow = true
        mesh.castShadow = false
        this.game.scene.add(mesh)

        this.ground = mesh

        const index = geometry.index
        this.game.objects.add(
            null,
            {
                type: 'fixed',
                position: mesh.position,
                friction: 0.9,
                restitution: 0,
                colliders: [
                    {
                        shape: 'trimesh',
                        parameters: [ position.array, index.array ],
                        category: 'floor'
                    }
                ]
            }
        )
    }

    setTestBox()
    {
        const geometry = new THREE.BoxGeometry(2, 2, 2)
        const material = new MeshDefaultMaterial({
            colorNode: color('#9d5734'),
            hasLightBounce: false,
            hasWater: false
        })
        material.flatShading = true

        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'wasteland-test-box'
        mesh.position.set(this.center.x + 6, 1, this.center.z)
        mesh.castShadow = true
        mesh.receiveShadow = true

        this.game.objects.add(
            mesh,
            {
                type: 'fixed',
                position: mesh.position,
                rotation: mesh.quaternion,
                friction: 0.8,
                restitution: 0.1,
                colliders: [
                    {
                        shape: 'cuboid',
                        parameters: [ 1, 1, 1 ]
                    }
                ]
            }
        )
    }

    setWorldModel()
    {
        // 可选：等你把 wasteland.glb 注册为 wastelandModel 后自动接入。
        const root = this.game.resources.wastelandModel?.scene
        if(!root)
            return

        const visual = root.getObjectByName('wastelandVisual')
        const physical = root.getObjectByName('wastelandPhysical')

        if(visual)
            this.game.objects.addFromModel(visual)

        if(physical)
            this.game.objects.addFromModel(physical)
    }
}
