import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import assert from 'node:assert/strict'
import { createPowerupModels } from '../sources/Models/PowerupModels.js'

// GLTFExporter needs FileReader even for texture-free binary exports in Node.
globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
        blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() })
    }
}
const directory = new URL('../static/models/powerups/', import.meta.url)
await mkdir(directory, { recursive: true })
const exporter = new GLTFExporter()
const manifest = []
for(const group of createPowerupModels()) {
    const output = await exporter.parseAsync(group, { binary: true, onlyVisible: false })
    const restored = await new GLTFLoader().parseAsync(output, '')
    const restoredBounds = new THREE.Box3().setFromObject(restored.scene)
    assert.ok([...restoredBounds.min.toArray(), ...restoredBounds.max.toArray()].every(Number.isFinite), `${group.name} must load with finite bounds`)
    const file = `${group.name}.glb`
    await writeFile(new URL(file, directory), Buffer.from(output))
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    let triangles = 0
    group.traverse(child => { if(child.isMesh) triangles += (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3 })
    manifest.push({ name: group.name, file, bytes: output.byteLength, triangles, dimensions: size.toArray().map(value => Number(value.toFixed(3))), pivot: 'ground-center', up: 'Y' })
}
await writeFile(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ directory: fileURLToPath(directory), models: manifest }, null, 2))
