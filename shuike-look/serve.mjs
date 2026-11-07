// Minimal static file server for local previews / screenshots.
// Usage: node tools/serve.mjs <root> [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const root = path.resolve(process.argv[2] || '.')
const port = Number(process.argv[3] || 4180)

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ktx': 'application/octet-stream',
    '.ktx2': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
}

http.createServer((req, res) => {
    const pathname = decodeURIComponent(url.parse(req.url).pathname)
    let file = path.join(root, pathname)
    if (pathname.endsWith('/')) file = path.join(file, 'index.html')
    if (!file.startsWith(root)) {
        res.writeHead(403).end('forbidden')
        return
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            // SPA-ish fallback for extension-less routes
            if (!path.extname(file)) {
                fs.readFile(path.join(root, 'index.html'), (e2, d2) => {
                    if (e2) { res.writeHead(404).end('not found') }
                    else { res.writeHead(200, { 'content-type': types['.html'] }).end(d2) }
                })
                return
            }
            res.writeHead(404).end('not found')
            return
        }
        res.writeHead(200, {
            'content-type': types[path.extname(file)] || 'application/octet-stream',
            'cache-control': 'no-store',
            'cross-origin-opener-policy': 'same-origin',
            'cross-origin-embedder-policy': 'credentialless',
        })
        res.end(data)
    })
}).listen(port, '127.0.0.1', () => {
    console.log(`serving ${root} at http://127.0.0.1:${port}/`)
})
