import * as THREE from 'three/webgpu'
import { attribute, color, float, Fn, mix, normalWorld, positionWorld, smoothstep, texture } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import MeshGridMaterial, { MeshGridMaterialLine } from '../Materials/MeshGridMaterial.js'

const SAND = new THREE.Color('#d8b46f')
const SAND_LIGHT = new THREE.Color('#e6cc93')
const GRASS = new THREE.Color('#b8b62e')
const GRASS_DARK = new THREE.Color('#8f8f28')
const WET = new THREE.Color('#867c65')

export class CanyonTerrain
{
    constructor()
    {
        this.game = Game.getInstance()
        this.data = this.game.levelLayout.terrainData
        this.size = this.data.size
        this.segments = this.data.segments
        this.heights = this.data.heights
        this.grass = this.data.grass
        this.waterLevel = this.data.waterLevel

        // This camp is a dry canyon. The imported layout still carries water
        // values left by the editor brush, including patches inside grass;
        // drop them all instead of rendering floating leaves on grass puddles.
        this.water = new Array(this.grass.length).fill(0)

        this.buildGeometry()
        this.setupTerrainData()
        this.buildMesh()
        this.buildPhysics()
        this.buildWater()
    }

    heightAt(x, z)
    {
        return this.sample('heights', x, z)
    }

    grassAt(x, z)
    {
        return this.sample('grass', x, z)
    }

    waterAt(x, z)
    {
        return this.sample('water', x, z)
    }

    sample(field, x, z)
    {
        const n = this.segments
        const u = (x / this.size + 0.5) * n
        const v = (z / this.size + 0.5) * n

        if(u < 0 || v < 0 || u > n || v > n)
            return field === 'heights' ? -100 : 0

        const a = Math.min(n - 1, Math.floor(u))
        const b = Math.min(n - 1, Math.floor(v))
        const fx = u - a
        const fz = v - b
        const row = n + 1
        const data = this[field]
        const h00 = data[b * row + a]
        const h10 = data[b * row + a + 1]
        const h01 = data[(b + 1) * row + a]
        const h11 = data[(b + 1) * row + a + 1]

        return fx + fz <= 1
            ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
            : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
    }

    buildGeometry()
    {
        const geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments)
        geometry.rotateX(- Math.PI * 0.5)

        const position = geometry.attributes.position
        const colors = new Float32Array(position.count * 3)
        const vertexColor = new THREE.Color()

        for(let i = 0; i < position.count; i++)
        {
            const height = this.heights[i]
            const grass = this.grass[i]
            const water = this.water[i]

            position.setY(i, height)

            const grassMix = THREE.MathUtils.smoothstep(grass, 0.05, 0.62)
            vertexColor.copy(SAND).lerp(GRASS, grassMix)

            // Higher sand catches more light; low and wet areas stay darker.
            const heightMix = THREE.MathUtils.clamp((height + 2) / 18, 0, 1)
            vertexColor.lerp(SAND_LIGHT, heightMix * 0.18)
            vertexColor.lerp(WET, water * 0.3)

            // Subtle low-poly grain so large sand areas do not look like flat paint.
            const x = position.getX(i)
            const z = position.getZ(i)
            const grain = Math.sin(x * 0.35 + z * 0.21) * 0.012 + Math.sin(x * 0.11 - z * 0.27) * 0.008
            vertexColor.offsetHSL(0, 0, grain)

            colors[i * 3    ] = vertexColor.r
            colors[i * 3 + 1] = vertexColor.g
            colors[i * 3 + 2] = vertexColor.b
        }

        position.needsUpdate = true
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geometry.computeVertexNormals()
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()

