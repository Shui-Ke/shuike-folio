import * as THREE from 'three/webgpu'
import { Fn, uv, float } from 'three/tsl'
import { Game } from './Game.js'
import { ITEM_TYPES } from './ItemDefinitions.js'
import { MissileSmoke } from './World/MissileSmoke.js'

const SHIELD_COOLDOWN = 12

export class VehicleItems
{
    constructor()
    {
        this.game = Game.getInstance()
        this.states = new Map()
        this.entities = []
        this.pulses = []
        this.smoke = new MissileSmoke()
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
            slowUntil: 0, shield: null, jet: null, nextUse: 0, nextAI: this.clock + 6, nextShield: 0,
            blockedContacts: new Set(), recentHits: new Map(),
        })
        return this.states.get(vehicle)
    }

    running()
    {
        return this.game.reveal.step === 2 && this.game.player.state === 1 && !this.game.editorPaused && !this.game.escMenu?.isOpen && !this.game.match?.ended
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
            if(this.selected === index) this.use(this.game.physicalVehicle, ITEM_TYPES[index].type)
            else this.selected = index
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
            const offset = (index - this.selected + ITEM_TYPES.length) % ITEM_TYPES.length
            const side = offset === 0 ? 'current' : offset === 1 ? 'next' : offset === ITEM_TYPES.length - 1 ? 'previous' : 'hidden'
            button.dataset.position = side
            button.hidden = side === 'hidden'
            button.setAttribute('aria-label', `${this.selected === index ? '使用' : '选择'}${ITEM_TYPES[index].title}`)
            button.classList.toggle('selected', this.selected === index)
            button.setAttribute('aria-pressed', String(this.selected === index))
            button.querySelector('[data-count]').textContent = state.counts[type]
            const cooldown = type === 'shield' && !state.shield && state.nextShield > this.clock
            button.disabled = !this.running() || !this.alive(vehicle) || (this.selected === index && (state.counts[type] === 0 || cooldown))
        })
        this.hud.style.setProperty('--selected-item-color', ITEM_TYPES[this.selected].color)
        const statuses = []
        if(state.slowUntil > this.clock) statuses.push(`减速 ${Math.ceil(state.slowUntil - this.clock)}s`)
        if(state.shield) statuses.push(`护盾 ${state.shield.charges}/3`)
        else if(state.nextShield > this.clock) statuses.push(`护盾冷却 ${Math.ceil(state.nextShield - this.clock)}s`)
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
        // Extreme rivals lock their missiles onto the player — never a packmate.
        const focus = this.game.world.rivals?.focusTargetOf?.(vehicle)
        if(focus && focus !== vehicle)
            return this.alive(focus) && vehicle.position.distanceTo(focus.position) <= 80 ? focus : null

        return this.vehicles().filter(other => other !== vehicle).sort((a, b) => a.position.distanceToSquared(vehicle.position) - b.position.distanceToSquared(vehicle.position))[0] ?? null
    }

    // A trap only pays off when the target is actually behind the car.
    targetIsBehind(vehicle, target)
    {
        const dx = target.position.x - vehicle.position.x
        const dz = target.position.z - vehicle.position.z
        return dx * vehicle.forward.x + dz * vehicle.forward.z < -2
    }

    // Where the current arc is about to put the car: water counts as lethal.
    deathZoneAhead(vehicle)
    {
        const position = vehicle.position
        const velocity = vehicle.chassis.physical.body.linvel()
        const x = position.x + velocity.x * 1.4
        const z = position.z + velocity.z * 1.4
        const ground = this.game.navigation?.groundAt(x, z) ?? null
        if(ground === null)
            return true

        return this.game.water.depthAt({ x, y: ground, z }) > 0.15
    }

    // A rival flying toward the lake/ocean burns its jetpack to survive.
    tryEmergencyJet(vehicle)
    {
        if(this.game.config?.profile?.botItems === false)
            return false

        const state = this.state(vehicle)
        if(!state.counts.jetpack || state.jet)
            return false
        if(!vehicle.jumpState.airborne && !vehicle.launch?.active)
            return false
        if(this.clock < (state.nextSave ?? 0))
            return false
        if(!this.deathZoneAhead(vehicle))
            return false
        if(!this.use(vehicle, 'jetpack'))
            return false

        // Roughly the jet lifetime, so a second tank can chain if still doomed.
        state.nextSave = this.clock + 1.3
        return true
    }

    vehicleColor(vehicle)
    {
        return this.game.world.vehicleDamage.records.get(vehicle)?.visual.parts.bodyPainted.material.userData.mainColor ?? '#ff3a3a'
    }

    use(vehicle, type)
    {
        if(!this.running() || !this.alive(vehicle)) return false
        const state = this.state(vehicle)
        if(!state.counts[type] || this.clock < state.nextUse) return false
        if(type === 'shield' && state.shield) { this.notify(vehicle, '护盾仍在生效'); return false }
        if(type === 'shield' && this.clock < state.nextShield)
        {
            this.notify(vehicle, `护盾冷却 ${Math.ceil(state.nextShield - this.clock)}s`)
            return false
        }
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
        const position = vehicle.position.clone().addScaledVector(direction, -4 * vehicle.scale)
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
        const dropHeight = 2.2, dropDuration = 0.55
        mesh.position.y += dropHeight
        body.setEnabled(false)
        this.game.scene.add(mesh)
        this.entities.push({ id: ++this.serial, type, owner: vehicle, mesh, position, body, collider, age: 0, lifetime: 60, dropHeight, dropDuration, landed: false })
        return true
    }

    fireMissile(vehicle)
    {
        const target = this.nearest(vehicle)
        if(!target) { this.notify(vehicle, '没有可追踪的车辆'); return false }
        const mesh = this.model('missile', 0.65)
        if(!mesh) return false
        const position = vehicle.position.clone().add(new THREE.Vector3(0, 1.9 * vehicle.scale, 0))
        const direction = vehicle.forward.clone().setY(0).normalize()
        mesh.position.copy(position)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction)
        this.game.scene.add(mesh)
        const marker = new THREE.Mesh(new THREE.RingGeometry(2.1 * target.scale, 2.22 * target.scale, 40, 1, 0, Math.PI * 1.6), new THREE.MeshBasicNodeMaterial({ color: this.vehicleColor(target), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
        marker.rotation.x = -Math.PI / 2
        marker.position.copy(target.position).add(new THREE.Vector3(0, -0.5, 0))
        marker.name = 'missile-target-lock'; marker.renderOrder = 4
        this.game.scene.add(marker)
        const side = new THREE.Vector3(-target.forward.z, 0, target.forward.x)
        const routeSide = position.clone().sub(target.position).dot(side) >= 0 ? 1 : -1
        this.entities.push({ id: ++this.serial, type: 'missile', owner: vehicle, target, mesh, marker, exhaust: mesh.getObjectByName('exhaust-core'), position, direction, age: 0, speed: 2, acceleration: 5, lifetime: 14, tracking: true, pursuit: false, routeSide })
        this.notify(vehicle, '导弹已锁定 · 同色圆环标记目标')
        return true
    }

    addShield(vehicle)
    {
        const geometry = new THREE.CylinderGeometry(2.55 * vehicle.scale, 2.55 * vehicle.scale, 2.4 * vehicle.scale, 64, 1, true)
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
        const collider = world.createCollider(R.ColliderDesc.cylinder(vehicle.scale, 2.55 * vehicle.scale).setMass(0).setCollisionGroups((groups.object << 16) | groups.bumper), vehicle.chassis.physical.body)
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
        state.nextShield = this.clock + SHIELD_COOLDOWN
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
                const otherSnapshot = this.before.get(other)
                const toward = new THREE.Vector3().copy(otherSnapshot?.position ?? other.position).sub(snapshot.position).setY(0).normalize()
                const outgoing = toward.dot(snapshot.velocity)
                const incoming = otherSnapshot ? -toward.dot(otherSnapshot.velocity) : 0
                // Keep the shield owner's own motion. An active ram against a
                // passive target is an attack, not a charge-consuming block.
                this.blocked.add(vehicle)
                if(outgoing > Math.max(0.7, incoming + 0.1)) return
                if(this.absorb(vehicle, key)) { touching.add(key); this.blocked.add(vehicle) }
            })
            // Keep immunity through sustained chassis contact, even after the
            // third charge removes the outer shell. Separation ends this hit.
            for(const key of state.blockedContacts) {
                const other = [...this.before.keys()].find(v => `car:${v.chassis.physical.body.handle}` === key)
                if(other && vehicle.position.distanceTo(other.position) < 2.6 * (vehicle.scale + other.scale)) touching.add(key)
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
        if(vehicle.launch) vehicle.launch.active = false
        const state = this.state(vehicle), body = vehicle.chassis.physical.body, velocity = body.linvel()
        // No backpack prop: only the flight effect (pulses + lift) remains.
        state.jet = { until: this.clock + 1.2, jumps: vehicle.upgrades.maxJumps, lastPulse: -1 }
        body.setLinvel({ x: velocity.x, y: Math.max(velocity.y, 12), z: velocity.z }, true)
        vehicle.jumpState.airborne = true
        vehicle.jumpState.jetFlight = true
        vehicle.jumpState.takeoffSpeed = Math.hypot(velocity.x, velocity.z)
        vehicle.jumpState.airOffset.set(0, 0, 0)
        this.pulse(vehicle.position, 13, '#bdffff')
        const key = `jet:${++this.serial}`
        for(const other of this.vehicles()) {
            if(other === vehicle) continue
            if(this.game.world.rivals?.isFriendlyPair?.(vehicle, other)) continue
            const delta = other.position.clone().sub(vehicle.position), distance = delta.length()
            if(distance > 13 || this.absorb(other, key)) continue
            const direction = delta.setY(0)
            if(direction.lengthSq() < 0.01) direction.copy(vehicle.forward)
            direction.normalize().multiplyScalar(20 * (1 - distance / 15)); direction.y = 5.5
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

    detonate(position, owner = null)
    {
        this.game.world.fireballs.create(position, 5, 7, { groundAttenuation: false, strength: 8, recoveryDelay: true, owner })
        this.game.world.explosiveCrates.sounds.explosions[0].play(position)
    }

    removeEntity(entity)
    {
        if(entity.removed) return
        entity.removed = true
        entity.mesh.removeFromParent()
        if(entity.marker) { entity.marker.removeFromParent(); entity.marker.geometry.dispose(); entity.marker.material.dispose() }
        if(entity.body) this.game.physics.world.removeRigidBody(entity.body)
    }

    updateEntity(entity, dt, vehicles)
    {
        entity.age += dt
        if(entity.age >= entity.lifetime) { this.removeEntity(entity); return }
        if(entity.type !== 'missile') {
            const progress = Math.min(1, entity.age / entity.dropDuration)
            entity.mesh.position.y = entity.position.y + entity.dropHeight * (1 - progress * progress)
            if(progress < 1) return
            if(!entity.landed) {
                entity.landed = true
                entity.body.setEnabled(true)
                this.pulse(entity.position, 1.3, '#e9d5b4')
            }
            if(entity.age < entity.dropDuration + 0.15) return
            for(const vehicle of vehicles) {
                if(vehicle === entity.owner && entity.age < 1.4) continue
                if(this.game.world.rivals?.isFriendlyPair?.(entity.owner, vehicle)) continue
                const previous = this.before.get(vehicle)?.position ?? vehicle.position
                const closest = previous.distanceToSquared(vehicle.position) < 400 ? new THREE.Line3(previous, vehicle.position).closestPointToPoint(entity.position, true, new THREE.Vector3()) : vehicle.position
                if(Math.hypot(closest.x - entity.position.x, closest.z - entity.position.z) > 1.85 * vehicle.scale || Math.abs(closest.y - entity.position.y) > 1.6 * vehicle.scale) continue
                if(entity.type === 'crate') this.detonate(entity.position, entity.owner)
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
        entity.speed = 2 + entity.acceleration * entity.age
        entity.marker.visible = entity.tracking
        if(entity.tracking) {
            const target = entity.target
            entity.marker.material.color.set(this.vehicleColor(target))
            entity.marker.position.copy(target.position).add(new THREE.Vector3(0, -0.5, 0))
            entity.marker.rotation.z = entity.age * 2
            const forward = target.forward.clone().setY(0).normalize()
            if(forward.lengthSq() < 0.1) forward.set(1, 0, 0)
            const side = new THREE.Vector3(-forward.z, 0, forward.x)
            const offset = previous.clone().sub(target.position)
            const behind = offset.dot(forward) < -2.4
            if(behind && Math.abs(offset.dot(side)) < 4) entity.pursuit = true
            // Approach from the rear quarter before pursuing the rear bumper.
            // Moving the aim point to the bumper lets the missile finish the hit,
            // instead of orbiting forever around a point behind the target.
            const aim = target.position.clone().addScaledVector(forward, entity.pursuit ? -1 : -5)
            if(!entity.pursuit && !behind) aim.addScaledVector(side, 6 * entity.routeSide)
            const ground = this.game.world.powerups.navigation.groundAt(previous.x, previous.z)
            aim.y = target.position.y + 0.35
            if(ground !== null) aim.y = THREE.MathUtils.clamp(aim.y, ground + 0.9, ground + 2.8)
            entity.aim = aim.clone()
            if(entity.age > 0.12) {
                const desired = aim.sub(previous).normalize()
                // Use an angular turn limit, not a velocity lerp that loses
                // steering authority as the missile accelerates past a car.
                const currentRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), entity.direction)
                const desiredRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), desired)
                currentRotation.rotateTowards(desiredRotation, dt * 7)
                entity.direction.set(1, 0, 0).applyQuaternion(currentRotation).normalize()
            }
        }
        const step = entity.speed * this.game.ticker.deltaScaled
        const end = previous.clone().addScaledVector(entity.direction, step)
        let hitDistance = Infinity
        // Sweep against scenery; ignore sensors and the firing car.
        const rayHit = this.game.physics.world.castRay(new this.game.RAPIER.Ray(previous, entity.direction), step, true, undefined, undefined, undefined, entity.owner.chassis.physical.body, collider => !collider.isSensor())
        if(rayHit) hitDistance = rayHit.timeOfImpact
        for(const vehicle of vehicles) {
            if(vehicle === entity.owner) continue
            if(this.game.world.rivals?.isFriendlyPair?.(entity.owner, vehicle)) continue
            const radius = (this.state(vehicle).shield ? 2.8 : 1.65) * vehicle.scale
            const old = this.before.get(vehicle)?.position ?? vehicle.position
            const relativeStart = previous.clone().sub(old), relativeEnd = end.clone().sub(vehicle.position)
            const relative = new THREE.Line3(relativeStart, relativeEnd)
            const t = relative.closestPointToPointParameter(new THREE.Vector3(), true)
            if(relative.at(t, new THREE.Vector3()).length() < radius) hitDistance = Math.min(hitDistance, t * step)
        }
        entity.position.copy(previous).addScaledVector(entity.direction, Math.min(step, hitDistance))
        entity.mesh.position.copy(entity.position)
        entity.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), entity.direction)
        this.smoke.emit(entity, dt)
        if(hitDistance !== Infinity) { this.detonate(entity.position, entity.owner); this.removeEntity(entity) }
    }

    clearEffects(vehicle)
    {
        const state = this.state(vehicle)
        this.removeShield(vehicle)
        state.jet = null
        vehicle.jumpState.jetFlight = false
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

        // Self-preservation has priority over offensive item use.
        for(const vehicle of vehicles)
            if(vehicle !== this.game.physicalVehicle && this.alive(vehicle))
                this.tryEmergencyJet(vehicle)

        for(const [vehicle, state] of this.states) {
            if(vehicle.destroyed) { this.clearEffects(vehicle); continue }
            if(state.shield) state.shield.mesh.position.copy(vehicle.position).add(new THREE.Vector3(0, 0.1, 0))
            if(state.jet) {
                const { jet } = state
                if(this.clock >= jet.until) state.jet = null
                else {
                    const body = vehicle.chassis.physical.body, velocity = body.linvel()
                    if(velocity.y < 7) body.setLinvel({ x: velocity.x, y: 7, z: velocity.z }, true)
                    if(Math.floor(this.clock * 12) !== jet.lastPulse) { jet.lastPulse = Math.floor(this.clock * 12); this.pulse(vehicle.position, 2, '#c9ffff') }
                }
            }
            for(const [key, until] of state.recentHits) if(this.clock >= until) state.recentHits.delete(key)
            if(vehicle !== this.game.physicalVehicle && this.alive(vehicle) && this.clock >= state.nextAI) {
                const profile = this.game.config?.profile
                // Easy rivals never fire items; they keep the inventory untouched.
                if(profile?.botItems === false) { state.nextAI = this.clock + 3; continue }
                const frenzied = this.game.world.rivals?.isFrenzied?.(vehicle) ?? false
                state.nextAI = this.clock + (frenzied ? 0.55 : (profile?.itemInterval ?? 4) + Math.random() * (profile?.itemRandom ?? 3))
                const target = this.nearest(vehicle), distance = target?.position.distanceTo(vehicle.position) ?? Infinity
                let choice = null

                if(target)
                {
                    const canShield = !state.shield && this.clock >= state.nextShield && state.counts.shield > 0
                    const canMissile = state.counts.missile > 0 && distance > 8 && distance < 45
                    const behind = this.targetIsBehind(vehicle, target)
                    const canTrap = behind && distance < 24 && this.clock >= (state.nextTrap ?? 0)

                    // One deliberate action per decision; the jetpack is reserved
                    // for the emergency bailout and never used as an opener.
                    if(frenzied && canMissile)
                        choice = 'missile'
                    else if(distance < 9 && canShield)
                        choice = 'shield'
                    else if(canMissile && distance > 12)
                        choice = 'missile'
                    else if(canTrap)
                        choice = state.counts.crate > 0 ? 'crate' : state.counts.caltrop > 0 ? 'caltrop' : null
                }

                if(choice && this.use(vehicle, choice))
                {
                    if(choice === 'crate' || choice === 'caltrop')
                        state.nextTrap = this.clock + 9
                }
            }
        }
        for(const entity of this.entities) if(!entity.removed) this.updateEntity(entity, dt, vehicles)
        this.entities = this.entities.filter(entity => !entity.removed)
        this.smoke.update(dt)
        for(const pulse of this.pulses) {
            pulse.age += dt
            pulse.mesh.scale.setScalar(0.5 + pulse.radius * Math.min(1, pulse.age / 0.6))
            pulse.mesh.material.opacity = Math.max(0, 0.8 * (1 - pulse.age / 0.6))
            if(pulse.age >= 0.6) { pulse.mesh.removeFromParent(); pulse.mesh.geometry.dispose(); pulse.mesh.material.dispose() }
        }
        this.pulses = this.pulses.filter(pulse => pulse.age < 0.6)
    }
}
