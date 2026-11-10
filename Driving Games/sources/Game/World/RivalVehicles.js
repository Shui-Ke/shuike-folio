import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { PhysicsVehicle } from '../Physics/PhysicsVehicle.js'
import { VisualVehicle } from './VisualVehicle.js'
import { VehicleNavigation } from './VehicleNavigation.js'
import { speedWhiteValue } from '../VehicleUpgrades.js'

const PAINTS = [
    { name: 'blue', top: '#38bfff', bottom: '#174db5' },
    { name: 'yellow', top: '#ffe15b', bottom: '#d67b13' },
    { name: 'purple', top: '#d38bff', bottom: '#7131bb' },
    { name: 'cyan', top: '#5ce1e6', bottom: '#0a5f66' },
    { name: 'green', top: '#63e06b', bottom: '#1a6b2a' },
    { name: 'pink', top: '#ff77c8', bottom: '#8a1a5e' },
    { name: 'lime', top: '#c8ff4d', bottom: '#4d7a00' },
]

export class RivalVehicles
{
    constructor(model)
    {
        this.game = Game.getInstance()
        this.model = model
        this.items = []
        this.time = 0
        this.started = false
        this.warmupFrames = 2
        this.escapePoint = new THREE.Vector3()
        this.tickCallback = () => this.update()
        this.game.ticker.events.on('tick', this.tickCallback, 1)
    }

    configureCollision(vehicle)
    {
        const body = vehicle.chassis.physical.body
        body.enableCcd(true)
        body.userData.vehicle = vehicle
        const groups = this.game.physics.groups
        // Only vehicle bumpers gain this rule; scenery keeps its existing mask.
        vehicle.chassis.physical.colliders[2].setCollisionGroups(
            (groups.bumper << 16) | groups.object | groups.bumper
        )
    }

    start()
    {
        this.navigation = this.game.navigation ?? new VehicleNavigation(this.game)
        this.profile = this.game.config.profile
        this.configureCollision(this.game.physicalVehicle)

        // Hard rivals press the advantage whenever an explosion lands near them.
        if(this.profile.frenzy)
        {
            this.momentumCallback = position => this.onMomentum(position)
            this.game.explosions.events.on('explode', this.momentumCallback)
            this.game.explosions.events.on('impact', this.momentumCallback)
        }

        const count = Math.min(this.game.config.bots, PAINTS.length)
        const reserved = this.game.config.paint
        const paints = PAINTS.filter(paint => paint.name !== reserved)
        // Extreme runs a split squad: a fixed chase pack plus item runners.
        const chaseCount = Math.min(this.chaseSquadSize(count) || count, count)
        this.nextRoleUpdate = 0

        for(let index = 0; index < count; index++)
        {
            const controls = { accelerating: 0, steering: 0, braking: 0, boosting: 0, suspensions: ['low', 'low', 'low', 'low'] }
            const vehicle = new PhysicsVehicle({ controls })
            this.configureCollision(vehicle)
            vehicle.deactivate()
            const paint = paints[index] ?? PAINTS[index]
            const material = this.game.materials.createGradient(`rival-${paint.name}`, paint.top, paint.bottom)
            const visual = new VisualVehicle(this.model.clone(true), { physicalVehicle: vehicle, controls, paintMaterial: material })
            const bot = {
                index, color: paint.name, colorCss: paint.top, controls, vehicle, visual,
                state: 'waiting', target: null, route: [], nextRoute: 0,
                nextTarget: index * 1.5, reverseUntil: 0, reverseSteer: 1,
                chargeUntil: 0, nextCharge: 3 + index, stuckTime: 0,
                upsideTime: 0, lastFlip: -10, recoveries: 0, nextSpawn: 0,
                aimPoint: new THREE.Vector3(), catchUpUntil: 0, nextCatchUp: 0,
                frenzyUntil: 0, lives: this.profile.botLives ?? 1,
                role: index < chaseCount ? 'chase' : 'collect',
            }
            this.items.push(bot)
            this.game.world.vehicleDamage.register(vehicle, visual)
            this.setVisible(bot, false)
            this.respawn(bot)
        }
        this.started = true
    }

