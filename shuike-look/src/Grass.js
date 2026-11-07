import * as THREE from 'three/webgpu'
import {
    atan,
    attribute,
    cameraPosition,
    color,
    float,
    Fn,
    mix,
    mod,
    modelWorldMatrix,
    rotateUV,
    step,
    texture,
    uniform,
    uniformArray,
    varying,
    vec2,
    vec3,
    vertexIndex,
} from 'three/tsl'
import { terrainHeightNode } from './Terrain.js'

/**
 * 草 —— 全片最“不像草”的草：
 *   - 一个 Mesh，一次 draw call，没有实例化
 *   - 每根草只有 3 个顶点（一个三角），位置数据只有 xz
 *   - 形状、弯曲、朝向、风全部在顶点着色器里算
 *
 * 原版：sources/Game/World/Grass.js
 */
export class Grass
{
    constructor(look, wind, noise, options = {})
    {
        this.look = look
        this.wind = wind
        this.noise = noise

        this.size = options.size ?? 62
        this.subdivisions = options.subdivisions ?? 360
        this.count = this.subdivisions * this.subdivisions
        this.fragmentSize = this.size / this.subdivisions

        this.center = uniform(new THREE.Vector2(0, 0))
        this.bladeWidth = uniform(0.17)
        this.bladeHeight = uniform(0.8)
        this.bladeHeightRandomness = uniform(0.7)

        // 顶点在三角里的角色：0 = 尖端，1 = 左，2 = 右
        this.loopIndex = vertexIndex.toFloat().mod(3)
        this.tipness = step(this.loopIndex, 0.5)
        this.bladePosition = varying(vec2())
        this.windOffset = varying(vec2())

        this.buildGeometry()
        this.buildMaterial()
        this.buildMesh()
    }

    buildGeometry()
    {
        const position = new Float32Array(this.count * 3 * 2)
        const heightRandomness = new Float32Array(this.count * 3)

        for(let iX = 0; iX < this.subdivisions; iX++)
        {
            const fragmentX = (iX / this.subdivisions - 0.5) * this.size + this.fragmentSize * 0.5

            for(let iZ = 0; iZ < this.subdivisions; iZ++)
            {
                const fragmentZ = (iZ / this.subdivisions - 0.5) * this.size + this.fragmentSize * 0.5

                const i = iX * this.subdivisions + iZ
                const i6 = i * 6
                const i3 = i * 3

                // 在格子内随机一点，避免整齐的网格感
                const x = fragmentX + (Math.random() - 0.5) * this.fragmentSize
                const z = fragmentZ + (Math.random() - 0.5) * this.fragmentSize

                // 三个顶点共用同一个 xz，形状后面在着色器里加
                position[i6 + 0] = x
                position[i6 + 1] = z
                position[i6 + 2] = x
                position[i6 + 3] = z
                position[i6 + 4] = x
                position[i6 + 5] = z

                heightRandomness[i3 + 0] = Math.random()
                heightRandomness[i3 + 1] = Math.random()
                heightRandomness[i3 + 2] = Math.random()
            }
        }

        this.geometry = new THREE.BufferGeometry()
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1)
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 2))
        this.geometry.setAttribute('heightRandomness', new THREE.Float32BufferAttribute(heightRandomness, 1))
    }

    buildMaterial()
    {
        const bladeShape = uniformArray([
            0, 1,   // 尖端
            1, 0,   // 左
            -1, 0,  // 右
        ])

        const grassColor = color('#77832d')
        const grassTipColor = color('#cfcf6b')

        this.material = this.look.createMaterial({
            colorNode: mix(grassColor, grassTipColor, this.tipness.mul(0.55)),
            normalNode: vec3(0, 1, 0),
            hasCoreShadows: false,
            hasDropShadows: false,
            hasLightBounce: false,
            // 草尖稍暗一点，读起来像一丛丛的
            shadowNode: this.tipness.oneMinus().mul(0.35),
        })

        this.material.positionNode = Fn(() =>
        {
            const position = attribute('position')

            // 世界空间里无限平铺：以 center 为中心循环
            const loopPosition = position.sub(this.center)
            const halfSize = float(this.size * 0.5)
            loopPosition.x.assign(mod(loopPosition.x.add(halfSize), float(this.size)).sub(halfSize))
            loopPosition.y.assign(mod(loopPosition.y.add(halfSize), float(this.size)).sub(halfSize))

            const position3 = vec3(loopPosition.x, 0, loopPosition.y)
                .add(vec3(this.center.x, 0, this.center.y))
                .toVar()

            // 贴地
            position3.y.assign(terrainHeightNode(position3.x, position3.z))

            const worldPosition = modelWorldMatrix.mul(position3)
            this.bladePosition.assign(worldPosition.xz)

            // 草只在“有草”的地方长
            const patch = texture(this.noise.texture, this.bladePosition.mul(0.013)).r.smoothstep(0.44, 0.58)
            const path = float(1).sub(
                this.bladePosition.x
                    .sub(this.bladePosition.y.mul(0.09).sin().mul(3.0))
                    .abs()
                    .smoothstep(1.7, 3.1)
            )
            const mask = patch.mul(path)

            // 高度：随机 + 大块噪声起伏
            const heightVariation = texture(this.noise.texture, this.bladePosition.mul(0.09)).r.mul(0.8).add(0.6)
            const height = this.bladeHeight
                .mul(this.bladeHeightRandomness.mul(attribute('heightRandomness')).add(this.bladeHeightRandomness.oneMinus()))
                .mul(heightVariation)
                .mul(mask.mul(0.5).add(0.5))

            // 三角形状
            const index = this.loopIndex.mul(2)
            const shape = vec3(
                bladeShape.element(index).mul(this.bladeWidth).mul(mask.mul(0.55).add(0.45)),
                bladeShape.element(index.add(1)).mul(height),
                0
            )

            const vertexPosition = position3.add(shape)

            // 永远面向相机（绕草的根部旋转）
            const angleToCamera = atan(
                worldPosition.z.sub(cameraPosition.z),
                worldPosition.x.sub(cameraPosition.x)
            ).add(- Math.PI * 0.5)

            vertexPosition.xz.assign(rotateUV(vertexPosition.xz, angleToCamera, worldPosition.xz))

            // 风：只有尖端动，且和高度成正比
            this.windOffset.assign(this.wind.offsetNode(worldPosition.xz).mul(this.tipness).mul(height).mul(2.2))
            vertexPosition.addAssign(vec3(this.windOffset.x, 0, this.windOffset.y))

            return vertexPosition
        })()
    }

    buildMesh()
    {
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.receiveShadow = true
        this.mesh.castShadow = false
    }
}
