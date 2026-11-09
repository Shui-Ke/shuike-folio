import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { clamp, lerp, remap } from './utilities/maths.js'
import { mix, uniform, vec4, Fn, positionGeometry, attribute } from 'three/tsl'
import { alea } from 'seedrandom'

const rng = new alea('speedLines')

export class View
{
    constructor(idealRatio = 1920 / 1080)
    {
        this.game = Game.getInstance()
        this.position = new THREE.Vector3()
        this.delta = new THREE.Vector3()
        this.idealRatio = idealRatio
        this.ratioOverflow = Math.max(1, idealRatio / this.game.viewport.ratio) - 1
        if(this.game.debug.active)
            this.debugPanel = this.game.debug.panel.addFolder({ title: '🎥 View', expanded: false })

        this.setFocusPoint()
        this.focusPoint.magnet.active = false
        this.setZoom()
        this.spherical = {
            phi: Math.PI * 0.31,
            theta: Math.PI * 0.25,
            radius: { edges: { min: 8, max: 60 }, current: 30, nonIdealRatioOffset: 9 },
            offset: new THREE.Vector3()
        }
        // Explosions may request a kick, but the fixed camera never rolls.
        this.roll = { value: 0, kick: () => {} }
        this.camera = new THREE.PerspectiveCamera(25, this.game.viewport.ratio, 0.1, 600)
        this.impactBlend = 0
        this.defaultCamera = this.camera.clone()
        this.game.scene.add(this.camera, this.defaultCamera)
        this.setOptimalArea()
        this.setSpeedLines()
        this.game.ticker.events.on('tick', () => this.update(), 7)
        this.game.viewport.events.on('change', () => this.resize())
        this.game.viewport.events.on('throttleChange', () => this.optimalArea.update(), 1)
        this.update()
    }

