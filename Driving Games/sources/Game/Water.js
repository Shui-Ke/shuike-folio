import { uniform, Fn, vec2, mix, float } from 'three/tsl'
import { MAP_SCALE, LAKE } from './WorldLayout.js'
import { Game } from './Game.js'
import { MathUtils } from 'three/webgpu'

export class Water
{
    constructor()
    {
        this.game = Game.getInstance()

        this.surfaceElevation = -0.3
        this.depthElevation = -1.5
        this.ocean = { start: 72 * MAP_SCALE, end: 88 * MAP_SCALE, floor: -12, halfSize: 96 * MAP_SCALE, warningDepth: 1.25 }
        this.lake = LAKE
        this.oceanHeightNode = Fn(([position, originalHeight]) =>
        {
            const edge = position.x.abs().max(position.y.abs())
            const offshore = edge.smoothstep(this.ocean.start, this.ocean.end)
            const submerged = originalHeight.negate().smoothstep(0.3, 0.8)
            const distance = position.sub(vec2(LAKE.x, LAKE.z)).div(vec2(LAKE.radiusX, LAKE.radiusZ)).length()
            const lakeBed = mix(float(-LAKE.depth), float(-1.1), distance.smoothstep(0.35, 0.72))
                .add(distance.smoothstep(0.72, 1).mul(1.1))
            const original = originalHeight.sub(offshore.mul(submerged).mul(10.5))
            const height = mix(lakeBed, original, distance.smoothstep(1, 1.25))
            return edge.greaterThan(this.ocean.halfSize).select(this.ocean.floor, height)
        })

        this.surfaceElevationUniform = uniform(this.surfaceElevation)
        this.surfaceThicknessUniform = uniform(0.013)

        // The retained map uses its original global water plane.
        this.enabledUniform = uniform(1)
        this.presenceNode = Fn(() => this.enabledUniform)

        // Debug
        if(this.game.debug.active)
        {
            const debugPanel = this.game.debug.panel.addFolder({
                title: '💧 Water',
                expanded: false,
            })
            debugPanel.addBinding(this.surfaceElevationUniform, 'value', { label: 'surfaceElevation', min: -1, max: 0, step: 0.001 })
            debugPanel.addBinding(this.surfaceThicknessUniform, 'value', { label: 'amplitude', min: 0, max: 0.5, step: 0.001 })
        }
    }

    depthAt(position)
    {
        return Math.max(0, this.surfaceElevationUniform.value - position.y)
    }

    oceanHeightAt(x, z, originalHeight)
    {
        const edge = Math.max(Math.abs(x), Math.abs(z))
        if(edge > this.ocean.halfSize) return this.ocean.floor
        const offshore = MathUtils.smoothstep(edge, this.ocean.start, this.ocean.end)
        const submerged = MathUtils.smoothstep(-originalHeight, 0.3, 0.8)
        const distance = this.lakeDistance(x, z)
        const lakeBed = MathUtils.lerp(-LAKE.depth, -1.1, MathUtils.smoothstep(distance, 0.35, 0.72)) + MathUtils.smoothstep(distance, 0.72, 1) * 1.1
        return MathUtils.lerp(lakeBed, originalHeight - offshore * submerged * 10.5, MathUtils.smoothstep(distance, 1, 1.25))
    }

    lakeDistance(x, z) { return Math.hypot((x - LAKE.x) / LAKE.radiusX, (z - LAKE.z) / LAKE.radiusZ) }
}
