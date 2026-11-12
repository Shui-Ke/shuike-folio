import { Game } from './Game.js'
import { PAINTS, ITEM_PRESETS, DIFFICULTIES, pickupTotalFor } from './Config.js'
import { t } from './I18n.js'

// Pre-match setup shown where the old "click to start" prompt was. Everything
// it writes lives in Config, so the world is built from one source of truth and
// the same values can be restored from the URL.
export class SetupScreen
{
    constructor()
    {
        this.game = Game.getInstance()
        this.isOpen = false
        this.values = { ...this.game.config.values }
        this.onConfirm = null
        this.build()
    }

    build()
    {
        const element = document.createElement('div')
        element.className = 'setup-screen'
        element.hidden = true
        element.innerHTML = `
            <div class="setup-screen__backdrop"></div>
            <section class="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
                <header class="setup-panel__header">
                    <div class="setup-panel__eyebrow">DRIVING GAMES / MATCH SETUP</div>
                    <h1 class="setup-panel__title" id="setup-title">${t('setup.title')}</h1>
                    <p class="setup-panel__lead">${t('setup.lead')}</p>
                </header>

                <div class="setup-grid">
                    <section class="setup-field" data-setup-field="paint">
                        <h2>${t('setup.paint')}</h2>
                        <div class="setup-swatches" role="group" aria-label="${t('setup.paintAria')}">
                            ${PAINTS.map(paint => `
                                <button class="setup-swatch" type="button" data-value="${paint.name}" aria-pressed="false">
                                    <span class="setup-swatch__chip" style="--paint-top:${paint.top};--paint-bottom:${paint.bottom}"></span>
                                    <span>${t(`paint.${paint.name}`)}</span>
                                </button>`).join('')}
                        </div>
                    </section>

                    <section class="setup-field" data-setup-field="bots">
                        <h2>${t('setup.bots')}</h2>
                        <div class="setup-choices" role="group" aria-label="${t('setup.botsAria')}">
                            ${[0, 1, 2, 3, 4, 5, 6, 7].map(count => `
                                <button class="setup-choice" type="button" data-value="${count}" aria-pressed="false">
                                    <b>${count}</b><small>${count === 0 ? t('setup.solo') : count === 1 ? t('setup.car') : t('setup.cars', { count })}</small>
                                </button>`).join('')}
                        </div>
                    </section>

                    <section class="setup-field" data-setup-field="difficulty">
                        <h2>${t('setup.difficulty')}</h2>
                        <div class="setup-cards" role="group" aria-label="${t('setup.difficultyAria')}">
                            ${Object.keys(DIFFICULTIES).map(name => `
                                <button class="setup-card" type="button" data-value="${name}" aria-pressed="false">
                                    <b>${t(`difficulty.${name}`)}</b>
                                    <small>${t(`difficulty.${name}Desc`)}</small>
                                </button>`).join('')}
                        </div>
                    </section>

                    <section class="setup-field" data-setup-field="items">
                        <h2>${t('setup.items')}</h2>
                        <div class="setup-choices setup-choices--wide" role="group" aria-label="${t('setup.itemsAria')}">
                            ${ITEM_PRESETS.map(preset => `
                                <button class="setup-choice" type="button" data-value="${preset.perType}" aria-pressed="false">
                                    <b>${t(`items.${preset.perType}`)}</b><small>${t('setup.itemsCount', { count: pickupTotalFor(preset.perType) })}</small>
                                </button>`).join('')}
                        </div>
                    </section>
                </div>

                <footer class="setup-panel__footer">
                    <p class="setup-panel__hint">${t('setup.hint')}</p>
                    <button class="setup-start" type="button" data-setup-start>${t('setup.start')}</button>
                </footer>
            </section>
        `

        // Keep pointer input away from the 3D scene while the overlay is up.
        for(const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchend', 'touchmove', 'wheel'])
            element.addEventListener(type, event => event.stopPropagation())

        for(const button of element.querySelectorAll('[data-setup-field] [data-value]'))
        {
            button.addEventListener('click', () =>
            {
                const field = button.closest('[data-setup-field]').dataset.setupField
                this.values[field] = field === 'bots' || field === 'items' ? Number(button.dataset.value) : button.dataset.value

                // Extreme is built around a 3-chase / 2-farm split.
                if(field === 'difficulty' && this.values.difficulty === 'extreme' && this.values.bots < 5)
                    this.values.bots = 5

                this.sync()
            })
        }

        element.querySelector('[data-setup-start]').addEventListener('click', () => this.confirm())

        this.element = element
        this.startButton = element.querySelector('[data-setup-start]')
        this.game.domElement.append(element)
    }

    sync()
    {
        for(const field of this.element.querySelectorAll('[data-setup-field]'))
        {
            const key = field.dataset.setupField
            const current = this.values[key]
            for(const button of field.querySelectorAll('[data-value]'))
            {
                const value = key === 'bots' || key === 'items' ? Number(button.dataset.value) : button.dataset.value
                const active = value === current
                button.classList.toggle('is-active', active)
                button.setAttribute('aria-pressed', String(active))
            }
        }
    }

    open(onConfirm)
    {
        if(this.isOpen)
            return

        this.onConfirm = onConfirm
        this.values = { ...this.game.config.values }
        this.sync()
        this.element.hidden = false
        this.isOpen = true
        document.documentElement.classList.add('setup-open')
        this.startButton.focus({ preventScroll: true })
    }

    close()
    {
        if(!this.isOpen)
            return

        this.isOpen = false
        this.element.hidden = true
        document.documentElement.classList.remove('setup-open')
        this.startButton.blur()
    }

    confirm()
    {
        if(!this.isOpen)
            return

        const values = { ...this.values }
        this.game.mobileOrientation?.requestLandscape()
        this.close()
        this.onConfirm?.(values)
    }
}
