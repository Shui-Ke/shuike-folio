import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { Events } from '../Events.js'
import { lerp, remap, remapClamp, smallestAngle } from '../utilities/maths.js'
import { VehicleUpgrades } from '../VehicleUpgrades.js'
import { VEHICLE_SCALE } from '../WorldLayout.js'

export class PhysicsVehicle
{
    constructor(options = {})
    {
        this.game = Game.getInstance()
        this.controlSource = options.controls
        this.destroyed = false
        this.explosionRecovery = { pending: 0, extra: 0, elapsed: 0 }
        this.scale = VEHICLE_SCALE
        this.upgrades = new VehicleUpgrades()
        this.jumpState = { used: 0, airborne: false, lastRequest: -Infinity, takeoffSpeed: 0, airOffset: new THREE.Vector3() }

        this.events = new Events()

        this.steeringAmplitude = 0.5
        this.engineForceAmplitude = 300
        this.boostMultiplier = 2
        this.topSpeed = 5
        this.topSpeedBoost = 40
        // Measured on the original suspension/drive setup; topSpeed above is
        // the motor's soft-force threshold, not the actual cruising velocity.
        this.drivingSpeedRange = { normal: 11, boost: 22 }
        this.brakeAmplitude = 35
        this.idleBrake = 0.06
        this.reverseBrake = 0.4

        this.sideward = new THREE.Vector3(0, 0, 1)
        this.upward = new THREE.Vector3(0, 1, 0)
        this.forward = new THREE.Vector3(1, 0, 0)
        this.position = new THREE.Vector3(0, 4, 0)
        if(options.position) this.position.copy(options.position)
        this.quaternion = new THREE.Quaternion()
        this.velocity = new THREE.Vector3()
        this.direction = this.forward.clone()
        this.speed = 0
        this.suspensionsHeights = {
            low: 0.88 * this.scale,
            mid: 1.23 * this.scale,
            high: 1.63 * this.scale
        }
        this.suspensionsStiffness = {
            low: 20,
            mid: 30,
            high: 40
        }

        // Debug
        if(this.game.debug.active)
        {
            this.debugPanel = this.game.physics.debugPanel.addFolder({
                title: 'Vehicle',
                expanded: true,
            })

            this.debugPanel.addBinding(this, 'steeringAmplitude', { min: 0, max: Math.PI * 0.5, step: 0.01 })
            this.debugPanel.addBinding(this, 'engineForceAmplitude', { min: 1, max: 20, step: 1 })
            this.debugPanel.addBinding(this, 'boostMultiplier', { min: 1, max: 5, step: 0.01 })
            this.debugPanel.addBinding(this, 'topSpeed', { min: 0, max: 20, step: 0.1 })
            this.debugPanel.addBinding(this, 'topSpeedBoost', { min: 0, max: 20, step: 0.1 })
            this.debugPanel.addBinding(this, 'brakeAmplitude', { min: 0, max: 200, step: 0.01 })
            this.debugPanel.addBinding(this, 'idleBrake', { min: 0, max: 1, step: 0.001 })
            this.debugPanel.addBinding(this, 'reverseBrake', { min: 0, max: 1, step: 0.001 })

            this.debugPanel.addBinding(this.suspensionsHeights, 'low', { min: 0, max: 2, step: 0.01 })
            this.debugPanel.addBinding(this.suspensionsHeights, 'mid', { min: 0, max: 2, step: 0.01 })
            this.debugPanel.addBinding(this.suspensionsHeights, 'high', { min: 0, max: 2, step: 0.01 })

            this.debugPanel.addBinding(this.suspensionsStiffness, 'low', { min: 0, max: 100, step: 0.1 })
            this.debugPanel.addBinding(this.suspensionsStiffness, 'mid', { min: 0, max: 100, step: 0.1 })
            this.debugPanel.addBinding(this.suspensionsStiffness, 'high', { min: 0, max: 100, step: 0.1 })
        }

        this.setChassis()
        this.controller = this.game.physics.world.createVehicleController(this.chassis.physical.body)
        this.setWheels()
        this.setStop()
        this.setUpsideDown()
        this.setStuck()
        // this.setBackWheel()
        this.setFlip()

        this.prePhysicsCallback = () =>
        {
            this.updatePrePhysics()
        }
        this.postPhysicsCallback = () =>
        {
            this.updatePostPhysics()
        }
        this.game.ticker.events.on('tick', this.prePhysicsCallback, 2)
        this.game.ticker.events.on('tick', this.postPhysicsCallback, 5)
    }

