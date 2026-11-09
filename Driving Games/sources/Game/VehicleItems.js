import * as THREE from 'three/webgpu'
import { Fn, uv, float } from 'three/tsl'
import { Game } from './Game.js'
import { ITEM_TYPES } from './ItemDefinitions.js'

export class VehicleItems
{
    constructor()
    {
        this.game = Game.getInstance()
        this.states = new Map()
        this.entities = []
        this.pulses = []
        this.serial = 0
        this.clock = 0
        this.selected = 0
        this.before = new Map()
        this.blocked = new Set()
        this.setupHud()
        this.game.ticker.events.on('tick', () => this.update(), 7)
    }

    state(vehicle)
    {
        if(!this.states.has(vehicle)) this.states.set(vehicle, {
            counts: Object.fromEntries(ITEM_TYPES.map(item => [item.type, 3])),
            slowUntil: 0, shield: null, jet: null, nextUse: 0, nextAI: this.clock + 6,
            blockedContacts: new Set(), recentHits: new Map(),
        })
        return this.states.get(vehicle)
    }

    running()
    {
        return this.game.reveal.step === 2 && this.game.player.state === 1 && !this.game.editorPaused && !this.game.escMenu?.isOpen
    }

    alive(vehicle)
    {
        return !vehicle.destroyed && vehicle.chassis.physical.body.isEnabled()
    }

    vehicles() { return [...this.game.world.vehicleDamage.records.keys()].filter(vehicle => this.alive(vehicle)) }
    canCollect(vehicle, type) { return (this.state(vehicle).counts[type] ?? 99) < 9 }
    collect(vehicle, type)
    {
        if(!this.canCollect(vehicle, type)) return false
        this.state(vehicle).counts[type]++
        return true
    }
    speedFactor(vehicle) { return this.state(vehicle).slowUntil > this.clock ? 0.5 : 1 }

    setupHud()
    {
        this.hud = document.createElement('div')
        this.hud.className = 'item-hud'
        this.hud.setAttribute('aria-label', '道具栏')
        this.hud.innerHTML = `<div class="item-status" role="status"></div><div class="item-slots">${ITEM_TYPES.map((item, index) => `<button type="button" data-item="${item.type}" style="--item-color:${item.color}" aria-label="使用${item.title}"><svg viewBox="0 0 64 64" aria-hidden="true">${item.icon}</svg><span>${item.title}</span><b data-count>3</b></button>`).join('')}</div><div class="item-controls"><span class="item-keyboard">← → 切换 · E 使用</span><span class="item-touch">点击道具使用</span></div>`
        this.game.domElement.append(this.hud)
        this.buttons = [...this.hud.querySelectorAll('button')]
        this.buttons.forEach((button, index) => button.addEventListener('click', event => {
            event.stopPropagation()
            if(!this.running()) return
            this.selected = index
            this.use(this.game.physicalVehicle, ITEM_TYPES[index].type)
            button.blur()
            this.updateHud()
        }))
        this.game.inputs.addActions([
            { name: 'useItem', categories: ['wandering', 'racing'], keys: ['Keyboard.KeyE'] },
            { name: 'previousItem', categories: ['wandering', 'racing'], keys: ['Keyboard.ArrowLeft'] },
            { name: 'nextItem', categories: ['wandering', 'racing'], keys: ['Keyboard.ArrowRight'] },
        ])
        this.game.inputs.events.on('useItem', action => { if(action.active) this.use(this.game.physicalVehicle, ITEM_TYPES[this.selected].type) })
        for(const [name, step] of [['previousItem', -1], ['nextItem', 1]])
            this.game.inputs.events.on(name, action => {
                if(action.active && this.running()) { this.selected = (this.selected + step + ITEM_TYPES.length) % ITEM_TYPES.length; this.updateHud() }
            })
        window.addEventListener('keydown', event => {
            if(this.running() && ['ArrowLeft', 'ArrowRight'].includes(event.code) && !event.target.matches('input, textarea, [contenteditable]')) event.preventDefault()
        })
    }

