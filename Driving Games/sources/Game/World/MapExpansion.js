import * as THREE from 'three/webgpu'
import { alea } from 'seedrandom'
import { MAP_SCALE, MAP_SIZE, LAKE } from '../WorldLayout.js'

export class MapExpansion
{
    static prepare(game)
    {
        const scale = MAP_SCALE
        const geometry = game.resources.terrainModel.scene.children[0].geometry.clone()
        geometry.scale(scale, 1, scale)
        game.resources.terrainModel.scene.children[0].geometry = geometry
        const position = geometry.attributes.position, rows = Math.sqrt(position.count)
        const heights = new Float32Array(rows * rows)
        for(let i = 0; i < position.count; i++) {
            const x = Math.round((position.getX(i) / MAP_SIZE + 0.5) * (rows - 1))
            const z = Math.round((position.getZ(i) / MAP_SIZE + 0.5) * (rows - 1))
            heights[z + x * rows] = position.getY(i)
        }
        const groundAt = (x, z) => {
            const fx = THREE.MathUtils.clamp((x / MAP_SIZE + 0.5) * (rows - 1), 0, rows - 1.001)
            const fz = THREE.MathUtils.clamp((z / MAP_SIZE + 0.5) * (rows - 1), 0, rows - 1.001)
            const ix = Math.floor(fx), iz = Math.floor(fz), dx = fx - ix, dz = fz - iz
            const a = THREE.MathUtils.lerp(heights[iz + ix * rows], heights[iz + (ix + 1) * rows], dx)
            const b = THREE.MathUtils.lerp(heights[iz + 1 + ix * rows], heights[iz + 1 + (ix + 1) * rows], dx)
            return game.water.oceanHeightAt(x, z, THREE.MathUtils.lerp(a, b, dz))
        }
        game.mapExpansion = { scale, areaMultiplier: scale * scale, groundAt, added: { trees: 0, crates: 0, bricks: 0, bushes: 0 } }
        const referenceKeys = ['bushesReferences', 'flowersReferencesModel', 'birchTreesReferencesModel', 'oakTreesReferencesModel', 'cherryTreesReferencesModel', 'bricksModel', 'fencesModel', 'benchesModel', 'explosiveCratesModel', 'lanternsModel', 'poleLightsModel']
        for(const key of referenceKeys) {
            for(const child of game.resources[key].scene.children) {
                child.position.x *= scale; child.position.z *= scale
                // Move lake-overlapping props to its outer shore, keeping the
                // original prototypes for each native instancing system.
                if(game.water.lakeDistance(child.position.x, child.position.z) < 1.03) {
                    const angle = Math.atan2((child.position.z - LAKE.z) / LAKE.radiusZ, (child.position.x - LAKE.x) / LAKE.radiusX)
                    child.position.x = LAKE.x + Math.cos(angle) * LAKE.radiusX * 1.22
                    child.position.z = LAKE.z + Math.sin(angle) * LAKE.radiusZ * 1.22
                    child.position.y = Math.max(0, groundAt(child.position.x, child.position.z))
                }
                child.updateMatrix(); child.updateMatrixWorld(true)
            }
        }
        // Bridges and their collider children stretch with their river beds.
        const scenery = game.resources.sceneryModel.scene
        scenery.updateMatrixWorld(true)
        const horizontalScale = new THREE.Matrix4().makeScale(scale, 1, scale)
        scenery.traverse(child => {
            child.position.x *= scale; child.position.z *= scale
            if(child.geometry) {
                // Some rocks have a tilted model origin. Scale in world axes:
                // stretching their local X/Z also changes world height.
                const basis = child.matrixWorld.clone().setPosition(0, 0, 0)
                const localScale = basis.clone().invert().multiply(horizontalScale).multiply(basis)
                child.geometry = child.geometry.clone().applyMatrix4(localScale)
            }
            if(/^(cuboid|tube|ball)/i.test(child.name)) { child.scale.x *= scale; child.scale.z *= scale }
            child.updateMatrix()
        })
        scenery.updateMatrixWorld(true)
        const rng = new alea('expanded-island-groves-v1')
        const occupied = referenceKeys.flatMap(key => game.resources[key].scene.children.map(child => child.position.clone()))
        const spawns = [...game.respawns.items.values()].map(item => item.position)
        const valid = (x, z, clearance) => {
            if(Math.max(Math.abs(x), Math.abs(z)) > 113) return false
            if(spawns.some(p => Math.hypot(p.x - x, p.z - z) < 10)) return false
            if(groundAt(x, z) < -0.12) return false
            if([[3,0],[-3,0],[0,3],[0,-3]].some(([dx,dz]) => groundAt(x + dx,z + dz) < -0.18)) return false
            // Continuous crossing routes, plus space around each obstacle.
            if(Math.abs(z - 0.15 * x - 8) < 5 || Math.abs(x + 0.2 * z - 14) < 5) return false
            return !occupied.some(p => Math.hypot(p.x - x, p.z - z) < clearance)
        }
        const add = (key, count, clearance, kind, lift = 0) => {
            const scene = game.resources[key].scene, prototype = scene.children[0]
            let made = 0
            for(let attempt = 0; attempt < 12000 && made < count; attempt++) {
                const x = (rng() - 0.5) * 224, z = (rng() - 0.5) * 224
                if(!valid(x, z, clearance)) continue
                const reference = prototype.clone(true)
                reference.name = `${prototype.name}-expanded-${made}`
                reference.position.set(x, groundAt(x, z) + lift, z)
                reference.rotation.y = rng() * Math.PI * 2
                scene.add(reference); reference.updateMatrix(); reference.updateMatrixWorld(true)
                occupied.push(reference.position.clone()); made++
            }
            game.mapExpansion.added[kind] += made
        }
        for(const key of ['birchTreesReferencesModel', 'oakTreesReferencesModel', 'cherryTreesReferencesModel'])
            add(key, Math.max(12, Math.round(game.resources[key].scene.children.length * 0.8)), 6, 'trees')
        add('bushesReferences', 24, 4, 'bushes')
        add('explosiveCratesModel', 24, 5, 'crates', 0.55)
        add('bricksModel', 48, 3, 'bricks', 0.4)
    }
}
