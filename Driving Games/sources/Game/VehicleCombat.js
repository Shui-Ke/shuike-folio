import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { speedWhiteValue } from './VehicleUpgrades.js'
import { attribute } from 'three/tsl'

export class VehicleCombat
{
    constructor()
    {
        this.game = Game.getInstance()
        this.before = new Map()
        this.touching = new Set()
        this.cooldowns = new Map()
        this.clock = 0
        this.hitCount = 0
        this.effectCount = 0
        this.effectCooldown = 0
        this.impactThreshold = 4
        this.maxImpactStrength = 30
        this.flights = []
        this.framing = { blend: 0, focus: new THREE.Vector3(), distance: 0 }
        this.game.ticker.events.on('tick', () => this.updateFlights(), 6)
    }

    isRunning()
    {
        return !this.game.editorPaused && !this.game.escMenu?.isOpen && this.game.player.state === 1 && this.game.reveal.step === 2
    }

    beforeStep()
    {
        this.before.clear()
        if(!this.isRunning()) { this.touching.clear(); return }
        this.clock += this.game.ticker.deltaScaled
        for(const { vehicle } of this.game.world.vehicleDamage.records.values())
        {
            const body = vehicle.chassis.physical.body
            if(vehicle.destroyed || !body.isEnabled()) continue
            const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(body.rotation()).setY(0).normalize()
            this.before.set(vehicle, { position: new THREE.Vector3().copy(body.translation()), velocity: new THREE.Vector3().copy(body.linvel()), forward })
        }
    }

    afterStep()
    {
        const vehicles = [...this.before.keys()]
        const touching = new Set()
        for(let i = 0; i < vehicles.length; i++)
        for(let j = i + 1; j < vehicles.length; j++)
        {
            const a = vehicles[i], b = vehicles[j]
            const key = [a.chassis.physical.body.handle, b.chassis.physical.body.handle].sort((a, b) => a - b).join(':')
            const points = []
            const colliders = vehicle => {
                const shield = this.game.world.items?.state(vehicle).shield?.collider
                return shield ? [...vehicle.chassis.physical.colliders, shield] : vehicle.chassis.physical.colliders
            }
            for(const ca of colliders(a))
            for(const cb of colliders(b))
                this.game.physics.world.contactPair(ca, cb, manifold =>
                {
                    for(let k = 0; k < manifold.numSolverContacts(); k++) points.push(manifold.solverContactPoint(k))
                })
            if(!points.length) continue
            touching.add(key)
            if(this.touching.has(key) || this.clock < (this.cooldowns.get(key) ?? 0)) continue
            // Decide both directions from the same pre-solver snapshot.
            const hits = [this.assessHit(a, b, points), this.assessHit(b, a, points)].filter(Boolean)
            for(const hit of hits) this.applyHit(hit)
            if(hits.length) this.cooldowns.set(key, this.clock + 0.6)
        }
        this.touching = touching
    }

    assessHit(attacker, target, points)
    {
        const a = this.before.get(attacker), b = this.before.get(target)
        const toward = b.position.clone().sub(a.position).setY(0).normalize()
        const forwardSpeed = a.velocity.dot(a.forward)
        const direction = a.forward.clone().multiplyScalar(forwardSpeed < 0 ? -1 : 1)
        const impactSpeed = Math.abs(forwardSpeed)
        const closingSpeed = a.velocity.clone().sub(b.velocity).dot(toward)
        if(attacker.launch?.active || impactSpeed < 0.8 || closingSpeed < 0.7 || direction.dot(toward) < 0.55) return null
        const point = points.find(point => new THREE.Vector3().copy(point).sub(a.position).dot(direction) > 0.8)
        if(!point) return null
        const speed = speedWhiteValue(impactSpeed, attacker.upgrades.speedMultiplier, attacker.drivingSpeedRange.normal, attacker.drivingSpeedRange.boost)
        const power = attacker.upgrades.powerMultiplier
        return { attacker, target, point: new THREE.Vector3().copy(point), direction, end: forwardSpeed < 0 ? 'rear' : 'front', power, speed,
            strength: power * speed, bonusSpeed: (power - 1) * speed * 0.9,
            heavyImpact: power * speed >= this.impactThreshold }
    }

    applyHit(hit)
    {
        if(this.game.world.items?.absorb(hit.target, `car:${hit.attacker.chassis.physical.body.handle}`)) return
        const body = hit.target.chassis.physical.body
        // Rapier supplies the existing weak base collision. Add only the POWER
        // bonus, once per impact, so Lv0 keeps the original driving/contact feel.
        if(hit.heavyImpact)
        {
            this.launch(hit)
            this.playImpact(hit.point)
        }
        else if(hit.bonusSpeed > 0)
        {
            const impulse = hit.direction.clone().multiplyScalar(hit.bonusSpeed * body.mass())
            impulse.y = hit.bonusSpeed * body.mass() * 0.035
            body.applyImpulse(impulse, true)
        }
        this.hitCount++
        this.lastHit = hit
    }