    updateHud()
    {
        const vehicle = this.game.physicalVehicle, state = this.state(vehicle)
        this.hud.hidden = this.game.reveal.step !== 2 || !!this.game.escMenu?.isOpen
        this.buttons.forEach((button, index) => {
            const type = ITEM_TYPES[index].type
            button.classList.toggle('selected', this.selected === index)
            button.setAttribute('aria-pressed', String(this.selected === index))
            button.querySelector('[data-count]').textContent = state.counts[type]
            button.disabled = state.counts[type] === 0 || !this.running() || !this.alive(vehicle)
        })
        const statuses = []
        if(state.slowUntil > this.clock) statuses.push(`减速 ${Math.ceil(state.slowUntil - this.clock)}s`)
        if(state.shield) statuses.push(`护盾 ${state.shield.charges}/3`)
        if(state.jet) statuses.push(`喷气 · 可跳跃 ${state.jet.jumps} 次`)
        this.hud.querySelector('.item-status').textContent = this.clock < (this.messageUntil ?? 0) ? this.message : statuses.join(' · ')
    }

    notify(vehicle, text)
    {
        if(vehicle === this.game.physicalVehicle) { this.message = text; this.messageUntil = this.clock + 1.5 }
    }

    model(type, scale = 1)
    {
        const template = this.game.world.powerups?.templateFor(type)
        if(!template) return null
        const group = new THREE.Group()
        const model = template.clone(true)
        model.scale.multiplyScalar(scale)
        group.add(model)
        group.name = `item-${type}`
        return group
    }

    nearest(vehicle)
    {
        return this.vehicles().filter(other => other !== vehicle).sort((a, b) => a.position.distanceToSquared(vehicle.position) - b.position.distanceToSquared(vehicle.position))[0] ?? null
    }

    use(vehicle, type)
    {
        if(!this.running() || !this.alive(vehicle)) return false
        const state = this.state(vehicle)
        if(!state.counts[type] || this.clock < state.nextUse) return false
        if(type === 'shield' && state.shield) { this.notify(vehicle, '护盾仍在生效'); return false }
        if(type === 'jetpack' && state.jet) return false
        let success = false
        if(type === 'caltrop' || type === 'crate') success = this.place(vehicle, type)
        if(type === 'missile') success = this.fireMissile(vehicle)
        if(type === 'shield') success = this.addShield(vehicle)
        if(type === 'jetpack') success = this.startJet(vehicle)
        if(!success) return false
        state.counts[type]--
        state.nextUse = this.clock + 0.45
        this.updateHud()
        return true
    }

