import * as THREE from 'three/webgpu'
import {
    float,
    Fn,
    mix,
    normalWorld,
    positionLocal,
    positionWorld,
    rotateUV,
    screenSize,
    screenUV,
    smoothstep,
    step,
    texture,
    uniform,
    uv,
    vec2,
} from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * 树冠 —— 原版 `sources/Game/World/Foliage.js` 的移植。
 *
 *  - 一个几何体：80 张 0.8×0.8 的平面，随机铺在球壳里
 *  - 每棵树一个实例，法线从“面片法线”揉向“球心向外”（lerp 0.85）
 *  - alpha 来自 128×128 的 foliageSDF，阈值 0.3
 *  - 风吹的是 UV，不是顶点：rotateUV(uv, windOffset.length() * 2.2)
 *  - 相机附近把叶子“透开”：screenUV 到屏幕点的距离做 smoothstep
 *  - 阴影 pass 用 maskShadowNode 裁形状，否则影子是 80 个方块
 *
 * 与原版的两处差别（都是为了让“一张卡片 = 一个纯色”）：
 *  1. 法线：原版逐顶点 lerp(normal, 0.85)，一张卡片内部会有渐变；
 *     这里一张卡片只用一个方向，只有卡片之间才有明暗差。
 *  2. alpha：原版输出 sdf - threshold（0..0.7 的连续值）；
 *     这里用 step(threshold, sdf) 压成 0/1。连续 alpha 在合成时会让卡片
 *     “中心亮、边缘暗”，看起来每片叶子都带一圈暗边。
 *
 * 与原版唯一的差别：原版手动建 instanceMatrix 并用 instance() 节点应用，
 * 这里用 InstancedMesh 自带的矩阵（结果等价，少一层风险）。
 */
export class Foliage
{
    constructor(look, wind, foliageTexture, canopies, colorA, colorB, options = {})
    {
        this.look = look
        this.wind = wind
        this.foliageTexture = foliageTexture
        this.canopies = canopies
        this.seeThrough = options.seeThrough ?? true

        this.colorA = uniform(new THREE.Color(colorA))
        this.colorB = uniform(new THREE.Color(colorB))

        // 原版：threshold 0.3，seeThrough 的软边 0.11 / 0.57（再按相机距离缩放）
        this.threshold = uniform(0.3)
        this.seeThroughPosition = uniform(vec2(0.5, 0.5))
        this.seeThroughEdgeMin = uniform(0.11)
        this.seeThroughEdgeMax = uniform(0.57)
        this.seeThroughMultiplier = 1

        this.geometry = this.buildGeometry()
        this.material = this.buildMaterial()
        this.mesh = this.buildMesh()
    }

    /* ---------------------------------------------------------------- */
    /*  80 张卡片铺在球壳上                                               */
    /* ---------------------------------------------------------------- */

    buildGeometry()
    {
        const count = 80
        const planes = []

        for(let i = 0; i < count; i++)
        {
            const plane = new THREE.PlaneGeometry(0.8, 0.8)

            // 球壳上随机一点（原版：1 - pow(rng, 3)，靠外更密）
            const spherical = new THREE.Spherical(
                1 - Math.pow(Math.random(), 3),
                Math.PI * 2 * Math.random(),
                Math.PI * Math.random()
            )
            const position = new THREE.Vector3().setFromSpherical(spherical)

            plane.rotateZ(Math.random() * 9999)
            plane.translate(position.x, position.y, position.z)

            // 法线：每张卡片只用一个方向（球心 → 卡片中心），四个顶点相同。
            // 原版是逐顶点 lerp(normal, 0.85)，会让一张卡片内部出现“中间亮、四角暗”的渐变；
            // 这里改成整张卡片一个法线 —— 卡片自己颜色是平的，只有不同卡片之间才有明暗差。
            const cardNormal = position.clone().normalize()
            const normalArray = new Float32Array(12)
            for(let v = 0; v < 4; v++)
            {
                const i3 = v * 3
                normalArray[i3] = cardNormal.x
                normalArray[i3 + 1] = cardNormal.y
                normalArray[i3 + 2] = cardNormal.z
            }
            plane.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3))