    setFocusPoint()
    {
        const defaultRespawn = this.game.respawns.getDefault()
        this.focusPoint = {}
        this.focusPoint.trackedPosition = new THREE.Vector3(defaultRespawn.position.x, 0, defaultRespawn.position.z)
        this.focusPoint.isTracking = true
        this.focusPoint.position = this.focusPoint.trackedPosition.clone()
        this.focusPoint.smoothedPosition = this.focusPoint.trackedPosition.clone()
        this.focusPoint.isEased = true
        this.focusPoint.easing = 1
        this.focusPoint.magnet = {}
        this.focusPoint.magnet.active = true
        this.focusPoint.magnet.multiplier = 0.25

        const focusActionsNames = [
            'forward',
            'right',
            'backward',
            'left',
            'boost',
            'brake',
            'respawn',
            'suspensions',
            'suspensionsFront',
            'suspensionsBack',
            'suspensionsRight',
            'suspensionsLeft',
            'suspensionsFrontLeft',
            'suspensionsFrontRight',
            'suspensionsBackRight',
            'suspensionsBackLeft',
            'interact',
            'whisper'
        ]
        this.game.inputs.events.on('actionStart', (action) =>
        {
            if(focusActionsNames.indexOf(action.name) !== -1)
                this.focusPoint.isTracking = true
        })

        this.focusPoint.helper = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('orange').multiplyScalar(4), wireframe: false }))
        this.focusPoint.helper.visible = false
        this.focusPoint.helper.userData.preventPreRender = true
        this.game.scene.add(this.focusPoint.helper)

        if(this.game.debug.active)
        {
            const zoomDebugPanel = this.debugPanel.addFolder({
                title: 'Magnet',
                expanded: true,
            })
            zoomDebugPanel.addBinding(this.focusPoint.magnet, 'multiplier', { min: 0, max: 1, step: 0.0001 })
        }
    }


    setOptimalArea()
    {
        this.optimalArea = {}
        this.optimalArea.needsUpdate = true
        this.optimalArea.position = new THREE.Vector3()
        this.optimalArea.basePosition = new THREE.Vector3()
        this.optimalArea.nearPosition = new THREE.Vector3()
        this.optimalArea.farPosition = new THREE.Vector3()
        this.optimalArea.nearDistance = null
        this.optimalArea.farDistance = null
        this.optimalArea.radius = 0
        this.optimalArea.raycaster = new THREE.Raycaster()
        this.optimalArea.quad2 = [
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
        ]

        this.optimalArea.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

        // // Helper
        // this.optimalArea.quad2Helper = {}

        // const geometry = new LineGeometry()
        // geometry.setPositions([
        //     0, 0, 0,
        //     0, 0, 0,
        //     0, 0, 0,
        //     0, 0, 0
        // ])

        // const material = new THREE.Line2NodeMaterial({
        //     color: new THREE.Color('orange').multiplyScalar(4),
        //     linewidth: 10
        // })

        // this.optimalArea.quad2Helper = new Line2(geometry, material)
        // this.optimalArea.quad2Helper.computeLineDistances()
        // this.game.scene.add(this.optimalArea.quad2Helper)

        this.optimalArea.update = () =>
        {
            // Save state
            const savedPosition = this.defaultCamera.position.clone()
            const savedQuaternion = this.defaultCamera.quaternion.clone()
            const savedFov = this.defaultCamera.fov
            this.defaultCamera.fov = 25

            // Reset with max radius
            let radiusMax = (this.spherical.radius.edges.max + this.ratioOverflow * this.spherical.radius.nonIdealRatioOffset)

            if(this.game.quality.level === 0)
                radiusMax *= 1.4 /* retain the existing foliage coverage */
            
            const offset = new THREE.Vector3()
            offset.setFromSphericalCoords(radiusMax, this.spherical.phi, this.spherical.theta)

            this.defaultCamera.position.set(0, 0, 0).add(offset)
            this.defaultCamera.lookAt(new THREE.Vector3())
            this.defaultCamera.updateProjectionMatrix()
            this.defaultCamera.updateWorldMatrix()

            // First near/far diagonal
            this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(1, -1), this.defaultCamera)
            this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, this.optimalArea.nearPosition)
            this.optimalArea.quad2[0].base.x = this.optimalArea.nearPosition.x
            this.optimalArea.quad2[0].base.y = this.optimalArea.nearPosition.z

            this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(-1, 1), this.defaultCamera)
            this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, this.optimalArea.farPosition)
            this.optimalArea.quad2[2].base.x = this.optimalArea.farPosition.x
            this.optimalArea.quad2[2].base.y = this.optimalArea.farPosition.z

            const centerA = this.optimalArea.nearPosition.clone().lerp(this.optimalArea.farPosition, 0.5)

            // Second near/far diagonal
            this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(-1, -1), this.defaultCamera)
            this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, this.optimalArea.nearPosition)
            this.optimalArea.quad2[3].base.x = this.optimalArea.nearPosition.x
            this.optimalArea.quad2[3].base.y = this.optimalArea.nearPosition.z

            this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(1, 1), this.defaultCamera)
            this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, this.optimalArea.farPosition)
            this.optimalArea.quad2[1].base.x = this.optimalArea.farPosition.x
            this.optimalArea.quad2[1].base.y = this.optimalArea.farPosition.z

            const centerB = this.optimalArea.nearPosition.clone().lerp(this.optimalArea.farPosition, 0.5)

            // Center between the two diagonal centers
            this.optimalArea.basePosition = centerA.clone().lerp(centerB, 0.5)

            // Radius
            this.optimalArea.radius = this.optimalArea.basePosition.distanceTo(this.optimalArea.farPosition)

            // Distances
            this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(0, -1), this.defaultCamera)
            this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, this.optimalArea.nearPosition)

            this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(0, 1), this.defaultCamera)
            this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, this.optimalArea.farPosition)
            
            this.optimalArea.nearDistance = this.defaultCamera.position.distanceTo(this.optimalArea.nearPosition)
            this.optimalArea.farDistance = this.defaultCamera.position.distanceTo(this.optimalArea.farPosition)

            // Put back state
            this.defaultCamera.position.copy(savedPosition)
            this.defaultCamera.quaternion.copy(savedQuaternion)
            this.defaultCamera.fov = savedFov
            this.defaultCamera.updateProjectionMatrix()

            // Save
            this.optimalArea.needsUpdate = false
        }
    }


    setZoom()
    {
        const initialRatio = (60 - 30) / (60 - 8)
        this.zoom = { baseRatio: initialRatio, ratio: initialRatio, smoothedRatio: initialRatio, sensitivity: 0.05 }
        this.game.inputs.addActions([
            { name: 'zoom', categories: ['wandering', 'racing'], keys: ['Wheel.roll'] }
        ])
        this.game.inputs.events.on('zoom', action =>
        {
            this.zoom.baseRatio = clamp(this.zoom.baseRatio - action.value * this.zoom.sensitivity, 0, 1)
        })
    }

    setSpeedLines()
    {
        this.speedLines = {}
        this.speedLines.strength = 0
        this.speedLines.smoothedStrength = uniform(this.speedLines.strength)
        this.speedLines.worldTarget = new THREE.Vector3()
        this.speedLines.clipSpaceTarget = uniform(new THREE.Vector3())
        this.speedLines.speed = uniform(12)

        const linesCount = 30
        const positionArray = new Float32Array(linesCount * 3 * 3)
        const timeRandomnessArray = new Float32Array(linesCount * 3)
        const distanceArray = new Float32Array(linesCount * 3)
        const tipnessArray = new Float32Array(linesCount * 3)
        const maxDistance = Math.hypot(1, 1)

        for(let i = 0; i < linesCount; i++)
        {
            const i9 = i * 9
            const i3 = i * 3

            // Base vertex
            const vertexMiddle = new THREE.Vector2(0, 1)
            const angle = Math.PI * 2 * rng()
            vertexMiddle.rotateAround(new THREE.Vector2(), angle)

            // Side vertices 
            const thickness = rng() * 0.01 + 0.002
            const vertexLeft = vertexMiddle.clone().rotateAround(new THREE.Vector2(), thickness)
            const vertexRight = vertexMiddle.clone().rotateAround(new THREE.Vector2(), - thickness)
            
            // Distance to center
            vertexMiddle.multiplyScalar(maxDistance)
            vertexLeft.multiplyScalar(maxDistance)
            vertexRight.multiplyScalar(maxDistance)

            // Position
            positionArray[i9 + 0] = vertexLeft.x
            positionArray[i9 + 1] = vertexLeft.y
            positionArray[i9 + 2] = 0
            
            positionArray[i9 + 3] = vertexMiddle.x
            positionArray[i9 + 4] = vertexMiddle.y
            positionArray[i9 + 5] = 0

            positionArray[i9 + 6] = vertexRight.x
            positionArray[i9 + 7] = vertexRight.y
            positionArray[i9 + 8] = 0

            // Time randomness
            timeRandomnessArray[i3 + 0] = i
            timeRandomnessArray[i3 + 1] = i
            timeRandomnessArray[i3 + 2] = i

            // Distance
            const distance = rng() * 0.4 + 0.4
            distanceArray[i3 + 0] = distance
            distanceArray[i3 + 1] = distance
            distanceArray[i3 + 2] = distance

            // Tipness
            tipnessArray[i3 + 0] = 0
            tipnessArray[i3 + 1] = 1
            tipnessArray[i3 + 2] = 0
        }

        this.speedLines.geometry = new THREE.BufferGeometry()
        this.speedLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3))
        this.speedLines.geometry.setAttribute('timeRandomness', new THREE.Float32BufferAttribute(timeRandomnessArray, 1))
        this.speedLines.geometry.setAttribute('distance', new THREE.Float32BufferAttribute(distanceArray, 1))
        this.speedLines.geometry.setAttribute('tipness', new THREE.Float32BufferAttribute(tipnessArray, 1))

        this.speedLines.material = new THREE.MeshBasicNodeMaterial({ wireframe: false, depthWrite: false, depthTest: false })
        this.speedLines.material.vertexNode = Fn(() =>
        {
            const timeRandomness = attribute('timeRandomness')
            const distance = attribute('distance')
            const tipness = attribute('tipness')
            
            const osciliation = this.game.ticker.elapsedScaledUniform.mul(this.speedLines.speed).add(timeRandomness).sin().div(2).add(0.5)
            const newPosition = mix(positionGeometry.xy, this.speedLines.clipSpaceTarget.xy, tipness.mul(osciliation).mul(distance).mul(this.speedLines.smoothedStrength))
            
            return vec4(newPosition, 0, 1)
        })()
        this.speedLines.material.outputNode = vec4(1)

        this.speedLines.mesh = new THREE.Mesh(this.speedLines.geometry, this.speedLines.material)
        this.speedLines.mesh.frustumCulled = false
        this.speedLines.mesh.renderOrder = 10
        this.game.scene.add(this.speedLines.mesh)

        // Debug
        if(this.game.debug.active)
        {
            const folder = this.debugPanel.addFolder({
                title: 'Speed lines',
                expanded: false,
            })
            folder.addBinding(this.speedLines, 'strength', { label: 'strength', min: 0, max: 1, step: 0.001 })
            folder.addBinding(this.speedLines.speed, 'value', { label: 'speed', min: 0, max: 100, step: 0.001 })
        }
    }


    recenter(position)
    {
        if(!this.focusPoint)
            return

        this.focusPoint.trackedPosition.set(position.x, 0, position.z)
        this.focusPoint.position.copy(this.focusPoint.trackedPosition)
        this.focusPoint.smoothedPosition.copy(this.focusPoint.trackedPosition)
    }

    resize()
    {
        this.ratioOverflow = Math.max(1, this.idealRatio / this.game.viewport.ratio) - 1
        for(const camera of [this.camera, this.defaultCamera])
        {
            camera.aspect = this.game.viewport.ratio
            camera.updateProjectionMatrix()
        }
    }

    update()
    {
        // Normal driving keeps the user's fixed camera. A heavy-impact launch
        // temporarily frames both cars, then returns to the same wheel zoom.
        this.focusPoint.isTracking = true
        this.focusPoint.position.copy(this.focusPoint.trackedPosition)
        const impact = this.game.world?.combat?.framing
        this.impactBlend = impact?.blend ?? 0
        if(this.impactBlend > 0) this.focusPoint.position.lerp(impact.focus, this.impactBlend)
        const easing = remap(this.focusPoint.easing, 0, 1, 1, this.game.ticker.delta * 10)
        this.focusPoint.smoothedPosition.lerp(this.focusPoint.position, easing)
        if(this.focusPoint.helper.visible) this.focusPoint.helper.position.copy(this.focusPoint.smoothedPosition)

        this.zoom.ratio = this.zoom.baseRatio
        this.zoom.smoothedRatio = lerp(this.zoom.smoothedRatio, this.zoom.ratio, Math.min(1, this.game.ticker.delta * 10))
        this.spherical.radius.current = lerp(this.spherical.radius.edges.min, this.spherical.radius.edges.max, 1 - this.zoom.smoothedRatio)
        if(this.impactBlend > 0)
            this.spherical.radius.current = lerp(this.spherical.radius.current, Math.max(this.spherical.radius.current, Math.min(110, 45 + impact.distance * 0.9)), this.impactBlend)
        const fov = lerp(25, 42, this.impactBlend)
        if(Math.abs(this.camera.fov - fov) > 0.0001)
        {
            this.camera.fov = this.defaultCamera.fov = fov
            this.camera.updateProjectionMatrix()
            this.defaultCamera.updateProjectionMatrix()
        }
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta)
        this.position.copy(this.focusPoint.smoothedPosition).add(this.spherical.offset)
        this.delta.copy(this.position).sub(this.defaultCamera.position)
        this.defaultCamera.position.copy(this.position)
        this.defaultCamera.lookAt(this.focusPoint.smoothedPosition)
        this.camera.position.copy(this.defaultCamera.position)
        this.camera.quaternion.copy(this.defaultCamera.quaternion)
        this.camera.updateMatrixWorld()
        this.defaultCamera.updateMatrixWorld()

        if(this.optimalArea.needsUpdate) this.optimalArea.update()
        this.optimalArea.position.copy(this.optimalArea.basePosition)
            .add(new THREE.Vector3(this.focusPoint.smoothedPosition.x, 0, this.focusPoint.smoothedPosition.z))
        for(const point of this.optimalArea.quad2)
        {
            point.offseted.x = point.base.x + this.focusPoint.position.x
            point.offseted.y = point.base.y + this.focusPoint.position.z
        }
        this.speedLines.clipSpaceTarget.value.copy(this.speedLines.worldTarget).project(this.camera)
        this.speedLines.smoothedStrength.value = lerp(this.speedLines.smoothedStrength.value, this.speedLines.strength, this.game.ticker.delta * 2)
    }
}
