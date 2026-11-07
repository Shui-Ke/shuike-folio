import { Fn, float, texture, uniform, vec2 } from 'three/tsl'

/**
 * 风：本质是“噪声贴图 + 时间偏移”。
 * 原版：sources/Game/Wind.js
 * 同样的节点同时喂给草（顶点位移）、树冠（UV 旋转）、落叶和雨（方向/倾斜）。
 */
export class Wind
{
    constructor(noise)
    {
        this.noise = noise

        this.angle = Math.PI * 0.62
        this.direction = uniform(vec2(Math.sin(this.angle), Math.cos(this.angle)))
        this.positionFrequency = uniform(0.5)
        this.strength = uniform(0.65)
        this.localTime = uniform(0)

        this.offsetNode = Fn(([position]) =>
        {
            const remapped = position.mul(this.positionFrequency)

            const uv1 = remapped.xy.mul(0.2).add(this.direction.mul(this.localTime)).xy
            const noise1 = texture(this.noise.texture, uv1).r.sub(0.5)

            const uv2 = remapped.xy.mul(0.1).add(this.direction.mul(this.localTime.mul(0.2))).xy
            const noise2 = texture(this.noise.texture, uv2).r.sub(0.5)

            const intensity = noise2.add(noise1)

            return vec2(this.direction.mul(intensity).mul(this.strength))
        })
    }

    update(dt)
    {
        this.localTime.value += dt * 0.1 * this.strength.value
    }
}