            planes.push(plane)
        }

        return mergeGeometries(planes)
    }

    /* ---------------------------------------------------------------- */
    /*  材质                                                              */
    /* ---------------------------------------------------------------- */

    buildMaterial()
    {
        // 受光面 / 背光面两个颜色，按 n·L 过渡
        const colorNode = Fn(() =>
        {
            const mixStrength = normalWorld.dot(this.look.directionUniform).smoothstep(0, 1)
            return mix(this.colorA, this.colorB, mixStrength)
        })()

        // 叶片在贴图空间里被风吹得轻轻转
        const foliageAlpha = Fn(() =>
        {
            const rotation = this.wind.offsetNode(positionLocal.xz).length().mul(2.2)
            const rotatedUv = rotateUV(uv(), rotation, vec2(0.5))
            return texture(this.foliageTexture, rotatedUv).r
        })()

        const alphaNode = Fn(() =>
        {
            let alpha = foliageAlpha

            if(this.seeThrough)
            {
                // 屏幕空间：离“焦点”越近越透，远处保持原样
                const toFocus = screenUV.sub(this.seeThroughPosition)
                    .mul(vec2(screenSize.x.div(screenSize.y), 1))
                const distance = toFocus.length()
                const distanceFade = smoothstep(this.seeThroughEdgeMin, this.seeThroughEdgeMax, distance)

                alpha = foliageAlpha.mul(distanceFade.mul(this.threshold.oneMinus()).add(this.threshold))
            }

            // 硬边：只留 0 / 1。
            // 如果这里保留 SDF 的软过渡，输出 alpha 会小于 1，
            // 整张卡片就会变成“中心亮、边缘暗”的渐变，而不是一整片同色。
            return step(this.threshold, alpha)
        })()

        const material = this.look.createMaterial({
            colorNode,
            alphaNode,
            alphaTest: 0.5,
            side: THREE.FrontSide,
            hasLightBounce: false,
            hasDropShadows: false,
        })

        // 原版：receivedShadowPositionNode = positionLocal + lightDirection * shadowOffset
        // 沿光方向把采样点往前推一点，避免 80 张卡片互相“打黑”
        this.shadowOffset = uniform(0.9)
        material.receivedShadowPositionNode = positionWorld.add(
            this.look.directionUniform.mul(this.shadowOffset)
        )

        // 阴影 pass 也按贴图裁形状
        material.maskShadowNode = texture(this.foliageTexture).r.greaterThan(0.5)

        return material
    }

    /* ---------------------------------------------------------------- */
    /*  实例化：每棵树冠一个实例，整团卡片朝向相机                         */
    /*                                                                  */
    /*  原版 setFromReferences() 里：                                       */
    /*      const towardCamera = view.spherical.offset.normalize()          */
    /*      object.up.set(sin(angle), cos(angle), 0)                         */
    /*      object.lookAt(towardCamera)                                      */
    /*  80 张卡片是平行的，必须整体朝向相机，否则从别的角度只能看到侧边。      */
    /*  原版在加载时算一次（相机角度固定），这里每帧跟着相机更新。            */
    /* ---------------------------------------------------------------- */

    buildMesh()
    {
        const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.canopies.length)
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false

        this.dummy = new THREE.Object3D()
        this.rollAngles = this.canopies.map(() => Math.PI * 2 * Math.random())

        this.mesh = mesh
        this.updateMatrices(new THREE.Vector3(0, 0, 50))

        return mesh
    }

    updateMatrices(cameraPosition)
    {
        const dummy = this.dummy
        dummy.scale.set(1, 1, 1)

        for(let i = 0; i < this.canopies.length; i++)
        {
            const canopy = this.canopies[i]
            const angle = this.rollAngles[i]

            dummy.position.copy(canopy.position)
            dummy.up.set(Math.sin(angle), Math.cos(angle), 0)
            dummy.lookAt(cameraPosition)
            dummy.scale.setScalar(canopy.radius)
            dummy.updateMatrix()

            this.mesh.setMatrixAt(i, dummy.matrix)
        }

        this.mesh.instanceMatrix.needsUpdate = true
    }

    /**
     * 每帧：整团卡片跟着相机转 + seeThrough 的屏幕点与软边
     * 原版：edge = (3 / radius, 15 / radius) * seeThroughMultiplier
     */
    update(cameraPosition, focusScreenPosition, cameraDistance)
    {
        this.updateMatrices(cameraPosition)

        if(!this.seeThrough)
            return

        this.seeThroughPosition.value.copy(focusScreenPosition)
        this.seeThroughEdgeMin.value = 3 / cameraDistance * this.seeThroughMultiplier
        this.seeThroughEdgeMax.value = 15 / cameraDistance * this.seeThroughMultiplier
    }
}
