import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { PhysicsVehicle } from '../Physics/PhysicsVehicle.js'
import { VisualVehicle } from './VisualVehicle.js'
import { VehicleNavigation } from './VehicleNavigation.js'

const PAINTS = [
    { name: 'blue', top: '#38bfff', bottom: '#174db5' },
    { name: 'yellow', top: '#ffe15b', bottom: '#d67b13' },
    { name: 'purple', top: '#d38bff', bottom: '#7131bb' },
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
        this.navigation = new VehicleNavigation(this.game)
        this.configureCollision(this.game.physicalVehicle)
        for(let index = 0; index < PAINTS.length; index++)
        {
            const controls = { accelerating: 0, steering: 0, braking: 0, boosting: 0, suspensions: ['low', 'low', 'low', 'low'] }
            const vehicle = new PhysicsVehicle({ controls })
            this.configureCollision(vehicle)
            vehicle.deactivate()
            const paint = PAINTS[index]
            const material = this.game.materials.createGradient(`rival-${paint.name}`, paint.top, paint.bottom)
            const visual = new VisualVehicle(this.model.clone(true), { physicalVehicle: vehicle, controls, paintMaterial: material })
            const bot = {
                index, color: paint.name, controls, vehicle, visual,
                state: 'waiting', target: null, route: [], nextRoute: 0,
                nextTarget: index * 1.5, reverseUntil: 0, reverseSteer: 1,
                chargeUntil: 0, nextCharge: 3 + index, stuckTime: 0,
                upsideTime: 0, lastFlip: -10, recoveries: 0, nextSpawn: 0,
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

    spawnPosition(bot)
    {
        const anchor = this.game.physicalVehicle.position
        for(let attempt = 0; attempt < 48; attempt++)
        {
            const angle = bot.index * Math.PI * 2 / 3 + attempt * 2.39996
            const radius = 11 + Math.floor(attempt / 12) * 5
            const ground = this.navigation.sample(anchor.x + Math.cos(angle) * radius, anchor.z + Math.sin(angle) * radius)
            if(!ground) continue
            const position = ground.clone().add(new THREE.Vector3(0, 1.7, 0))
            // New bodies are absent from Rapier's query index until the next step.
            // Check other cars explicitly when spawning several in the same frame.
            if(this.items.some(other => other !== bot && other.state !== 'waiting' && other.vehicle.position.distanceTo(position) < 6)) continue
            let occupied = false
            this.game.physics.world.intersectionsWithShape(
                position, this.navigation.identity, new this.game.RAPIER.Ball(2.8),
                () => { occupied = true; return false },
                undefined, undefined, undefined, bot.vehicle.chassis.physical.body,
                collider => !collider.isSensor() && !this.navigation.isGround(collider)
            )
            if(occupied) continue
            if(!this.navigation.clearLine(ground, anchor) && this.navigation.path(ground, anchor, false).length === 0) continue
            return position
        }
        return null
    }

    respawn(bot)
    {
        if(bot.vehicle.destroyed) return false
        const position = this.spawnPosition(bot)
        bot.nextSpawn = this.time + 2
        if(!position) return false
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
        bot.nextRoute = 0
        bot.route = []
        this.setVisible(bot, true)
        return true
    }

    chooseTarget(bot)
    {
        const opponents = [this.game.physicalVehicle, ...this.items.filter(other => other !== bot && other.state !== 'waiting').map(other => other.vehicle)]
        // Alternate opponents so the player is not permanently dogpiled.
        const available = opponents.filter(vehicle => vehicle !== bot.target && vehicle.chassis.physical.body.isEnabled())
        bot.target = available[Math.floor(Math.random() * available.length)] ?? opponents[0]
        bot.nextTarget = this.time + 5 + Math.random() * 3
        bot.nextRoute = 0
    }

    reverse(bot)
    {
        bot.reverseUntil = this.time + 1.3
        bot.reverseSteer = (bot.index + bot.recoveries) % 2 ? 1 : -1
        bot.recoveries++
        bot.stuckTime = 0
        bot.nextRoute = 0
        bot.chargeUntil = 0
    }

    updateBot(bot, dt)
    {
        const { controls, vehicle } = bot
        controls.accelerating = controls.steering = controls.boosting = controls.braking = 0
        if(vehicle.destroyed)
        {
            bot.state = 'destroyed'
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
            if(this.time >= bot.nextSpawn && !this.respawn(bot))
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
            if(this.time - bot.lastFlip > 2.5)
            {
                vehicle.flip.jump()
                bot.lastFlip = this.time
            }
            if(bot.upsideTime > 7) this.respawn(bot)
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
        const pickup = this.game.world.powerups?.nearestFor(vehicle)
        if(bot.pickupId !== (pickup?.id ?? null)) { bot.pickupId = pickup?.id ?? null; bot.nextRoute = 0 }
        const target = pickup?.position ?? bot.target.position
        const distance = Math.hypot(target.x - position.x, target.z - position.z)
        if(this.time >= bot.nextRoute)
        {
            bot.direct = distance < 30 && this.navigation.clearLine(position, target)
            bot.route = bot.direct ? [] : this.navigation.path(position, target)
            bot.nextRoute = this.time + 0.9 + bot.index * 0.12
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
        controls.steering = THREE.MathUtils.clamp(-error * 1.8, -1, 1)
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
        else if(bot.direct && distance > 6 && distance < 22 && Math.abs(error) < 0.22 && this.time >= bot.nextCharge)
        {
            bot.chargeUntil = this.time + 0.75
            bot.nextCharge = this.time + 4 + Math.random() * 2
        }
        if(this.time < bot.chargeUntil && Math.abs(error) < 0.45 && vehicle.speed < 16 && !blocked && ahead)
        {
            controls.boosting = 1
            bot.state = 'charge'
        }
        if(Math.abs(error) > 0.7 && vehicle.speed > 7) controls.braking = 0.25
        if(vehicle.upgrades.jump && vehicle.jumpState.airborne && vehicle.jumpState.used === 1 && vehicle.chassis.physical.body.linvel().y < -0.5) vehicle.requestJump()

        bot.stuckTime = vehicle.speed < 0.65 ? bot.stuckTime + dt : Math.max(0, bot.stuckTime - dt * 0.5)
        if(bot.stuckTime > 1.8 || (distance < 3.2 && vehicle.speed < 2)) this.reverse(bot)
        if(bot.recoveries >= 4)
        {
            this.respawn(bot)
            return
        }
        if(vehicle.speed > 2 && bot.stuckTime === 0) bot.recoveries = 0
        if(bot.visual.antenna) bot.visual.antenna.target.copy(target)
    }

    update()
    {
        const ready = !this.game.editorPaused && !this.game.escMenu?.isOpen &&
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
