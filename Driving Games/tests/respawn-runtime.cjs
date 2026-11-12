const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')

;(async () => {
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4194', '--strictPort', '--open=false'], { cwd: require('node:path').resolve(__dirname, '..'), windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) {
            try { if((await fetch('http://127.0.0.1:4194')).ok) break } catch {}
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
        // Keep unrelated edits in the shared workspace from reloading this run.
        await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export const createHotContext = () => ({accept(){}, on(){}, dispose(){}, prune(){}, invalidate(){}, data:{}}); export const updateStyle = () => {}; export const removeStyle = () => {}; export const injectQuery = url => url;' }))
        const errors = []
        page.on('console', message => { if(message.type() === 'error') console.log('CONSOLE:', message.text()) })
        page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR:', error.message, error.stack) })
        await page.route('http://127.0.0.1:4194/index.js*', async route => {
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.testGame=Game.getInstance();' })
        })
        await page.goto('http://127.0.0.1:4194/?ai=extreme&bots=7&seed=respawn-check#skip', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.testGame?.world?.rivals?.started && window.testGame.reveal.step === 2, null, { timeout: 150000 })
        console.log('Loaded')
        const removedSupport = await page.evaluate(() => {
            const R = window.testGame.RAPIER
            const world = new R.World({x:0,y:-9.81,z:0})
            const support = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0,0,0))
            world.createCollider(R.ColliderDesc.cuboid(8,0.5,8), support)
            const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,1.8,0))
            world.createCollider(R.ColliderDesc.cuboid(1,0.4,0.7).setMass(2.5), body)
            const controller = world.createVehicleController(body)
            for(const x of [-0.9,0.9]) for(const z of [-0.7,0.7]) controller.addWheel({x,y:0,z},{x:0,y:-1,z:0},{x:0,y:0,z:1},1,0.5)
            for(let i=0;i<30;i++){ world.step(); controller.updateVehicle(1/60) }
            const contact = controller.wheelGroundObject(0)?.handle
            world.removeRigidBody(support)
            controller.updateVehicle(1/60)
            world.step()
            world.free()
            return {contact, passed:true}
        })
        console.log('Removed wheel support', JSON.stringify(removedSupport))
        await page.evaluate(() => {
            const g = window.testGame
            for(const vehicle of [g.physicalVehicle, ...g.world.rivals.items.map(bot => bot.vehicle)]) {
                const update = vehicle.controller.updateVehicle.bind(vehicle.controller)
                vehicle.controller.updateVehicle = delta => {
                    try { return update(delta) }
                    catch(error) { console.error('Vehicle failure', JSON.stringify({delta, tickDelta:g.ticker.delta, average:g.ticker.deltaAverage, position:vehicle.position, player:vehicle===g.physicalVehicle})); throw error }
                }
            }
        })
        for(let round = 0; round < 6; round++) {
            const result = await page.evaluate(() => {
                const g = window.testGame, rivals = g.world.rivals
                g.rendering.renderer.setAnimationLoop(null)
                const render = g.rendering.render, tracks = g.tracks.update
                g.rendering.render = () => {}; g.tracks.update = () => {}
                try {
                    for(const bot of rivals.items) {
                        bot.lives = 3
                        g.world.vehicleDamage.destroy(bot.vehicle)
                    }
                    for(let frame = 0; frame < 90; frame++) g.ticker.update(g.ticker.elapsed * 1000 + 1000 / 30)
                    return rivals.items.map(bot => ({ state: bot.state, destroyed: bot.vehicle.destroyed }))
                } finally {
                    g.rendering.render = render; g.tracks.update = tracks
                    let firstFrame = true
                    g.rendering.renderer.setAnimationLoop(elapsed => {
                        if(firstFrame) { g.ticker.elapsed = elapsed / 1000; firstFrame = false; return }
                        g.ticker.update(elapsed)
                    })
                }
            })
            console.log('Revived round', round, JSON.stringify(result))
            assert.ok(result.every(bot => !bot.destroyed))
            await page.waitForTimeout(1000)
        }
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => window.testGame.escMenu.isOpen, null, { timeout: 5000 })
        assert.deepEqual(errors, [])
        console.log('PASS: repeated bot deaths/revivals and responsive menu')
    } finally { await browser?.close(); server.kill() }
})().catch(error => { console.error(error); process.exitCode = 1 })
