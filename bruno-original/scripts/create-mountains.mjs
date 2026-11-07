import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(base, 'package.json'))
const T = require('three'), sharp = require('sharp')
const { Document, NodeIO } = require('@gltf-transform/core')
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await require('draco3dgltf').createDecoderModule(),
})
const out = path.join(base, 'static/wasteland/library/地形')
const v = (x, y, z) => new T.Vector3(x, y, z)
let seed = 15719
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)

// Sample the existing basalt material, including its embedded palette texture.
const source = await io.read(path.join(out, '岩石场景.glb'))
const colors = new Map()
for (const node of source.getRoot().listNodes().filter(n => /^basalt/.test(n.getName()))) {
  for (const p of node.getMesh().listPrimitives()) {
    const texture = p.getMaterial().getBaseColorTexture(), uv = p.getAttribute('TEXCOORD_0')
    if (!texture || !uv) continue
    const { data, info } = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < uv.getCount(); i++) {
      const [u, w] = uv.getElement(i, [])
      const x = Math.max(0, Math.min(info.width - 1, Math.floor(u * info.width)))
      const y = Math.max(0, Math.min(info.height - 1, Math.floor(w * info.height)))
      const hex = data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3).toString('hex')
      colors.set(hex, (colors.get(hex) || 0) + 1)
    }
  }
}
const referenceColor = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0]
if (!referenceColor) throw Error('Could not read the reference basalt palette')
const baseColor = new T.Color('#' + referenceColor)
const palette = [.80, .89, .97, 1.04, 1.12, 1.20].map(s => baseColor.clone().multiplyScalar(s).getHexString())

const specifications = [
  { name: '细山峰', size: [15, 36, 13], sides: 13, phase: .4, lean: [.18, -.07],
    profile: [[0, 1], [.10, .90], [.23, .65], [.42, .48], [.62, .37], [.78, .25], [.92, .11]],
    ribs: 5, description: '细长偏斜尖峰，陡峭岩壁与低矮山脚' },
  { name: '山体', size: [58, 25, 43], sides: 23, phase: 1.7, lean: [-.08, .05],
    profile: [[0, 1], [.12, .96], [.29, .84], [.45, .77], [.61, .60], [.77, .43], [.90, .26]],
    ribs: 9, description: '宽厚低矮山体，起伏山脊与分层岩壁，可组合摆放' },
  { name: '大山峰', size: [53, 64, 46], sides: 21, phase: 2.8, lean: [-.13, -.06],
    profile: [[0, 1], [.10, .93], [.26, .77], [.43, .60], [.59, .47], [.73, .32], [.88, .17]],
    ribs: 10, description: '高耸主峰，放射状山脊、侧峰与厚重山脚' },
]

function build(spec) {
  const faces = [], [width, height, depth] = spec.size, N = spec.sides
  function triangle(a, b, c, color) {
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    if (normal.lengthSq() < 1e-12) throw Error('Degenerate triangle')
    faces.push({ p: [a, b, c], normal: normal.normalize(), col: color })
  }
  // Closed faceted shell: correlated angular ridges continue from the foot to the summit.
  function shell({ cx = 0, cz = 0, rx, rz, h, sides, profile, phase, lean, tint = 0 }) {
    const angular = Array.from({ length: sides }, (_, i) => {
      const a = i / sides * Math.PI * 2 + phase
      return { a: a + (rand() - .5) * .14, r: .86 + rand() * .22 + .09 * Math.sin(i * 2.3),
        ridge: .68 + rand() * .32, color: Math.floor(rand() * 3) + 1 }
    })
    const rings = profile.map(([t, r], k) => angular.map(({ a, r: bump, ridge }, i) => {
      const radial = r * bump * (1 + (k > 0 ? .055 * Math.sin(i * 1.9 + k * 2.1) : 0))
      return v(cx + rx * (Math.cos(a) * radial + lean[0] * t),
        k === 0 ? 0 : h * t * (ridge + (1 - ridge) * t),
        cz + rz * (Math.sin(a) * radial + lean[1] * t))
    }))
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, a = rings[k][i], b = rings[k + 1][i], c = rings[k + 1][j], d = rings[k][j]
      const col = palette[Math.max(0, Math.min(5, angular[i].color + tint + (k > 4 ? 1 : 0)))]
      if ((i + k) % 2) { triangle(a, b, d, col); triangle(b, c, d, col) }
      else { triangle(a, b, c, col); triangle(a, c, d, col) }
    }
    const apex = v(cx + rx * lean[0], h, cz + rz * lean[1]), bottom = v(cx, 0, cz)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      triangle(rings.at(-1)[i], apex, rings.at(-1)[j], palette[angular[i].color + 1])
      triangle(bottom, rings[0][i], rings[0][j], palette[0])
    }
  }
  shell({ rx: width / 2, rz: depth / 2, h: height, sides: N, profile: spec.profile, phase: spec.phase, lean: spec.lean })
  // Intersecting buttresses are part of the same asset, with no floating rocks.
  // Their tall planar faces echo the original basalt's vertical fractures.
  for (let i = 0; i < spec.ribs; i++) {
    const angle = i / spec.ribs * Math.PI * 2 + spec.phase + .12
    const r = .47 + rand() * .14, h = height * (.25 + rand() * .26)
    shell({ cx: Math.cos(angle) * width * .5 * r, cz: Math.sin(angle) * depth * .5 * r,
      rx: width * (.12 + rand() * .055), rz: depth * (.12 + rand() * .055), h,
      sides: 7, phase: angle, lean: [-Math.cos(angle) * .22, -Math.sin(angle) * .22], tint: i % 3 === 0 ? -1 : 0,
      profile: [[0, 1], [.15, .94], [.42, .71], [.79, .59], [.90, .34]] })
  }
  const bounds = new T.Box3()
  for (const f of faces) for (const p of f.p) bounds.expandByPoint(p)
  const shift = v(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2)
  // Vertices shared by adjacent triangles must only be moved once.
  for (const p of new Set(faces.flatMap(f => f.p))) p.add(shift)
  return { faces, size: bounds.getSize(v()).toArray() }
}

