import gsap from 'gsap'
import { i18n, t } from './I18n.js'

export class MobileOrientation
{
    constructor(game)
    {
        this.game = game
        this.blocked = false
        this.pauseHeld = false
        this.element = document.createElement('div')
        this.element.className = 'rotate-screen'
        this.element.hidden = true
        this.element.innerHTML = `<section class="rotate-screen__panel" role="dialog" aria-modal="true" aria-labelledby="rotate-title">
            <div class="rotate-screen__phone" aria-hidden="true">↻</div>
            <h2 id="rotate-title">${t('rotate.title')}</h2>
            <p data-rotate-message>${t('rotate.message')}</p>
            <button type="button">${t('rotate.button')}</button>
        </section>`
        game.domElement.append(this.element)
        this.element.querySelector('button').addEventListener('click', () => this.requestLandscape())
        i18n.events.on('change', () => this.syncLanguage())
        for(const name of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click'])
            this.element.addEventListener(name, event => event.stopPropagation())
        window.addEventListener('resize', () => this.update())
        window.addEventListener('orientationchange', () => this.update())
        document.addEventListener('fullscreenchange', () => this.update())
        this.update()
    }

    isMobile()
    {
        return matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) <= 900
    }

    update()
    {
        const mobile = this.isMobile()
        const wasBlocked = this.blocked
        this.blocked = mobile && innerHeight > innerWidth
        if(this.blocked && !wasBlocked && this.game.inputs?.pointer) {
            // Rotation can cancel a finger without delivering its release to
            // the canvas. Resume with a neutral joystick, not a stuck throttle.
            this.game.inputs.pointer.upcomingDown = false
            this.game.inputs.pointer.upcomingTouches = []
            if(this.game.inputs.nipple) {
                this.game.inputs.nipple.active = false
                this.game.inputs.nipple.inRadiusLow = false
            }
        }
        this.element.hidden = !this.blocked
        document.documentElement.classList.toggle('mobile-landscape', mobile)
        document.documentElement.classList.toggle('rotate-required', this.blocked)
        this.syncPause()
    }

    syncPause()
    {
        const pause = this.blocked && this.game.reveal?.step === 2
        if(pause && !this.pauseHeld) {
            this.wasPaused = gsap.globalTimeline.paused()
            gsap.globalTimeline.pause()
            this.pauseHeld = true
        }
        else if(!pause && this.pauseHeld) {
            if(!this.wasPaused) gsap.globalTimeline.resume()
            this.pauseHeld = false
        }
    }

    syncLanguage()
    {
        this.element.querySelector('#rotate-title').textContent = t('rotate.title')
        this.element.querySelector('[data-rotate-message]').textContent = t('rotate.message')
        this.element.querySelector('button').textContent = t('rotate.button')
    }

    async requestLandscape()
    {
        if(!this.isMobile() || this.requesting) return
        this.requesting = true
        try {
            // Fullscreen is required by many mobile browsers for orientation lock.
            if(!document.fullscreenElement && document.documentElement.requestFullscreen)
                await document.documentElement.requestFullscreen()
            if(screen.orientation?.lock) await screen.orientation.lock('landscape')
        }
        catch { /* Manual rotation remains available when the browser rejects locking. */ }
        finally {
            this.requesting = false
            this.update()
            if(this.blocked) this.element.querySelector('[data-rotate-message]').textContent = t('rotate.blocked')
        }
    }
}
