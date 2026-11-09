
import { Game } from './Game.js'
import gsap from 'gsap'
import { clamp, remap } from './utilities/maths.js'

export class Time
{
    constructor()
    {
        this.game = Game.getInstance()

        this.defaultScale = 2
        this._scale = this.defaultScale
        this.game.ticker.scale = this.scale
        gsap.globalTimeline.timeScale(this.scale)

        this.setBulletTime()
        this.impactRemaining = 0
        this.impactDuration = 0.34

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 0)

        // Debug
        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '⏱️ Time',
                expanded: false,
            })
            this.debugPanel.addBinding(this, 'defaultScale', { min: 0, max: 5, step: 0.01 })
            this.debugPanel.addButton({ title: 'bullet time' }).on('click', () => { this.bulletTime.activate() })
        }
    }

    setBulletTime()
    {
        this.bulletTime = {}
        this.bulletTime.active = false
        this.bulletTime.endTime = null
        this.bulletTime.scale = 0.5
        this.bulletTime.progress = 0
        this.bulletTime.inSpeed = 3
        this.bulletTime.outSpeed = 0.3
        this.bulletTime.activate = (duration = 1.5) =>
        {
            if(this.bulletTime.active)
            {
                const newEndTime = Date.now() + duration * 1000
                this.bulletTime.endTime = Math.max(this.bulletTime.endTime, newEndTime)
            }
            else
            {
                this.bulletTime.endTime = Date.now() + duration * 1000
            }
            
            this.bulletTime.active = true
        }
    }

    impact(duration = 0.34)
    {
        this.impactDuration = duration
        this.impactRemaining = duration
    }

    update()
    {
        if(Date.now() > this.bulletTime.endTime)
            this.bulletTime.active = false

        const speed = this.bulletTime.active ? this.bulletTime.inSpeed : this.bulletTime.outSpeed
        this.bulletTime.progress += (this.bulletTime.active ? 1 : - 1) * this.game.ticker.delta * speed
        this.bulletTime.progress = clamp(this.bulletTime.progress, 0, 1)

        this.impactRemaining = Math.max(0, this.impactRemaining - this.game.ticker.delta)
        const impactRatio = this.impactRemaining > 0.14 ? 0.22 : 1 - 0.78 * this.impactRemaining / 0.14
        this.scale = remap(this.bulletTime.progress, 0, 1, this.defaultScale, this.bulletTime.scale) * impactRatio
        // console.log(this.bulletTime.progress)
    }

    set scale(value)
    {
        this._scale = value
        this.game.ticker.scale = this.scale
        gsap.globalTimeline.timeScale(value)
    }

    get scale()
    {
        return this._scale
    }
}