    launch(hit)
    {
        const { target, attacker } = hit
        const body = target.chassis.physical.body
        // Full POWER at base boost reaches the existing maximum trajectory.
        const ratio = THREE.MathUtils.clamp(hit.strength / this.maxImpactStrength, 0, 1)
        const range = 50 * ratio
        const height = Math.max(3, 12 * ratio)
        const gravity = Math.abs(this.game.physics.world.gravity.y)
        const upSpeed = Math.sqrt(2 * gravity * height)
        const duration = 2 * upSpeed / gravity
        const velocity = hit.direction.clone().multiplyScalar(range / duration)
        velocity.y = upSpeed
        body.setLinvel(velocity, true)
        body.setAngvel({ x: hit.direction.z * 1.5, y: 0.35, z: -hit.direction.x * 1.5 }, true)
        target.launch = { active: true, elapsed: 0, duration, range, height, origin: new THREE.Vector3().copy(body.translation()) }
        target.jumpState.airborne = true
        target.jumpState.used = 1
        const capacity = 240
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('trailFade', new THREE.BufferAttribute(new Float32Array(capacity * 2), 1).setUsage(THREE.DynamicDrawUsage))
        const indices = []
        for(let i = 0; i < capacity - 1; i++) indices.push(i*2, i*2+1, i*2+2, i*2+1, i*2+3, i*2+2)
        geometry.setIndex(indices)
        geometry.setDrawRange(0, 0)
        const material = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide })
        material.opacityNode = attribute('trailFade', 'float')
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'heavy-impact-arc'
        mesh.frustumCulled = false
        mesh.renderOrder = 3
        this.game.scene.add(mesh)
        const flight = { target, attacker, launch: target.launch, mesh, points: [target.launch.origin.clone()], side: new THREE.Vector3(-hit.direction.z, 0, hit.direction.x), fade: 1, lastSample: -1 }
        this.flights.push(flight)
        const screen = hit.point.clone().project(this.game.view.camera)
        if(attacker === this.game.physicalVehicle || target === this.game.physicalVehicle || (Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z < 1)) this.shot = flight
        hit.launchRange = range
    }

    updateFlights()
    {
        if(this.game.editorPaused || this.game.escMenu?.isOpen) return
        const dt = this.game.ticker.delta
        for(let i = this.flights.length - 1; i >= 0; i--)
        {
            const flight = this.flights[i], state = flight.launch
            const body = flight.target.chassis.physical.body
            if(flight.target.destroyed || flight.target.launch !== state) state.active = false
            if(state.active && state.elapsed - flight.lastSample >= 0.025)
            {
                flight.lastSample = state.elapsed
                flight.points.push(new THREE.Vector3().copy(body.translation()))
                if(flight.points.length > 240) flight.points.shift()
            }
            if(!state.active) flight.fade -= dt * 1.3
            if(flight.fade <= 0)
            {
                flight.mesh.removeFromParent(); flight.mesh.geometry.dispose(); flight.mesh.material.dispose()
                this.flights.splice(i, 1)
                continue
            }
            const position = flight.mesh.geometry.attributes.position, opacity = flight.mesh.geometry.attributes.trailFade
            flight.points.forEach((point, index) =>
            {
                const ratio = index / Math.max(1, flight.points.length - 1)
                const width = 0.12 + ratio * 0.12
                const left = point.clone().addScaledVector(flight.side, -width), right = point.clone().addScaledVector(flight.side, width)
                position.setXYZ(index * 2, left.x, left.y, left.z)
                position.setXYZ(index * 2 + 1, right.x, right.y, right.z)
                opacity.setX(index * 2, (0.22 + ratio * 0.65) * flight.fade)
                opacity.setX(index * 2 + 1, (0.22 + ratio * 0.65) * flight.fade)
            })
            position.needsUpdate = opacity.needsUpdate = true
            flight.mesh.geometry.setDrawRange(0, Math.max(0, flight.points.length - 1) * 6)
        }
        const framing = this.framing
        const active = this.shot && (this.shot.launch.active || this.shot.fade > 0)
        framing.blend = THREE.MathUtils.lerp(framing.blend, active ? 1 : 0, Math.min(1, dt * (active ? 8 : 4)))
        if(active)
        {
            const from = this.shot.attacker.position, to = this.shot.target.position
            framing.focus.copy(from).lerp(to, 0.5)
            framing.distance = from.distanceTo(to)
        }
        if(!active && framing.blend < 0.001) { framing.blend = 0; this.shot = null }
    }

    playImpact(point)
    {
        const screen = point.clone().project(this.game.view.camera)
        if(Math.abs(screen.x) > 1.1 || Math.abs(screen.y) > 1.1 || screen.z > 1 || screen.z < -1 || performance.now() < this.effectCooldown) return
        this.effectCooldown = performance.now() + 900
        this.effectCount++
        this.game.time.impact(0.34)
        this.game.world.fireballs.create(point, 3.5, 0, { groundAttenuation: false, strength: 0 })
    }
}
