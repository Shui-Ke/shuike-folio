import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

// Edge markers for rivals that are outside the camera frustum. Each marker is
// tinted with the rival paint and points toward where that car actually is.
const MARGIN = 38
const SPREAD = 16

export class BotRadar
{
    constructor(game)
    {
        this.game = game ?? Game.getInstance()
        this.markers = new Map()
        this.toTarget = new THREE.Vector3()
        this.cameraForward = new THREE.Vector3()
        this.point = new THREE.Vector3()

        this.container = document.createElement('div')
        this.container.className = 'bot-radar'
        this.game.domElement.append(this.container)

        this.game.ticker.events.on('tick', () => this.update(), 8)
    }

    create(bot)
    {
        const element = document.createElement('div')
        element.className = 'bot-marker'
        element.style.setProperty('--marker-color', bot.colorCss ?? '#ffffff')
        element.hidden = true
        this.container.append(element)
        this.markers.set(bot, element)
        return element
    }

    update()
    {
        const game = this.game
        const bots = game.world.rivals?.items ?? []

        // Cars only exist after the match starts; keep the DOM in sync.
        for(const [bot, element] of this.markers)
        {
            if(!bots.includes(bot))
            {
                element.remove()
                this.markers.delete(bot)
            }
        }

        const active = game.reveal.step === 2 && !game.escMenu?.isOpen && !game.match?.ended && !game.setupScreen?.isOpen
        if(!active)
        {
            for(const element of this.markers.values())
                element.hidden = true
            return
        }

        const camera = game.view.camera
        // Rendering runs after the HUD ticks; refresh the view matrix here so
        // edge markers line up with the frame that is about to be drawn.
        camera.updateMatrixWorld()
        this.cameraForward.set(0, 0, -1).applyQuaternion(camera.quaternion)

        const halfWidth = window.innerWidth / 2
        const halfHeight = window.innerHeight / 2
        const maxX = Math.max(8, halfWidth - MARGIN)
        const maxY = Math.max(8, halfHeight - MARGIN)

        for(const bot of bots)
        {
            let element = this.markers.get(bot)
            if(!element)
                element = this.create(bot)

            if(bot.vehicle.destroyed || bot.state === 'waiting')
            {
                element.hidden = true
                continue
            }

            this.toTarget.copy(bot.vehicle.position).sub(camera.position)
            const behind = this.toTarget.dot(this.cameraForward) < 0

            this.point.copy(bot.vehicle.position)
            this.point.y += 1.5
            this.point.project(camera)

            let dx = this.point.x
            let dy = - this.point.y
            if(behind)
            {
                dx = - dx
                dy = - dy
            }

            // Behind the camera with a centred projection: aim straight down.
            if(Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5)
                dy = 1

            if(!behind && Math.abs(this.point.x) <= 1 && Math.abs(this.point.y) <= 1)
            {
                element.hidden = true
                continue
            }

            const length = Math.hypot(dx, dy)
            const scale = Math.min(maxX / Math.max(1e-5, Math.abs(dx)), maxY / Math.max(1e-5, Math.abs(dy)))
            // Fan same-direction markers so a 7-car pack does not stack into one.
            const count = Math.max(1, bots.length)
            const spread = (bot.index - (count - 1) / 2) * (SPREAD * 0.6)
            const x = halfWidth + dx * scale - (dy / length) * spread
            const y = halfHeight + dy * scale + (dx / length) * spread

            element.hidden = false
            element.style.left = `${x}px`
            element.style.top = `${y}px`
            element.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`
        }
    }
}
