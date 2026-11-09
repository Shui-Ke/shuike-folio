const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..')
    const output = path.join(root, 'previews')
    fs.mkdirSync(output, { recursive: true })
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4194', '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) {
            try { if((await fetch('http://127.0.0.1:4194/props.html')).ok) break } catch {}
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1 })
        const errors = [], missing = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('response', response => { if(response.status() >= 400) missing.push(response.url()) })
        await page.goto('http://127.0.0.1:4194/props.html', { waitUntil: 'networkidle' })
        await page.waitForFunction(() => window.propsPreviewState?.ready)
        const result = await page.evaluate(() => window.propsPreviewState)
        console.log(JSON.stringify(result, null, 2))
        await page.screenshot({ path: path.join(output, 'powerups.png'), fullPage: true })
        assert.equal(result.models.length, 7)
        assert.deepEqual(result.errors, [])
        assert.ok(result.models.every(model => model.dimensions.every(value => Number.isFinite(value) && value > 0)))
        assert.deepEqual(errors, [])
        assert.deepEqual(missing, [])
        console.log(`PASS: all seven exported GLB models load in the built preview. Image: ${path.join(output, 'powerups.png')}`)
    } finally {
        if(browser) await browser.close()
        server.kill()
    }
})().catch(error => { console.error(error); process.exitCode = 1 })