    setVisible(bot, visible)
    {
        bot.visual.parts.chassis.visible = visible
        if(bot.visual.antenna) bot.visual.antenna.head.visible = visible
    }

    spawnPosition(bot, anchor = null)
    {
        // Rivals appear anywhere on the island, never next to the player, so a
        // match starts spread out instead of with three cars already on you.
        const random = this.game.config.random
        const bound = this.game.water.ocean.start * 0.97
        const player = this.game.physicalVehicle.position

        const blocked = position =>
        {
            let occupied = false
            this.game.physics.world.intersectionsWithShape(
                position, this.navigation.identity, new this.game.RAPIER.Ball(2.8),
                () => { occupied = true; return false },
                undefined, undefined, undefined, bot.vehicle.chassis.physical.body,
                collider => !collider.isSensor() && !this.navigation.isGround(collider)
            )
            return occupied
        }

        // New bodies are absent from Rapier's query index until the next step.
        // Check other cars explicitly when spawning several in one frame.
        const clearOfCars = (position, radius) =>
            !this.items.some(other => other !== bot && other.state !== 'waiting' && other.vehicle.position.distanceTo(position) < radius)

        // Recovery: stay in the same area instead of teleporting across the map.
        if(anchor)
        {
            for(let attempt = 0; attempt < 260; attempt++)
            {
                const angle = random() * Math.PI * 2
                const radius = 6 + random() * 16
                const ground = this.navigation.sample(anchor.x + Math.cos(angle) * radius, anchor.z + Math.sin(angle) * radius)
                if(!ground) continue

                const position = ground.clone().add(new THREE.Vector3(0, 1.7, 0))
                if(position.distanceTo(player) < 8) continue
                if(!clearOfCars(position, 10)) continue
                if(blocked(position)) continue

                return position
            }
        }

        // Fresh match or a lost life: relax the margins instead of leaving the
        // car invisible in `waiting` forever.
        const tiers = anchor
            ? [{ minPlayer: 30, minCars: 14, attempts: 260 }]
            : [
                { minPlayer: 42, minCars: 20, attempts: 220 },
                { minPlayer: 30, minCars: 14, attempts: 220 },
                { minPlayer: 18, minCars: 10, attempts: 220 },
                { minPlayer: 10, minCars: 6, attempts: 180 },
            ]

        for(const tier of tiers)
        {
            for(let attempt = 0; attempt < tier.attempts; attempt++)
            {
                const x = (random() * 2 - 1) * bound
                const z = (random() * 2 - 1) * bound
                const ground = this.navigation.sample(x, z)
                if(!ground) continue

                const position = ground.clone().add(new THREE.Vector3(0, 1.7, 0))
                if(position.distanceTo(player) < tier.minPlayer) continue
                if(!clearOfCars(position, tier.minCars)) continue
                if(blocked(position)) continue

                return position
            }
        }

        // Last resort: any drivable cell, even if it is close to someone.
        for(let attempt = 0; attempt < 240; attempt++)
        {
            const x = (random() * 2 - 1) * bound
            const z = (random() * 2 - 1) * bound
            const ground = this.navigation.sample(x, z)
            if(!ground) continue

            const position = ground.clone().add(new THREE.Vector3(0, 1.7, 0))
            if(blocked(position)) continue

            return position
        }

        // Never keep a rival invisible: fall back to the match start area.
        const fallback = this.game.respawns.getDefault().position
        for(let attempt = 0; attempt < 12; attempt++)
        {
            const angle = random() * Math.PI * 2
            const ground = this.navigation.sample(fallback.x + Math.cos(angle) * 8, fallback.z + Math.sin(angle) * 8)
            if(ground)
                return ground.clone().add(new THREE.Vector3(0, 1.7, 0))
        }

        return fallback.clone().add(new THREE.Vector3(0, 2.2, 0))
    }