    place(vehicle, type)
    {
        const direction = vehicle.forward.clone().setY(0).normalize()
        const position = vehicle.position.clone().addScaledVector(direction, -4)
        const ground = this.game.world.powerups.navigation.groundAt(position.x, position.z)
        if(ground === null || this.game.water.depthAt({ x: position.x, y: ground, z: position.z }) > 0.15 || vehicle.position.y - ground > 4) {
            this.notify(vehicle, '需要在陆地附近放置'); return false
        }
        position.y = ground + (type === 'crate' ? 0.65 : 0.05)
        const mesh = this.model(type, type === 'crate' ? 1.2 : 0.9)
        if(!mesh) return false
        const R = this.game.RAPIER, world = this.game.physics.world
        // Sensors register the item without launching the car off a tiny spike.
        const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z))
        const collider = world.createCollider(R.ColliderDesc.cuboid(0.85, type === 'crate' ? 0.65 : 0.4, 0.85).setSensor(true), body)
        mesh.position.copy(position); mesh.rotation.y = -Math.atan2(direction.z, direction.x)
        this.game.scene.add(mesh)
        this.entities.push({ id: ++this.serial, type, owner: vehicle, mesh, position, body, collider, age: 0, lifetime: 60 })
        return true
    }

    fireMissile(vehicle)
    {
        const target = this.nearest(vehicle)
        if(!target) { this.notify(vehicle, '没有可追踪的车辆'); return false }
        const mesh = this.model('missile', 0.65)
        if(!mesh) return false
        const position = vehicle.position.clone().add(new THREE.Vector3(0, 2.7, 0))
        mesh.position.copy(position)
        this.game.scene.add(mesh)
        const direction = vehicle.forward.clone().setY(1.7).normalize()
        this.entities.push({ id: ++this.serial, type: 'missile', owner: vehicle, target, mesh, position, direction, age: 0, lifetime: 14, tracking: true })
        return true
    }

    addShield(vehicle)
    {
        const geometry = new THREE.CylinderGeometry(2.55, 2.55, 2.4, 64, 1, true)
        const material = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, side: THREE.DoubleSide, depthWrite: false })
        material.opacityNode = Fn(() => {
            const height = uv().y
            const phase = height.mul(3).sub(this.game.ticker.elapsedUniform.mul(0.65)).fract()
            const feather = phase.fwidth().min(0.04).max(0.003)
            const stripe = phase.sub(0.5).abs().smoothstep(float(0.035).sub(feather), float(0.035).add(feather)).oneMinus()
            return stripe.mul(height.oneMinus().pow(1.6).mul(0.85)).max(height.smoothstep(0.009, 0.022).oneMinus().mul(0.7))
        })()
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'vehicle-shield-bands'; mesh.renderOrder = 3
        mesh.position.copy(vehicle.position).add(new THREE.Vector3(0, 0.1, 0))
        this.game.scene.add(mesh)
        const { world, groups } = this.game.physics, R = this.game.RAPIER
        // Solid, massless shell: only vehicle bumpers hit it, not the terrain.
        const collider = world.createCollider(R.ColliderDesc.cylinder(1, 2.55).setMass(0).setCollisionGroups((groups.object << 16) | groups.bumper), vehicle.chassis.physical.body)
        this.state(vehicle).shield = { charges: 3, collider, mesh, touching: new Set() }
        return true
    }

    removeShield(vehicle)
    {
        const state = this.state(vehicle), shield = state.shield
        if(!shield) return
        this.game.physics.world.removeCollider(shield.collider, true)
        shield.mesh.removeFromParent(); shield.mesh.geometry.dispose(); shield.mesh.material.dispose()
        state.shield = null
    }

    absorb(vehicle, key)
    {
        const state = this.state(vehicle)
        if(state.blockedContacts.has(key) || this.clock < (state.recentHits.get(key) ?? 0)) return true
        if(!state.shield?.charges) return false
        state.shield.charges--
        state.recentHits.set(key, this.clock + 0.6)
        this.blocked.add(vehicle)
        this.notify(vehicle, `护盾抵挡 · 剩余 ${state.shield.charges} 次`)
        this.pulse(vehicle.position, 3.5, '#ffffff')
        return true
    }

    beforeStep()
    {
        this.before.clear(); this.blocked.clear()
        if(!this.running()) return
        for(const vehicle of this.vehicles()) {
            const body = vehicle.chassis.physical.body
            this.before.set(vehicle, { position: new THREE.Vector3().copy(body.translation()), velocity: { ...body.linvel() }, angular: { ...body.angvel() } })
        }
    }

    afterStep()
    {
        if(!this.running()) return
        for(const [vehicle, snapshot] of this.before) {
            const state = this.state(vehicle), shield = state.shield, touching = new Set()
            if(shield) this.game.physics.world.contactPairsWith(shield.collider, collider => {
                const other = collider.parent()?.userData?.vehicle
                if(!other || other === vehicle || !this.alive(other)) return
                let contact = false
                this.game.physics.world.contactPair(shield.collider, collider, manifold => { if(manifold.numSolverContacts()) contact = true })
                if(!contact) return
                const key = `car:${other.chassis.physical.body.handle}`
                if(this.absorb(vehicle, key)) { touching.add(key); this.blocked.add(vehicle) }
            })
            // Keep immunity through sustained chassis contact, even after the
            // third charge removes the outer shell. Separation ends this hit.
            for(const key of state.blockedContacts) {
                const other = [...this.before.keys()].find(v => `car:${v.chassis.physical.body.handle}` === key)
                if(other && vehicle.position.distanceTo(other.position) < 5.2) touching.add(key)
            }
            state.blockedContacts = touching
            if(touching.size || this.blocked.has(vehicle)) {
                const body = vehicle.chassis.physical.body, velocity = body.linvel(), position = body.translation()
                // The solver already integrated the impact this frame. Restore
                // the protected car's own horizontal motion as well as velocity.
                body.setTranslation({ x: snapshot.position.x + snapshot.velocity.x * this.game.ticker.deltaScaled, y: position.y, z: snapshot.position.z + snapshot.velocity.z * this.game.ticker.deltaScaled }, true)
                body.setLinvel({ x: snapshot.velocity.x, y: Math.max(velocity.y, snapshot.velocity.y - 0.4), z: snapshot.velocity.z }, true)
                body.setAngvel(snapshot.angular, true)
            }
        }
        for(const [vehicle, state] of this.states) if(state.shield?.charges === 0) this.removeShield(vehicle)
    }

    startJet(vehicle)
    {
        const mesh = this.model('jetpack', 0.75)
        if(!mesh) return false
        if(vehicle.launch) vehicle.launch.active = false
        const state = this.state(vehicle), body = vehicle.chassis.physical.body, velocity = body.linvel()
        state.jet = { mesh, until: this.clock + 1.2, jumps: vehicle.upgrades.maxJumps }
        mesh.position.copy(vehicle.position).add(new THREE.Vector3(-0.6, 0.8, 0).applyQuaternion(vehicle.quaternion))
        mesh.quaternion.copy(vehicle.quaternion)
        this.game.scene.add(mesh)
        body.setLinvel({ x: velocity.x, y: Math.max(velocity.y, 12), z: velocity.z }, true)
        vehicle.jumpState.airborne = true
        vehicle.jumpState.takeoffSpeed = Math.hypot(velocity.x, velocity.z)
        vehicle.jumpState.airOffset.set(0, 0, 0)
        this.pulse(vehicle.position, 9, '#bdffff')
        const key = `jet:${++this.serial}`
        for(const other of this.vehicles()) {
            if(other === vehicle) continue
            const delta = other.position.clone().sub(vehicle.position), distance = delta.length()
            if(distance > 9 || this.absorb(other, key)) continue
            const direction = delta.setY(0)
            if(direction.lengthSq() < 0.01) direction.copy(vehicle.forward)
            direction.normalize().multiplyScalar(14 * (1 - distance / 12)); direction.y = 4
            const otherBody = other.chassis.physical.body
            otherBody.applyImpulse(direction.multiplyScalar(otherBody.mass()), true)
        }
        return true
    }

    jetJump(vehicle)
    {
        const jet = this.state(vehicle).jet
        if(!jet || jet.jumps <= 0) return false
        jet.jumps--
        return true
    }

    pulse(position, radius, color)
    {
        const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicNodeMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
        mesh.rotation.x = -Math.PI / 2; mesh.position.copy(position); mesh.position.y -= 0.45
        this.game.scene.add(mesh); this.pulses.push({ mesh, radius, age: 0 })
    }

    detonate(position)
    {
        this.game.world.fireballs.create(position, 5, 7, { groundAttenuation: false, strength: 8 })
        this.game.world.explosiveCrates.sounds.explosions[0].play(position)
    }

    removeEntity(entity)
    {
        if(entity.removed) return
        entity.removed = true
        entity.mesh.removeFromParent()
        if(entity.body) this.game.physics.world.removeRigidBody(entity.body)
    }

    updateEntity(entity, dt, vehicles)
    {
        entity.age += dt
        if(entity.age >= entity.lifetime) { this.removeEntity(entity); return }
        if(entity.type !== 'missile') {
            if(entity.age < 0.7) return
            for(const vehicle of vehicles) {
                if(vehicle === entity.owner && entity.age < 1.4) continue
                const previous = this.before.get(vehicle)?.position ?? vehicle.position
                const closest = previous.distanceToSquared(vehicle.position) < 400 ? new THREE.Line3(previous, vehicle.position).closestPointToPoint(entity.position, true, new THREE.Vector3()) : vehicle.position
                if(Math.hypot(closest.x - entity.position.x, closest.z - entity.position.z) > 1.85 || Math.abs(closest.y - entity.position.y) > 1.6) continue
                if(entity.type === 'crate') this.detonate(entity.position)
                else if(!this.absorb(vehicle, `caltrop:${entity.id}`)) {
                    const body = vehicle.chassis.physical.body
                    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
                    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
                    if(vehicle.launch) vehicle.launch.active = false
                    vehicle.jumpState.airOffset.set(0, 0, 0)
                    this.state(vehicle).slowUntil = this.clock + 15
                    this.notify(vehicle, '铁蒺藜命中 · 减速 15s')
                }
                this.removeEntity(entity); break
            }
            return
        }
        const previous = entity.position.clone()
        entity.tracking = entity.age < 10 && !!entity.target && this.alive(entity.target)
        if(entity.age > 0.3 && entity.tracking) {
            const desired = entity.target.position.clone().add(new THREE.Vector3(0, 0.45, 0)).sub(previous).normalize()
            entity.direction.lerp(desired, Math.min(1, dt * 3.5)).normalize()
        }
        const step = (entity.age < 0.3 ? 10 : 26) * this.game.ticker.deltaScaled
        const end = previous.clone().addScaledVector(entity.direction, step)
        let hitDistance = Infinity
        // Sweep against scenery; ignore sensors and the firing car.
        const rayHit = this.game.physics.world.castRay(new this.game.RAPIER.Ray(previous, entity.direction), step, true, undefined, undefined, undefined, entity.owner.chassis.physical.body, collider => !collider.isSensor())
        if(rayHit) hitDistance = rayHit.timeOfImpact
        for(const vehicle of vehicles) {
            if(vehicle === entity.owner) continue
            const radius = this.state(vehicle).shield ? 2.8 : 1.65
            const old = this.before.get(vehicle)?.position ?? vehicle.position
            const relativeStart = previous.clone().sub(old), relativeEnd = end.clone().sub(vehicle.position)
            const relative = new THREE.Line3(relativeStart, relativeEnd)
            const t = relative.closestPointToPointParameter(new THREE.Vector3(), true)
            if(relative.at(t, new THREE.Vector3()).length() < radius) hitDistance = Math.min(hitDistance, t * step)
        }
        entity.position.copy(previous).addScaledVector(entity.direction, Math.min(step, hitDistance))
        entity.mesh.position.copy(entity.position)
        entity.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), entity.direction)
        if(hitDistance !== Infinity) { this.detonate(entity.position); this.removeEntity(entity) }
    }

    clearEffects(vehicle)
    {
        const state = this.state(vehicle)
        this.removeShield(vehicle)
        state.jet?.mesh.removeFromParent(); state.jet = null
        state.slowUntil = 0; state.blockedContacts.clear(); state.recentHits.clear()
    }

    reset(vehicle)
    {
        this.clearEffects(vehicle)
        this.states.delete(vehicle)
        for(const entity of this.entities) if(entity.owner === vehicle) this.removeEntity(entity)
        this.state(vehicle)
    }

    update()
    {
        this.updateHud()
        if(!this.running()) return
        const dt = this.game.ticker.delta
        this.clock += dt
        const vehicles = this.vehicles()
        for(const [vehicle, state] of this.states) {
            if(vehicle.destroyed) { this.clearEffects(vehicle); continue }
            if(state.shield) state.shield.mesh.position.copy(vehicle.position).add(new THREE.Vector3(0, 0.1, 0))
            if(state.jet) {
                const { jet } = state
                jet.mesh.position.copy(vehicle.position).add(new THREE.Vector3(-0.6, 0.8, 0).applyQuaternion(vehicle.quaternion))
                jet.mesh.quaternion.copy(vehicle.quaternion)
                if(this.clock >= jet.until) { jet.mesh.removeFromParent(); state.jet = null }
                else {
                    const body = vehicle.chassis.physical.body, velocity = body.linvel()
                    if(velocity.y < 7) body.setLinvel({ x: velocity.x, y: 7, z: velocity.z }, true)
                    if(Math.floor(this.clock * 12) !== jet.lastPulse) { jet.lastPulse = Math.floor(this.clock * 12); this.pulse(vehicle.position, 2, '#c9ffff') }
                }
            }
            for(const [key, until] of state.recentHits) if(this.clock >= until) state.recentHits.delete(key)
            if(vehicle !== this.game.physicalVehicle && this.alive(vehicle) && this.clock >= state.nextAI) {
                state.nextAI = this.clock + 4 + Math.random() * 3
                const target = this.nearest(vehicle), distance = target?.position.distanceTo(vehicle.position) ?? Infinity
                const preferred = distance < 7 && !state.shield ? 'shield' : distance < 8 ? 'jetpack' : distance < 45 ? 'missile' : 'caltrop'
                const choices = [preferred, 'crate', 'caltrop', 'missile', 'jetpack']
                for(const type of choices) if(this.use(vehicle, type)) break
            }
        }
        for(const entity of this.entities) if(!entity.removed) this.updateEntity(entity, dt, vehicles)
        this.entities = this.entities.filter(entity => !entity.removed)
        for(const pulse of this.pulses) {
            pulse.age += dt
            pulse.mesh.scale.setScalar(0.5 + pulse.radius * Math.min(1, pulse.age / 0.6))
            pulse.mesh.material.opacity = Math.max(0, 0.8 * (1 - pulse.age / 0.6))
            if(pulse.age >= 0.6) { pulse.mesh.removeFromParent(); pulse.mesh.geometry.dispose(); pulse.mesh.material.dispose() }
        }
        this.pulses = this.pulses.filter(pulse => pulse.age < 0.6)
    }
}
