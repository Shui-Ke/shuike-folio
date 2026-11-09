import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { Player } from './Player.js'

export class VehicleDamage
{
    constructor()
    {
        this.game = Game.getInstance()
        this.records = new Map()
        this.point = new THREE.Vector3()
        this.hint = document.createElement('div')
        this.hint.className = 'vehicle-damage-hint'
        this.hint.hidden = true
        this.hint.setAttribute('role', 'status')
        this.hint.innerHTML = '<strong>车辆损坏</strong><span>车身已完全没入水中</span><button type="button">按 R 复活</button>'
        this.hint.querySelector('button').addEventListener('click', () =>
        {
            if(this.game.physicalVehicle.destroyed && !this.game.escMenu?.isOpen) this.game.player.respawn()
        })
        this.game.domElement.append(this.hint)
        this.game.ticker.events.on('tick', () => this.update(), 6)
    }

    register(vehicle, visual, isPlayer = false)
    {
        visual.parts.chassis.updateWorldMatrix(true, true)
        const painted = visual.parts.bodyPainted
        painted.geometry.computeBoundingBox()
        const transform = new THREE.Matrix4().copy(visual.parts.chassis.matrixWorld).invert().multiply(painted.matrixWorld)
        const bounds = painted.geometry.boundingBox.clone().applyMatrix4(transform)
        // Main body only: exclude the antenna. All corners must be submerged,
        // including the highest corner while tilted or upside down.
        const bodyPoints = []
        for(const x of [bounds.min.x, bounds.max.x])
            for(const y of [bounds.min.y, bounds.max.y])
                for(const z of [bounds.min.z, bounds.max.z]) bodyPoints.push(new THREE.Vector3(x, y, z))
        const record = { vehicle, visual, isPlayer, bodyPoints, debris: [], destroyedCount: 0 }
        this.records.set(vehicle, record)
        vehicle.chassis.physical.autoReset = false
        vehicle.chassis.physical.body.userData.vehicle = vehicle
        return record
    }

    highestBodyPoint(record)
    {
        const body = record.vehicle.chassis.physical.body
        const rotation = body.rotation(), position = body.translation()
        let highest = -Infinity
        for(const point of record.bodyPoints)
            highest = Math.max(highest, this.point.copy(point).applyQuaternion(rotation).add(position).y)
        return highest
    }

    destroy(vehicle, reason = 'submerged')
    {
        const record = this.records.get(vehicle)
        if(!record || vehicle.destroyed) return false
        const { visual } = record
        // Synchronize to the actual impact pose, not the previous rendered frame.
        visual.update()
        visual.parts.chassis.updateWorldMatrix(true, true)
        if(visual.antenna) visual.antenna.head.updateWorldMatrix(true, true)
        const position = new THREE.Vector3().copy(vehicle.chassis.physical.body.translation())
        const velocity = { ...vehicle.chassis.physical.body.linvel() }
        this.clearDebris(record)
        this.scatterBody(record, position, velocity)
        vehicle.destroyed = true
        this.game.world.items?.clearEffects(vehicle)
        if(vehicle.launch) vehicle.launch.active = false
        vehicle.deactivate()
        vehicle.speed = vehicle.xzSpeed = vehicle.forwardSpeed = 0
        vehicle.velocity.set(0, 0, 0)
        vehicle.wheels.justTouchedCount = 0
        Object.assign(vehicle.controls, { accelerating: 0, steering: 0, boosting: 0, braking: 0 })
        visual.setDestroyed(true)
        record.destroyedCount++
        record.reason = reason

        // Lift the blast to the waterline so the crate effect remains readable.
        const blast = position.clone()
        if(reason === 'submerged') blast.y = Math.max(blast.y, this.game.water.surfaceElevationUniform.value + 0.2)
        this.game.world.fireballs.create(blast, 5, 5, { groundAttenuation: false, strength: 0 })
        const sounds = this.game.world.explosiveCrates?.sounds.explosions
        if(sounds?.length) sounds[Math.floor(Math.random() * sounds.length)].play(blast)

        if(record.isPlayer)
        {
            this.game.player.state = Player.STATE_DESTROYED
            this.game.player.unstuck.delay?.kill()
            this.game.player.unstuck.delay = null
            this.game.inputs.interactiveButtons.removeItems(['unstuck'])
            this.hint.hidden = false
        }
        return true
    }