    // A rival that lost a life rejoins near the fight instead of popping up on
    // the far side of the island.
    revivePosition(bot)
    {
        const random = this.game.config.random
        const player = this.game.physicalVehicle.position

        for(let attempt = 0; attempt < 320; attempt++)
        {
            const angle = random() * Math.PI * 2
            const radius = 26 + random() * 18
            const ground = this.navigation.sample(player.x + Math.cos(angle) * radius, player.z + Math.sin(angle) * radius)
            if(!ground) continue

            const position = ground.clone().add(new THREE.Vector3(0, 1.7, 0))
            if(this.items.some(other => other !== bot && other.state !== 'waiting' && other.vehicle.position.distanceTo(position) < 10)) continue

            let occupied = false
            this.game.physics.world.intersectionsWithShape(
                position, this.navigation.identity, new this.game.RAPIER.Ball(2.8),
                () => { occupied = true; return false },
                undefined, undefined, undefined, bot.vehicle.chassis.physical.body,
                collider => !collider.isSensor() && !this.navigation.isGround(collider)
            )
            if(occupied) continue

            return position
        }

        return null
    }

    respawn(bot, anchor = null)
    {
        if(bot.vehicle.destroyed && !this.canReviveBot(bot))
            return false

        const reviving = bot.vehicle.destroyed
        const position = reviving
            ? (this.revivePosition(bot) ?? this.spawnPosition(bot))
            : this.spawnPosition(bot, anchor)
        bot.nextSpawn = this.time + 2
        if(!position)
            return false

        // Extreme rivals spend their spare life only once a safe spot exists.
        if(bot.vehicle.destroyed)
            this.game.world.vehicleDamage.revive(bot.vehicle)

        const target = this.game.physicalVehicle.position
        const yaw = -Math.atan2(target.z - position.z, target.x - position.x)
        bot.vehicle.moveTo(position, yaw)
        bot.vehicle.activate()
        const physical = bot.vehicle.chassis.physical
        physical.initialState.position = { ...position }
        physical.initialState.rotation = { ...physical.body.rotation() }
        bot.state = 'chase'
        bot.stuckTime = bot.upsideTime = bot.recoveries = 0
        bot.reverseUntil = 0
        bot.frenzyUntil = 0
        bot.nextRoute = 0
        bot.route = []
        this.setVisible(bot, true)
        this.updateRoles(true)
        return true
    }

    chooseTarget(bot)
    {
        // Extreme rivals ignore each other and pile onto the player. They fall
        // back to normal rotation while the player is wrecked/reviving.
        const player = this.game.physicalVehicle
        if(this.profile.focusPlayer && !player.destroyed && player.chassis.physical.body.isEnabled())
        {
            bot.target = player
            bot.nextTarget = this.time + 30
            bot.nextRoute = 0
            return
        }

        const opponents = [this.game.physicalVehicle, ...this.items.filter(other => other !== bot && other.state !== 'waiting').map(other => other.vehicle)]
        // Alternate opponents so the player is not permanently dogpiled.
        const available = opponents.filter(vehicle => vehicle !== bot.target && vehicle.chassis.physical.body.isEnabled())
        bot.target = available[Math.floor(Math.random() * available.length)] ?? opponents[0]
        bot.nextTarget = this.time + this.profile.targetMin + Math.random() * this.profile.targetRandom
        bot.nextRoute = 0
    }

    reverse(bot)
    {
        bot.reverseUntil = this.time + this.profile.reverseTime
        bot.reverseSteer = (bot.index + bot.recoveries) % 2 ? 1 : -1
        bot.recoveries++
        bot.stuckTime = 0
        bot.nextRoute = 0
        bot.chargeUntil = 0
    }

