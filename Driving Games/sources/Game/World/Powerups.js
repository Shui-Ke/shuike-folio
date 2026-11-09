import * as THREE from 'three/webgpu'
import { color } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { VehicleNavigation } from './VehicleNavigation.js'
import { speedWhiteValue } from '../VehicleUpgrades.js'
import { ITEM_TYPES } from '../ItemDefinitions.js'

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
        this.started = false
        this.previousPositions = new Map()
        this.navigation = new VehicleNavigation(this.game)
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
        const spawn = this.game.respawns.getDefault().position
        const origin = this.navigation.nearest(spawn)?.position ?? spawn
        const positions = []
        const count = TYPES.length * 5
        for(const radius of [8, 14, 21, 29, 38, 48, 58, 68, 78])
        {
            for(let i = 0; i < 48 && positions.length < count; i++)
            {
                const angle = i * Math.PI * 2 / 48 + radius * 0.1
                const x = spawn.x + Math.cos(angle) * radius, z = spawn.z + Math.sin(angle) * radius
                if(Math.max(Math.abs(x), Math.abs(z)) > 67) continue
                const position = this.navigation.sample(x, z)
                if(!position || positions.some(other => other.distanceTo(position) < 5.5)) continue
                if(!this.navigation.clearLine(origin, position) && !this.navigation.path(origin, position, false).length) continue
                positions.push(position)
            }
            if(positions.length >= count) break
        }
        positions.forEach((position, index) =>
        {
            const typeIndex = index % TYPES.length, definition = TYPES[typeIndex]
            const group = new THREE.Group()
            const model = this.templates[typeIndex].clone(true)
            model.scale.setScalar(0.57)
            model.rotation.y = Math.PI / 4
            group.add(model)
            const halo = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.82, 24), new THREE.MeshBasicNodeMaterial({ color: definition.color, transparent: true, opacity: 0.5, depthWrite: false }))
            halo.rotation.x = -Math.PI / 2
            halo.position.y = 0.04
            group.add(halo)
            group.position.copy(position)
            group.name = `pickup-${definition.type}-${index}`
            this.game.scene.add(group)
            this.items.push({ id: index, ...definition, position, group, model, active: true, respawnAt: 0 })
        })
        this.started = true
    }

    nearestFor(vehicle)
    {
        let nearest = null, best = 24 * 24
        for(const item of this.items)
        {
            if(!item.active || !this.canCollect(item, vehicle)) continue
            const distance = vehicle.position.distanceToSquared(item.position)
            if(distance < best) { best = distance; nearest = item }
        }
        return nearest
    }

    collect(item, vehicle)
    {
        if(!item.active || vehicle.destroyed || !vehicle.chassis.physical.body.isEnabled()) return false
        const collected = item.consumable ? this.game.world.items.collect(vehicle, item.type) : vehicle.upgrades.collect(item.type)
        if(!collected) return false
        item.active = false
        item.group.visible = false
        item.respawnAt = this.clock + 12
        if(vehicle === this.game.physicalVehicle)
        {
            const stats = vehicle.upgrades
            const message = item.consumable ? `${item.title} +1 · 按 E 使用` : item.type === 'power' ? `POWER+ ${stats.power}/5 · 撞击 ×${stats.powerMultiplier}` :
                item.type === 'speed' ? `SPEED+ ${stats.speed}/2 · 速度 ×${stats.speedMultiplier}` : 'JUMP×2 · 再按一次空格可二段跳'
            this.toast.textContent = message
            this.toast.style.color = item.color
            this.toastAnimation?.cancel()
            this.toastAnimation = this.toast.animate([{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -8px)' }], { duration: 1800 })
        }
        return true
    }

    templateFor(type) { return this.templates?.[TYPES.findIndex(item => item.type === type)] }
    canCollect(item, vehicle) { return item.consumable ? this.game.world.items.canCollect(vehicle, item.type) : vehicle.upgrades.canCollect(item.type) }

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
        const vehicles = [...this.game.world.vehicleDamage.records.keys()].filter(vehicle => !vehicle.destroyed && vehicle.chassis.physical.body.isEnabled())
        for(const item of this.items)
        {
            if(!item.active && this.clock >= item.respawnAt) { item.active = true; item.group.visible = true }
            item.model.position.y = 0.6 + Math.sin(this.clock * 2 + item.id) * 0.13
            item.model.rotation.y = Math.PI / 4 + Math.sin(this.clock * 0.7 + item.id) * 0.18
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
