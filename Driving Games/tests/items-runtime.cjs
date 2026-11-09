const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..'), output = path.join(root, 'previews')
    fs.mkdirSync(output, { recursive: true })
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4192', '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) { try { if((await fetch('http://127.0.0.1:4192')).ok) break } catch {} await new Promise(resolve => setTimeout(resolve, 200)) }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true })
        const page = await context.newPage(), errors = [], missing = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if(message.type() === 'error') errors.push(message.text()) })
        page.on('response', response => { if(response.status() >= 400) missing.push(response.url()) })
        await page.route('**/index.js*', async route => {
            if(new URL(route.request().url()).pathname !== '/index.js') return route.continue()
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.itemGame=Game.getInstance();' })
        })
        await page.goto('http://127.0.0.1:4192/?time=0.05#skip', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.itemGame?.world?.powerups?.started && window.itemGame.world.rivals.started, null, { timeout: 120000 })
        const initial = await page.evaluate(() => {
            const g = window.itemGame, items = g.world.items
            g.rendering.renderer.setAnimationLoop(null)
            for(const v of g.world.vehicleDamage.records.keys()) { items.reset(v); items.state(v).nextAI = Infinity }
            items.updateHud()
            return { counts: items.state(g.physicalVehicle).counts, pickups: Object.fromEntries(['power','speed','jump','caltrop','missile','crate','shield','jetpack'].map(type => [type, g.world.powerups.items.filter(p => p.type === type).length])) }
        })
        console.log('Inventory and pickups:', initial)
        assert.ok(Object.values(initial.counts).every(n => n === 3))
        assert.ok(Object.values(initial.pickups).every(n => n >= 3))
        await page.keyboard.press('ArrowLeft')
        assert.equal(await page.evaluate(() => window.itemGame.world.items.selected), 4)
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.evaluate(() => window.itemGame.world.items.selected), 0)
        assert.equal(await page.evaluate(() => window.itemGame.inputs.actions.get('right').active), false)
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.down('KeyE')
        await page.keyboard.down('KeyE')
        await page.keyboard.up('KeyE')
        assert.deepEqual(await page.evaluate(() => { const s = window.itemGame.world.items.state(window.itemGame.physicalVehicle); return [s.counts.shield, s.shield.charges] }), [2, 3])

        const result = await page.evaluate(() => {
            const g = window.itemGame, items = g.world.items, player = g.physicalVehicle, bot = g.world.rivals.items[0].vehicle, pickups = g.world.powerups, vehicles = [...g.world.vehicleDamage.records.keys()]
            const report = {}
            const zero = v => Object.assign(v.controls, { accelerating: 0, boosting: 0, steering: 0, braking: 0, suspensions: ['low','low','low','low'] })
            const reset = v => { items.reset(v); items.state(v).nextAI = Infinity; zero(v); v.upgrades.reset() }
            for(const v of vehicles) { reset(v); v.deactivate() }
            player.activate(); bot.activate()
            const spawn = g.respawns.getDefault().position.clone()
            player.moveTo(spawn, 0); bot.moveTo(spawn.clone().add({ x: 20, y: 0, z: 0 }), 0)
            const tick = (active = [player, bot]) => {
                g.ticker.delta = g.ticker.deltaAverage = 1/60; g.ticker.deltaScaled = 1/30; g.ticker.elapsed += 1/60
                for(let i = g.ticker.waits.length - 1; i >= 0; i--) { const wait = g.ticker.waits[i]; if(--wait[0] <= 0) { g.ticker.waits.splice(i, 1); wait[1]() } }
                for(const v of active) v.updatePrePhysics()
                g.physics.update()
                for(const v of active) v.updatePostPhysics()
                items.update(); g.world.combat.updateFlights()
            }
            const pickup = pickups.items.find(p => p.type === 'missile')
            player.moveTo(pickup.position.clone().add({ x: 0, y: 1, z: 0 }))
            pickups.previousPositions.clear(); pickups.update()
            report.pickup = items.state(player).counts.missile === 4 && !pickup.active
            pickups.update()
            report.singlePickup = items.state(player).counts.missile === 4
            const itemState = items.state(player)
            itemState.counts.missile = 9
            report.cap = !items.collect(player, 'missile')
            itemState.counts.missile = 3
            player.moveTo(spawn, 0)
            report.caltropPlaced = items.use(player, 'caltrop')
            const spike = items.entities.find(e => !e.removed && e.type === 'caltrop')
            report.placementBehind = spike.position.clone().sub(player.position).dot(player.forward) < -3
            bot.moveTo(spike.position.clone().add({ x: 0, y: 0.8, z: 0 }))
            bot.chassis.physical.body.setLinvel({ x: 15, y: 0, z: 0 }, true)
            items.before.clear(); spike.age = 1.5; items.updateEntity(spike, 1/60, [bot])
            report.spike = { removed: spike.removed, speed: Math.hypot(...Object.values(bot.chassis.physical.body.linvel())), seconds: items.state(bot).slowUntil - items.clock, multiplier: items.speedFactor(bot) }
            const R = g.RAPIER, floor = g.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(3000, -0.5, 0))
            g.physics.world.createCollider(R.ColliderDesc.cuboid(2000, 0.5, 100).setCollisionGroups(g.physics.categories.floor), floor)
            player.deactivate(); bot.moveTo(bot.position.clone().set(2000, 1.25, 0), 0)
            items.state(bot).slowUntil = items.clock + 15
            bot.controls.accelerating = 1
            for(let i = 0; i < 480; i++) tick([bot])
            report.slowSpeed = bot.xzSpeed
            const expiry = items.state(bot).slowUntil
            items.clock = expiry - 0.01
            report.slowBeforeExpiry = items.speedFactor(bot)
            items.clock = expiry + 0.01
            report.slowAfterExpiry = items.speedFactor(bot)
            for(let i = 0; i < 360; i++) tick([bot])
            report.restoredSpeed = bot.xzSpeed

            reset(player); reset(bot); player.activate(); bot.activate()
            player.moveTo(player.position.clone().set(2006, 1.25, 0), Math.PI)
            bot.moveTo(bot.position.clone().set(2000, 1.25, 0), 0)
            for(let i = 0; i < 40; i++) tick()
            items.use(player, 'shield')
            report.shield = []
            for(let hit = 0; hit < 3; hit++) {
                bot.moveTo(bot.position.clone().set(2000, 1.25, 0), 0)
                player.moveTo(player.position.clone().set(2006, 1.25, 0), Math.PI)
                for(let i = 0; i < 45; i++) tick()
                bot.upgrades.power = 5
                bot.chassis.physical.body.setLinvel({ x: 30, y: 0, z: 0 }, true)
                const expected = 2-hit
                for(let i = 0; i < 30; i++) { tick(); if((items.state(player).shield?.charges ?? 0) === expected) break }
                report.shield.push({ charges: items.state(player).shield?.charges ?? 0, launched: !!player.launch?.active, speed: player.xzSpeed })
            }
            // A fourth independent hit must no longer be protected.
            bot.moveTo(bot.position.clone().set(2000, 1.25, 0), 0)
            player.moveTo(player.position.clone().set(2006, 1.25, 0), Math.PI)
            for(let i = 0; i < 50; i++) tick()
            bot.chassis.physical.body.setLinvel({ x: 30, y: 0, z: 0 }, true)
            for(let i = 0; i < 25; i++) tick()
            report.fourthLaunch = !!player.launch?.active

            reset(player); reset(bot)
            player.moveTo(player.position.clone().set(2000, 10, 0), 0)
            bot.moveTo(bot.position.clone().set(2005, 10, 0), 0)
            report.jetUsed = items.use(player, 'jetpack')
            report.jetPush = bot.chassis.physical.body.linvel().x > 1
            report.jetRise = player.chassis.physical.body.linvel().y >= 12
            report.jetJump = player.requestJump()
            g.ticker.elapsed += 0.3
            report.noInfiniteJetJump = !player.requestJump()
            for(let i = 0; i < 90; i++) tick()
            report.jetEnds = !items.state(player).jet
            reset(player); player.upgrades.jump = 1
            items.startJet(player)
            report.jetDoubleFirst = player.requestJump()
            g.ticker.elapsed += 0.3
            report.jetDoubleSecond = player.requestJump()
            g.ticker.elapsed += 0.3
            report.jetDoubleCap = !player.requestJump()

            reset(player); reset(bot)
            player.moveTo(player.position.clone().set(2000, 10, 0), 0)
            bot.moveTo(bot.position.clone().set(2020, 10, 0), 0)
            report.missileUsed = items.use(player, 'missile')
            const missile = items.entities.find(e => !e.removed && e.type === 'missile')
            report.nearest = missile.target === bot && missile.position.y > player.position.y + 2
            const fireballsBefore = g.scene.children.filter(child => child.name === 'explosion-fireball').length
            // Keep the target stationary to test the actual homing trajectory.
            items.before.clear()
            for(let i = 0; i < 180 && !missile.removed; i++) items.updateEntity(missile, 1/60, [player, bot])
            report.missileHit = missile.removed && g.scene.children.filter(child => child.name === 'explosion-fireball').length > fireballsBefore
            items.fireMissile(player)
            const timeoutMissile = items.entities.find(e => !e.removed && e.type === 'missile')
            timeoutMissile.position.set(2000, 80, 0); timeoutMissile.age = 10.01
            const beforeDirection = timeoutMissile.direction.clone()
            items.updateEntity(timeoutMissile, 1/60, [player, bot])
            report.trackingTimeout = !timeoutMissile.tracking && timeoutMissile.direction.distanceTo(beforeDirection) < 1e-8
            timeoutMissile.age = 14; items.updateEntity(timeoutMissile, 1/60, [])
            report.missileCleanup = timeoutMissile.removed

            reset(player); reset(bot)
            player.moveTo(spawn, 0)
            items.state(player).nextUse = 0
            report.crateUsed = items.use(player, 'crate')
            const crate = items.entities.find(e => !e.removed && e.type === 'crate')
            bot.moveTo(crate.position.clone().add({ x: 0, y: 0.7, z: 0 }))
            items.addShield(bot)
            const oldCharges = items.state(bot).shield.charges
            items.before.clear(); crate.age = 1.5
            items.updateEntity(crate, 1/60, [bot])
            report.crate = { removed: crate.removed, shieldUsed: items.state(bot).shield.charges === oldCharges - 1 }
            items.state(player).counts.caltrop = 0
            report.emptyRejected = !items.use(player, 'caltrop')
            g.escMenu.open()
            const clock = items.clock, count = items.state(player).counts.missile
            items.update()
            report.pause = !items.use(player, 'missile') && items.clock === clock && items.state(player).counts.missile === count
            g.escMenu.close()
            g.world.vehicleDamage.revive(player)
            report.respawn = Object.values(items.state(player).counts).every(n => n === 3) && !items.state(player).shield && !items.state(player).jet && items.speedFactor(player) === 1
            g.physics.world.removeRigidBody(floor)
            for(const v of vehicles) { reset(v); v.deactivate() }
            player.activate(); player.moveTo(spawn, 0); items.addShield(player)
            items.selected = 3; items.state(player).nextUse = 0
            items.update(); items.updateHud()
            g.world.visualVehicle.update()
            g.view.focusPoint.trackedPosition.copy(player.position); g.view.focusPoint.smoothedPosition.copy(player.position)
            g.world.combat.framing.blend = 0; g.world.combat.shot = null
            for(let i = 0; i < 60; i++) g.view.update()
            g.world.floor.update(); g.world.waterSurface.update()
            return report
        })
        console.log(JSON.stringify(result, null, 2))
        for(const key of ['pickup','singlePickup','cap','caltropPlaced','placementBehind','fourthLaunch','jetUsed','jetPush','jetRise','jetJump','noInfiniteJetJump','jetEnds','jetDoubleFirst','jetDoubleSecond','jetDoubleCap','missileUsed','nearest','missileHit','trackingTimeout','missileCleanup','crateUsed','emptyRejected','pause','respawn']) assert.ok(result[key], key)
        assert.ok(result.spike.removed && result.spike.speed === 0 && result.spike.seconds === 15 && result.spike.multiplier === 0.5)
        assert.equal(result.slowBeforeExpiry, 0.5); assert.equal(result.slowAfterExpiry, 1)
        assert.ok(result.slowSpeed / result.restoredSpeed > 0.4 && result.slowSpeed / result.restoredSpeed < 0.6)
        assert.deepEqual(result.shield.map(s => s.charges), [2,1,0])
        assert.ok(result.shield.every(s => !s.launched && s.speed < 3))
        assert.ok(result.crate.removed && result.crate.shieldUsed)
        const renderFrames = () => page.evaluate(() => new Promise(resolve => {
            const g = window.itemGame; let frames = 0
            g.rendering.renderer.setAnimationLoop(() => { g.rendering.render(); if(++frames === 3) { g.rendering.renderer.setAnimationLoop(null); resolve() } })
        }))
        await renderFrames()
        await page.screenshot({ path: path.join(output, 'items-desktop.png') })
        await page.setViewportSize({ width: 390, height: 844 })
        await renderFrames()
        await page.locator('[data-item="jetpack"]').tap()
        const mobile = await page.evaluate(() => {
            const g = window.itemGame, hud = g.world.items.hud.getBoundingClientRect(), s = g.world.items.state(g.physicalVehicle)
            return { count: s.counts.jetpack, active: !!s.jet, inView: hud.left >= 0 && hud.right <= innerWidth && hud.bottom <= innerHeight, joystick: g.inputs.pointer.upcomingDown }
        })
        assert.deepEqual(mobile, { count: 2, active: true, inView: true, joystick: false })
        await renderFrames()
        await page.screenshot({ path: path.join(output, 'items-mobile.png') })
        assert.deepEqual(errors, []); assert.deepEqual(missing, [])
        console.log('PASS: five consumables, pickups, keyboard/touch, 15s slow, three-hit shield, homing timeout, explosion, jet jumps, pause and respawn.')
    } finally { if(browser) await browser.close(); server.kill() }
})().catch(error => { console.error(error); process.exitCode = 1 })
