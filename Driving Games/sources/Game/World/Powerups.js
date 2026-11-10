import * as THREE from 'three/webgpu'
import { color } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { VehicleNavigation } from './VehicleNavigation.js'
import { speedWhiteValue } from '../VehicleUpgrades.js'
import { ITEM_TYPES } from '../ItemDefinitions.js'
import { PICKUP_WEIGHTS } from '../Config.js'

const TYPES = [
    { type: 'power', file: 'power-plus', title: 'POWER+', color: '#ffb64f' },
    { type: 'speed', file: 'speed-plus', title: 'SPEED+', color: '#ffe875' },
    { type: 'jump', file: 'jump-times-two', title: 'JUMP×2', color: '#69dfcf' },
    ...ITEM_TYPES.map(item => ({ ...item, consumable: true })),
]

export class Powerups
{
    constructor()
    {
        this.game = Game.getInstance()
        this.items = []
        this.clock = 0
        this.refreshInterval = 30
        this.nextRefreshAt = 30
        this.started = false
        this.previousPositions = new Map()
        this.navigation = this.game.navigation ?? new VehicleNavigation(this.game)
        this.hud = document.createElement('div')
        this.hud.className = 'upgrade-hud'
        this.hud.innerHTML = '<span data-stat="power"></span><span data-stat="speed"></span><span data-stat="jump"></span><small data-stat="velocity"></small>'
        this.toast = document.createElement('div')
        this.toast.className = 'upgrade-toast'
        this.toast.setAttribute('role', 'status')
        this.game.domElement.append(this.hud, this.toast)
        this.ready = this.load()
        this.game.ticker.events.on('tick', () => this.update(), 6)
    }

    async load()
    {
        const loader = new GLTFLoader()
        this.templates = await Promise.all(TYPES.map(async definition =>
        {
            if(definition.type === 'crate') return this.game.world.explosiveCrates.template.clone(true)
            const { scene } = await loader.loadAsync(`models/powerups/${definition.file}.glb`)
            const materials = new Map()
            const convert = source =>
            {
                if(!materials.has(source)) materials.set(source, new MeshDefaultMaterial({ colorNode: color(source.color), hasCoreShadows: true }))
                return materials.get(source)
            }
            scene.traverse(child =>
            {
                if(!child.isMesh) return
                child.material = Array.isArray(child.material) ? child.material.map(convert) : convert(child.material)
                child.castShadow = true
            })
            return scene
        }))
    }

