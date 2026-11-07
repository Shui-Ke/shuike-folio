import * as THREE from 'three/webgpu'
import {
    abs,
    color,
    cos,
    float,
    Fn,
    fract,
    fwidth,
    max,
    min,
    mix,
    positionWorld,
    sin,
    smoothstep,
    texture,
} from 'three/tsl'

export const TERRAIN_SIZE = 72

/** 地面高度：几个正弦叠加，便宜、平滑、CPU/GPU 可共用同一个公式 */
export function terrainHeight(x, z)
{
    return Math.sin(x * 0.14) * Math.cos(z * 0.12) * 0.8
        + Math.sin(x * 0.33 + z * 0.28) * 0.35
        + Math.cos(x * 0.06 - z * 0.1) * 0.22
}

/** 与 terrainHeight 完全一致的 TSL 版本，给草的顶点用 */
export const terrainHeightNode = Fn(([x, z]) =>
{
    return sin(x.mul(0.14)).mul(cos(z.mul(0.12))).mul(0.8)
        .add(sin(x.mul(0.33).add(z.mul(0.28))).mul(0.35))
        .add(cos(x.mul(0.06).sub(z.mul(0.1))).mul(0.22))
})

/** 小路：沿着 z 方向缓慢摆动的一条带子，路径上不长草 */
export function pathMask(x, z)
{
    const distance = Math.abs(x - Math.sin(z * 0.09) * 3.0)
    return 1 - THREE.MathUtils.smoothstep(distance, 1.7, 3.1)
}

export function grassMask(noise, x, z)
{
    const n = noise.sample(x * 0.013, z * 0.013)
    const patch = THREE.MathUtils.smoothstep(n, 0.45, 0.6)
    return patch * (1 - pathMask(x, z))
}

export class Terrain
{
    constructor(noise, look)
    {
        this.noise = noise
        this.look = look

        this.buildMesh()
        this.buildMaterial()
    }

    buildMesh()
    {
        const segments = 180
        const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments)
        geometry.rotateX(- Math.PI * 0.5)

        const position = geometry.attributes.position
        for(let i = 0; i < position.count; i++)
        {
            const x = position.getX(i)
            const z = position.getZ(i)
            position.setY(i, terrainHeight(x, z))
        }
        position.needsUpdate = true
        geometry.computeVertexNormals()

        this.geometry = geometry
        this.mesh = new THREE.Mesh(geometry, null)
        this.mesh.receiveShadow = true
    }

    buildMaterial()
    {
        const grassColor = color('#6b7a2b')
        const dirtColor = color('#cf7043')
        const dirtDarkColor = color('#a95a42')
        const slabColor = color('#e7ab84')
        const lineColor = color('#b06b52')

        const colorNode = Fn(() =>
        {
            const xz = positionWorld.xz

            // 大块噪声决定草地/裸土
            const patchNoise = texture(this.noise.texture, xz.mul(0.013)).r
            const patches = patchNoise.smoothstep(0.44, 0.58)

            // 小路
            const path = float(1).sub(
                abs(xz.x.sub(sin(xz.y.mul(0.09)).mul(3.0))).smoothstep(1.7, 3.1)
            )

            // 土色本身再抖一层
            const grain = texture(this.noise.texture, xz.mul(0.05)).r
            let ground = mix(dirtDarkColor, dirtColor, grain)

            // 草
            ground = mix(ground, grassColor, patches.mul(path.oneMinus()).mul(0.95))

            // 小路上的石板
            ground = mix(ground, slabColor, path.mul(0.92))

            // 石板缝：世界空间网格，宽度跟随屏幕像素
            const coords = xz.div(1.6)
            const derivative = fwidth(coords)
            const cell = fract(coords).sub(0.5).abs()
            const line = cell.x.max(cell.y)
            const width = max(max(derivative.x, derivative.y).mul(1.4), 0.015)
            const lineMask = float(1).sub(line.smoothstep(0, width))
            const density = float(1).div(max(derivative.x, derivative.y)).smoothstep(2, 8)

            ground = mix(ground, lineColor, lineMask.mul(path).mul(density).mul(0.75))

            return ground
        })()

        this.material = this.look.createMaterial({
            colorNode,
            hasDropShadows: true,
            hasCoreShadows: false,
            hasLightBounce: false,
        })

        this.mesh.material = this.material
    }
}
