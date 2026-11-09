import * as THREE from 'three/webgpu'
import { Fn, float, uv } from 'three/tsl'
import { Game } from '../Game.js'

// A visual warning only. It creates no rigid bodies or collision surfaces.
export class OceanBoundary
{
    constructor(heightfield)
    {
        this.game = Game.getInstance()
        this.height = 2.4
        this.depth = this.game.water.ocean.warningDepth
        this.segments = this.traceBoundary(heightfield)
        const positions = [], uvs = []
        for(const [a, b] of this.segments)
        {
            for(const [point, top] of [[a, 0], [b, 0], [a, 1], [a, 1], [b, 0], [b, 1]])
            {
                positions.push(point.x, top * this.height, point.z)
                uvs.push(0, top)
            }
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
        geometry.computeBoundingSphere()

        const material = new THREE.MeshBasicNodeMaterial({
            color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        })
        material.opacityNode = Fn(() =>
        {
            const height = uv().y
            // Three narrow layers climb at about half a metre per second.
            const phase = height.mul(3).sub(this.game.ticker.elapsedUniform.mul(0.65)).fract()
            const distance = phase.sub(0.5).abs()
            const feather = phase.fwidth().min(0.04).max(0.003)
            const stripe = distance.smoothstep(float(0.035).sub(feather), float(0.035).add(feather)).oneMinus()
            const fade = height.oneMinus().pow(1.6).mul(0.7)
            const base = height.smoothstep(0.009, 0.022).oneMinus().mul(0.65)
            return base.max(stripe.mul(fade))
        })()
        this.mesh = new THREE.Mesh(geometry, material)
        this.mesh.name = 'ocean-warning-bands'
        this.mesh.position.y = this.game.water.surfaceElevationUniform.value + 0.06
        this.mesh.renderOrder = 2
        this.game.scene.add(this.mesh)
    }

    traceBoundary({ heights, rowsCount, size })
    {
        const level = this.game.water.surfaceElevationUniform.value - this.depth
        const spacing = size / (rowsCount - 1)
        const segments = []
        const pointAt = (x, z) => ({ x: x * spacing - size / 2, z: z * spacing - size / 2, y: heights[z + x * rowsCount] })
        const edgePoint = (a, b) =>
        {
            const t = (level - a.y) / (b.y - a.y)
            return { x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) }
        }
        // March the actual seabed heightfield. Inland water is too shallow to
        // reach this level, so only the outer deep sea gets warning bands.
        for(let x = 0; x < rowsCount - 1; x++)
        {
            for(let z = 0; z < rowsCount - 1; z++)
            {
                const corners = [pointAt(x, z), pointAt(x + 1, z), pointAt(x + 1, z + 1), pointAt(x, z + 1)]
                const crossings = new Map()
                for(let edge = 0; edge < 4; edge++)
                {
                    const a = corners[edge], b = corners[(edge + 1) % 4]
                    if((a.y < level) !== (b.y < level)) crossings.set(edge, edgePoint(a, b))
                }
                if(crossings.size === 2) segments.push([...crossings.values()])
                else if(crossings.size === 4)
                {
                    const centerBelow = corners.reduce((sum, point) => sum + point.y, 0) / 4 < level
                    const pairs = centerBelow === (corners[0].y < level) ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]]
                    for(const [a, b] of pairs) segments.push([crossings.get(a), crossings.get(b)])
                }
            }
        }
        return this.smoothSegments(segments)
    }

    smoothSegments(segments)
    {
        const key = point => `${point.x.toFixed(5)},${point.z.toFixed(5)}`
        const connected = new Map()
        segments.forEach((segment, index) =>
        {
            for(const point of segment)
            {
                const id = key(point)
                if(!connected.has(id)) connected.set(id, [])
                connected.get(id).push(index)
            }
        })
        const visited = new Set(), result = []
        for(let start = 0; start < segments.length; start++)
        {
            if(visited.has(start)) continue
            let points = [...segments[start]]
            visited.add(start)
            while(key(points.at(-1)) !== key(points[0]))
            {
                const last = key(points.at(-1))
                const next = connected.get(last)?.find(index => !visited.has(index))
                if(next === undefined) break
                visited.add(next)
                const segment = segments[next]
                points.push(key(segment[0]) === last ? segment[1] : segment[0])
            }
            const closed = key(points.at(-1)) === key(points[0])
            if(closed) points.pop()
            // Round the coarse heightfield corners without moving the warning
            // far from the danger contour or adding any physical barrier.
            for(let pass = 0; pass < 2; pass++)
            {
                const rounded = closed ? [] : [points[0]]
                for(let i = 0; i < points.length - (closed ? 0 : 1); i++)
                {
                    const a = points[i], b = points[(i + 1) % points.length]
                    for(const t of [0.25, 0.75]) rounded.push({ x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) })
                }
                if(!closed) rounded.push(points.at(-1))
                points = rounded
            }
            for(let i = 0; i < points.length - (closed ? 0 : 1); i++)
                result.push([points[i], points[(i + 1) % points.length]])
        }
        return result
    }
}
