const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..')
    const output = path.join(os.tmpdir(), 'bruno-water-visuals')
    fs.mkdirSync(output, { recursive: true })
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4196', '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) {
            try { if((await fetch('http://127.0.0.1:4196')).ok) break } catch {}
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if(message.type() === 'error') errors.push(message.text()) })
        await page.route('**/index.js*', async route => {
            if(new URL(route.request().url()).pathname !== '/index.js') return route.continue()
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.visualGame=Game.getInstance();' })
        })
        await page.goto('http://127.0.0.1:4196/?bots=0&time=0.05#skip', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.visualGame?.reveal?.step === 2, null, { timeout: 90000 })
        const data = await page.evaluate(() => {
            const g = window.visualGame, boundary = g.world.oceanBoundary
            g.rendering.renderer.setAnimationLoop(null)
            const a = g.world.floor.geometry.attributes.position, spawn = g.respawns.getDefault().position
            let shore, best = Infinity
            for(let i = 0; i < a.count; i++) {
                if(Math.abs(a.getY(i) + 0.3) > 0.08) continue
                const score = Math.hypot(a.getX(i) - spawn.x, a.getZ(i) - spawn.z)
                if(score < best) { best = score; shore = { x: a.getX(i), z: a.getZ(i) } }
            }
            const segment = boundary.segments.reduce((best, segment) => Math.hypot(segment[0].x - 45, segment[0].z - 72) < Math.hypot(best[0].x - 45, best[0].z - 72) ? segment : best)
            return { shore, boundary: segment[0], segments: boundary.segments.length, height: boundary.height, vertices: g.world.floor.mesh.geometry.attributes.position.count, hasCollider: !!boundary.physical, minBoundaryEdge: Math.min(...boundary.segments.flat().map(p => Math.max(Math.abs(p.x), Math.abs(p.z)))) }
        })
        console.log(JSON.stringify(data, null, 2))
        assert.ok(data.segments > 100 && data.minBoundaryEdge >= 70 && !data.hasCollider)
        async function capture(name, target, distance, time, quality = 0) {
            await page.evaluate(async ({ target, distance, time, quality }) => {
                const g = window.visualGame
                g.quality.changeLevel(quality)
                g.ticker.elapsedUniform.value = time
                g.view.focusPoint.trackedPosition.set(target.x, 0, target.z)
                g.view.focusPoint.smoothedPosition.copy(g.view.focusPoint.trackedPosition)
                g.view.zoom.baseRatio = g.view.zoom.smoothedRatio = (60 - distance) / 52
                g.view.update(); g.world.floor.update(); g.world.waterSurface.update()
                await new Promise(resolve => {
                    let frames = 0
                    g.rendering.renderer.setAnimationLoop(() => {
                        g.rendering.render()
                        if(++frames === 3) { g.rendering.renderer.setAnimationLoop(null); resolve() }
                    })
                })
            }, { target, distance, time, quality })
            await page.screenshot({ path: path.join(output, `${name}.png`) })
        }
        await capture('shore-close', data.shore, 12, 0)
        await capture('boundary-0', data.boundary, 22, 0)
        await capture('boundary-1', data.boundary, 22, 0.7)
        await page.setViewportSize({ width: 1100, height: 760 })
        await capture('shore-low-resized', data.shore, 12, 0, 1)
        assert.deepEqual(errors, [])
        console.log(`PASS: shore close-up, rising boundary layers, low quality and resized viewport. Images: ${output}`)
    } finally {
        if(browser) await browser.close()
        server.kill()
    }
})().catch(error => { console.error(error); process.exitCode = 1 })
