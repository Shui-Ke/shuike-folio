const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..')
    const output = process.env.GAME_TEST_OUTPUT || path.join(root, 'previews')
    fs.mkdirSync(output, { recursive: true })
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4193', '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) {
            try { if((await fetch('http://127.0.0.1:4193')).ok) break } catch {}
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const errors = [], missing = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if(message.type() === 'error') errors.push(message.text()) })
        page.on('response', response => { if(response.status() >= 400) missing.push(response.url()) })
        await page.route('**/index.js*', async route => {
            if(new URL(route.request().url()).pathname !== '/index.js') return route.continue()
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.playGame=Game.getInstance();' })
        })
        await page.route('**/Game/World/Fireballs.js*', async route => {
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.gameplayGsap=gsap;' })
        })
        await page.goto('http://127.0.0.1:4193/?time=0.05#skip', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.playGame?.world?.powerups?.started && window.playGame.world.rivals.started, null, { timeout: 120000 })
        await page.waitForFunction(() => window.playGame.physicalVehicle.wheels.inContactCount >= 2)
        await page.keyboard.press('Space')
        const keyboardJump = await page.evaluate(() => { const g = window.playGame; g.inputs.nipple.update(); return { used: g.physicalVehicle.jumpState.used, touchVisible: g.inputs.nipple.group.visible, touchAnimated: g.inputs.nipple.animated } })
        assert.equal(keyboardJump.used, 1)
        assert.ok(!keyboardJump.touchVisible && !keyboardJump.touchAnimated, 'Keyboard jump must not show the touch joystick')
        await page.screenshot({ path: path.join(output, 'gameplay-pickups.png') })
        console.log('Map and pickup models loaded.')
        const result = await page.evaluate(() => {
            const g = window.playGame, player = g.physicalVehicle, bot = g.world.rivals.items[0].vehicle, pickups = g.world.powerups, combat = g.world.combat
            g.rendering.renderer.setAnimationLoop(null)
            const vehicles = [...g.world.vehicleDamage.records.keys()]
            for(const vehicle of vehicles) { vehicle.upgrades.reset(); vehicle.deactivate() }
            player.activate()
            const counts = Object.fromEntries(['power','speed','jump'].map(type => [type, pickups.items.filter(item => item.type === type).length]))
            const pickup = pickups.items.find(item => item.type === 'power')
            player.moveTo(pickup.position.clone().add({ x: 0, y: 1, z: 0 }))
            pickups.previousPositions.clear(); pickups.update()
            const playerCollect = player.upgrades.power === 1 && !pickup.active
            bot.activate(); bot.moveTo(player.position.clone())
            pickups.update()
            const singleConsumer = bot.upgrades.power === 0
            player.moveTo(g.respawns.getDefault().position)
            pickups.clock = pickup.respawnAt + 0.01
            pickups.previousPositions.clear(); pickups.update()
            bot.moveTo(pickup.position.clone().add({ x: 0, y: 1, z: 0 }))
            pickups.previousPositions.clear(); pickups.update()
            const botCollect = bot.upgrades.power === 1 && !pickup.active
            const caps = {}
            for(const type of ['power','speed','jump']) {
                for(let i = 0; i < 9; i++) player.upgrades.collect(type)
                caps[type] = player.upgrades[type]
            }
            const capRejected = !player.upgrades.collect('power') && !player.upgrades.collect('speed') && !player.upgrades.collect('jump')
            const aiTarget = !!pickups.nearestFor(bot)
            for(const v of vehicles) v.deactivate()
            const R = g.RAPIER
            const floor = g.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(3000, -0.5, 0))
            const floorCollider = g.physics.world.createCollider(R.ColliderDesc.cuboid(2000, 0.5, 100).setCollisionGroups(g.physics.categories.floor), floor)
            const controls = v => Object.assign(v.controls, { accelerating: 0, boosting: 0, steering: 0, braking: 0, suspensions: ['low','low','low','low'] })
            const tick = (active = [player, bot]) => {
                g.ticker.delta = g.ticker.deltaAverage = 1 / 60; g.ticker.deltaScaled = 1 / 30; g.ticker.elapsed += 1 / 60
                for(const v of active) v.updatePrePhysics()
                g.physics.update()
                for(const v of active) v.updatePostPhysics()
                combat.updateFlights(); g.view.update()
            }
            const reset = (v, x, z = 0, rotation = 0) => {
                controls(v); v.upgrades.reset(); v.activate(); v.moveTo(v.position.clone().set(x, 1.25, z), rotation)
            }
            const drive = (level, boost) => {
                bot.deactivate(); reset(player, 2000)
                player.upgrades.speed = level
                for(let i = 0; i < 40; i++) tick([player])
                player.controls.accelerating = 1; player.controls.boosting = boost
                for(let i = 0; i < (boost ? 960 : 480); i++) {
                    tick([player])
                }
                return Math.hypot(player.chassis.physical.body.linvel().x, player.chassis.physical.body.linvel().z)
            }
            const speeds = [0,1,2].map(level => ({ normal: drive(level, 0), boost: drive(level, 1) }))
            const collide = (level, speed, rotation = 0, speedLevel = 0) => {
                reset(player, 2000, 0, rotation); reset(bot, 2004.5)
                for(let i = 0; i < 40; i++) tick()
                player.upgrades.power = level
                player.upgrades.speed = speedLevel
                combat.touching.clear(); combat.cooldowns.clear()
                const initial = bot.position.clone(), count = combat.hitCount
                player.chassis.physical.body.setLinvel({ x: speed, y: 0, z: 0 }, true)
                let firstHit = null, landingRange = null, apex = initial.y, peakZoom = 0
                for(let i = 0; i < 240; i++) {
                    tick()
                    apex = Math.max(apex, bot.position.y)
                    peakZoom = Math.max(peakZoom, g.view.spherical.radius.current)
                    if(!firstHit && combat.hitCount > count) {
                        firstHit = { strength: combat.lastHit.strength, bonus: combat.lastHit.bonusSpeed, heavyImpact: combat.lastHit.heavyImpact, range: combat.lastHit.launchRange, end: combat.lastHit.end, direction: combat.lastHit.direction.toArray() }
                        player.deactivate()
                    }
                    if(firstHit?.heavyImpact && landingRange === null && bot.launch.elapsed > 1) {
                        // A tumbling chassis can land roof-first, then bounce above
                        // its initial center height. Measure the first floor contact.
                        let touchedFloor = false
                        for(const collider of bot.chassis.physical.colliders)
                            g.physics.world.contactPair(collider, floorCollider, manifold => { if(manifold.numSolverContacts()) touchedFloor = true })
                        if(touchedFloor || bot.position.y <= initial.y || !bot.launch.active)
                            landingRange = Math.hypot(bot.position.x - initial.x, bot.position.z - initial.z)
                    }
                }
                return { displacement: landingRange ?? Math.hypot(bot.position.x - initial.x, bot.position.z - initial.z), apex: apex - initial.y, peakZoom, hits: combat.hitCount - count, hit: firstHit }
            }
            const pushes = [0,1,2,3,4,5].map(level => collide(level, 35))
            const lowHit = collide(5, 5)
            const rearHit = collide(5, 35, Math.PI)
            const rearBase = collide(0, 22.6, Math.PI)
            const rearSlow = collide(0, 5, Math.PI)
            const sideHit = collide(5, 35, Math.PI / 2)
            const maxHit = collide(5, 42)
            const baseImpact = collide(0, 22.6)
            const poweredCruise = collide(5, 11)
            const speedBuffImpact = collide(2, 22, 0, 2)
            const plainCruise = collide(0, 11)
            const loweredGate = collide(0, 21.5)
            if(!loweredGate.hit?.heavyImpact || loweredGate.hit.strength < 4 || loweredGate.hit.strength >= 5) throw new Error('Reduced impact threshold must trigger between scores 4 and 5: ' + JSON.stringify(loweredGate))

            bot.deactivate(); reset(player, 2000)
            for(let i = 0; i < 40; i++) tick([player])
            const firstJump = player.requestJump()
            for(let i = 0; i < 15; i++) tick([player])
            const noExtraWithoutBuff = !player.requestJump()
            player.upgrades.collect('jump')
            const beforeY = player.chassis.physical.body.linvel().y
            const secondJump = player.requestJump()
            const afterY = player.chassis.physical.body.linvel().y
            for(let i = 0; i < 15; i++) tick([player])
            const noThirdJump = !player.requestJump()
            player.controls.steering = -1
            const beforeZ = player.position.z
            for(let i = 0; i < 12; i++) tick([player])
            const airMovement = Math.abs(player.position.z - beforeZ), airOffset = player.jumpState.airOffset.length(), airLimit = Math.max(player.jumpState.takeoffSpeed, player.topSpeed) * 0.25
            player.controls.steering = 0
            for(let i = 0; i < 150; i++) tick([player])
            const landed = !player.jumpState.airborne && player.jumpState.used === 0 && player.requestJump()
            const effectBefore = combat.effectCount
            const cameraTarget = g.view.focusPoint.smoothedPosition.clone()
            const oldExplode = g.explosions.explode
            let physicalExplosions = 0
            g.explosions.explode = (...args) => { physicalExplosions++; return oldExplode.apply(g.explosions, args) }
            const velocitiesBefore = vehicles.map(v => ({ ...v.chassis.physical.body.linvel() }))
            const fireballsBefore = g.scene.children.filter(child => child.name === 'explosion-fireball').length
            combat.effectCooldown = 0; combat.playImpact(cameraTarget)
            const fireballCreated = g.scene.children.filter(child => child.name === 'explosion-fireball').length === fireballsBefore + 1
            const velocitiesUnchanged = vehicles.every((v, i) => ['x','y','z'].every(axis => v.chassis.physical.body.linvel()[axis] === velocitiesBefore[i][axis]))
            g.explosions.explode = oldExplode
            g.ticker.delta = 1 / 60; g.time.update()
            const slowScale = g.time.scale
            for(let i = 0; i < 45; i++) g.time.update()
            const effect = { triggered: combat.effectCount > effectBefore, slowScale, restoredScale: g.time.scale, fireballCreated, physicalExplosions, velocitiesUnchanged, noFlash: !document.querySelector('.impact-burst') && getComputedStyle(g.canvasElement).filter === 'none' && g.canvasElement.getAnimations().length === 0 }
            g.world.vehicleDamage.revive(player)
            const resetOnRevive = player.upgrades.power === 0 && player.upgrades.speed === 0 && player.upgrades.jump === 0
            g.physics.world.removeRigidBody(floor)
            for(let i = 0; i < 150; i++) { combat.updateFlights(); g.view.update() }
            return { counts, playerCollect, singleConsumer, botCollect, caps, capRejected, aiTarget, speeds, pushes, lowHit, rearHit, rearBase, rearSlow, sideHit, maxHit, baseImpact, poweredCruise, speedBuffImpact, plainCruise, cameraRestored: Math.abs(g.view.spherical.radius.current - 36) < 0.1, jumps: { firstJump, noExtraWithoutBuff, secondJump, beforeY, afterY, noThirdJump, airMovement, airOffset, airLimit, landed }, effect, resetOnRevive }
        })
        console.log(JSON.stringify(result, null, 2))
        assert.ok(Object.values(result.counts).every(count => count >= 3))
        assert.ok(result.playerCollect && result.singleConsumer && result.botCollect && result.capRejected && result.aiTarget)
        assert.deepEqual(result.caps, { power: 5, speed: 2, jump: 1 })
        for(const field of ['normal','boost']) {
            assert.ok(Math.abs(result.speeds[1][field] / result.speeds[0][field] - 1.5) < 0.2)
            assert.ok(Math.abs(result.speeds[2][field] / result.speeds[0][field] - 2) < 0.25)
        }
        for(let i = 0; i < 6; i++) {
            assert.equal(result.pushes[i].hits, 1)
            const expectedRange = 50 * Math.min(1, result.pushes[i].hit.strength / 30)
            assert.ok(Math.abs(result.pushes[i].hit.range - expectedRange) < 0.001)
            assert.ok(Math.abs(result.pushes[i].displacement - expectedRange) < 6)
            if(i) assert.ok(result.pushes[i].hit.strength > result.pushes[i-1].hit.strength)
        }
        assert.ok(result.lowHit.displacement < result.pushes[5].displacement)
        assert.equal(result.rearHit.hits, 1)
        assert.ok(result.rearHit.hit.heavyImpact && result.rearHit.hit.end === 'rear' && result.rearHit.hit.direction[0] > 0.99)
        assert.ok(result.rearHit.displacement > 45 && result.rearHit.displacement < 56)
        assert.ok(result.rearBase.hit.heavyImpact && result.rearBase.hit.strength === 5)
        assert.ok(!result.rearSlow.hit.heavyImpact)
        assert.equal(result.sideHit.hits, 0)
        assert.ok(result.maxHit.hit.heavyImpact && result.baseImpact.hit.heavyImpact && result.poweredCruise.hit.heavyImpact && result.speedBuffImpact.hit.heavyImpact && !result.plainCruise.hit.heavyImpact)
        assert.ok(result.maxHit.displacement > 45 && result.maxHit.displacement < 56)
        assert.ok(Math.abs(result.baseImpact.displacement - 50 / 6) < 6 && result.baseImpact.apex > 2 && result.cameraRestored)
        assert.ok(result.jumps.firstJump && result.jumps.noExtraWithoutBuff && result.jumps.secondJump && result.jumps.noThirdJump && result.jumps.landed)
        assert.ok(result.jumps.afterY > result.jumps.beforeY && result.jumps.airMovement > 0.05 && result.jumps.airOffset <= result.jumps.airLimit + 0.01)
        assert.ok(result.effect.triggered && result.effect.slowScale < 0.6 && result.effect.restoredScale === 2 && result.effect.fireballCreated && result.effect.velocitiesUnchanged && result.effect.noFlash && result.resetOnRevive)
        assert.equal(result.effect.physicalExplosions, 0)
        await page.evaluate(() => {
            const g = window.playGame, player = g.physicalVehicle, bot = g.world.rivals.items[0].vehicle, combat = g.world.combat
            window.gameplayGsap.globalTimeline.pause()
            window.gameplayGsap.globalTimeline.time(window.gameplayGsap.globalTimeline.time() + 3)
            for(const v of g.world.vehicleDamage.records.keys()) {
                v.deactivate()
                Object.assign(v.controls, { accelerating: 0, steering: 0, boosting: 0, braking: 0 })
            }
            const spawn = g.respawns.getDefault().position.clone()
            player.activate(); player.moveTo(spawn, 0)
            bot.activate(); bot.moveTo(spawn.clone().add({ x: 4, y: 1, z: 0 }), 0)
            g.view.focusPoint.trackedPosition.copy(player.position)
            g.view.focusPoint.smoothedPosition.copy(player.position)
            g.view.update()
            const point = spawn.clone().add({ x: 2, y: 1, z: 0 })
            combat.launch({ attacker: player, target: bot, direction: spawn.clone().set(1, 0, 0), point, strength: 30 })
            combat.effectCooldown = 0; combat.playImpact(point)
            window.gameplayGsap.globalTimeline.time(window.gameplayGsap.globalTimeline.time() + 0.3)
            g.world.visualVehicle.update(); g.world.rivals.items[0].visual.update()
            g.world.floor.update(); g.world.waterSurface.update()
        })
        const renderFrames = () => page.evaluate(() => new Promise(resolve => {
            const g = window.playGame
            let frames = 0
            g.rendering.renderer.setAnimationLoop(() => {
                g.rendering.render()
                if(++frames === 3) { g.rendering.renderer.setAnimationLoop(null); resolve() }
            })
        }))
        await renderFrames()
        await page.screenshot({ path: path.join(output, 'impact-explosion.png') })
        const visual = await page.evaluate(() => {
            const g = window.playGame, player = g.physicalVehicle, bot = g.world.rivals.items[0].vehicle
            for(let i = 0; i < 45; i++) {
                g.ticker.delta = g.ticker.deltaAverage = 1 / 60; g.ticker.deltaScaled = 1 / 30
                player.updatePrePhysics(); bot.updatePrePhysics(); g.physics.update()
                player.updatePostPhysics(); bot.updatePostPhysics()
                g.world.combat.updateFlights(); g.view.update()
            }
            window.gameplayGsap.globalTimeline.time(window.gameplayGsap.globalTimeline.time() + 0.4)
            g.world.visualVehicle.update(); g.world.rivals.items[0].visual.update()
            g.world.floor.update(); g.world.waterSurface.update()
            return { radius: g.view.spherical.radius.current, trailIndices: g.world.combat.shot.mesh.geometry.drawRange.count, height: bot.position.y - bot.launch.origin.y }
        })
        await renderFrames()
        await page.screenshot({ path: path.join(output, 'impact-flight.png') })
        console.log('Rendered impact preview:', visual)
        assert.ok(visual.radius > 50 && visual.trailIndices > 100 && visual.height > 8)
        assert.deepEqual(errors, [])
        assert.deepEqual(missing, [])
        console.log('PASS: real pickups for player/AI, caps, measured speed ratios, front/rear heavy impacts, double jump and air control, impact slow motion and recovery.')
    } finally {
        if(browser) await browser.close()
        server.kill()
    }
})().catch(error => { console.error(error); process.exitCode = 1 })