async function save(spec, asset) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(spec.name)
  doc.getRoot().setDefaultScene(scene)
  const root = doc.createNode(spec.name).setExtras({ singleAsset: true, units: 'metres', upAxis: 'Y', origin: 'ground-center' })
  scene.addChild(root)
  const mesh = doc.createMesh(spec.name)
  root.setMesh(mesh)
  for (const color of palette) {
    const faces = asset.faces.filter(f => f.col === color)
    if (!faces.length) continue
    const pos = [], norm = []
    for (const f of faces) for (const p of f.p) { pos.push(...p.toArray()); norm.push(...f.normal.toArray()) }
    const accessor = data => doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(data))
    const material = doc.createMaterial('Basalt-' + color).setBaseColorFactor([...new T.Color('#' + color).toArray(), 1]).setRoughnessFactor(.96).setMetallicFactor(0)
    mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', accessor(pos)).setAttribute('NORMAL', accessor(norm)).setMaterial(material))
  }
  scene.setExtras({ description: spec.description, dimensions: asset.size, reference: '岩石场景.glb / basalt palette', collision: 'not included' })
  const bytes = await io.writeBinary(doc)
  const report = await require('gltf-validator').validateBytes(bytes)
  if (report.issues.numErrors || report.issues.numWarnings) throw Error(JSON.stringify(report.issues))
  const file = path.join(out, spec.name + '.glb')
  fs.writeFileSync(file, bytes)
  // Read the saved artifact back: previews are generated from the delivered GLB.
  const loaded = await io.read(file), faces = []
  for (const p of loaded.getRoot().listMeshes()[0].listPrimitives()) {
    const positions = p.getAttribute('POSITION'), normals = p.getAttribute('NORMAL')
    const col = new T.Color().fromArray(p.getMaterial().getBaseColorFactor()).getHexString()
    for (let i = 0; i < positions.getCount(); i += 3) faces.push({
      p: [0, 1, 2].map(k => v(...positions.getElement(i + k, []))), normal: v(...normals.getElement(i, [])), col,
    })
  }
  console.log(JSON.stringify({ name: spec.name, triangles: faces.length, dimensions: asset.size.map(x => +x.toFixed(2)), bytes: bytes.length, errors: report.issues.numErrors, warnings: report.issues.numWarnings }))
  return faces
}

