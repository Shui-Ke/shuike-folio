import * as THREE from 'three/webgpu'
import {
    Fn,
    attribute,
    color,
    float,
    hash,
    instancedArray,
    instanceIndex,
    materialNormal,
    max,
    mix,
    mod,
    modelViewMatrix,
    normalWorld,
    positionGeometry,
    remapClamp,
    rotateUV,
    sin,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl'
import { terrainHeight, terrainHeightNode } from './Terrain.js'

/**
 * 落叶 —— 原版 `sources/Game/World/Leaves.js` 的移植。
 *
 * 结构完全一致：
 *   positionBuffer / velocityBuffer  两个 instancedArray，GPU 上做积分
 *   init compute                     在地面附近按 hash 撒点
 *   update compute                   车推 → 风 → 爆炸 → 升力 → 阻尼 → 重力 → 积分 → 贴地 → 绕镜头循环
 *   渲染                              每片叶子一个 1×1 面片，配 per-instance 法线/基础旋转/缩放/重量
 *
 * 唯一的环境差异：原版用 terrainData.b（水深）算阻尼和地面高度，
 * 这里没有水体，改用 terrainHeight() + 一个高度阈值近似，公式位置一一对应。
 *
 * 没有 WebGPU（拿不到 compute）时，用 stepCpu() 在 CPU 上跑同一组方程，
 * 结果写回同一个实例属性 —— 渲染路径不变，只是执行器不同。
 */
export class Leaves
{
    constructor(look, wind, noise, options = {})
    {
        this.look = look
        this.wind = wind
        this.noise = noise
        this.renderer = options.renderer ?? null
        this.useCompute = options.compute ?? false

        // 原版：2^7 ~ 2^11，按 yearCycles.leaves 取
        this.count = options.count ?? Math.pow(2, 10)
        this.sizeValue = options.size ?? 30
        this.sizeUniform = uniform(this.sizeValue)

        // 原版的 uniforms，一一对应
        this.focusPoint = uniform(vec2())
        this.vehicleVelocity = uniform(vec3())
        this.vehiclePosition = uniform(vec3(0, 0, -100))
        this.scale = uniform(0.25)
        this.rotationFrequency = uniform(3)
        this.rotationElevationMultiplier = uniform(1)
        this.pushSidewaysMultiplier = uniform(20)
        this.pushMultiplier = uniform(100)
        this.windFrequency = uniform(0.005)
        this.windMultiplier = uniform(0.5)
        this.upwardMultiplier = uniform(1)
        this.defaultDamping = uniform(1.5)
        this.waterDamping = uniform(0.75)
        this.gravity = uniform(9.807)
        this.explosion = uniform(vec4(0))
        this.delta = uniform(1 / 60)

        this.colorA = uniform(color(0x95513a))
        this.colorB = uniform(color(0xf56a3a))

        this.buildGeometry()
        this.buildPerInstanceAttributes()

        if(this.useCompute)
            this.buildCompute()
        else
            this.buildCpu()

        this.buildMaterial()
        this.buildMesh()
    }

    /* ---------------------------------------------------------------- */
    /*  几何：一个 1×1 面片，左右两端各偏移 0.15，让叶子不是死板的矩形      */
    /* ---------------------------------------------------------------- */

    buildGeometry()
    {
        this.geometry = new THREE.PlaneGeometry(1, 1)

        const positions = this.geometry.attributes.position.array
        positions[0] += 0.15
        positions[3] += 0.15
        positions[6] -= 0.15
        positions[9] -= 0.15

        this.geometry.rotateX(- Math.PI * 0.5)
    }

    /* ---------------------------------------------------------------- */
    /*  每片叶子的固有属性：基础旋转、缩放、重量、法线                     */
    /* ---------------------------------------------------------------- */

    buildPerInstanceAttributes()
    {
        const count = this.count

        const baseRotation = new Float32Array(count)
        const scale = new Float32Array(count)
        const weight = new Float32Array(count)

        for(let i = 0; i < count; i++)
        {
            baseRotation[i] = Math.random() * Math.PI * 2
            scale[i] = Math.random() * 0.5 + 0.5
            weight[i] = Math.random() * 0.1 + 0.1
        }

        const normalArray = new Float32Array(count * 3)
        for(let i = 0; i < count; i++)
        {
            const normal = new THREE.Vector3(0, 1, 0)
            normal.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 2)
            normal.applyAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 2)
            normal.toArray(normalArray, i * 3)
        }

        // 原版用 instancedArray(...).toAttribute()，这里用等价的 InstancedBufferAttribute
        this.baseRotationAttribute = new THREE.InstancedBufferAttribute(baseRotation, 1)
        this.scaleAttribute = new THREE.InstancedBufferAttribute(scale, 1)
        this.weightAttribute = new THREE.InstancedBufferAttribute(weight, 1)
        this.normalAttribute = new THREE.InstancedBufferAttribute(normalArray, 3)

        this.geometry.setAttribute('leafBaseRotation', this.baseRotationAttribute)
        this.geometry.setAttribute('leafScale', this.scaleAttribute)
        this.geometry.setAttribute('leafWeight', this.weightAttribute)
        this.geometry.setAttribute('leafNormal', this.normalAttribute)
    }

    /* ---------------------------------------------------------------- */
    /*  GPU 路径：与 bruno 相同，两个 storage buffer + 两次 dispatch        */
    /* ---------------------------------------------------------------- */

    buildCompute()
    {
        this.positionBuffer = instancedArray(this.count, 'vec3')
        this.velocityBuffer = instancedArray(this.count, 'vec3')
        this.weightBuffer = instancedArray(this.weightAttribute.array, 'float')

        this.positionNode = this.positionBuffer.toAttribute()

        // init：贴地撒点 + 一点噪声把叶子推开
        const init = Fn(() =>
        {
            const position = this.positionBuffer.element(instanceIndex)

            position.assign(vec3(
                hash(instanceIndex).sub(0.5).mul(this.sizeUniform),
                0,
                hash(instanceIndex.add(1)).sub(0.5).mul(this.sizeUniform)
            ))

            const noiseUv = position.xz.mul(0.02)
            const noiseValue = texture(this.noise.texture, noiseUv).r
            position.x.addAssign(noiseValue.mul(15))
        })().compute(this.count)

        if(this.renderer)
            this.renderer.computeAsync(init)

        // update：原版 update compute 的逐行移植
        const update = Fn(() =>
        {
            const position = this.positionBuffer.element(instanceIndex)
            const velocity = this.velocityBuffer.element(instanceIndex)
            const weight = this.weightBuffer.element(instanceIndex)

            // 车推：横向 + 速度方向
            const vehicleDelta = position.sub(this.vehiclePosition)
            const pushSideways = vec3(vehicleDelta.x, 0, vehicleDelta.z).normalize().mul(this.pushSidewaysMultiplier)
            const pushVelocity = vec3(this.vehicleVelocity.x, 0, this.vehicleVelocity.z).mul(this.pushMultiplier)

            const distanceToVehicle = vehicleDelta.length()
            const vehicleMultiplier = distanceToVehicle.remapClamp(0.5, 2, 1, 0)
            const speedMultiplier = this.vehicleVelocity.length()
            const vehiclePush = pushVelocity.add(pushSideways).mul(speedMultiplier).mul(vehicleMultiplier)

            velocity.addAssign(vehiclePush)

            // 风：噪声 - 阈值，乘重量
            const noiseUv = position.xz.mul(this.windFrequency)
                .add(this.wind.direction.mul(this.wind.localTime)).xy
            const noiseValue = texture(this.noise.texture, noiseUv).r

            const windStrength = this.wind.strength.sub(noiseValue).mul(weight).mul(this.windMultiplier).max(0)
            velocity.x.addAssign(this.wind.direction.x.mul(windStrength))
            velocity.z.addAssign(this.wind.direction.y.mul(windStrength))

            // 爆炸
            const explosionDelta = position.xz.sub(this.explosion.xy)
            const distanceToExplosion = explosionDelta.length()
            const explosionMultiplier = distanceToExplosion
                .remapClamp(this.explosion.z.mul(0.5), this.explosion.z, 0.2, 0)
            const explosionPush = explosionDelta.mul(explosionMultiplier).mul(this.explosion.a)
            velocity.addAssign(vec3(explosionPush.x, 0, explosionPush.y))

            // 升力：水平速度越快，抬得越高；离地越高，抬升越小
            const upwardDim = position.y.remapClamp(0, 6, 1, 0)
            velocity.y = velocity.xz.length().min(2).mul(this.upwardMultiplier).mul(upwardDim)

            // 阻尼：贴地/贴水用 waterDamping，空中的用 defaultDamping
            const nearGround = step(0.05, position.y).oneMinus()
            const groundDamping = mix(this.defaultDamping, this.waterDamping, nearGround)
            const inTheAirDamping = step(0.05, position.y).mul(this.defaultDamping)
            const damping = max(groundDamping, inTheAirDamping).mul(this.delta)
            velocity.mulAssign(float(1).sub(damping))

            // 重力（原版这里没有再乘 delta，保持一致）
            velocity.y = velocity.y.sub(this.gravity.mul(weight))

            // 积分
            position.addAssign(velocity.mul(this.delta))

            // 贴地
            const floorY = terrainHeightNode(position.x, position.z).add(0.02)
            position.y.assign(max(position.y, floorY))

            // 绕镜头循环
            const halfSize = this.sizeUniform.mul(0.5)
            position.x.assign(mod(position.x.add(halfSize).sub(this.focusPoint.x), this.sizeUniform).sub(halfSize).add(this.focusPoint.x))
            position.z.assign(mod(position.z.add(halfSize).sub(this.focusPoint.y), this.sizeUniform).sub(halfSize).add(this.focusPoint.y))
        })()

        this.updateCompute = update.compute(this.count)
    }

    /* ---------------------------------------------------------------- */
    /*  CPU 路径：同一组方程的 JS 版本（没有 compute 的机器 / WebGL2）      */
    /* ---------------------------------------------------------------- */

    buildCpu()
    {
        const count = this.count

        this.positions = new Float32Array(count * 3)
        this.velocities = new Float32Array(count * 3)

        // init：和 compute 版一样，用 hash 撒点
        for(let i = 0; i < count; i++)
        {
            const x = (this.hash(i) - 0.5) * this.sizeValue
            const z = (this.hash(i + 1) - 0.5) * this.sizeValue
            const noiseValue = this.noise.sample(x * 0.02, z * 0.02)

            this.positions[i * 3 + 0] = x + noiseValue * 15
            this.positions[i * 3 + 1] = 0
            this.positions[i * 3 + 2] = z
        }

        this.positionAttribute = new THREE.InstancedBufferAttribute(this.positions, 3)
        this.positionAttribute.setUsage(THREE.DynamicDrawUsage)
        this.geometry.setAttribute('leafPosition', this.positionAttribute)

        this.positionNode = attribute('leafPosition')
    }

    /** 与 TSL hash 同样味道的 0..1 随机 */
    hash(value)
    {
        const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453
        return x - Math.floor(x)
    }

    /** CPU 版积分，逐行对应 update compute */
    stepCpu(dt)
    {
        const positions = this.positions
        const velocities = this.velocities

        const direction = this.wind.direction.value
        const windTime = this.wind.localTime.value
        const windStrengthUniform = this.wind.strength.value

        const vehiclePosition = this.vehiclePosition.value
        const vehicleVelocity = this.vehicleVelocity.value
        const speedMultiplier = Math.hypot(vehicleVelocity.x, vehicleVelocity.z)

        const explosion = this.explosion.value
        const focusX = this.focusPoint.value.x
        const focusZ = this.focusPoint.value.y
        const halfSize = this.sizeValue * 0.5

        const waterDamping = this.waterDamping.value
        const defaultDamping = this.defaultDamping.value
        const gravity = this.gravity.value
        const upwardMultiplier = this.upwardMultiplier.value

        for(let i = 0; i < this.count; i++)
        {
            const i3 = i * 3
            let x = positions[i3 + 0]
            let y = positions[i3 + 1]
            let z = positions[i3 + 2]
            let vx = velocities[i3 + 0]
            let vy = velocities[i3 + 1]
            let vz = velocities[i3 + 2]

            const weight = this.weightAttribute.array[i]

            // 车推
            const dx = x - vehiclePosition.x
            const dy = y - vehiclePosition.y
            const dz = z - vehiclePosition.z
            const distanceToVehicle = Math.hypot(dx, dy, dz)
            const limit = (distanceToVehicle - 0.5) / (2 - 0.5)
            const vehicleMultiplier = Math.max(0, Math.min(1, 1 - limit))

            const sideLength = Math.hypot(dx, dz) || 1
            const sideX = dx / sideLength * this.pushSidewaysMultiplier.value
            const sideZ = dz / sideLength * this.pushSidewaysMultiplier.value

            vx += (vehicleVelocity.x * this.pushMultiplier.value + sideX) * speedMultiplier * vehicleMultiplier
            vz += (vehicleVelocity.z * this.pushMultiplier.value + sideZ) * speedMultiplier * vehicleMultiplier

            // 风
            const noiseUvX = x * this.windFrequency.value + direction.x * windTime
            const noiseUvZ = z * this.windFrequency.value + direction.y * windTime
            const noiseValue = this.noise.sample(noiseUvX, noiseUvZ)
            const windStrength = Math.max(0, (windStrengthUniform - noiseValue) * weight * this.windMultiplier.value)

            vx += direction.x * windStrength
            vz += direction.y * windStrength

            // 爆炸
            const explosionDx = x - explosion.x
            const explosionDz = z - explosion.y
            const distanceToExplosion = Math.hypot(explosionDx, explosionDz)
            const explosionMultiplier = this.remapClamp(
                distanceToExplosion,
                explosion.z * 0.5,
                explosion.z,
                0.2,
                0
            )
            vx += explosionDx * explosionMultiplier * explosion.w
            vz += explosionDz * explosionMultiplier * explosion.w

            // 升力
            const upwardDim = this.remapClamp(y, 0, 6, 1, 0)
            vy = Math.min(Math.hypot(vx, vz), 2) * upwardMultiplier * upwardDim

            // 阻尼
            const groundDamping = y < 0.05 ? waterDamping : defaultDamping
            const inTheAirDamping = (y >= 0.05 ? 1 : 0) * defaultDamping
            const damping = Math.max(groundDamping, inTheAirDamping) * dt
            const keep = 1 - damping
            vx *= keep
            vy *= keep
            vz *= keep

            // 重力
            vy -= gravity * weight

            // 积分
            x += vx * dt
            y += vy * dt
            z += vz * dt

            // 贴地
            const floorY = terrainHeight(x, z) + 0.02
            if(y < floorY)
                y = floorY

            // 绕镜头循环
            x = ((x + halfSize - focusX) % this.sizeValue + this.sizeValue) % this.sizeValue - halfSize + focusX
            z = ((z + halfSize - focusZ) % this.sizeValue + this.sizeValue) % this.sizeValue - halfSize + focusZ

            positions[i3 + 0] = x
            positions[i3 + 1] = y
            positions[i3 + 2] = z
            velocities[i3 + 0] = vx
            velocities[i3 + 1] = vy
            velocities[i3 + 2] = vz
        }

        this.positionAttribute.needsUpdate = true
    }

    remapClamp(value, inMin, inMax, outMin, outMax)
    {
        if(inMax === inMin)
            return outMin

        const ratio = Math.min(Math.max((value - inMin) / (inMax - inMin), 0), 1)
        return outMin + ratio * (outMax - outMin)
    }

    /* ---------------------------------------------------------------- */
    /*  渲染：与 bruno 相同的 positionNode（翻滚 + 位移）                  */
    /* ---------------------------------------------------------------- */

    buildMaterial()
    {
        const colorNode = Fn(() =>
        {
            const mixStrength = hash(instanceIndex.add(99))
            return vec3(mix(this.colorA, this.colorB, mixStrength))
        })()

        this.material = this.look.createMaterial({
            colorNode,
            normalNode: normalWorld,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0,
        })

        this.material.positionNode = Fn(() =>
        {
            // 每片叶子自己的法线（转到 view 空间）
            materialNormal.assign(modelViewMatrix.mul(vec4(attribute('leafNormal'), 0)))

            const leafPosition = this.positionNode
            const newPosition = positionGeometry
                .mul(attribute('leafScale'))
                .mul(this.scale)

            // 翻滚：水平位置驱动 Z/X 旋转，给每片叶子固定的 Y 基础旋转
            const rotationMultiplier = max(leafPosition.y.mul(this.rotationElevationMultiplier), 0)
            const rotationZ = sin(leafPosition.x.mul(this.rotationFrequency)).mul(rotationMultiplier)
            const rotationX = sin(leafPosition.z.mul(this.rotationFrequency)).mul(rotationMultiplier)
            const rotationY = attribute('leafBaseRotation')

            newPosition.xy.assign(rotateUV(newPosition.xy, rotationZ, vec2(0)))
            newPosition.yz.assign(rotateUV(newPosition.yz, rotationX, vec2(0)))
            newPosition.xz.assign(rotateUV(newPosition.xz, rotationY, vec2(0)))

            return newPosition.add(leafPosition)
        })()
    }

    buildMesh()
    {
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count)
        this.mesh.frustumCulled = false
        this.mesh.castShadow = true
        this.mesh.receiveShadow = true
        this.mesh.renderOrder = 2

        // 位置全在着色器/buffer 里算，实例矩阵保持单位阵
        const identity = new THREE.Matrix4()
        for(let i = 0; i < this.count; i++)
            this.mesh.setMatrixAt(i, identity)
        this.mesh.instanceMatrix.needsUpdate = true
    }

    explode(coordinates, radius)
    {
        this.explosion.value.x = coordinates.x
        this.explosion.value.y = coordinates.z
        this.explosion.value.z = radius
        this.explosion.value.w = 20
    }

    /** 每帧：与 bruno 的 update() 相同 —— 只写 uniform，然后派发 compute */
    update(dt, focusPoint, vehiclePosition, vehicleVelocity)
    {
        this.delta.value = dt
        this.focusPoint.value.set(focusPoint.x, focusPoint.z)
        this.vehiclePosition.value.copy(vehiclePosition)
        this.vehicleVelocity.value.copy(vehicleVelocity)

        if(this.useCompute)
        {
            if(this.renderer)
                this.renderer.computeAsync(this.updateCompute)
        }
        else
        {
            this.stepCpu(dt)
        }

        this.explosion.value.w = 0
    }
}
