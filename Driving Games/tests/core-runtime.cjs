const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..')
    const output = process.env.GAME_TEST_OUTPUT || path.join(os.tmpdir(), 'bruno-core-verification')
    fs.mkdirSync(output, { recursive: true })
    const servers = []
    let browser
    async function start(port, preview) {
        servers.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(preview ? ['preview'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' }))
        for(let i = 0; i < 60; i++) {
            try { if((await fetch(`http://127.0.0.1:${port}`)).ok) return } catch {}
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        throw new Error(`Server ${port} failed to start`)
    }
    try {
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const errors = [], missing = []
        if(!process.argv.includes('--production-only')) {
        await start(4197, false)
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const requests = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('response', response => { if(response.status() >= 400) missing.push(`${response.status()} ${response.url()}`) })
        page.on('request', request => requests.push(decodeURI(request.url())))
        await page.route('http://127.0.0.1:4197/index.js*', async route => {
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.coreGame=Game.getInstance();' })
        })
        await page.goto('http://127.0.0.1:4197/#skip', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.coreGame?.world?.rivals?.started && window.coreGame.reveal.step === 2, null, { timeout: 90000 })
        console.log('Original map loaded.')
        // Let the damped chase yaw settle before sampling it.
        await page.waitForFunction(() =>
        {
            const game = window.coreGame, view = game.view, forward = game.physicalVehicle.forward
            const target = Math.atan2(- forward.x, - forward.z)
            const difference = Math.atan2(Math.sin(target - view.spherical.theta), Math.cos(target - view.spherical.theta))
            return Math.abs(difference) < 0.02
        }, null, { timeout: 10000 })
        const before = await page.evaluate(() => ({ ratio: window.coreGame.view.zoom.baseRatio, phi: window.coreGame.view.spherical.phi, theta: window.coreGame.view.spherical.theta }))
        assert.equal(before.ratio, (60 - 36) / (60 - 8), 'Intro must not change the initial 36-unit distance')
        await page.mouse.move(500, 400)
        await page.mouse.down()
        await page.mouse.move(850, 650, { steps: 12 })
        await page.mouse.up()
        const afterDrag = await page.evaluate(() => ({ ratio: window.coreGame.view.zoom.baseRatio, phi: window.coreGame.view.spherical.phi, theta: window.coreGame.view.spherical.theta, tracking: window.coreGame.view.focusPoint.isTracking }))
        assert.equal(afterDrag.ratio, before.ratio)
        assert.equal(afterDrag.phi, before.phi)
        // The chase yaw follows the car; a pointer drag must not steer it.
        assert.ok(Math.abs(afterDrag.theta - before.theta) < 0.05, 'Mouse drag must not steer the chase camera')
        assert.equal(afterDrag.tracking, true)
        await page.mouse.wheel(0, 240)
        await page.waitForFunction(ratio => window.coreGame.view.zoom.baseRatio < ratio, before.ratio)
        const wheelRatio = await page.evaluate(() => window.coreGame.view.zoom.baseRatio)
        const result = await page.evaluate(() => {
            const g = window.coreGame, view = g.view, rivals = g.world.rivals, bots = rivals.items, player = g.physicalVehicle
            const spawnOnLand = !!g.navigation.sample(player.position.x, player.position.z)
            g.rendering.renderer.setAnimationLoop(null)
            g.ticker.delta = g.ticker.deltaAverage = 1 / 60
            g.ticker.deltaScaled = 1 / 60 * g.ticker.scale
            for(let i = 0; i < 150; i++) view.update()
            const radius = view.spherical.radius.current
            const rotation = view.camera.quaternion.clone()
            const ratio = view.zoom.baseRatio
            const originalFocus = view.focusPoint.trackedPosition.clone()
            view.roll.kick(10)
            const wallPosition = view.focusPoint.smoothedPosition.clone().addScaledVector(view.spherical.offset, 0.6)
            const wallBody = g.physics.world.createRigidBody(g.RAPIER.RigidBodyDesc.fixed().setTranslation(wallPosition.x, wallPosition.y, wallPosition.z))
            g.physics.world.createCollider(g.RAPIER.ColliderDesc.cuboid(5, 8, 5), wallBody)
            g.physics.world.step()
            for(let i = 0; i < 120; i++) {
                view.focusPoint.trackedPosition.x += 0.8
                view.update()
            }
            const fixedCamera = Math.abs(radius - view.spherical.radius.current) < 1e-6 && rotation.angleTo(view.camera.quaternion) < 1e-6 && view.zoom.baseRatio === ratio
            const followsCar = view.focusPoint.position.distanceTo(view.focusPoint.trackedPosition) < 1e-6
            g.physics.world.removeRigidBody(wallBody)
            view.focusPoint.trackedPosition.copy(originalFocus)
            for(let i = 0; i < 120; i++) view.update()
            const step = () => {
                g.ticker.elapsed += 1 / 60
                rivals.update()
                player.updatePrePhysics()
                for(const bot of bots) bot.vehicle.updatePrePhysics()
                g.physics.update()
                player.updatePostPhysics()
                g.player.position.copy(player.position)
                for(const bot of bots) bot.vehicle.updatePostPhysics()
            }
            let contacts = 0, invalid = false
            const minimumDistances = bots.map(() => Infinity)
            const states = new Set()
            // Rivals now spawn anywhere on the island. Record that, then stage
            // them close by so this test still exercises pursuit and contacts.
            const initialDistances = bots.map(bot => bot.vehicle.position.distanceTo(player.position))
            bots.forEach((bot, index) => {
                const angle = index * Math.PI * 2 / bots.length
                const spot = player.position.clone()
                spot.x += Math.cos(angle) * 12
                spot.z += Math.sin(angle) * 12
                bot.vehicle.moveTo(spot, angle)
                bot.vehicle.activate()
            })
            for(let i = 0; i < 1500; i++) {
                step()
                bots.forEach((bot, index) => {
                    minimumDistances[index] = Math.min(minimumDistances[index], bot.vehicle.position.distanceTo(player.position))
                    states.add(bot.state)
                    if(!bot.vehicle.position.toArray().every(Number.isFinite)) invalid = true
                    for(const collider of bot.vehicle.chassis.physical.colliders)
                        g.physics.world.contactPairsWith(collider, other => { if(other.parent()?.userData?.vehicle && other.parent() !== bot.vehicle.chassis.physical.body) contacts++ })
                })
            }
            g.escMenu.open(); rivals.update()
            const paused = bots.every(bot => !bot.vehicle.chassis.physical.body.isEnabled())
            g.escMenu.close(); rivals.update()
            const resumed = bots.every(bot => bot.vehicle.chassis.physical.body.isEnabled())
            // Return the render to the real physics positions for the screenshot.
            view.focusPoint.trackedPosition.copy(player.position)
            for(let i = 0; i < 120; i++) view.update()
            for(const bot of bots) bot.visual.update()
            g.world.visualVehicle.update()
            return { fixedCamera, followsCar, radius, contacts, minimumDistances, initialDistances, states: [...states], invalid, paused, resumed, colors: bots.map(bot => bot.color), distinctPaints: new Set([g.world.visualVehicle, ...bots.map(bot => bot.visual)].map(visual => visual.parts.bodyPainted.material.uuid)).size, noHighrise: !g.world.level && !g.resources.campTower, parameters: [player.steeringAmplitude, player.engineForceAmplitude, player.topSpeed, player.topSpeedBoost], map: !!g.world.floor && !!g.world.waterSurface, spawnOnLand }
        })
        console.log(JSON.stringify({ wheelRatio, ...result }, null, 2))
        assert.ok(result.fixedCamera && result.followsCar && result.noHighrise && result.map && result.spawnOnLand)
        assert.ok(result.initialDistances.every(distance => distance > 30), 'Rivals must not spawn next to the player')
        assert.ok(result.contacts > 0 && result.minimumDistances.some(distance => distance < 6))
        assert.ok(!result.invalid && result.paused && result.resumed)
        assert.equal(result.distinctPaints, 4)
        assert.deepEqual(result.colors, ['blue', 'yellow', 'purple'])
        assert.deepEqual(result.parameters, [0.5, 300, 5, 40])
        assert.ok(!requests.some(url => /wasteland|levels\/camp|\/editor\//.test(url)))
        assert.deepEqual(errors, [])
        assert.deepEqual(missing, [])
        await page.close()
        }

        // Smoke-test the distributable used by Play.cmd, including wheel and settings.
        await start(4196, true)
        const built = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        built.on('pageerror', error => errors.push(error.message))
        built.on('response', response => { if(response.status() >= 400) missing.push(`${response.status()} ${response.url()}`) })
        // Expose the bundled singleton in this test response only. The artifact
        // on disk stays unchanged, and readiness means the map is really visible.
        await built.route(/\/assets\/(?:index|game)-[^/]+\.js$/, async route => {
            const response = await route.fetch()
            const source = await response.text()
            assert.ok(source.includes('this.ready=this.init()'))
            await route.fulfill({ response, body: source.replace('this.ready=this.init()', 'this.ready=this.init(),window.coreBuilt=this') })
        })
        await built.goto('http://127.0.0.1:4196/#skip', { waitUntil: 'networkidle', timeout: 90000 })
        await built.waitForFunction(() => window.coreBuilt?.reveal?.step === 2 && window.coreBuilt?.world?.rivals?.started, null, { timeout: 90000 })
        const initialDistance = await built.evaluate(() => window.coreBuilt.view.spherical.radius.current)
        assert.ok(Math.abs(initialDistance - 36) < 1e-6, 'Production camera must start at distance 36')
        console.log('Production map fully revealed.')
        await built.mouse.wheel(0, 240)
        await built.waitForTimeout(1000)
        await built.keyboard.press('Escape')
        await built.locator('[data-esc-tab="weather"]').click()
        await built.locator('[data-esc-weather="rain"]').click()
        await built.waitForTimeout(1500)
        await built.locator('[data-esc-weather="clear"]').click()
        await built.keyboard.press('Escape')
        await built.waitForTimeout(1500)
        await built.screenshot({ path: path.join(output, 'original-map-fixed-camera.png') })
        assert.deepEqual(errors, [])
        assert.deepEqual(missing, [])
        console.log(`PASS: fixed camera, real wheel/drag input, pursuit/collisions, original map and production assets. Screenshot: ${path.join(output, 'original-map-fixed-camera.png')}`)
    } finally {
        if(browser) await browser.close()
        for(const server of servers) server.kill()
    }
})().catch(error => { console.error(error); process.exitCode = 1 })
