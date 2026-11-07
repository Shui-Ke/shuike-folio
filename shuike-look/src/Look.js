import * as THREE from 'three/webgpu'
import {
    cameraPosition,
    color,
    float,
    Fn,
    mix,
    normalWorld,
    positionWorld,
    vec3,
    vec4,
    uniform,
} from 'three/tsl'

/**
 * Bruno(folio-2025)的“三色打光”配方，抽成不依赖 Game 单例的版本。
 *
 * 原版位置：sources/Game/Materials/MeshDefaultMaterial.js
 *   - 不用 Lambert 自带光照，而是自己算：
 *       基础色 × 光色 × 强度        （受光面）
 *       基础色 × 阴影色              （背光核心阴影，偏紫）
 *       再用 n·L 的 smoothstep 在两者之间过渡
 *   - 地面反弹（light bounce）：朝下的面混一点地形色
 *   - 雾：朝 fogColor 混合
 *   - 阴影：把 shadow map 的值“截获”成一个 float，不参与原管线
 *
 * 这里保留同样的结构，方便直接对照阅读。
 */
export class Look
{
    constructor()
    {
        // 一天里的几组配色。数值取自 bruno 的 DayCycles presets
        this.presets = {
            day: {
                lightColor: new THREE.Color('#ffc9a4'),
                lightIntensity: 1.35,
                shadowColor: new THREE.Color('#5a2fd0'),
                fogColor: new THREE.Color('#ffab74'),
                skyTop: new THREE.Color('#ff8f5e'),
                skyBottom: new THREE.Color('#ffdcae'),
                ground: new THREE.Color('#e89a6e'),
                bounce: new THREE.Color('#c96a55'),
            },
            dusk: {
                lightColor: new THREE.Color('#ff8a72'),
                lightIntensity: 1.35,
                shadowColor: new THREE.Color('#4e009c'),
                fogColor: new THREE.Color('#ff5d63'),
                skyTop: new THREE.Color('#ff5f7a'),
                skyBottom: new THREE.Color('#ffb46a'),
                ground: new THREE.Color('#d9795b'),
                bounce: new THREE.Color('#7d2f57'),
            },
            night: {
                lightColor: new THREE.Color('#7d8bff'),
                lightIntensity: 1.1,
                shadowColor: new THREE.Color('#2f00db'),
                fogColor: new THREE.Color('#2a2a6e'),
                skyTop: new THREE.Color('#171a4a'),
                skyBottom: new THREE.Color('#5b2f6e'),
                ground: new THREE.Color('#40325c'),
                bounce: new THREE.Color('#2b1b4a'),
            },
        }

        this.palette = this.presets.day

        this.lightDirection = new THREE.Vector3(0.42, 0.8, 0.44).normalize()
        this.directionUniform = uniform(this.lightDirection)
        this.colorUniform = uniform(color(this.palette.lightColor))
        this.intensityUniform = uniform(this.palette.lightIntensity)
        this.shadowColorUniform = uniform(color(this.palette.shadowColor))
        this.bounceColorUniform = uniform(color(this.palette.bounce))
        this.fogColorUniform = uniform(color(this.palette.fogColor))
        this.groundColorUniform = uniform(color(this.palette.ground))

        this.fogNear = uniform(34)
        this.fogFar = uniform(96)

        // 核心阴影的过渡区间：n·L 从 1 到 -0.25
        this.coreShadowEdgeLow = uniform(-0.25)
        this.coreShadowEdgeHigh = uniform(1)

        // 地面反弹：越靠近地面、越朝下的面，混得越多
        this.bounceDistance = uniform(2.2)
        this.bounceMultiplier = uniform(0.55)
        this.bounceEdgeLow = uniform(-1)
        this.bounceEdgeHigh = uniform(1)

        this.light = new THREE.DirectionalLight(0xffffff, 3)
        this.light.castShadow = true
        this.light.shadow.mapSize.set(2048, 2048)
        this.light.shadow.camera.left = -26
        this.light.shadow.camera.right = 26
        this.light.shadow.camera.top = 26
        this.light.shadow.camera.bottom = -26
        this.light.shadow.camera.near = 1
        this.light.shadow.camera.far = 90
        this.light.shadow.bias = -0.0012
        this.light.shadow.normalBias = 0.05
        this.light.shadow.radius = 3
    }