function camera(dir, focus, scale, w, h) {
  const forward = dir.clone().normalize(), right = v(0, 1, 0).cross(forward).normalize(), up = forward.clone().cross(right)
  return p => { const q = p.clone().sub(focus); return [w / 2 + q.dot(right) * scale, h / 2 - q.dot(up) * scale, q.dot(forward)] }
}
function raster(p, w, h, put) {
  const [a, b, c] = p, dx = b[0] - a[0], dy = b[1] - a[1], ex = c[0] - a[0], ey = c[1] - a[1], det = dx * ey - dy * ex
  if (Math.abs(det) < .00001) return
  const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), right = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
  const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), bottom = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const px = x + .5 - a[0], py = y + .5 - a[1], s = (px * ey - py * ex) / det, t = (dx * py - dy * px) / det
    if (s >= 0 && t >= 0 && s + t <= 1) put(y * w + x, a[2] + s * (b[2] - a[2]) + t * (c[2] - a[2]), s, t)
  }
}
async function render(input, filename, eye = v(1.15, .72, 1.6)) {
  const bounds = new T.Box3()
  for (const f of input) for (const p of f.p) bounds.expandByPoint(p)
  const focus = bounds.getCenter(v()), size = bounds.getSize(v()), width = 1200, height = 1100
  const preliminary = camera(eye, focus, 1, 0, 0), projected = input.flatMap(f => f.p.map(preliminary))
  const dx = Math.max(...projected.map(p => p[0])) - Math.min(...projected.map(p => p[0]))
  const dy = Math.max(...projected.map(p => p[1])) - Math.min(...projected.map(p => p[1]))
  const scale = Math.min(940 / dx, 850 / dy), view = camera(eye, focus, scale, width, height)
  const extent = Math.max(...size.toArray()) * 12
  const ground = [v(-extent, -.06, -extent), v(-extent, -.06, extent), v(extent, -.06, extent), v(extent, -.06, -extent)]
  const faces = [...input, { p: ground.slice(0, 3), normal: v(0, 1, 0), col: 'e9e3d7' }, { p: [ground[0], ground[2], ground[3]], normal: v(0, 1, 0), col: 'e9e3d7' }]
  const light = v(-.7, 1.4, .8).normalize(), ss = 1600, shadow = new Float32Array(ss * ss).fill(-Infinity)
  const sun = camera(light, focus, 1100 / Math.max(...size.toArray()), ss, ss)
  for (const f of faces) { f.shadow = f.p.map(sun); raster(f.shadow, ss, ss, (i, z) => { if (z > shadow[i]) shadow[i] = z }) }
  const pixels = Buffer.alloc(width * height * 3, 240), depth = new Float32Array(width * height).fill(-Infinity)
  for (const f of faces) {
    if (f.normal.dot(eye) <= 0) continue
    const rgb = [0, 2, 4].map(i => parseInt(f.col.slice(i, i + 2), 16)), lit = .69 + .31 * Math.max(0, f.normal.dot(light))
    const [a, b, c] = f.shadow
    raster(f.p.map(view), width, height, (i, z, s, t) => {
      if (z <= depth[i]) return
      depth[i] = z
      const sx = Math.round(a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * t), sy = Math.round(a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * t)
      const sz = a[2] + (b[2] - a[2]) * s + (c[2] - a[2]) * t
      let occluded = 0
      for (const offset of [-ss - 1, -ss + 1, ss - 1, ss + 1]) if (sx > 1 && sx < ss - 2 && sy > 1 && sy < ss - 2 && shadow[sy * ss + sx + offset] > sz + .09) occluded += .25
      for (let k = 0; k < 3; k++) pixels[i * 3 + k] = Math.min(255, rgb[k] * lit * (1 - occluded * .22))
    })
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).resize(840).png().toFile(path.join(out, filename))
}

const results = []
for (const spec of specifications) {
  const asset = build(spec), faces = await save(spec, asset)
  await render(faces, spec.name + '预览.png')
  results.push({ spec, asset, faces })
}
const labels = results.map(({ spec, asset }, i) => {
  const text = `${asset.size.map(x => x.toFixed(1)).join(' × ')} m`
  return `<text x="${i * 620 + 310}" y="660" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="32" fill="#35333c">${spec.name}</text><text x="${i * 620 + 310}" y="699" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#716b73">${text}</text>`
}).join('')
const cards = await Promise.all(results.map(async ({ spec }, i) => ({ input: await sharp(path.join(out, spec.name + '预览.png')).resize(620, 568).toBuffer(), left: i * 620, top: 60 })))
const overlay = Buffer.from(`<svg width="1860" height="750" xmlns="http://www.w3.org/2000/svg">${labels}<text x="930" y="738" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="16" fill="#817b82">尺寸顺序：宽 × 高 × 深 · 各模型独立取景</text></svg>`)
await sharp({ create: { width: 1860, height: 750, channels: 3, background: '#e5dfd3' } }).composite([...cards, { input: overlay, top: 0, left: 0 }]).png().toFile(path.join(out, '三座山预览.png'))
// Keep the existing catalog intact, updating only these three named assets.
const manifestFile = path.join(out, '../素材清单.json'), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
for (const { spec, asset } of results) {
  const entry = { 中文名: spec.name, 文件: `地形/${spec.name}.glb`, 用途: spec.description,
    尺寸: asset.size.map(x => x.toFixed(2)).join(' × ') + ' 米（宽×高×深）', 碰撞建议: '静态装饰；需要碰撞时另配简化凸包或网格' }
  const index = manifest.目录.地形.findIndex(e => e.中文名 === spec.name)
  if (index < 0) manifest.目录.地形.push(entry)
  else manifest.目录.地形[index] = entry
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
fs.writeFileSync(path.join(out, '三座山说明.md'), `# 三座山模型\n\n参考现有岩石场景的灰紫色玄武岩调色板，采用低多边形硬边造型。三个 GLB 均为独立模型、单个同名顶层节点；Y 轴向上，单位为米，原点位于底部中心，材质已内置，无需额外贴图。\n\n| 模型 | 宽 × 高 × 深（米） | 三角面 |\n|---|---|---|\n${results.map(({ spec, asset, faces }) => `| ${spec.name} | ${asset.size.map(x => x.toFixed(2)).join(' × ')} | ${faces.length} |`).join('\n')}\n\n可直接导入 Blender、Three.js 或场景编辑器。山脚封底；岩脊与主山体相交，适用于游戏显示，并非布尔合并后的打印模型。没有预置物理碰撞。预览中的地面、灯光和阴影不包含在 GLB 中。\n\n运行项目脚本 node scripts/create-mountains.mjs 可重新生成。\n`)
console.log('Saved three models, previews, and catalog entries. Reference color: #' + referenceColor)