    scatterBody(record, origin, velocity)
    {
        const painted = record.visual.parts.bodyPainted
        const geometry = painted.geometry.index ? painted.geometry.toNonIndexed() : painted.geometry.clone()
        geometry.computeBoundingBox()
        const bounds = geometry.boundingBox
        const width = Math.max(0.001, bounds.max.x - bounds.min.x)
        const middleZ = (bounds.min.z + bounds.max.z) / 2
        const groups = Array.from({ length: 6 }, () => [])
        const positions = geometry.attributes.position
        // Split the real painted shell into front/middle/rear, left/right pieces.
        // Keep UVs and normals so each shard retains its original car paint.
        for(let i = 0; i < positions.count; i += 3)
        {
            const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3
            const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3
            const section = Math.min(2, Math.floor((x - bounds.min.x) / width * 3))
            groups[section * 2 + (z > middleZ ? 1 : 0)].push(i, i + 1, i + 2)
        }
        for(const vertices of groups)
        {
            if(!vertices.length) continue
            const fragment = new THREE.BufferGeometry()
            for(const [name, attribute] of Object.entries(geometry.attributes))
            {
                const array = new Float32Array(vertices.length * attribute.itemSize)
                vertices.forEach((vertex, index) =>
                {
                    for(let component = 0; component < attribute.itemSize; component++)
                        array[index * attribute.itemSize + component] = attribute.getComponent(vertex, component)
                })
                fragment.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize))
            }
            fragment.computeBoundingBox()
            const center = fragment.boundingBox.getCenter(new THREE.Vector3())
            fragment.translate(-center.x, -center.y, -center.z)
            const mesh = new THREE.Mesh(fragment, painted.material)
            const worldPosition = center.applyMatrix4(painted.matrixWorld)
            const worldRotation = painted.getWorldQuaternion(new THREE.Quaternion())
            const worldScale = painted.getWorldScale(new THREE.Vector3())
            this.addDebris(record, mesh, worldPosition, worldRotation, worldScale, origin, velocity, true)
        }
        geometry.dispose()

        const parts = record.visual.wheels.items.map(wheel => wheel.container)
        if(record.visual.parts.chassis.isMesh) parts.push(record.visual.parts.chassis)
        if(record.visual.antenna) parts.push(record.visual.antenna.head)
        for(const source of parts)
        {
            const mesh = source.clone(source !== record.visual.parts.chassis)
            this.addDebris(record, mesh, source.getWorldPosition(new THREE.Vector3()), source.getWorldQuaternion(new THREE.Quaternion()), source.getWorldScale(new THREE.Vector3()), origin, velocity, false)
        }
    }

    addDebris(record, mesh, position, rotation, scale, origin, inheritedVelocity, ownsGeometry)
    {
        mesh.position.set(0, 0, 0)
        mesh.quaternion.identity()
        mesh.scale.copy(scale)
        mesh.visible = true
        mesh.updateWorldMatrix(true, true)
        const bounds = new THREE.Box3().setFromObject(mesh)
        const center = bounds.getCenter(new THREE.Vector3())
        const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.42)
        mesh.name = 'vehicle-wreck-piece'
        mesh.position.copy(position)
        mesh.quaternion.copy(rotation)
        mesh.traverse(child => { if(child.isMesh) { child.castShadow = true; child.receiveShadow = true } })
        this.game.scene.add(mesh)
        const R = this.game.RAPIER
        const body = this.game.physics.world.createRigidBody(R.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z).setRotation(rotation)
            .setLinearDamping(0.3).setAngularDamping(0.4).setGravityScale(0.8).setCcdEnabled(true))
        this.game.physics.world.createCollider(R.ColliderDesc.cuboid(Math.max(0.06, half.x), Math.max(0.06, half.y), Math.max(0.06, half.z))
            .setTranslation(center.x, center.y, center.z).setMass(0.08).setFriction(0.6).setRestitution(0.35)
            .setCollisionGroups(this.game.physics.categories.object), body)
        const angle = record.debris.length * 2.39996
        const direction = position.clone().sub(origin).setY(0)
        if(direction.lengthSq() < 0.1) direction.set(Math.cos(angle), 0, Math.sin(angle))
        direction.normalize().multiplyScalar(4 + Math.random() * 4)
        body.setLinvel({ x: direction.x + inheritedVelocity.x * 0.25, y: 8 + Math.random() * 4, z: direction.z + inheritedVelocity.z * 0.25 }, true)
        body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }, true)
        record.debris.push({ mesh, body, scale: scale.clone(), age: 0, ownsGeometry })
    }

    removePiece(piece)
    {
        this.game.physics.world.removeRigidBody(piece.body)
        piece.mesh.removeFromParent()
        if(piece.ownsGeometry) piece.mesh.geometry.dispose()
    }

    clearDebris(record)
    {
        for(const piece of record.debris) this.removePiece(piece)
        record.debris.length = 0
    }

    revive(vehicle)
    {
        const record = this.records.get(vehicle)
        if(!record) return
        this.clearDebris(record)
        vehicle.destroyed = false
        vehicle.upgrades.reset()
        this.game.world.items?.reset(vehicle)
        record.visual.setDestroyed(false)
        vehicle.activate()
        record.visual.update()
        if(record.isPlayer) this.hint.hidden = true
    }

    update()
    {
        if(this.game.editorPaused) return
        for(const record of this.records.values())
        {
            const vehicle = record.vehicle
            if(!vehicle.destroyed && vehicle.chassis.physical.body.isEnabled() && !(record.isPlayer && this.game.player.respawning))
            {
                if(this.highestBodyPoint(record) < this.game.water.surfaceElevationUniform.value)
                    this.destroy(vehicle)
            }
            if(vehicle.destroyed && record.isPlayer && !this.game.player.respawning && !this.game.escMenu?.isOpen)
                this.game.player.state = Player.STATE_DESTROYED
            for(let i = record.debris.length - 1; i >= 0; i--)
            {
                const piece = record.debris[i]
                piece.age += this.game.ticker.delta
                if(piece.age > 5)
                {
                    this.removePiece(piece)
                    record.debris.splice(i, 1)
                    continue
                }
                piece.mesh.position.copy(piece.body.translation())
                piece.mesh.quaternion.copy(piece.body.rotation())
                piece.mesh.scale.copy(piece.scale).multiplyScalar(Math.min(1, (5 - piece.age) / 1.5))
            }
        }
    }
}
