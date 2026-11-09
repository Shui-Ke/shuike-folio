import * as THREE from 'three/webgpu'
import { VEHICLE_SCALE } from '../WorldLayout.js'

// A small, lazily sampled driving grid. Only fixed obstacles enter the cache;
// cars and movable props are handled by the vehicle physics and local probes.
export class VehicleNavigation
{
    constructor(game)
    {
        this.game = game
        this.spacing = 3
        this.cells = new Map()
        this.halfSize = (game.world.level?.terrain.size ?? game.terrain.size) / 2 - 3
        this.clearance = new game.RAPIER.Cuboid(1.65 * VEHICLE_SCALE, 0.55 * VEHICLE_SCALE, 1.65 * VEHICLE_SCALE)
        this.identity = { x: 0, y: 0, z: 0, w: 1 }
        this.isGround = collider => collider.parent()?.isFixed() &&
            (collider.collisionGroups() >>> 16) === game.physics.groups.all
        this.isObstacle = collider => !collider.isSensor() && collider.parent()?.isFixed() && !this.isGround(collider)
    }

    groundAt(x, z)
    {
        if(Math.abs(x) > this.halfSize || Math.abs(z) > this.halfSize) return null
        const terrain = this.game.world.level?.terrain
        if(terrain) return terrain.heightAt(x, z)
        const ray = new this.game.RAPIER.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 })
        const hit = this.game.physics.world.castRay(ray, 200, true, undefined, undefined, undefined, undefined, this.isGround)
        return hit ? 100 - hit.timeOfImpact : null
    }

    sample(x, z)
    {
        const y = this.groundAt(x, z)
        if(y === null || !Number.isFinite(y)) return null
        if(this.game.water.depthAt({ x, y, z }) > 0.12) return null
        // Reject cliffs and steep slopes across the car's footprint.
        for(const [dx, dz] of [[1.7, 0], [-1.7, 0], [0, 1.7], [0, -1.7]])
        {
            const h = this.groundAt(x + dx * VEHICLE_SCALE, z + dz * VEHICLE_SCALE)
            if(h === null || Math.abs(h - y) > 1.05) return null
        }
        let blocked = false
        this.game.physics.world.intersectionsWithShape(
            { x, y: y + 1.15 * VEHICLE_SCALE, z }, this.identity, this.clearance,
            () => { blocked = true; return false },
            undefined, undefined, undefined, undefined, this.isObstacle
        )
        return blocked ? null : new THREE.Vector3(x, y, z)
    }

    cell(ix, iz)
    {
        const key = `${ix},${iz}`
        if(!this.cells.has(key))
        {
            const position = this.sample(ix * this.spacing, iz * this.spacing)
            this.cells.set(key, position ? { key, ix, iz, position } : null)
        }
        return this.cells.get(key)
    }

    nearest(position)
    {
        const ix = Math.round(position.x / this.spacing)
        const iz = Math.round(position.z / this.spacing)
        for(let radius = 0; radius <= 3; radius++)
        {
            let nearest = null
            let distance = Infinity
            for(let x = -radius; x <= radius; x++)
                for(let z = -radius; z <= radius; z++)
                {
                    if(Math.max(Math.abs(x), Math.abs(z)) !== radius) continue
                    const cell = this.cell(ix + x, iz + z)
                    const d = cell?.position.distanceToSquared(position) ?? Infinity
                    if(d < distance) { distance = d; nearest = cell }
                }
            if(nearest) return nearest
        }
        return null
    }

    clearLine(from, to)
    {
        const distance = Math.hypot(to.x - from.x, to.z - from.z)
        const count = Math.max(1, Math.ceil(distance / 1.5))
        let previous = this.groundAt(from.x, from.z)
        for(let i = 1; i <= count; i++)
        {
            const t = i / count
            const position = this.sample(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)
            if(!position || previous === null || Math.abs(position.y - previous) > 1) return false
            previous = position.y
        }
        return true
    }

    path(from, to, allowPartial = true)
    {
        const start = this.nearest(from)
        const goal = this.nearest(to)
        if(!start || !goal) return []
        const open = new Map([[start.key, start]])
        const closed = new Set()
        const costs = new Map([[start.key, 0]])
        const previous = new Map()
        const heuristic = cell => Math.hypot(cell.ix - goal.ix, cell.iz - goal.iz)
        let best = start

        // The map doubled in area and rivals now spawn across it, so a
        // corner-to-corner route needs a larger exploration budget.
        for(let iteration = 0; open.size && iteration < 4200; iteration++)
        {
            let current
            let score = Infinity
            for(const cell of open.values())
            {
                const f = costs.get(cell.key) + heuristic(cell)
                if(f < score) { score = f; current = cell }
            }
            open.delete(current.key)
            closed.add(current.key)
            if(heuristic(current) < heuristic(best)) best = current
            if(current.key === goal.key) { best = current; break }

            for(const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]])
            {
                const next = this.cell(current.ix + dx, current.iz + dz)
                if(!next || closed.has(next.key)) continue
                if(Math.abs(next.position.y - current.position.y) > this.spacing * 0.6) continue
                // No diagonal cuts through building corners.
                if(dx && dz && (!this.cell(current.ix + dx, current.iz) || !this.cell(current.ix, current.iz + dz))) continue
                const cost = costs.get(current.key) + Math.hypot(dx, dz) + Math.abs(next.position.y - current.position.y) * 0.2
                if(cost >= (costs.get(next.key) ?? Infinity)) continue
                costs.set(next.key, cost)
                previous.set(next.key, current)
                open.set(next.key, next)
            }
        }

        if(!allowPartial && best.key !== goal.key) return []
        const route = []
        for(let cell = best; cell && cell.key !== start.key; cell = previous.get(cell.key))
            route.unshift(cell.position.clone())
        return route
    }
}