    // "Momentum": an explosion or a heavy launch nearby is a cue to chain
    // another attack instead of waiting out the usual cooldowns.
    onMomentum(position)
    {
        if(!this.started || !this.profile.frenzy)
            return

        const range = this.profile.frenzyRange
        for(const bot of this.items)
        {
            if(bot.vehicle.destroyed || bot.state === 'waiting')
                continue

            const targetDistance = bot.target?.position.distanceTo(position) ?? Infinity
            const selfDistance = bot.vehicle.position.distanceTo(position)
            if(selfDistance > range && targetDistance > range)
                continue

            bot.frenzyUntil = this.time + this.profile.frenzyDuration
            bot.nextCharge = Math.min(bot.nextCharge, this.time)
            bot.nextRoute = Math.min(bot.nextRoute, this.time + 0.1)
            bot.catchUpUntil = Math.max(bot.catchUpUntil, this.time + 1.2)

            // Let the follow-up item fire immediately (usually a missile).
            const items = this.game.world.items
            if(items)
            {
                const state = items.state(bot.vehicle)
                state.nextAI = Math.min(state.nextAI, items.clock)
            }
        }
    }

    isFrenzied(vehicle)
    {
        if(!this.profile?.frenzy)
            return false

        for(const bot of this.items)
            if(bot.vehicle === vehicle)
                return this.time < (bot.frenzyUntil ?? 0)

        return false
    }

    // Extreme runs a split squad: chasers never detour, runners keep fetching
    // items for the pack. Easy rivals cannot use consumables, so they only
    // chase upgrades.
    findPickup(bot)
    {
        const vehicle = bot.vehicle
        const powerups = this.game.world.powerups
        if(!powerups)
            return null

        if(this.profile.chaseSquad)
        {
            if(bot.role === 'chase')
                return null

            const upgrade = powerups.nearestFor(vehicle, { upgradesOnly: true, range: this.profile.buffRange ?? 60 })
            if(upgrade)
                return upgrade

            return powerups.nearestFor(vehicle, { range: this.profile.buffRange ?? 60 })
        }

        if(this.profile.botItems === false)
            return powerups.nearestFor(vehicle, { upgradesOnly: true, range: 24 })

        return powerups.nearestFor(vehicle)
    }

    // 3 chasers up to five rivals; a large pack (6–7) keeps 4.
    chaseSquadSize(total = this.items.length)
    {
        const profile = this.profile
        if(!profile?.chaseSquad)
            return 0

        return profile.chaseSquadLarge && total >= (profile.largeSquadAt ?? 6)
            ? profile.chaseSquadLarge
            : profile.chaseSquad
    }

    // Keep three (or four) rivals on the player while the rest farm; promote
    // and demote as cars die, revive, or the map runs out of pickups.
    updateRoles(force = false)
    {
        if(!this.profile?.chaseSquad)
            return
        if(!force && this.time < this.nextRoleUpdate)
            return

        this.nextRoleUpdate = this.time + (this.profile.roleRefresh ?? 2)

        const alive = this.items.filter(bot => !bot.vehicle.destroyed && bot.state !== 'waiting')
        if(!alive.length)
            return

        const player = this.game.physicalVehicle.position
        const distance = bot => bot.vehicle.position.distanceToSquared(player)
        const collectible = this.game.world.powerups?.items?.some(item => item.active) ?? false

        let desired = Math.min(this.chaseSquadSize(), alive.length)
        // Nothing left to farm: the whole pack joins the hunt.
        if(!collectible)
            desired = alive.length

        const chasers = alive.filter(bot => bot.role === 'chase')

        if(chasers.length < desired)
        {
            const candidates = alive
                .filter(bot => bot.role !== 'chase')
                .sort((a, b) => distance(a) - distance(b))

            while(chasers.length < desired && candidates.length)
            {
                const bot = candidates.shift()
                bot.role = 'chase'
                chasers.push(bot)
            }
        }
        else if(chasers.length > desired)
        {
            chasers.sort((a, b) => distance(b) - distance(a))

            while(chasers.length > desired)
                chasers.shift().role = 'collect'
        }
    }