    addTo(scene)
    {
        scene.add(this.light)
        scene.add(this.light.target)
    }

    setPreset(name)
    {
        this.palette = this.presets[name]
        this.colorUniform.value.copy(this.palette.lightColor)
        this.intensityUniform.value = this.palette.lightIntensity
        this.shadowColorUniform.value.copy(this.palette.shadowColor)
        this.bounceColorUniform.value.copy(this.palette.bounce)
        this.fogColorUniform.value.copy(this.palette.fogColor)
        this.groundColorUniform.value.copy(this.palette.ground)
    }

    update(camera)
    {
        // 光始终罩着相机前方，保证 shadow map 分辨率都花在看得见的地方
        const focus = camera.position.clone().addScaledVector(
            new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
            12
        )
        focus.y = 0

        this.light.position.copy(focus).addScaledVector(this.lightDirection, 40)
        this.light.target.position.copy(focus)
        this.light.target.updateMatrixWorld()
    }

    /**
     * 与 MeshDefaultMaterial 同构的材质工厂。
     * 关键点：outputNode 完全接管输出，只保留 shadow map 的“截获”。
     */
    createMaterial(parameters = {})
    {
        const {
            colorNode = color(0xffffff),
            normalNode = normalWorld,
            alphaNode = float(1),
            shadowNode = null,
            hasCoreShadows = true,
            hasDropShadows = true,
            hasLightBounce = true,
            hasFog = true,
            transparent = false,
            side = THREE.FrontSide,
            alphaTest = 0.1,
            depthWrite = true,
        } = parameters

        const material = new THREE.MeshLambertNodeMaterial()
        material.side = side
        material.transparent = transparent
        material.alphaTest = alphaTest
        material.depthWrite = depthWrite

        // shadow map 的值先接住，后面自己决定怎么用
        const catchedShadow = float(1).toVar()
        if(hasDropShadows)
        {
            material.receivedShadowNode = Fn(([shadow]) =>
            {
                catchedShadow.mulAssign(shadow.r)
                return float(1)
            })
        }

        material.outputNode = Fn(() =>
        {
            const baseColor = colorNode.toVar()
            const outputColor = colorNode.toVar()

            // 地面反弹：朝下的面 + 靠近地面
            if(hasLightBounce)
            {
                const bounceOrientation = normalNode
                    .dot(vec3(0, -1, 0))
                    .smoothstep(this.bounceEdgeLow, this.bounceEdgeHigh)

                const bounceDistance = this.bounceDistance
                    .sub(positionWorld.y.max(0))
                    .div(this.bounceDistance)
                    .max(0)
                    .pow(2)

                outputColor.assign(mix(
                    outputColor,
                    this.bounceColorUniform,
                    bounceOrientation.mul(bounceDistance).mul(this.bounceMultiplier)
                ))
            }

            // 受光
            outputColor.mulAssign(this.colorUniform)
            outputColor.mulAssign(this.intensityUniform)

            // 核心阴影：背光面直接换成“基础色 × 阴影色”
            let shadowMix = float(0)
            if(hasCoreShadows)
            {
                shadowMix = normalNode
                    .dot(this.directionUniform)
                    .smoothstep(this.coreShadowEdgeHigh, this.coreShadowEdgeLow)
            }

            // 投影：shadow map
            let dropShadowMix = float(0)
            if(hasDropShadows)
                dropShadowMix = catchedShadow.oneMinus()

            if(hasCoreShadows || hasDropShadows)
            {
                let combined = shadowMix.max(dropShadowMix).clamp(0, 1)

                if(shadowNode)
                    combined = combined.max(shadowNode).clamp(0, 1)

                outputColor.assign(mix(
                    outputColor,
                    baseColor.mul(this.shadowColorUniform),
                    combined
                ))
            }

            // 雾
            if(hasFog)
            {
                const fogFactor = cameraPosition
                    .sub(positionWorld)
                    .length()
                    .smoothstep(this.fogNear, this.fogFar)

                outputColor.assign(mix(outputColor, this.fogColorUniform, fogFactor))
            }

            alphaNode.lessThan(alphaTest).discard()

            return vec4(outputColor, alphaNode)
        })()

        return material
    }
}
