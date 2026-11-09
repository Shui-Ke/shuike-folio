import * as THREE from 'three/webgpu'
import { attribute, color } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

// Small, faceted 3D smoke puffs, sharing geometry and one instanced draw.
// The bounded pool keeps several simultaneous missiles inexpensive.
export class MissileSmoke
{
    constructor()
    {
        this.game = Game.getInstance()
        this.capacity = 768
        this.particles = new Array(this.capacity)
        this.cursor = 0
        this.activeCount = 0
        this.geometry = new THREE.IcosahedronGeometry(1, 0)
        this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage)
        this.geometry.setAttribute('smokeOpacity', this.opacity)
        this.material = new MeshDefaultMaterial({
            colorNode: color('#25262b'), alphaNode: attribute('smokeOpacity', 'float'),
            transparent: true, depthWrite: false, alphaTest: 0.003,
            hasLightBounce: false, hasDropShadows: false,
        })
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity)
        this.mesh.name = 'missile-black-smoke'
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.count = 0
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 2
        this.mesh.visible = false
        this.transform = new THREE.Object3D()
        this.game.scene.add(this.mesh)
    }

    emit(missile, dt)
    {
        const tail = new THREE.Vector3()
        if(missile.exhaust) missile.exhaust.getWorldPosition(tail)
        else tail.copy(missile.position).addScaledVector(missile.direction, -0.72)
        const previous = missile.smokePosition ?? tail
        const distance = previous.distanceTo(tail)
        missile.smokeElapsed = (missile.smokeElapsed ?? 0) + dt
        // Fill the travelled segment so faster missiles don't leave dotted gaps.
        const count = Math.min(12, Math.max(Math.floor(distance / 0.32), missile.smokeElapsed >= 0.05 ? 1 : 0))
        if(!count) return
        for(let i = 1; i <= count; i++) {
            const index = this.cursor
            this.cursor = (index + 1) % this.capacity
            this.particles[index] = {
                position: previous.clone().lerp(tail, i / count), age: 0,
                lifetime: 0.95 + Math.random() * 0.35,
                drift: missile.direction.clone().multiplyScalar(-0.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.4, (Math.random() - 0.5) * 0.3)),
                rotation: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
                size: 0.85 + Math.random() * 0.3,
            }
            this.mesh.count = Math.max(this.mesh.count, index + 1)
        }
        missile.smokePosition = tail.clone()
        missile.smokeElapsed = 0
    }

    update(dt)
    {
        this.activeCount = 0
        for(let i = 0; i < this.mesh.count; i++) {
            const particle = this.particles[i]
            if(!particle) continue
            particle.age += dt
            const progress = particle.age / particle.lifetime
            if(progress >= 1) {
                this.particles[i] = null
                this.opacity.setX(i, 0)
                this.transform.scale.setScalar(0)
            }
            else {
                this.activeCount++
                particle.position.addScaledVector(particle.drift, dt)
                this.transform.position.copy(particle.position)
                this.transform.rotation.copy(particle.rotation)
                this.transform.scale.setScalar((0.16 + progress * 0.5) * particle.size)
                this.opacity.setX(i, 0.78 * Math.pow(1 - progress, 1.3))
            }
            this.transform.updateMatrix()
            this.mesh.setMatrixAt(i, this.transform.matrix)
        }
        this.mesh.visible = this.activeCount > 0
        this.opacity.needsUpdate = this.mesh.instanceMatrix.needsUpdate = true
    }
}
