import * as THREE from 'three/webgpu'
import {
    attribute,
    clamp,
    color,
    float,
    Fn,
    fract,
    mod,
    step,
    uniform,
    vec2,
    vec3,
} from 'three/tsl'

/**
 * 雨 —— 2048 条“线”，但只是一次 draw call 的 4 顶点面片。
 *
 * 位置全部在 0..1 的盒子里，顶点着色器做三件事：
 *   1. 以相机为中心循环（世界无限大）
 *   2. 用一个 0..1 的 progress 让雨滴从上往下掉，掉到底就回顶
 *   3. 每滴雨按 random 阈值显示/隐藏，于是“雨量”只是改一个 uniform
 *
 * 原版：sources/Game/World/RainLines.js
 * 同一套代码在 bruno 里还兼职下雪（把 length 变短、speed 变慢）。
 */
export class RainLines
{
    constructor(look, options = {})
    {
        this.look = look

        this.count = options.count ?? 1400
        this.size = 46
        this.thickness = uniform(0.014)
        this.elevation = uniform(15)
        this.length = uniform(1.15)
        this.incline = uniform(0.22)
        this.speed = 0.32
        this.center = uniform(vec2(0, 0))
        this.localTime = uniform(0)
        this.visibleRatio = uniform(0.45)

        this.buildGeometry()
        this.buildMaterial()
        this.buildMesh()
    }

    buildGeometry()
    {
        const positionArray = new Float32Array(this.count * 4 * 3)
        const offsetArray = new Float32Array(this.count * 4 * 2)
        const randomArray = new Float32Array(this.count * 4)
        const indexArray = new Uint16Array(this.count * 6)

        for(let lineIndex = 0; lineIndex < this.count; lineIndex++)
        {
            const x = Math.random()
            const z = Math.random()
            const random = Math.random()

            for(let vertexIndex = 0; vertexIndex < 4; vertexIndex++)
            {
                const positionIndex = (lineIndex * 4 + vertexIndex) * 3
                positionArray[positionIndex + 0] = x
                positionArray[positionIndex + 1] = 0
                positionArray[positionIndex + 2] = z

                const offsetIndex = (lineIndex * 4 + vertexIndex) * 2
                offsetArray[offsetIndex + 0] = (vertexIndex === 0 || vertexIndex === 1) ? 1 : 0
                offsetArray[offsetIndex + 1] = (vertexIndex === 0 || vertexIndex === 3) ? 1 : 0

                randomArray[lineIndex * 4 + vertexIndex] = random
            }

            indexArray[lineIndex * 6 + 0] = lineIndex * 4 + 0
            indexArray[lineIndex * 6 + 1] = lineIndex * 4 + 3
            indexArray[lineIndex * 6 + 2] = lineIndex * 4 + 2
            indexArray[lineIndex * 6 + 3] = lineIndex * 4 + 2
            indexArray[lineIndex * 6 + 4] = lineIndex * 4 + 1
            indexArray[lineIndex * 6 + 5] = lineIndex * 4 + 0
        }

        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3))
        this.geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsetArray, 2))
        this.geometry.setAttribute('random', new THREE.Float32BufferAttribute(randomArray, 1))
        this.geometry.index = new THREE.Uint16BufferAttribute(indexArray, 1)
    }

    buildMaterial()
    {
        this.material = this.look.createMaterial({
            colorNode: color('#f4f7ff'),
            normalNode: vec3(0, 1, 0),
            transparent: true,
            hasDropShadows: false,
            hasLightBounce: false,
            hasFog: false,
            depthWrite: false,
        })

        this.material.positionNode = Fn(() =>
        {
            const newPosition = attribute('position').toVar()
            const offset = attribute('offset')
            const random = attribute('random')
            const tangent = vec2(0.707, -0.707)

            // 跟着相机循环
            newPosition.xz.mulAssign(this.size)
            newPosition.xz.subAssign(this.center)
            const halfSize = float(this.size * 0.5)
            newPosition.x.assign(mod(newPosition.x.add(halfSize), float(this.size)).sub(halfSize))
            newPosition.z.assign(mod(newPosition.z.add(halfSize), float(this.size)).sub(halfSize))
            newPosition.xz.addAssign(this.center)

            // 线的粗细
            newPosition.xz.addAssign(tangent.mul(offset.x.mul(this.thickness)))

            // 从上往下掉，掉完回顶
            const progress = this.localTime.add(random).mod(1)
            newPosition.y.assign(this.elevation.add(this.length))
            newPosition.y.subAssign(this.length.mul(offset.y.oneMinus()))
            newPosition.y.subAssign(progress.mul(this.elevation.add(this.length)))
            newPosition.y.assign(clamp(newPosition.y, 0, this.elevation))

            // 雨量：按随机阈值剔除
            const visible = step(this.visibleRatio, fract(random.mul(99)))
            newPosition.y.addAssign(visible.mul(99))

            // 被风吹斜
            newPosition.xz.addAssign(tangent.mul(newPosition.y.mul(this.incline).mul(-1)))

            return newPosition
        })()
    }

    buildMesh()
    {
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.position.y = -0.3
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 1
    }

    update(dt, center)
    {
        this.center.value.copy(center)
        this.localTime.value += dt * this.speed
    }
}
