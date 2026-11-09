const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..')
    const output = path.join(os.tmpdir(), 'bruno-water-damage')
    fs.mkdirSync(output, { recursive: true })
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4195', '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) {
            try { if((await fetch('http://127.0.0.1:4195')).ok) break } catch {}
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const errors = [], missing = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('response', response => { if(response.status() >= 400) missing.push(`${response.status()} ${response.url()}`) })
        await page.route('**/index.js*', async route => {
            if(new URL(route.request().url()).pathname !== '/index.js') return route.continue()
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.damageGame=Game.getInstance();' })
        })
        await page.route('**/Game/World/Fireballs.js*', async route => {
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.damageGsap=gsap;' })
        })
        await page.goto('http://127.0.0.1:4195/#skip', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.damageGame?.reveal?.step === 2 && window.damageGame.world.rivals?.started, null, { timeout: 90000 })
        console.log('Loaded map, vehicles and water damage.')
        const result = await page.evaluate(async () => {
            const g = window.damageGame, vehicle = g.physicalVehicle, damage = g.world.vehicleDamage, record = damage.records.get(vehicle), R = g.RAPIER
            g.rendering.renderer.setAnimationLoop(null)
            window.damageGsap.globalTimeline.pause()
            g.ticker.delta = g.ticker.deltaAverage = 1 / 60
            g.ticker.deltaScaled = 1 / 30
            const groundAt = (x, z) => {
                const hit = g.physics.world.castRay(new R.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true, undefined, undefined, undefined, undefined, collider => collider.parent()?.isFixed() && (collider.collisionGroups() >>> 16) === g.physics.groups.all)
                return hit ? 50 - hit.timeOfImpact : null
            }
            const seaFloor = groundAt(110, 0)
            const geometry = g.world.floor.geometry.attributes.position
            let oceanVertex, landVertex, innerVertex
            for(let i = 0; i < geometry.count; i++) {
                const x = geometry.getX(i), y = geometry.getY(i), z = geometry.getZ(i), edge = Math.max(Math.abs(x), Math.abs(z))
                if(!oceanVertex && edge >= 88 && y < -1.3) oceanVertex = { original: y, actual: groundAt(x, z), x, z }
                if(!landVertex && edge < 80 && y >= -0.2) landVertex = { original: y, actual: groundAt(x, z), x, z }
                if(!innerVertex && edge < 60 && y < -1.3) innerVertex = { original: y, actual: groundAt(x, z), x, z }
            }
            // Horizontal and tilted roof tests use the real imported car dimensions.
            const roof = Math.max(...record.bodyPoints.map(point => point.y))
            const water = g.water.surfaceElevationUniform.value
            vehicle.moveTo(vehicle.position.clone().set(110, water - roof + 0.1, 0))
            damage.update()
            const partialSurvives = !vehicle.destroyed
            vehicle.chassis.physical.body.setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) }, true)
            const highest = damage.highestBodyPoint(record)
            const at = vehicle.chassis.physical.body.translation()
            vehicle.chassis.physical.body.setTranslation({ x: 110, y: at.y + water - highest + 0.1, z: 0 }, true)
            damage.update()
            const tiltedSurvives = !vehicle.destroyed

            vehicle.moveTo(vehicle.position.clone().set(110, 3, 0))
            vehicle.activate()
            let sinkTicks = 0
            while(!vehicle.destroyed && sinkTicks < 300) {
                g.ticker.elapsed += 1 / 60
                vehicle.updatePrePhysics()
                g.physics.update()
                g.objects.update() // Includes the old automatic underwater reset path.
                vehicle.updatePostPhysics()
                damage.update()
                sinkTicks++
            }
            const count = record.destroyedCount
            const pieces = record.debris.length
            const destroyedAt = vehicle.position.toArray()
            const initialPieces = record.debris.map(piece => ({ x: piece.body.translation().x, z: piece.body.translation().z }))
            for(let i = 0; i < 16; i++) { g.physics.update(); damage.update() }
            const spread = record.debris.map((piece, i) => Math.hypot(piece.body.translation().x - initialPieces[i].x, piece.body.translation().z - initialPieces[i].z))
            const duplicatePrevented = record.destroyedCount === count && !damage.destroy(vehicle)
            const hidden = !g.world.visualVehicle.parts.chassis.visible
            const disabled = !vehicle.chassis.physical.body.isEnabled()
            const hasFireball = g.scene.children.some(child => child.name === 'explosion-fireball')
            // Advance only the animation clock for a reproducible explosion frame.
            window.damageGsap.globalTimeline.time(window.damageGsap.globalTimeline.time() + 0.3)
            g.view.focusPoint.trackedPosition.copy(vehicle.position)
            g.view.focusPoint.smoothedPosition.copy(vehicle.position)
            for(let i = 0; i < 30; i++) g.view.update()
            g.world.floor.update()
            g.world.waterSurface.update()
            await g.rendering.render()
            return { seaFloor, oceanVertex, landVertex, innerVertex, roof, partialSurvives, tiltedSurvives, sinkTicks, destroyed: vehicle.destroyed, destroyedAt, pieces, spread: Math.max(...spread), duplicatePrevented, hidden, disabled, hasFireball, hint: !damage.hint.hidden, state: g.player.state, cameraDistance: g.view.spherical.radius.current }
        })
        console.log(JSON.stringify(result, null, 2))
        assert.ok(Math.abs(result.seaFloor + 12) < 0.01)
        assert.ok(result.oceanVertex?.actual < -8)
        assert.ok(Math.abs(result.landVertex.actual - result.landVertex.original) < 0.03)
        assert.ok(Math.abs(result.innerVertex.actual - result.innerVertex.original) < 0.03)
        assert.ok(result.partialSurvives && result.tiltedSurvives)
        assert.ok(result.destroyed && result.sinkTicks < 300 && result.destroyedAt[0] > 100)
        assert.ok(result.pieces >= 8 && result.spread > 1)
        assert.ok(result.duplicatePrevented && result.hidden && result.disabled && result.hasFireball && result.hint)
        await page.evaluate(() => new Promise(resolve => {
            const g = window.damageGame
            let frames = 0
            g.rendering.renderer.setAnimationLoop(() => {
                g.rendering.render()
                if(++frames === 2) { g.rendering.renderer.setAnimationLoop(null); resolve() }
            })
        }))
        await page.screenshot({ path: path.join(output, 'water-destruction.png') })
        const held = await page.evaluate(() => {
            const g = window.damageGame, d = g.world.vehicleDamage, v = g.physicalVehicle, record = d.records.get(v)
            for(let i = 0; i < 360; i++) { g.physics.update(); d.update() }
            return { stillDead: v.destroyed, debris: record.debris.length, piecesInScene: g.scene.children.filter(child => child.name === 'vehicle-wreck-piece').length, count: record.destroyedCount }
        })
        assert.ok(held.stillDead && held.debris === 0 && held.piecesInScene === 0 && held.count === 1)
        await page.evaluate(() => {
            window.damageGsap.globalTimeline.resume()
            const g = window.damageGame
            g.rendering.renderer.setAnimationLoop(elapsed => g.ticker.update(elapsed))
        })
        await page.keyboard.press('r')
        await page.waitForFunction(() => !window.damageGame.physicalVehicle.destroyed && !window.damageGame.player.respawning && window.damageGame.player.state === 1, null, { timeout: 30000 }).catch(async error => {
            console.log('Revival diagnostics', await page.evaluate(() => { const g = window.damageGame; return { destroyed: g.physicalVehicle.destroyed, respawning: g.player.respawning, state: g.player.state, filters: [...g.inputs.filters], overlay: g.overlay.progress.value, paused: window.damageGsap.globalTimeline.paused(), time: window.damageGsap.globalTimeline.time() } }), errors)
            throw error
        })
        const revived = await page.evaluate(() => {
            const g = window.damageGame
            return { visible: g.world.visualVehicle.parts.chassis.visible, enabled: g.physicalVehicle.chassis.physical.body.isEnabled(), hintHidden: g.world.vehicleDamage.hint.hidden, onLand: g.physicalVehicle.position.distanceTo(g.respawns.getDefault().position) < 8, pieces: g.world.vehicleDamage.records.get(g.physicalVehicle).debris.length }
        })
        assert.ok(revived.visible && revived.enabled && revived.hintHidden && revived.onLand && revived.pieces === 0)
        const botResult = await page.evaluate(() => {
            const g = window.damageGame, rivals = g.world.rivals, bot = rivals.items[0], damage = g.world.vehicleDamage
            g.rendering.renderer.setAnimationLoop(null)
            bot.vehicle.moveTo(bot.vehicle.position.clone().set(110, -4, 0))
            rivals.updateBot(bot, 1 / 60)
            const didNotTeleport = bot.vehicle.position.x === 110
            damage.update()
            rivals.updateBot(bot, 1 / 60)
            g.escMenu.open(); rivals.update(); g.escMenu.close(); rivals.update()
            return { didNotTeleport, destroyed: bot.vehicle.destroyed, state: bot.state, disabledAfterMenu: !bot.vehicle.chassis.physical.body.isEnabled(), autoRespawnDenied: !rivals.respawn(bot) }
        })
        console.log(JSON.stringify({ held, revived, botResult, errors, missing }, null, 2))
        assert.ok(botResult.didNotTeleport && botResult.destroyed && botResult.disabledAfterMenu && botResult.autoRespawnDenied)
        assert.equal(botResult.state, 'destroyed')
        assert.deepEqual(errors, [])
        assert.deepEqual(missing, [])
        console.log(`PASS: deep ocean, roof threshold, real sinking, scattered parts, no automatic revival, R revival, NPC death. Screenshot: ${path.join(output, 'water-destruction.png')}`)
    } finally {
        if(browser) await browser.close()
        server.kill()
    }
})().catch(error => { console.error(error); process.exitCode = 1 })
