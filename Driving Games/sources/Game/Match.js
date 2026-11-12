import gsap from 'gsap'
import { Game } from './Game.js'
import { Player } from './Player.js'
import { i18n, t } from './I18n.js'

// Lives / match end. Easy is the only difficulty that grants a second car;
// every other difficulty ends the run on the first destruction.
export class Match
{
    constructor()
    {
        this.game = Game.getInstance()
        this.maxLives = 1 + (this.game.config?.revives ?? 0)
        this.lives = this.maxLives
        this.ended = false
        this.result = null
        this.buildHud()
        this.buildResult()
        this.game.ticker.events.on('tick', () => this.update(), 9)
        i18n.events.on('change', () => this.syncLanguage())
    }

    get canRevive()
    {
        return !this.ended && this.lives > 0 && this.game.physicalVehicle.destroyed
    }

    // Difficulty is chosen after this object exists, so the life budget is
    // (re)computed when the match actually starts.
    reset()
    {
        this.maxLives = 1 + (this.game.config?.revives ?? 0)
        this.lives = this.maxLives
        this.ended = false
        this.result = null
        this.element.hidden = true
        document.documentElement.classList.remove('match-ended')
        this.syncHud()
    }

    buildHud()
    {
        this.hud = document.createElement('div')
        this.hud.className = 'match-hud'
        this.hud.hidden = true
        this.hud.innerHTML = `<span class="match-hud__label">${t('match.lives')}</span><span class="match-hud__lives"></span>`
        this.livesElement = this.hud.querySelector('.match-hud__lives')
        this.game.domElement.append(this.hud)
        this.syncHud()
    }

    buildResult()
    {
        const element = document.createElement('div')
        element.className = 'match-overlay'
        element.hidden = true
        element.innerHTML = `
            <div class="match-overlay__backdrop"></div>
            <section class="match-panel" role="dialog" aria-modal="true" aria-labelledby="match-title">
                <div class="match-panel__eyebrow" data-match-eyebrow>MATCH OVER</div>
                <h2 class="match-panel__title" id="match-title" data-match-title>${t('match.titleLost')}</h2>
                <p class="match-panel__text" data-match-text>${t('match.textLost')}</p>
                <p class="match-panel__meta" data-match-meta></p>
                <div class="match-panel__actions">
                    <button class="match-button match-button--primary" type="button" data-match-retry>${t('match.retry')}</button>
                    <button class="match-button" type="button" data-match-setup>${t('match.changeSetup')}</button>
                </div>
            </section>
        `
        element.querySelector('[data-match-retry]').addEventListener('click', () => this.retry())
        element.querySelector('[data-match-setup]').addEventListener('click', () => this.changeSetup())
        for(const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchend', 'touchmove', 'wheel'])
            element.addEventListener(type, event => event.stopPropagation())

        this.element = element
        this.game.domElement.append(element)
    }

    syncHud()
    {
        const total = Math.max(1, this.maxLives)
        this.livesElement.innerHTML = Array.from({ length: total }, (_, index) =>
            `<i class="${index < this.lives ? 'is-full' : ''}"></i>`).join('')
    }

    syncHint()
    {
        const hint = this.game.world.vehicleDamage?.hint
        if(!hint)
            return

        hint.hidden = false
        const button = hint.querySelector('button')
        if(button)
            button.textContent = t('match.reviveHint', { lives: this.lives })
    }

    hideHint()
    {
        const hint = this.game.world.vehicleDamage?.hint
        if(hint)
            hint.hidden = true
    }

    playerDestroyed()
    {
        if(this.ended)
            return

        this.lives = Math.max(0, this.lives - 1)
        this.syncHud()

        if(this.lives > 0)
        {
            this.syncHint()
            return
        }

        // Let the wreck and the dust read for a beat before the result panel.
        // If the car is revived in the meantime (debug tools, external calls)
        // the match simply continues.
        gsap.delayedCall(1.2, () =>
        {
            if(!this.ended && this.game.physicalVehicle.destroyed)
                this.end('lost')
        })
    }

    revive()
    {
        if(!this.canRevive)
            return false

        this.hideHint()
        this.game.player.respawn()
        return true
    }

    botDestroyed()
    {
        if(this.ended)
            return

        const rivals = this.game.world.rivals
        const bots = rivals?.items ?? []
        if(bots.length && bots.every(bot => bot.vehicle.destroyed && !rivals.canReviveBot(bot)))
        {
            // Let the final wreck land before taking the frame.
            gsap.delayedCall(0.9, () =>
            {
                if(!this.ended)
                    this.end('won')
            })
        }
    }

    end(result)
    {
        if(this.ended)
            return

        this.ended = true
        this.result = result
        this.hideHint()
        this.syncHud()
        this.game.escMenu?.close()

        if(result === 'won')
            this.game.player.state = Player.STATE_LOCKED

        this.syncResult()
        this.element.hidden = false
        document.documentElement.classList.add('match-ended')
    }

    syncResult()
    {
        const title = this.element.querySelector('[data-match-title]')
        const eyebrow = this.element.querySelector('[data-match-eyebrow]')
        const text = this.element.querySelector('[data-match-text]')
        const meta = this.element.querySelector('[data-match-meta]')
        const difficulty = t(`difficulty.${this.game.config.difficulty}`)

        if(this.result === 'won')
        {
            eyebrow.textContent = 'MATCH WON'
            title.textContent = t('match.titleWon')
            text.textContent = t('match.textWon')
        }
        else
        {
            eyebrow.textContent = 'MATCH OVER'
            title.textContent = t('match.titleLost')
            text.textContent = this.lives > 0 ? t('match.textLost') : t('match.textLostLives')
        }

        meta.textContent = t('match.meta', { difficulty, lives: this.lives, maxLives: this.maxLives })
    }

    syncLanguage()
    {
        this.hud.querySelector('.match-hud__label').textContent = t('match.lives')
        this.element.querySelector('[data-match-retry]').textContent = t('match.retry')
        this.element.querySelector('[data-match-setup]').textContent = t('match.changeSetup')

        if(this.ended)
            this.syncResult()

        const hint = this.game.world.vehicleDamage?.hint
        if(hint && !hint.hidden)
            this.syncHint()
    }

    retry()
    {
        const url = new URL(location.href)
        url.hash = 'skip'
        history.replaceState(null, '', url.href)
        location.reload()
    }

    changeSetup()
    {
        const url = new URL(location.href)
        url.hash = ''
        history.replaceState(null, '', url.href)
        location.reload()
    }

    update()
    {
        if(this.game.setupScreen?.isOpen)
        {
            this.hud.hidden = true
            return
        }

        this.hud.hidden = this.game.reveal.step !== 2 || this.ended
    }
}
