import { uniform, Fn } from 'three/tsl'
import { Game } from './Game.js'
import { MathUtils } from 'three/webgpu'

export class Water
{
    constructor()
    {
        this.game = Game.getInstance()

        this.surfaceElevation = -0.3
        this.depthElevation = -1.5
        this.ocean = { start: 72, end: 88, floor: -12, halfSize: 96, warningDepth: 1.25 }
        this.oceanHeightNode = Fn(([position, originalHeight]) =>
        {
            const edge = position.x.abs().max(position.y.abs())
            const offshore = edge.smoothstep(this.ocean.start, this.ocean.end)
            const submerged = originalHeight.negate().smoothstep(0.3, 0.8)
            const height = originalHeight.sub(offshore.mul(submerged).mul(10.5))
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
        return originalHeight - offshore * submerged * 10.5
    }
}