        this.geometry = geometry
    }

    buildMesh()
    {
        // Same grid language as Bruno's empty terrain grid, tinted as yellow
        // earth. worldTriplanar keeps the cells readable on slopes and raised
        // ground instead of stretching them like a flat decal.
        const gridMaterial = new MeshGridMaterial({
            color: 0xc19a56,
            reference: 'worldTriplanar',
            antialiased: true,
            lines: [
                new MeshGridMaterialLine('#6f4e26', 2, 0.012, 1),
                new MeshGridMaterialLine('#f0d29a', 10, 0.006, 1)
            ]
        })

        const colorNode = Fn(() =>
        {
            const grid = gridMaterial.outputNode.rgb
            const terrainData = this.game.terrain.terrainNode(positionWorld.xz)
            const grassMix = smoothstep(0.05, 0.6, terrainData.g)

            return mix(grid, color('#b8b62e'), grassMix)
        })()

        const material = new MeshDefaultMaterial({
            colorNode,
            normalNode: normalWorld,
            hasWater: false,
            hasLightBounce: false,
            hasCoreShadows: true
        })
        material.flatShading = true

        this.mesh = new THREE.Mesh(this.geometry, material)
        this.mesh.receiveShadow = true
        this.mesh.castShadow = false
        this.game.scene.add(this.mesh)
    }

    setupTerrainData()
    {
        const n = this.segments + 1
        const pixels = new Uint8Array(n * n * 4)

        for(let i = 0; i < n * n; i++)
        {
            pixels[i * 4    ] = 0
            pixels[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(this.grass[i], 0, 1) * 255)
            pixels[i * 4 + 2] = Math.round(THREE.MathUtils.clamp(this.water[i], 0, 1) * 255)
            pixels[i * 4 + 3] = 255
        }

        const dataTexture = new THREE.DataTexture(pixels, n, n, THREE.RGBAFormat)
        dataTexture.minFilter = THREE.LinearFilter
        dataTexture.magFilter = THREE.LinearFilter
        dataTexture.generateMipmaps = false
        dataTexture.needsUpdate = true

        const heightTexture = new THREE.DataTexture(new Float32Array(this.heights), n, n, THREE.RedFormat, THREE.FloatType)
        heightTexture.minFilter = THREE.LinearFilter
        heightTexture.magFilter = THREE.LinearFilter
        heightTexture.generateMipmaps = false
        heightTexture.needsUpdate = true

        const coords = (position) => position.div(this.size).add(0.5).mul(this.segments / n).add(0.5 / n)

        this.game.terrain.size = this.size
        this.game.terrain.segments = this.segments
        this.game.terrain.terrainNode = Fn(([position]) => texture(dataTexture, coords(position)))
        this.game.terrain.heightNode = Fn(([position]) => texture(heightTexture, coords(position)).r)
        this.game.terrain.colorNode = Fn(() =>
        {
            const mixStrength = this.game.terrain.heightNode ? 0.25 : 0
            return color('#b8b62e').mul(0.92 + mixStrength)
        })
    }

    buildPhysics()
    {
        const position = this.geometry.attributes.position
        const index = this.geometry.index

        this.game.objects.add(
            null,
            {
                type: 'fixed',
                friction: 0.7,
                restitution: 0.02,
                colliders: [ {
                    shape: 'trimesh',
                    parameters: [ position.array, new Uint32Array(index.array) ],
                    category: 'floor'
                } ]
            }
        )
    }

    buildWater()
    {
        this.game.water.surfaceElevation = this.waterLevel
        this.game.water.surfaceElevationUniform.value = this.waterLevel

        // Objects.update resets anything below depthElevation. This level has
        // dry depressions far below the water level, so keep the reset line
        // under the lowest terrain point instead of using the Bruno default.
        this.game.water.depthElevation = Math.min(...this.heights) - 2

        if(!this.water.some((value) => value > 0.05))
            return

        const positions = []
        const n = this.segments
        const row = n + 1
        const step = this.size / n
        const y = this.waterLevel

        const triangle = (ids) =>
        {
            // Only complete water cells become surface triangles. This keeps
            // stray water values from painting over neighbouring grass.
            if(!ids.every((i) => this.water[i] > 0.3) || ids.every((i) => this.heights[i] >= y))
                return

            for(const i of ids)
                positions.push((i % row) * step - this.size / 2, y, Math.floor(i / row) * step - this.size / 2)
        }

        for(let z = 0; z < n; z++)
        {
            for(let x = 0; x < n; x++)
            {
                const a = z * row + x
                const b = a + 1
                const c = a + row
                const d = c + 1
                triangle([a, c, b])
                triangle([b, c, d])
            }
        }

        if(!positions.length)
            return

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()

        const material = new MeshDefaultMaterial({
            colorNode: color('#2f8fa3'),
            hasWater: false,
            transparent: true,
            alphaNode: float(0.82)
        })

        this.waterMesh = new THREE.Mesh(geometry, material)
        this.waterMesh.receiveShadow = true
        this.game.scene.add(this.waterMesh)
    }
}
