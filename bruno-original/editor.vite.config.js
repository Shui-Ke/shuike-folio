import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { validateLayout } from './editor/scene-format.js'
import wasm from 'vite-plugin-wasm'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const base = path.dirname(fileURLToPath(import.meta.url))
const sceneFolder = path.join(base, 'editor-scenes')
const digest = text => createHash('sha256').update(text).digest('hex')
let saveQueue = Promise.resolve()

function sceneFiles() {
    return {
        name: 'local-scene-files',
        configureServer(server) {
            server.middlewares.use('/__scene-editor/status', (_req, res) => {
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.setHeader('Cache-Control', 'no-store')
                res.end(JSON.stringify({ application: 'bruno-scene-editor', workspace: digest(base.toLowerCase()) }))
            })
            server.middlewares.use('/__scene-editor/scenes', async (req, res) => {
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.setHeader('Cache-Control', 'no-store')
                const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
                try {
                    const origin = req.headers.origin
                    if (origin && new URL(origin).host !== req.headers.host)
                        return reply(403, { error: '只允许编辑器本身保存场景。' })
                    await fs.mkdir(sceneFolder, { recursive: true })
                    if (req.method === 'GET') {
                        const filename = new URL(req.url, 'http://localhost').searchParams.get('file')
                        if (filename) {
                            if (path.basename(filename) !== filename || !filename.endsWith('.json')) return reply(400, { error: '场景文件名无效。' })
                            const text = await fs.readFile(path.join(sceneFolder, filename), 'utf8')
                            return reply(200, { layout: JSON.parse(text), revision: digest(text), file: filename })
                        }
                        const files = (await fs.readdir(sceneFolder)).filter(f => f.endsWith('.json'))
                        return reply(200, { files: files.sort((a,b) => a.localeCompare(b, 'zh-CN')) })
                    }
                    if (req.method !== 'POST') return reply(405, { error: '不支持此操作。' })
                    const chunks = []
                    let bytes = 0
                    for await (const chunk of req) {
                        bytes += chunk.length
                        if (bytes > 5000000) return reply(413, { error: '场景文件过大。' })
                        chunks.push(chunk)
                    }
                    const body = Buffer.concat(chunks).toString('utf8')
                    const { layout, revision } = JSON.parse(body)
                    validateLayout(layout)
                    if (!/^[\p{L}\p{N}_ -]{1,64}$/u.test(layout.name)) return reply(400, { error: '名称请使用汉字、字母、数字、空格、短横线或下划线。' })
                    for (const asset of new Set(layout.objects.map(o => o.asset))) {
                        const target = path.resolve(base, 'static', asset)
                        const library = path.resolve(base, 'static/wasteland/library') + path.sep
                        if (!target.startsWith(library)) return reply(400, { error: '素材路径超出素材库。' })
                        await fs.access(target)
                    }
                    // Serialize read/compare/write so concurrent tabs cannot silently overwrite each other.
                    const save = async () => {
                        const file = layout.name.trim() + '.json'
                        const target = path.join(sceneFolder, file)
                        let old = null
                        try { old = await fs.readFile(target, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
                        if (old !== null && digest(old) !== revision)
                            return reply(409, { error: '同名场景已存在或被其他窗口修改。请打开最新版本，或更换场景名称后保存。' })
                        const text = JSON.stringify(layout, null, 2)
                        const temporary = target + '.tmp'
                        await fs.writeFile(temporary, text, 'utf8')
                        await fs.rename(temporary, target)
                        reply(200, { file, revision: digest(text) })
                    }
                    saveQueue = saveQueue.then(save, save)
                    await saveQueue
                } catch (error) {
                    reply(error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? '场景或素材文件不存在。' : error.message })
                }
            })
        }
    }
}
export default {
    root: path.join(base, 'editor'),
    envDir: base,
    publicDir: path.join(base, 'static'),
    server: { host: '127.0.0.1', port: 4195, strictPort: true, open: false },
    build: { outDir: path.join(base, 'editor-dist'), emptyOutDir: true, rollupOptions: {input: {editor:path.join(base,'editor/index.html'),bruno:path.join(base,'editor/bruno.html')}} },
    plugins: [sceneFiles(), wasm(), nodePolyfills()]
}