    get controls()
    {
        // Player is constructed after its vehicle; resolve it lazily.
        return this.controlSource ?? this.game.player
    }

    destroy()
    {
        this.game.ticker.events.off('tick', this.prePhysicsCallback)
        this.game.ticker.events.off('tick', this.postPhysicsCallback)
        this.game.physics.world.removeVehicleController(this.controller)
        this.game.physics.world.removeRigidBody(this.chassis.physical.body)
        const physicals = this.game.physics.physicals
        const index = physicals.indexOf(this.chassis.physical)
        if(index !== -1) physicals.splice(index, 1)
        for(const [key, object] of this.game.objects.list)
            if(object.physical === this.chassis.physical) this.game.objects.list.delete(key)
    }

    setChassis()
    {
        this.chassis = {}
        const object = this.game.objects.add(null, {
            type: 'dynamic',
            position: this.position,
            friction: 0.4,
            rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Euler(0, 1, 0), Math.PI * 0),
            colliders: [
                { shape: 'cuboid', mass: 2.5, parameters: [ 1.3, 0.4, 0.85 ], position: { x: 0, y: -0.1, z: 0 }, centerOfMass: { x: 0, y: -0.5, z: 0 } }, // Main
                { shape: 'cuboid', mass: 0, parameters: [ 0.5, 0.15, 0.65 ], position: { x: 0, y: 0.4, z: 0 } }, // Top
                { shape: 'cuboid', mass: 0, parameters: [ 1.5, 0.5, 0.9 ], position: { x: 0.1, y: -0.2, z: 0 }, category: 'bumper' }, // Bumper
            ].map(collider => ({ ...collider,
                parameters: collider.parameters.map(value => value * this.scale),
                position: Object.fromEntries(Object.entries(collider.position).map(([axis, value]) => [axis, value * this.scale])),
                // Keep mass/drive forces unchanged, but account for the larger
                // chassis in its rotational inertia so boost stays stable.
                ...(collider.centerOfMass ? {
                    // Offset the extra ride height to retain the original
                    // center-of-mass height above the wheel contact plane.
                    centerOfMass: { x: 0, y: -0.5 * this.scale - 0.68 * (this.scale - 1), z: 0 },
                    principalAngularInertia: { x: this.scale ** 2, y: this.scale ** 2, z: this.scale ** 2 },
                } : {}),
            })),
            canSleep: false,
            waterGravityMultiplier: 0,
            onCollision: (force, position) =>
            {
                this.game.audio.groups.get('hitDefault').playRandomNext(force, position)
            }
        })
        this.chassis.physical = object.physical
        this.chassis.physical.body.enableCcd(true)
        this.chassis.mass = this.chassis.physical.body.mass()
    }

    setWheels()
    {
        // Setup
        this.wheels = {}
        this.wheels.inContactCount = 0
        this.wheels.justTouchedCount = 0
        this.wheels.items = []

        // Create wheels
        for(let i = 0; i < 4; i++)
        {
            const wheel = {}

            wheel.inContact = false
            wheel.contactPoint = null
            wheel.suspensionLength = null
            wheel.suspensionState = 'low'
            wheel.lastTouchTime = this.game.ticker.elapsed

            // Default wheel with random parameters
            this.controller.addWheel(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), 1, 1)

            // Base position
            wheel.basePosition = new THREE.Vector3()

            this.wheels.items.push(wheel)
        }

        // Settings
        this.wheels.settings = {
            offset: { x: 0.90 * this.scale, y: 0, z: 0.75 * this.scale },
            radius: 0.4 * this.scale,
            directionCs: { x: 0, y: -1, z: 0 },
            axleCs: { x: 0, y: 0, z: 1 },
            frictionSlip: 0.9,
            maxSuspensionForce: 150,
            maxSuspensionTravel: 2,
            sideFrictionStiffness: 3,
            suspensionCompression: 10,
            suspensionRelaxation: 2.7,
            suspensionStiffness: 25,
        }

        this.wheels.updateSettings = () =>
        {
            this.wheels.perimeter = this.wheels.settings.radius * Math.PI * 2

            const wheelsPositions = [
                new THREE.Vector3(  this.wheels.settings.offset.x, this.wheels.settings.offset.y,   this.wheels.settings.offset.z),
                new THREE.Vector3(  this.wheels.settings.offset.x, this.wheels.settings.offset.y, - this.wheels.settings.offset.z),
                new THREE.Vector3(- this.wheels.settings.offset.x, this.wheels.settings.offset.y,   this.wheels.settings.offset.z),
                new THREE.Vector3(- this.wheels.settings.offset.x, this.wheels.settings.offset.y, - this.wheels.settings.offset.z),
            ]
            
            let i = 0
            for(const wheel of this.wheels.items)
            {
                wheel.basePosition.copy(wheelsPositions[i])
                
                this.controller.setWheelDirectionCs(i, this.wheels.settings.directionCs)
                this.controller.setWheelAxleCs(i, this.wheels.settings.axleCs)
                this.controller.setWheelRadius(i, this.wheels.settings.radius)
                this.controller.setWheelChassisConnectionPointCs(i, wheel.basePosition)
                this.controller.setWheelFrictionSlip(i, this.wheels.settings.frictionSlip)
                this.controller.setWheelMaxSuspensionForce(i, this.wheels.settings.maxSuspensionForce)
                this.controller.setWheelMaxSuspensionTravel(i, this.wheels.settings.maxSuspensionTravel)
                this.controller.setWheelSideFrictionStiffness(i, this.wheels.settings.sideFrictionStiffness)
                this.controller.setWheelSuspensionCompression(i, this.wheels.settings.suspensionCompression)
                this.controller.setWheelSuspensionRelaxation(i, this.wheels.settings.suspensionRelaxation)

                i++
            }
        }

        this.wheels.updateSettings()

        // Debug
        if(this.game.debug.active)
        {
            this.debugPanel.addBlade({ view: 'separator' })
            this.debugPanel.addBinding(this.wheels.settings, 'offset', { min: -1, max: 2, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'radius', { min: 0, max: 1, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'frictionSlip', { min: 0, max: 1, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'maxSuspensionForce', { min: 0, max: 1000, step: 1 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'maxSuspensionTravel', { min: 0, max: 2, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'sideFrictionStiffness', { min: 0, max: 10, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'suspensionCompression', { min: 0, max: 30, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'suspensionRelaxation', { min: 0, max: 10, step: 0.01 }).on('change', this.wheels.updateSettings)
            this.debugPanel.addBinding(this.wheels.settings, 'suspensionStiffness', { min: 0, max: 100, step: 0.1 }).on('change', this.wheels.updateSettings)
        }
    }

    setStop()
    {
        this.stop = {}
        this.stop.active = true
        this.stop.lowThreshold = 0.04
        this.stop.highThreshold = 0.7

        this.stop.test = () =>
        {

            if(this.speed < this.stop.lowThreshold)
            {
                if(!this.stop.active)
                {
                    this.stop.active = true
                    this.events.trigger('stop')
                }
            }
            else if(this.speed > this.stop.highThreshold)
            {
                if(this.stop.active)
                {
                    this.stop.active = false
                    this.events.trigger('start')
                }
            }
        }
    }

    setUpsideDown()
    {
        this.upsideDown = {}
        this.upsideDown.active = false
        this.upsideDown.ratio = 0
        this.upsideDown.threshold = 0.3

        this.upsideDown.test = () =>
        {
            this.upsideDown.ratio = this.upward.dot(new THREE.Vector3(0, - 1, 0)) * 0.5 + 0.5

            if(this.upsideDown.ratio > this.upsideDown.threshold)
            {
                if(!this.upsideDown.active)
                {
                    this.upsideDown.active = true
                    this.events.trigger('upsideDown', [ this.upsideDown.ratio ])
                }
            }
            else
            {
                if(this.upsideDown.active)
                {
                    this.upsideDown.active = false
                    this.events.trigger('rightSideUp')
                }
            }
        }
    }

    setStuck()
    {
        this.stuck = {}
        this.stuck.durationTest = 3
        this.stuck.durationSaved = 0
        this.stuck.savedItems = []
        this.stuck.distance = 0
        this.stuck.distanceThreshold = 0.5
        this.stuck.active = false

        this.stuck.accumulate = (traveled, time) =>
        {
            this.stuck.savedItems.unshift([traveled, time])
            this.stuck.distance = 0
            this.stuck.durationSaved = 0

            for(let i = 0; i < this.stuck.savedItems.length; i++)
            {
                const item = this.stuck.savedItems[i]

                if(this.stuck.durationSaved >= this.stuck.durationTest)
                {
                    this.stuck.savedItems.splice(i)
                    break
                }
                else
                {
                    this.stuck.distance += item[0]
                    this.stuck.durationSaved += item[1]
                }
            }
        }

        this.stuck.test = () =>
        {
            if(this.stuck.durationSaved >= this.stuck.durationTest && this.stuck.distance < this.stuck.distanceThreshold)
            {
                if(!this.stuck.active)
                {
                    this.stuck.active = true
                    this.events.trigger('stuck')
                }
            }
            else
            {
                if(this.stuck.active)
                {
                    this.stuck.active = false
                    this.events.trigger('unstuck')
                }
            }
        }
    }

    // setBackWheel()
    // {
    //     this.backWheel = {}
    //     this.backWheel.active = false
    //     this.backWheel.test = () =>
    //     {
    //         if(
    //             this.zRotation > 1 && this.zRotation < 1.7 &&
    //             this.wheels.items[2].inContact && this.wheels.items[3].inContact
    //         )
    //         {
    //             if(!this.backWheel.active)
    //             {
    //                 this.backWheel.active = true
    //                 this.events.trigger('backWheel', [ this.backWheel.active ])
    //             }
    //         }
    //         else
    //         {
    //             if(this.backWheel.active)
    //             {
    //                 this.backWheel.active = false
    //                 this.events.trigger('backWheel', [ this.backWheel.active ])
    //             }
    //         }
    //     }
    // }

    setFlip()
    {
        this.flip = {}
        this.flip.force = 5
        let inAir = false
        
        let previousXAngle = 0
        let accumulatedXAngle = 0

        let previousZAngle = 0
        let accumulatedZAngle = 0

        this.flip.test = () =>
        {
            // Every wheel stop touching
            if(this.wheels.inContactCount === 0)
            {
                // Wasn't in the air => Start
                if(!inAir)
                {
                    inAir = true
                    
                    previousXAngle = this.xRotation
                    accumulatedXAngle = 0
                    
                    previousZAngle = this.zRotation
                    accumulatedZAngle = 0
                }
            }

            // 4 wheels are touching
            if(this.wheels.inContactCount >= 4)
            {
                // Was in the air => stop
                if(inAir)
                {
                    inAir = false

                    if(
                        Math.abs(accumulatedXAngle) < 1 &&
                        Math.abs(accumulatedZAngle) > 5
                    )
                    {
                        this.events.trigger('flip', [ Math.sign(accumulatedZAngle) ])
                    }
                }
            }
            else
            {
                if(inAir)
                {
                    accumulatedXAngle += smallestAngle(previousXAngle, this.xRotation)
                    previousXAngle = this.xRotation

                    accumulatedZAngle += smallestAngle(previousZAngle, this.zRotation)
                    previousZAngle = this.zRotation
                }
            }
        }

        this.flip.jump = () =>
        {
            if(this.explosionRecovery.extra && this.explosionRecovery.elapsed < 2) return false
            accumulatedXAngle = 0
            accumulatedZAngle = 0

            const up = new THREE.Vector3(0, 1, 0)
            const sidewardDot = up.dot(this.sideward)
            const forwardDot = up.dot(this.forward)
            const upwarddDot = up.dot(this.upward)
            
            const sidewardAbsolute = Math.abs(sidewardDot)
            const forwardAbsolute = Math.abs(forwardDot)
            const upwarddAbsolute = Math.abs(upwarddDot)

            const impulse = new THREE.Vector3(0, 1, 0).multiplyScalar(this.flip.force * this.chassis.mass)
            this.chassis.physical.body.applyImpulse(impulse)

            // Upside down
            if(upwarddAbsolute > sidewardAbsolute && upwarddAbsolute > forwardAbsolute)
            {
                const torqueX = 0.8 * this.chassis.mass
                const torque = new THREE.Vector3(torqueX, 0, 0)
                torque.applyQuaternion(this.chassis.physical.body.rotation())
                this.chassis.physical.body.applyTorqueImpulse(torque)
            }
            // On the side
            else
            {
                const torqueX = sidewardDot * 0.4 * this.chassis.mass
                const torqueZ = - forwardDot * 0.8 * this.chassis.mass
                const torque = new THREE.Vector3(torqueX, 0, torqueZ)
                torque.applyQuaternion(this.chassis.physical.body.rotation())
                this.chassis.physical.body.applyTorqueImpulse(torque)
            }
        }

        if(this.game.debug.active)
        {
            this.debugPanel.addBinding(this.flip, 'force', { label: 'flipForce', min: 0, max: 10, step: 0.01 })
        }
    }

    moveTo(position, rotation = 0)
    {
        Object.assign(this.explosionRecovery, { pending: 0, extra: 0, elapsed: 0 })
        const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation)
        this.chassis.physical.body.setTranslation(position)
        this.chassis.physical.body.setRotation(quaternion)
        this.chassis.physical.body.setLinvel({ x: 0, y: 0, z: 0 })
        this.chassis.physical.body.setAngvel({ x: 0, y: 0, z: 0 })

        this.position.copy(position)
        this.quaternion.copy(quaternion)
        this.velocity.set(0, 0, 0)
        this.speed = this.xzSpeed = this.forwardSpeed = 0
        this.forward.set(1, 0, 0).applyQuaternion(quaternion)
        this.upward.set(0, 1, 0).applyQuaternion(quaternion)
        this.jumpState.used = 0
        this.jumpState.jetFlight = false
        this.jumpState.airborne = false
        this.jumpState.lastRequest = -Infinity
        this.jumpState.airOffset.set(0, 0, 0)
        this.wheels.inContactCount = 0
        if(this.launch) this.launch.active = false
    }

    requestJump()
    {
        const body = this.chassis.physical.body
        const state = this.jumpState
        if(this.destroyed || this.launch?.active || !body.isEnabled() || this.game.editorPaused || this.game.escMenu?.isOpen) return false
        if(this.game.water.depthAt(body.translation()) > 0.15) return false
        if(this.game.ticker.elapsed - state.lastRequest < 0.18) return false
        const grounded = this.wheels.inContactCount >= 2 && !state.airborne
        const jet = this.game.world.items?.state(this).jet
        if(jet) {
            if(!this.game.world.items.jetJump(this)) return false
        }
        else if(!grounded && (this.upgrades.maxJumps < 2 || Math.max(1, state.used) >= this.upgrades.maxJumps)) return false
        if(this.upsideDown.active && this.explosionRecovery.extra && this.explosionRecovery.elapsed < 2) return false
        if(grounded && this.upsideDown.active) { this.flip.jump(); return true }
        const velocity = body.linvel()
        state.used = grounded ? 1 : Math.max(1, state.used) + 1
        state.lastRequest = this.game.ticker.elapsed
        if(grounded)
        {
            state.takeoffSpeed = Math.hypot(velocity.x, velocity.z)
            state.airOffset.set(0, 0, 0)
        }
        // The second press cancels falling first, so the extra jump is readable.
        body.setLinvel({ x: velocity.x, y: Math.max(0, velocity.y) + 5.5, z: velocity.z }, true)
        return true
    }

    get recoveryDelay()
    {
        return this.explosionRecovery.pending > 0 || this.explosionRecovery.extra > 0 ? 2 : 0
    }

    markExplosionHit()
    {
        this.explosionRecovery.pending = 2
        if(this.upsideDown.active) {
            this.explosionRecovery.extra = 2
            this.explosionRecovery.elapsed = 0
            this.events.trigger('upsideDown')
        }
    }

    updateAirControl()
    {
        const state = this.jumpState
        if(!state.airborne || this.wheels.inContactCount > 0 || this.game.water.depthAt(this.position) > 0.15) return
        if(state.jetFlight) {
            const limit = lerp(this.drivingSpeedRange.normal, this.drivingSpeedRange.boost, this.controls.boosting) * this.upgrades.speedMultiplier * (this.game.world.items?.speedFactor(this) ?? 1)
            const direction = this.forward.clone().setY(0).normalize().multiplyScalar(this.controls.accelerating)
                .add(this.sideward.clone().setY(0).normalize().multiplyScalar(-this.controls.steering))
            if(direction.lengthSq() > 1) direction.normalize()
            direction.multiplyScalar(limit)
            const body = this.chassis.physical.body, velocity = body.linvel()
            const blend = Math.min(1, this.game.ticker.deltaScaled * 5)
            body.setLinvel({ x: lerp(velocity.x, direction.x, blend), y: velocity.y, z: lerp(velocity.z, direction.z, blend) }, true)
            return
        }
        const limit = Math.max(state.takeoffSpeed, this.topSpeed * this.upgrades.speedMultiplier) * 0.25
        const direction = this.forward.clone().setY(0).normalize().multiplyScalar(this.controls.accelerating)
            .add(this.sideward.clone().setY(0).normalize().multiplyScalar(-this.controls.steering))
        if(direction.lengthSq() > 1) direction.normalize()
        const previous = state.airOffset.clone()
        state.airOffset.lerp(direction.multiplyScalar(limit), Math.min(1, this.game.ticker.deltaScaled * 8))
        const change = state.airOffset.clone().sub(previous)
        const body = this.chassis.physical.body, velocity = body.linvel()
        body.setLinvel({ x: velocity.x + change.x, y: velocity.y, z: velocity.z + change.z }, true)
    }

    updatePrePhysics()
    {
        if(this.destroyed || this.game.editorPaused || !this.chassis.physical.body.isEnabled()) return
        if(this.launch?.active)
        {
            for(let i = 0; i < 4; i++) { this.controller.setWheelEngineForce(i, 0); this.controller.setWheelBrake(i, 0) }
            this.controller.updateVehicle(Math.min(1/60, this.game.ticker.deltaAverage))
            return
        }
        const controls = this.controls
        // Engine force
        const topSpeed = lerp(this.topSpeed, this.topSpeedBoost, controls.boosting)
        const speedMultiplier = this.upgrades.speedMultiplier * (this.game.world.items?.speedFactor(this) ?? 1)
        const overflowSpeed = Math.max(0, this.speed / speedMultiplier - topSpeed)
        let engineForce = (controls.accelerating * (1 + controls.boosting * this.boostMultiplier)) * this.engineForceAmplitude / (1 + overflowSpeed) * this.game.ticker.deltaScaled

        // Brake
        let brake = controls.braking

        if(!controls.braking && Math.abs(controls.accelerating) < 0.1)
            brake = this.idleBrake
    
        if(
            this.speed > 0.5 &&
            (
                (controls.accelerating > 0 && !this.goingForward) ||
                (controls.accelerating < 0 && this.goingForward)
            )
        )
        {
            brake = this.reverseBrake
            engineForce = 0
        }

        brake *= this.brakeAmplitude * this.game.ticker.deltaScaled

        // Steer
        const steer = controls.steering * this.steeringAmplitude

        // Update wheels
        this.controller.setWheelSteering(0, steer)
        this.controller.setWheelSteering(1, steer)

        for(let i = 0; i < 4; i++)
        {
            this.controller.setWheelBrake(i, brake)
            this.controller.setWheelEngineForce(i, engineForce)
            this.controller.setWheelSuspensionRestLength(i, this.suspensionsHeights[controls.suspensions[i]])
            this.controller.setWheelSuspensionStiffness(i, this.suspensionsStiffness[controls.suspensions[i]])

            // Ice slip
            const groundObject = this.controller.wheelGroundObject(i)

            if(groundObject && this.game.world.waterSurface)
            {
                const onIce = groundObject.parent() === this.game.world.waterSurface.ice.physical.body
                const iceFriction = lerp(this.wheels.settings.frictionSlip, 0.04, this.game.world.waterSurface.iceRatio.value)

                this.controller.setWheelFrictionSlip(i, onIce ? iceFriction : this.wheels.settings.frictionSlip)
            }
        }

        // Update controller
        const delta = this.game.quality.level === 1 ? 1/60 : Math.min(1/60, this.game.ticker.deltaAverage)
        // Solve wheel traction in the original speed range, then restore the
        // upgraded horizontal velocity before Rapier integrates collisions.
        // Simply multiplying engine force also multiplied wheelie torque and
        // made upgraded boost slower than the base car.
        const body = this.chassis.physical.body
        const beforeDrive = body.linvel()
        if(speedMultiplier !== 1)
        {
            body.setLinvel({ x: beforeDrive.x / speedMultiplier, y: beforeDrive.y, z: beforeDrive.z / speedMultiplier }, true)
        }
        this.controller.updateVehicle(delta)
        if(speedMultiplier !== 1)
        {
            const velocity = body.linvel()
            body.setLinvel({ x: velocity.x * speedMultiplier, y: velocity.y, z: velocity.z * speedMultiplier }, true)
        }
        if(engineForce !== 0)
        {
            const axis = this.forward.clone().setY(0).normalize().multiplyScalar(Math.sign(engineForce))
            const velocity = new THREE.Vector3().copy(body.linvel())
            const limit = lerp(this.drivingSpeedRange.normal, this.drivingSpeedRange.boost, controls.boosting) * speedMultiplier
            // Limit only speed added by the motor. External collision impulses
            // and downhill momentum remain free to exceed the driving limit.
            const previousAlong = axis.dot(beforeDrive)
            const excess = Math.max(0, velocity.dot(axis) - Math.max(limit, previousAlong))
            if(excess > 0) body.setLinvel(velocity.addScaledVector(axis, -excess), true)
        }
        this.updateAirControl()
    }

    updatePostPhysics()
    {
        if(this.destroyed || this.game.editorPaused || !this.chassis.physical.body.isEnabled()) return
        // Various measures
        const newPosition = new THREE.Vector3().copy(this.chassis.physical.body.translation())
        this.velocity = newPosition.clone().sub(this.position)
        this.direction = this.velocity.clone().normalize()
        this.position.copy(newPosition)
        this.quaternion.copy(this.chassis.physical.body.rotation())
        this.sideward.set(0, 0, 1).applyQuaternion(this.quaternion)
        this.upward.set(0, 1, 0).applyQuaternion(this.quaternion)
        this.forward.set(1, 0, 0).applyQuaternion(this.quaternion)
        // this.speed = this.controller.currentVehicleSpeed()
        this.speed = this.velocity.length() / this.game.ticker.deltaScaled
        this.xzSpeed = Math.hypot(this.velocity.x, this.velocity.z) / this.game.ticker.deltaScaled
        this.forwardRatio = this.direction.dot(this.forward)
        this.goingForward = this.forwardRatio > 0.5
        this.forwardSpeed = this.speed * this.forwardRatio

        this.xRotation = new THREE.Euler().setFromQuaternion(this.quaternion, 'XYZ').x
        this.yRotation = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ').y
        this.zRotation = new THREE.Euler().setFromQuaternion(this.quaternion, 'ZYX').z

        if(Math.abs(this.controls.accelerating) > 0.5)
            this.stuck.accumulate(this.velocity.length(), this.game.ticker.deltaScaled)

        let inContactCount = 0
        for(let i = 0; i < 4; i++)
        {
            const wheel = this.wheels.items[i]

            const inContact = this.controller.wheelIsInContact(i)

            if(inContact && !wheel.inContact)
            {
                wheel.lastTouchTime = this.game.ticker.elapsed
            }

            wheel.inContact = inContact
            wheel.contactPoint = this.controller.wheelContactPoint(i)
            wheel.suspensionLength = this.controller.wheelSuspensionLength(i)

            if(wheel.inContact)
                inContactCount++
        }

        let justTouchedCount = 0
        if(inContactCount > this.wheels.inContactCount)
        {
            for(const wheel of this.wheels.items)
            {
                if(wheel.lastTouchTime > this.game.ticker.elapsed - 0.2)
                    justTouchedCount++
            }
        }

        this.wheels.inContactCount = inContactCount
        this.wheels.justTouchedCount = justTouchedCount
        if(this.launch?.active)
        {
            this.launch.elapsed += this.game.ticker.deltaScaled
            if((this.launch.elapsed > 0.3 && inContactCount >= 2 && this.chassis.physical.body.linvel().y < 1) || this.launch.elapsed > this.launch.duration + 2)
                this.launch.active = false
        }

        const jump = this.jumpState
        if(inContactCount === 0 && !jump.airborne)
        {
            jump.airborne = true
            jump.used = Math.max(1, jump.used)
            jump.takeoffSpeed = Math.hypot(this.chassis.physical.body.linvel().x, this.chassis.physical.body.linvel().z)
            jump.airOffset.set(0, 0, 0)
        }
        if(inContactCount >= 2 && jump.airborne && this.chassis.physical.body.linvel().y < 1.5 && this.game.ticker.elapsed - jump.lastRequest > 0.18)
        {
            jump.used = 0
            jump.jetFlight = false
            jump.airborne = false
            jump.airOffset.set(0, 0, 0)
        }

        this.stop.test()
        this.upsideDown.test()
        const recovery = this.explosionRecovery
        if(this.upsideDown.active) {
            if(recovery.pending > 0) recovery.extra = 2
            recovery.elapsed += this.game.ticker.delta
        }
        else { recovery.extra = 0; recovery.elapsed = 0 }
        recovery.pending = Math.max(0, recovery.pending - this.game.ticker.delta)
        this.stuck.test()
        // this.backWheel.test()
        this.flip.test()
    }

    activate()
    {
        this.chassis.physical.body.setLinvel({ x: 0, y: 0, z: 0 })
        this.chassis.physical.body.setAngvel({ x: 0, y: 0, z: 0 })
        this.chassis.physical.body.setEnabled(true)
    }

    deactivate()
    {
        this.chassis.physical.body.setEnabled(false)
    }
}
