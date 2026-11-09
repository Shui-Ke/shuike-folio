import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { color, float, Fn, materialNormal, min, mix, mul, normalWorld, positionLocal, positionWorld, texture, uniform, uv, vec3, vec4 } from 'three/tsl'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

export class Floor
{
    constructor()
    {
        this.game = Game.getInstance()

        // Debug
        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '⏥ Floor',
                expanded: false,
            })
        }
        this.geometry = this.game.resources.terrainModel.scene.children[0].geometry
        this.subdivision = this.game.terrain.subdivision

        this.setVisual()
        this.setPhysical()
        this.setOceanFloor()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setVisual()
    {
        this.size = Math.round(this.game.view.optimalArea.radius * 2) + 1
        this.halfSize = this.size * 0.5
        // Keep the displaced shoreline close to the continuous water mask.
        this.cellSize = 0.5
        this.subdivisions = Math.ceil(this.size / this.cellSize)

        // Geometry
        let geometry = new THREE.PlaneGeometry(this.size, this.size, this.subdivisions, this.subdivisions)
        geometry.rotateX(-Math.PI * 0.5)
        geometry.deleteAttribute('normal')

        // Terrain data
        const terrainData = this.game.terrain.terrainNode(positionWorld.xz)
        const slabHighColor = uniform(color('#ffcf8b'))
        const slabLowColor = uniform(color('#a87762'))
        const slabTextureFrequency = uniform(0.175)
        const slabNoiseFrequency = uniform(0.03)
        const colorNode = Fn(() =>
        {
            const baseColor = this.game.terrain.colorNode(terrainData)
            
            const slabTerrain = terrainData.r
            const slabNoiseUv = positionWorld.xz.mul(slabNoiseFrequency)
            const slabNoise = texture(this.game.noises.perlin, slabNoiseUv).r
            const slabsTexture = texture(this.game.resources.floorSlabsTexture, positionWorld.xz.mul(slabTextureFrequency)).r
            const slabColor = mix(slabLowColor, slabHighColor, slabsTexture)
            // return vec3(slabsTexture.mul(slabStrength))

            const slab = slabTerrain.mul(slabNoise)
            // return vec3(slab)
            
            const finalColor = mix(baseColor, slabColor, slab)
            return finalColor
        })()

        // Material
        const material = new MeshDefaultMaterial({
            colorNode: colorNode,
            normalNode: vec3(0, 1, 0),
            shadowNode: terrainData.g,
            hasWater: false,
            hasLightBounce: false,
            wireframe: false
        })
        // Displacement
        material.positionNode = Fn(() =>
        {
            const uvDim = min(min(uv().x, uv().y).mul(20), 1)

            const newPosition = positionLocal
            const floorHeight = this.game.terrain.heightNode(positionWorld.xz)
            newPosition.y.addAssign(floorHeight.mul(uvDim))

            return newPosition
        })()

        // Mesh
        this.mesh = new THREE.Mesh(geometry, material)
        this.drivingGeometry = geometry
        this.mesh.receiveShadow = true
        // this.mesh.castShadow = true
        this.game.scene.add(this.mesh)

        // Resize
        this.game.viewport.events.on('throttleChange', () =>
        {
            this.size = Math.round(this.game.view.optimalArea.radius * 2) + 1
            this.halfSize = this.size * 0.5
            this.subdivisions = Math.ceil(this.size / this.cellSize)
            
            geometry.dispose()
            
            geometry = new THREE.PlaneGeometry(this.size, this.size, this.subdivisions, this.subdivisions)
            geometry.rotateX(-Math.PI * 0.5)
            geometry.deleteAttribute('normal')

            this.mesh.geometry = geometry
            this.drivingGeometry = geometry
        }, 2)

        if(this.game.debug.active)
        {
            this.debugPanel.addBinding(slabTextureFrequency, 'value', { label: 'slabTextureFrequency', min: 0, max: 1, step: 0.001 })
            this.debugPanel.addBinding(slabNoiseFrequency, 'value', { label: 'slabNoiseFrequency', min: 0, max: 0.1, step: 0.001 })
            this.game.debug.addThreeColorBinding(this.debugPanel, slabHighColor.value, 'slabHighColor')
            this.game.debug.addThreeColorBinding(this.debugPanel, slabLowColor.value, 'slabLowColor')
        }
    }

    setPhysical()
    {
        // Extract heights from geometry
        const positionAttribute = this.geometry.attributes.position
        const totalCount = positionAttribute.count
        const rowsCount = Math.sqrt(totalCount)
        const heights = new Float32Array(totalCount)
        const halfExtent = this.game.terrain.size / 2

        for(let i = 0; i < totalCount; i++)
        {
            const x = positionAttribute.array[i * 3 + 0]
            const y = positionAttribute.array[i * 3 + 1]
            const z = positionAttribute.array[i * 3 + 2]
            const indexX = Math.round(((x / (halfExtent * 2)) + 0.5) * (rowsCount - 1))
            const indexZ = Math.round(((z / (halfExtent * 2)) + 0.5) * (rowsCount - 1))
            const index = indexZ + indexX * rowsCount

            heights[index] = this.game.water.oceanHeightAt(x, z, y)
        }

        this.heightfield = { heights, rowsCount, size: this.game.terrain.size }
        const object = this.game.objects.add(
            null,
            {
                type: 'fixed',
                friction: 0.2,
                restitution: 0.15,
                colliders: [
                    { shape: 'heightfield', parameters: [ rowsCount - 1, rowsCount - 1, heights, { x: this.game.terrain.size, y: 1, z: this.game.terrain.size } ], category: 'floor' }
                ]
            }
        )
        this.physical = object.physical
    }

    setOceanFloor()
    {
        // A real, deep seabed replaces the shallow platform that followed the car.
        this.oceanFloor = this.game.physics.getPhysical({
            type: 'fixed',
            position: new THREE.Vector3(0, this.game.water.ocean.floor - 0.5, 0),
            friction: 0.5,
            colliders:
            [
                { shape: 'cuboid', parameters: [ 1000, 0.5, 1000 ], category: 'floor' },
            ]
        })
    }

    update()
    {
        const cinematic = this.game.view.impactBlend > 0.001
        if(cinematic && !this.cinematicGeometry)
        {
            this.cinematicGeometry = new THREE.PlaneGeometry(512, 512, 342, 342)
            this.cinematicGeometry.rotateX(-Math.PI * 0.5)
            this.cinematicGeometry.deleteAttribute('normal')
        }
        this.mesh.geometry = cinematic ? this.cinematicGeometry : this.drivingGeometry
        this.mesh.position.x = Math.round(this.game.view.optimalArea.position.x / this.cellSize) * this.cellSize
        this.mesh.position.z = Math.round(this.game.view.optimalArea.position.z / this.cellSize) * this.cellSize

    }
}
