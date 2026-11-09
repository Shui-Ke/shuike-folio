const { chromium } = require('C:/Users/KLJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const assert = require('node:assert/strict')

;(async () => {
    const root = path.resolve(__dirname, '..')
    const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4191', '--strictPort', '--open=false'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    let browser
    try {
        for(let i = 0; i < 60; i++) { try { if((await fetch('http://127.0.0.1:4191')).ok) break } catch {} await new Promise(r => setTimeout(r, 200)) }
        browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if(message.type() === 'error') errors.push(message.text()) })
        await page.route('**/index.js*', async route => {
            if(new URL(route.request().url()).pathname !== '/index.js') return route.continue()
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + '\nwindow.mapGame=Game.getInstance();' })
        })
        await page.route('**/Game/World/MapExpansion.js*', async route => {
            const response = await route.fetch()
            await route.fulfill({ response, body: await response.text() + `
const prepareMap = MapExpansion.prepare;
MapExpansion.prepare = function(game) {
    const scene = game.resources.sceneryModel.scene;
    scene.updateMatrixWorld(true);
    const samples = [];
    scene.traverse(mesh => {
        if(!mesh.geometry || /^(cuboid|hull|tube|ball)/i.test(mesh.name)) return;
        const positions = mesh.geometry.attributes.position;
        const points = Array.from({length: positions.count}, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
        samples.push({mesh, points});
    });
    prepareMap(game);
    let error = 0;
    for(const {mesh, points} of samples) points.forEach((before, i) => {
        const after = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld);
        error = Math.max(error, Math.abs(after.y - before.y), Math.abs(after.x - before.x * MAP_SCALE), Math.abs(after.z - before.z * MAP_SCALE));
    });
    game.mapExpansion.sceneryTransformError = error;
};` })
        })
        await page.goto('http://127.0.0.1:4191/?time=0.05#skip')
        await page.waitForFunction(() => window.mapGame?.world?.powerups?.started && window.mapGame.world.rivals.started, null, { timeout: 150000 })
        await page.waitForFunction(() => window.mapGame.physicalVehicle.wheels.inContactCount >= 2)
        await page.screenshot({ path: path.join(root, 'previews/expanded-map-driving.png') })
        const result = await page.evaluate(() => {
            const g = window.mapGame, player = g.physicalVehicle, lake = g.water.lake, nav = g.world.powerups.navigation
            g.rendering.renderer.setAnimationLoop(null)
            for(const v of g.world.vehicleDamage.records.keys()) { g.world.items.reset(v); g.world.items.state(v).nextAI = Infinity; v.deactivate() }
            player.activate()
            const cars = [...g.world.vehicleDamage.records.values()].map(({ vehicle, visual }) => ({ scale: vehicle.scale, visual: visual.parts.chassis.scale.toArray(), half: { ...vehicle.chassis.physical.colliders[0].halfExtents() }, wheelRadius: vehicle.wheels.settings.radius }))
            const lakeFloor = nav.groundAt(lake.x, lake.z)
            const shore = nav.groundAt(lake.x + lake.radiusX * 0.98, lake.z)
            const warningCount = g.world.oceanBoundary.segments.filter(([a]) => g.water.lakeDistance(a.x, a.z) < 0.9).length
            const tick = () => {
                g.ticker.delta = g.ticker.deltaAverage = 1/60; g.ticker.deltaScaled = 1/30; g.ticker.elapsed += 1/60
                player.updatePrePhysics(); g.physics.update(); player.updatePostPhysics(); g.world.vehicleDamage.update()
            }
            Object.assign(player.controls, { accelerating: 0, boosting: 0, braking: 0, steering: 0 })
            player.moveTo(player.position.clone().set(lake.x + lake.radiusX * 0.98, 2, lake.z))
            for(let i = 0; i < 120; i++) tick()
            const shoreSurvives = !player.destroyed
            player.moveTo(player.position.clone().set(lake.x, 4, lake.z))
            let ticks = 0
            while(!player.destroyed && ticks++ < 240) tick()
            const submergedDestroyed = player.destroyed
            g.world.vehicleDamage.revive(player); g.player.state = 1
            player.moveTo(g.respawns.getDefault().position, 0)
            for(let i = 0; i < 60; i++) tick()
            g.world.visualVehicle.update()
            const painted = g.world.visualVehicle.parts.bodyPainted
            painted.updateWorldMatrix(true, false)
            const visualTop = painted.geometry.boundingBox.clone().applyMatrix4(painted.matrixWorld).max.y
            const damageTop = g.world.vehicleDamage.highestBodyPoint(g.world.vehicleDamage.records.get(player))
            // Pull back over the lake to inspect its shore, deep center and band.
            const framing = g.world.combat.framing
            framing.blend = 1; framing.focus.set(lake.x, 0, lake.z); framing.distance = 40
            g.view.focusPoint.smoothedPosition.copy(framing.focus)
            g.view.update(); g.world.floor.update(); g.world.waterSurface.update(); g.world.grass.update()
            return { area: (g.terrain.size / 192) ** 2, size: g.terrain.size, added: g.mapExpansion.added, cars, lakeFloor, shore, warningCount, shoreSurvives, submergedDestroyed, sinkTicks: ticks, roofError: Math.abs(visualTop - damageTop), pickups: g.world.powerups.items.length }
        })
        console.log(JSON.stringify(result, null, 2))
        const sceneryError = await page.evaluate(() => window.mapGame.mapExpansion.sceneryTransformError)
        assert.ok(sceneryError < 0.0001, `Scenery must expand horizontally without lifting rocks: ${sceneryError}`)
        assert.ok(Math.abs(result.area - 2) < 1e-8)
        assert.ok(result.added.trees >= 36 && result.added.crates === 24 && result.added.bricks === 48)
        assert.ok(result.cars.every(car => car.scale === 1.25 && car.visual.every(n => Math.abs(n - 1.25) < 0.001) && Math.abs(car.half.x - 1.625) < 0.001 && car.wheelRadius === 0.5))
        assert.ok(result.lakeFloor < -7 && result.shore > -0.3 && result.warningCount > 20)
        assert.ok(result.shoreSurvives && result.submergedDestroyed && result.roofError < 0.05 && result.pickups === 40)
        const render = () => page.evaluate(() => new Promise(resolve => { const g = window.mapGame; let frames = 0; g.rendering.renderer.setAnimationLoop(() => { g.rendering.render(); if(++frames === 3) { g.rendering.renderer.setAnimationLoop(null); resolve() } }) }))
        await render()
        await page.screenshot({ path: path.join(root, 'previews/expanded-lake.png') })
        await page.evaluate(() => {
            const g = window.mapGame, framing = g.world.combat.framing
            framing.focus.set(57 * g.mapExpansion.scale, 0, 50 * g.mapExpansion.scale); framing.distance = 30
            g.view.focusPoint.smoothedPosition.copy(framing.focus)
            g.view.update(); g.world.floor.update(); g.world.waterSurface.update(); g.world.grass.update()
        })
        await render()
        await page.screenshot({ path: path.join(root, 'previews/grounded-rocks.png') })
        assert.deepEqual(errors, [])
        console.log('PASS: doubled map area, added native props, deep lake destruction, safe shallows, warning contour and 1.25x visual/physical cars.')
    } finally { if(browser) await browser.close(); server.kill() }
})().catch(error => { console.error(error); process.exitCode = 1 })