    botFor(vehicle)
    {
        for(const bot of this.items)
            if(bot.vehicle === vehicle)
                return bot

        return null
    }

    // Same numbers the combat system uses: speed white value × POWER.
    impactStrength(vehicle)
    {
        const velocity = vehicle.chassis.physical.body.linvel()
        const forwardSpeed = velocity.x * vehicle.forward.x + velocity.z * vehicle.forward.z
        const speed = speedWhiteValue(Math.abs(forwardSpeed), vehicle.upgrades.speedMultiplier, vehicle.drivingSpeedRange.normal, vehicle.drivingSpeedRange.boost)
        return vehicle.upgrades.powerMultiplier * speed
    }

    canReviveBot(bot)
    {
        return !!bot && (bot.lives ?? 0) > 0
    }

    // Extreme rivals are a pack: collisions between them never deal damage.
    isFriendlyPair(a, b)
    {
        if(!this.profile?.noFriendlyFire || !a || !b)
            return false

        const player = this.game.physicalVehicle
        return a !== player && b !== player
    }

    // Airborne over water: steer for the closest dry ground instead of the
    // target, so a mid-air jetpack can actually reach the shore.
    escapeAim(vehicle)
    {
        if(!vehicle.jumpState.airborne)
            return null

        const navigation = this.game.navigation
        if(!navigation)
            return null

        const position = vehicle.position
        const ground = navigation.groundAt(position.x, position.z)
        if(ground !== null && this.game.water.depthAt({ x: position.x, y: ground, z: position.z }) <= 0.15)
            return null

        let best = null
        let bestDistance = Infinity
        for(let i = 0; i < 12; i++)
        {
            const angle = i / 12 * Math.PI * 2
            for(const radius of [12, 22, 34])
            {
                const x = position.x + Math.cos(angle) * radius
                const z = position.z + Math.sin(angle) * radius
                const sample = navigation.groundAt(x, z)
                if(sample === null)
                    continue
                if(this.game.water.depthAt({ x, y: sample, z }) > 0.15)
                    continue
                if(radius < bestDistance)
                {
                    bestDistance = radius
                    best = { x, z }
                }
                break
            }
        }

        if(!best)
            return null

        return this.escapePoint.set(best.x, position.y, best.z)
    }

    // Keep pack members from ramming each other while they converge.
    separateFromMates(bot, heading)
    {
        const position = bot.vehicle.position
        const forwardX = Math.cos(heading), forwardZ = Math.sin(heading)

        for(const other of this.items)
        {
            if(other === bot || other.state === 'waiting' || other.vehicle.destroyed)
                continue

            const dx = other.vehicle.position.x - position.x
            const dz = other.vehicle.position.z - position.z
            if(dx * dx + dz * dz > 25)
                continue
            if(dx * forwardX + dz * forwardZ < 0.5)
                continue

            const side = dx * -forwardZ + dz * forwardX
            bot.controls.steering = side > 0 ? -0.9 : 0.9
            return true
        }

        return false
    }

    // VehicleItems asks this so extreme missiles lock onto the player.
    focusTargetOf(vehicle)
    {
        if(!this.profile?.focusPlayer)
            return null

        return this.botFor(vehicle) ? this.game.physicalVehicle : null
    }

    onBotDestroyed(vehicle)
    {
        const bot = this.botFor(vehicle)
        if(!bot)
            return

        bot.lives = Math.max(0, (bot.lives ?? 1) - 1)
        if(bot.lives <= 0)
        {
            this.updateRoles(true)
            return
        }

        // Spare life: come back after a short delay instead of staying wrecked.
        bot.state = 'waiting'
        bot.stuckTime = bot.upsideTime = bot.recoveries = 0
        bot.reverseUntil = 0
        bot.frenzyUntil = 0
        bot.nextRoute = 0
        bot.route = []
        bot.nextSpawn = this.time + 2
        this.setVisible(bot, false)
        this.updateRoles(true)
    }