    start()
    {
        const perType = this.game.config?.items ?? 5
        if(perType <= 0)
        {
            this.started = true
            return
        }

        // Weighted pool: shield and missile spawn less often than other types.
        const plan = []
        for(let typeIndex = 0; typeIndex < TYPES.length; typeIndex++)
        {
            const definition = TYPES[typeIndex]
            const count = Math.max(0, Math.floor(perType * (PICKUP_WEIGHTS[definition.type] ?? 1)))
            for(let i = 0; i < count; i++)
                plan.push(typeIndex)
        }

        const positions = this.randomPositions(plan.length)
        positions.forEach((position, index) =>
        {
            const typeIndex = plan[index], definition = TYPES[typeIndex]
            const group = new THREE.Group()
            const model = this.templates[typeIndex].clone(true)
            model.scale.setScalar(0.91)
            model.rotation.y = Math.PI / 4
            group.add(model)
            const halo = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.82, 24), new THREE.MeshBasicNodeMaterial({ color: definition.color, transparent: true, opacity: 0.5, depthWrite: false }))
            halo.rotation.x = -Math.PI / 2
            halo.position.y = 0.04
            group.add(halo)
            const stars = this.createStars(definition.color)
            group.add(stars)
            group.position.copy(position)
            group.name = `pickup-${definition.type}-${index}`
            this.game.scene.add(group)
            this.items.push({ id: index, ...definition, position, group, model, halo, stars, active: true, respawnAt: 0 })
        })
        this.started = true
    }

    randomPositions(count)
    {
        const positions = [], random = this.game.config?.random ?? Math.random
        // Keep pickups on the authored island instead of the open ocean ring.
        const bound = this.game.water.ocean.start * 0.97
        const vehicles = [...this.game.world.vehicleDamage.records.keys()].filter(v => !v.destroyed)
        for(let attempt = 0; attempt < 9000 && positions.length < count; attempt++) {
            const x = (random() * 2 - 1) * bound, z = (random() * 2 - 1) * bound
            if(vehicles.some(v => Math.hypot(v.position.x - x, v.position.z - z) < 5)) continue
            if(positions.some(p => Math.hypot(p.x - x, p.z - z) < 5.5)) continue
            const position = this.navigation.sample(x, z)
            if(position) positions.push(position)
        }
        return positions
    }

    createStars(tint)
    {
        if(!this.starGeometry) {
            const vertices = []
            for(let i = 0; i < 8; i++) {
                const angle = i * Math.PI / 4, c = Math.cos(angle), s = Math.sin(angle)
                const next = (i + 1) * Math.PI / 4
                const radius = i % 2 ? 0.2 : 1, nextRadius = i % 2 ? 1 : 0.2
                vertices.push(0, 0, 0, c * radius, s * radius, 0, Math.cos(next) * nextRadius, Math.sin(next) * nextRadius, 0)
            }
            this.starGeometry = new THREE.BufferGeometry()
            this.starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        }
        const stars = new THREE.Group()
        stars.name = 'pickup-twinkling-stars'
        for(let i = 0; i < 6; i++) {
            const material = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(tint).lerp(new THREE.Color('#ffffff'), 0.7), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
            const star = new THREE.Mesh(this.starGeometry, material)
            star.userData = { angle: i * Math.PI / 3, radius: 0.95 + i % 2 * 0.4, height: 0.7 + i % 3 * 0.55 }
            stars.add(star)
        }
        return stars
    }

    refresh()
    {
        const positions = this.randomPositions(this.items.length)
        this.items.forEach((item, index) => {
            if(!positions[index]) return
            item.position.copy(positions[index]); item.group.position.copy(item.position)
            item.active = true; item.group.visible = true; item.respawnAt = 0
        })
        this.previousPositions.clear()
        this.nextRefreshAt = this.clock + this.refreshInterval
    }

    nearestFor(vehicle, options = {})
    {
        const range = options.range ?? 24
        let nearest = null, best = range * range
        for(const item of this.items)
        {
            if(!item.active || !this.canCollect(item, vehicle)) continue
            if(options.upgradesOnly && item.consumable) continue
            // A maxed upgrade would only waste the trip.
            if(!item.consumable && !vehicle.upgrades.canCollect(item.type)) continue
            const distance = vehicle.position.distanceToSquared(item.position)
            if(distance < best) { best = distance; nearest = item }
        }
        return nearest
    }

    collect(item, vehicle)
    {
        if(!item.active || vehicle.destroyed || !vehicle.chassis.physical.body.isEnabled()) return false
        const maxed = !item.consumable && !vehicle.upgrades.canCollect(item.type)
        const collected = item.consumable ? this.game.world.items.collect(vehicle, item.type) : (maxed || vehicle.upgrades.collect(item.type))
        if(!collected) return false
        item.active = false
        item.group.visible = false
        item.respawnAt = this.nextRefreshAt
        if(vehicle === this.game.physicalVehicle)
        {
            const stats = vehicle.upgrades
            const message = maxed ? `${item.title} 已拾取 · 已满级，属性不变` : item.consumable ? `${item.title} +1 · 按 E 使用` : item.type === 'power' ? `POWER+ ${stats.power}/5 · 撞击 ×${stats.powerMultiplier}` :
                item.type === 'speed' ? `SPEED+ ${stats.speed}/2 · 速度 ×${stats.speedMultiplier}` : 'JUMP×2 · 再按一次空格可二段跳'
            this.toast.textContent = message
            this.toast.style.color = item.color
            this.toastAnimation?.cancel()
            this.toastAnimation = this.toast.animate([{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -8px)' }], { duration: 1800 })
        }
        return true
    }

    templateFor(type) { return this.templates?.[TYPES.findIndex(item => item.type === type)] }
    canCollect(item, vehicle) { return item.consumable ? this.game.world.items.canCollect(vehicle, item.type) : true }

    updateHud()
    {
        const vehicle = this.game.physicalVehicle, stats = vehicle.upgrades
        this.hud.hidden = this.game.reveal.step !== 2
        const values = { power: `POWER ${stats.power}/5 · ×${stats.powerMultiplier}`, speed: `SPEED ${stats.speed}/2 · ×${stats.speedMultiplier}`,
            jump: `JUMP ${Math.max(0, stats.maxJumps - vehicle.jumpState.used)}/${stats.maxJumps}`,
            velocity: `速度 ${speedWhiteValue(vehicle.xzSpeed || 0, stats.speedMultiplier, vehicle.drivingSpeedRange.normal, vehicle.drivingSpeedRange.boost).toFixed(1)} / ${5 * stats.speedMultiplier}` }
        for(const [key, value] of Object.entries(values))
        {
            const node = this.hud.querySelector(`[data-stat="${key}"]`)
            if(node.textContent !== value) node.textContent = value
        }
    }

    update()
    {
        this.updateHud()
        if(!this.templates || this.game.reveal.step !== 2 || this.game.editorPaused || this.game.escMenu?.isOpen || this.game.player.state !== 1) return
        if(!this.started) this.start()
        this.clock += this.game.ticker.delta
        if(this.clock >= this.nextRefreshAt) this.refresh()
        const vehicles = [...this.game.world.vehicleDamage.records.keys()].filter(vehicle => !vehicle.destroyed && vehicle.chassis.physical.body.isEnabled())
        for(const item of this.items)
        {
            const pulse = 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 + item.id * 0.7)
            item.stars.children.forEach((star, index) => {
                const phase = this.clock * 3.5 + index * 1.7 + item.id
                const sparkle = Math.pow(0.5 + 0.5 * Math.sin(phase), 3)
                const angle = star.userData.angle + this.clock * 0.18
                star.position.set(Math.cos(angle) * star.userData.radius, star.userData.height + Math.sin(phase * 0.5) * 0.12, Math.sin(angle) * star.userData.radius)
                star.quaternion.copy(this.game.view.camera.quaternion)
                star.scale.setScalar(0.08 + sparkle * 0.24)
                star.material.opacity = sparkle * 0.95
            })
            item.halo.material.opacity = 0.25 + pulse * 0.15
            item.model.position.y = 0.6 + Math.sin(this.clock * 2 + item.id) * 0.13
            item.model.rotation.y = Math.PI / 4 + Math.sin(this.clock * 0.77 + item.id) * 0.18
            if(!item.active) continue
            let collector = null, closest = 1.8 * 1.8
            for(const vehicle of vehicles)
            {
                if(!this.canCollect(item, vehicle)) continue
                const position = vehicle.position
                const previous = this.previousPositions.get(vehicle) ?? position
                // Swept collection catches fast cars, but never a respawn teleport.
                const point = previous.distanceToSquared(position) < 225 ? new THREE.Line3(previous, position).closestPointToPoint(item.position.clone().add(new THREE.Vector3(0, 0.8, 0)), true, new THREE.Vector3()) : position
                if(Math.abs(point.y - item.position.y - 0.8) > 2) continue
                const distance = Math.hypot(point.x - item.position.x, point.z - item.position.z) ** 2
                if(distance < closest) { closest = distance; collector = vehicle }
            }
            if(collector) this.collect(item, collector)
        }
        for(const vehicle of vehicles) this.previousPositions.set(vehicle, vehicle.position.clone())
    }
}