    updateBot(bot, dt)
    {
        const { controls, vehicle } = bot
        controls.accelerating = controls.steering = controls.boosting = controls.braking = 0
        if(vehicle.destroyed)
        {
            // Extreme rivals wait out a short delay, then spend their spare life.
            if(bot.state === 'waiting' && this.canReviveBot(bot))
            {
                if(this.time >= bot.nextSpawn)
                    this.respawn(bot)
                return
            }

            bot.state = 'destroyed'
            return
        }
        // Airborne over water beats any other goal: aim for the nearest shore.
        const escape = this.escapeAim(vehicle)
        if(escape)
        {
            const heading = Math.atan2(vehicle.forward.z, vehicle.forward.x)
            const desired = Math.atan2(escape.z - vehicle.position.z, escape.x - vehicle.position.x)
            const error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading))
            controls.steering = THREE.MathUtils.clamp(-error * this.profile.steerGain, -1, 1)
            controls.accelerating = 1
            controls.boosting = 1
            bot.aimPoint.copy(escape)
            bot.state = 'escape'
            if(bot.visual.antenna) bot.visual.antenna.target.copy(escape)
            return
        }

        if(vehicle.launch?.active) { bot.state = 'launched'; return }
        if(bot.state === 'waiting')
        {
            if(this.time >= bot.nextSpawn) this.respawn(bot)
            return
        }
        const position = vehicle.position
        const ground = this.navigation.groundAt(position.x, position.z)
        // Let a car pushed offshore actually sink. Damage is decided from the
        // roof/body height after physics, never by an automatic AI teleport.
        if(ground === null || this.game.water.depthAt(position) > 0.15)
        {
            bot.state = 'sinking'
            return
        }
        if(position.y < ground - 3)
        {
            if(this.time >= bot.nextSpawn && !this.respawn(bot, vehicle.position))
            {
                vehicle.deactivate()
                bot.state = 'waiting'
                this.setVisible(bot, false)
            }
            return
        }

        bot.upsideTime = vehicle.upsideDown.active ? bot.upsideTime + dt : 0
        if(bot.upsideTime > 1.5)
        {
            bot.state = 'recover'
            if(bot.upsideTime > 1.5 + vehicle.recoveryDelay && this.time - bot.lastFlip > 2.5 && (!vehicle.explosionRecovery.extra || vehicle.explosionRecovery.elapsed >= 2))
            {
                vehicle.flip.jump()
                bot.lastFlip = this.time
            }
            if(bot.upsideTime > 7 + vehicle.recoveryDelay) this.respawn(bot, vehicle.position)
            return
        }

        if(this.time < bot.reverseUntil)
        {
            bot.state = 'reverse'
            controls.accelerating = -0.8
            controls.steering = bot.reverseSteer
            return
        }
        if(!bot.target || this.time > bot.nextTarget || !bot.target.chassis.physical.body.isEnabled()) this.chooseTarget(bot)
        const profile = this.profile
        const frenzied = this.time < bot.frenzyUntil
        const pickup = this.findPickup(bot)
        if(bot.pickupId !== (pickup?.id ?? null)) { bot.pickupId = pickup?.id ?? null; bot.nextRoute = 0 }

        // Hard rivals lead the target and fan out instead of queuing behind it.
        bot.aimPoint.copy(pickup?.position ?? bot.target.position)
        if(!pickup)
        {
            if(profile.lead)
                bot.aimPoint.addScaledVector(bot.target.velocity, profile.lead / this.game.ticker.deltaScaled)
            if(profile.flank)
            {
                // Spread every rival across the target's width: -1 … +1.
                const count = Math.max(1, this.items.length)
                const spread = count > 1 ? (bot.index - (count - 1) / 2) / ((count - 1) / 2) : 0
                const side = profile.flank * spread
                bot.aimPoint.x += -bot.target.forward.z * side
                bot.aimPoint.z += bot.target.forward.x * side
            }
        }

        const target = bot.aimPoint
        const distance = Math.hypot(target.x - position.x, target.z - position.z)
        if(this.time >= bot.nextRoute)
        {
            bot.direct = distance < profile.directRange && this.navigation.clearLine(position, target)
            bot.route = bot.direct ? [] : this.navigation.path(position, target)
            bot.nextRoute = this.time + profile.routeInterval + bot.index * 0.12
        }
        while(bot.route.length && Math.hypot(bot.route[0].x - position.x, bot.route[0].z - position.z) < 2.5) bot.route.shift()
        const aim = bot.direct ? target : bot.route[0]
        if(!aim)
        {
            controls.braking = 0.5
            bot.state = 'search'
            bot.stuckTime += dt
            if(bot.stuckTime > 3) { this.chooseTarget(bot); this.reverse(bot) }
            return
        }

        const heading = Math.atan2(vehicle.forward.z, vehicle.forward.x)
        const desired = Math.atan2(aim.z - position.z, aim.x - position.x)
        const error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading))
        controls.steering = THREE.MathUtils.clamp(-error * profile.steerGain, -1, 1)
        controls.accelerating = Math.abs(error) > 1 ? 0.6 : 1
        bot.state = pickup ? 'scavenge' : 'chase'

        // Probe the car's swept width. Vehicles remain valid collision targets.
        const lookAhead = 4 + Math.min(vehicle.speed, 15) * 0.3
        let blocked = false
        for(const side of [-0.9, 0, 0.9])
        {
            const origin = { x: position.x - Math.sin(heading) * side, y: position.y, z: position.z + Math.cos(heading) * side }
            const hit = this.game.physics.world.castRay(
                new this.game.RAPIER.Ray(origin, { x: Math.cos(heading), y: 0, z: Math.sin(heading) }),
                lookAhead, true, undefined, undefined, undefined, vehicle.chassis.physical.body,
                this.navigation.isObstacle
            )
            if(hit) blocked = true
        }
        const ahead = this.navigation.sample(position.x + Math.cos(heading) * lookAhead, position.z + Math.sin(heading) * lookAhead)
        if(blocked || !ahead)
        {
            if(blocked && ahead && vehicle.upgrades.jump && this.time - (bot.lastJump ?? -10) > 4 && vehicle.requestJump()) bot.lastJump = this.time
            controls.accelerating = 0.35
            controls.steering = Math.abs(error) > 0.15 ? Math.sign(-error) : (bot.index % 2 ? 1 : -1)
            controls.braking = vehicle.speed > 5 ? 0.35 : 0
            bot.chargeUntil = 0
            bot.nextRoute = Math.min(bot.nextRoute, this.time + 0.25)
        }
        else if(bot.direct && distance > profile.chargeNear && distance < profile.chargeFar && Math.abs(error) < profile.chargeError && this.time >= bot.nextCharge)
        {
            bot.chargeUntil = this.time + profile.chargeWindow
            bot.nextCharge = this.time + (frenzied ? 0.9 : profile.chargeCooldown + Math.random() * profile.chargeCooldownRandom)
        }

        // A distant rival may keep boosting to close the gap. This is the same
        // resource the player holds with Shift, not a hidden speed multiplier.
        if(profile.catchUp && !pickup && distance > profile.catchUp && this.time >= bot.nextCatchUp)
        {
            bot.catchUpUntil = this.time + profile.catchUpDuration
            bot.nextCatchUp = this.time + 6
        }

        // Extreme rivals check their own impact force before committing: a hit
        // only pays off when speed × POWER can reach the heavy-launch threshold.
        if(profile.heavyRam && !pickup && bot.target === this.game.physicalVehicle)
        {
            const strength = this.impactStrength(vehicle)
            const aligned = bot.direct && !blocked && ahead && Math.abs(error) < 0.2

            if(aligned && distance > 9 && distance < profile.directRange && strength >= profile.ramStrength)
            {
                bot.chargeUntil = Math.max(bot.chargeUntil, this.time + 1.2)
                bot.nextCharge = this.time + 2.4
                bot.state = 'ram'
                controls.boosting = 1
                controls.braking = 0
            }
            else if(strength < profile.ramStrength)
            {
                if(distance < 9)
                {
                    // Too close for a strong hit: swerve off and build speed again.
                    bot.chargeUntil = 0
                    controls.accelerating = 0.35
                    controls.braking = Math.max(controls.braking, 0.4)
                    controls.steering = bot.index % 2 ? 1 : -1
                }
                else if(!blocked && ahead && Math.abs(error) < 0.6)
                {
                    controls.boosting = 1
                }
            }
        }

        if(this.time < bot.chargeUntil && Math.abs(error) < 0.45 && vehicle.speed < 16 && !blocked && ahead)
        {
            controls.boosting = 1
            bot.state = 'charge'
        }
        else if(this.time < bot.catchUpUntil && !blocked && ahead && Math.abs(error) < 0.5)
        {
            controls.boosting = 1
            bot.state = 'pursuit'
        }
        // Pack members sidestep each other instead of rear-ending on the way in.
        if(this.profile.packSpacing && this.separateFromMates(bot, heading))
        {
            controls.boosting = 0
            bot.chargeUntil = 0
            bot.state = 'spacing'
        }

        if(Math.abs(error) > 0.7 && vehicle.speed > 7) controls.braking = 0.25
        if(vehicle.upgrades.jump && vehicle.jumpState.airborne && vehicle.jumpState.used === 1 && vehicle.chassis.physical.body.linvel().y < -0.5) vehicle.requestJump()

        bot.stuckTime = vehicle.speed < 0.65 ? bot.stuckTime + dt : Math.max(0, bot.stuckTime - dt * 0.5)
        if(bot.stuckTime > profile.stuckLimit || (distance < 3.2 && vehicle.speed < 2)) this.reverse(bot)
        if(bot.recoveries >= 4)
        {
            this.respawn(bot, vehicle.position)
            return
        }
        if(vehicle.speed > 2 && bot.stuckTime === 0) bot.recoveries = 0
        if(bot.visual.antenna) bot.visual.antenna.target.copy(target)
    }

    update()
    {
        const ready = !this.game.editorPaused && !this.game.escMenu?.isOpen && !this.game.match?.ended &&
            !this.game.inputs.filters.has('intro') && this.game.player.state === 1 &&
            this.game.physicalVehicle.chassis.physical.body.isEnabled()
        if(!ready)
        {
            for(const bot of this.items)
            {
                bot.controls.accelerating = bot.controls.steering = bot.controls.boosting = 0
                bot.controls.braking = 1
                // Do not let bots hit the player while menus/respawn are open.
                if(!bot.suspended)
                {
                    bot.savedVelocity = { ...bot.vehicle.chassis.physical.body.linvel() }
                    bot.savedAngularVelocity = { ...bot.vehicle.chassis.physical.body.angvel() }
                    bot.vehicle.deactivate()
                    bot.suspended = true
                }
            }
            return
        }
        if(!this.started)
        {
            // Let Rapier register the freshly constructed terrain and props first.
            if(this.warmupFrames-- > 0) return
            this.start()
        }
        const dt = this.game.ticker.delta
        this.time += dt
        this.updateRoles()
        for(const bot of this.items)
        {
            if(bot.suspended)
            {
                if(bot.state !== 'waiting' && !bot.vehicle.destroyed)
                {
                    bot.vehicle.activate()
                    bot.vehicle.chassis.physical.body.setLinvel(bot.savedVelocity, true)
                    bot.vehicle.chassis.physical.body.setAngvel(bot.savedAngularVelocity, true)
                }
                bot.suspended = false
            }
            this.updateBot(bot, dt)
        }
    }
}
