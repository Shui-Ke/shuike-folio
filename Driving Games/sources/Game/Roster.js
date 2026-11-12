import { Game } from './Game.js'
import { PAINTS } from './Config.js'
import { i18n, t } from './I18n.js'

const BOT_LABELS = {
    blue: 'Blue',
    yellow: 'Yellow',
    purple: 'Purple',
    cyan: 'Cyan',
    green: 'Green',
    pink: 'Pink',
    lime: 'Lime',
}

// Small right-side board: who is still driving, and how many lives are left.
export class Roster
{
    constructor(game)
    {
        this.game = game ?? Game.getInstance()
        this.rows = []
        this.paintKey = null
        this.build()
        this.game.ticker.events.on('tick', () => this.update(), 8)
        i18n.events.on('change', () => this.rebuild())
    }

    build()
    {
        this.element = document.createElement('div')
        this.element.className = 'match-roster'
        this.element.hidden = true
        this.element.innerHTML = `
            <div class="match-roster__title">
                <span>${t('roster.alive')}</span><b data-roster-alive>0</b><span>/</span><b data-roster-total>0</b>
            </div>
            <ul class="match-roster__list"></ul>
        `
        this.list = this.element.querySelector('.match-roster__list')
        this.titleLabel = this.element.querySelector('.match-roster__title span')
        this.aliveElement = this.element.querySelector('[data-roster-alive]')
        this.totalElement = this.element.querySelector('[data-roster-total]')
        this.game.domElement.append(this.element)
    }

    addRow(vehicle, label, color, isPlayer, bot = null)
    {
        const row = document.createElement('li')
        row.className = `match-roster__row${isPlayer ? ' is-player' : ''}`
        row.innerHTML = `<i style="--dot:${color}"></i><span>${label}</span><b></b>`
        this.list.append(row)
        const item = { vehicle, bot, isPlayer, status: row.querySelector('b'), state: null, row }
        this.rows.push(item)
        return item
    }

    rebuild()
    {
        this.list.innerHTML = ''
        this.rows = []
        this.titleLabel.textContent = t('roster.alive')

        const paint = PAINTS.find(item => item.name === this.game.config.paint) ?? PAINTS[0]
        this.addRow(this.game.physicalVehicle, t('roster.you'), paint.top, true)

        for(const bot of this.game.world.rivals?.items ?? [])
            this.addRow(bot.vehicle, BOT_LABELS[bot.color] ?? bot.color, bot.colorCss ?? '#ffffff', false, bot)

        this.paintKey = this.game.config.paint
    }

    update()
    {
        const game = this.game
        const active = game.reveal.step === 2 && !game.escMenu?.isOpen && !game.setupScreen?.isOpen && !game.match?.ended
        if(!active)
        {
            this.element.hidden = true
            return
        }

        const bots = game.world.rivals?.items ?? []
        if(this.rows.length !== bots.length + 1 || this.paintKey !== game.config.paint)
            this.rebuild()

        this.element.hidden = false

        let alive = 0
        for(const item of this.rows)
        {
            const destroyed = item.vehicle.destroyed
            let state
            let text

            if(item.isPlayer)
            {
                item.lives = game.match?.lives ?? 1
                if(!destroyed)
                {
                    state = 'alive'
                    text = `×${item.lives}`
                    alive++
                }
                else if(game.match?.canRevive)
                {
                    state = 'revive'
                    text = t('roster.awaiting')
                }
                else
                {
                    state = 'dead'
                    text = t('roster.eliminated')
                }
            }
            else
            {
                const bot = item.bot
                const spareLife = !!bot && (game.world.rivals?.canReviveBot?.(bot) ?? false)

                if(!destroyed)
                {
                    state = 'alive'
                    const parts = [t('roster.alive')]
                    if(bot && this.game.config.profile?.chaseSquad)
                        parts.push(bot.role === 'chase' ? t('roster.chase') : t('roster.collect'))
                    if(bot && bot.lives > 1)
                        parts.push(`×${bot.lives}`)
                    text = parts.join('·')
                    alive++
                }
                else if(spareLife)
                {
                    // Waiting out the two-second respawn with a spare life.
                    state = 'revive'
                    text = t('roster.reviving')
                    alive++
                }
                else
                {
                    state = 'dead'
                    text = t('roster.eliminated')
                }
            }

            if(item.state !== state)
            {
                item.state = state
                item.row.classList.toggle('is-dead', state === 'dead')
                item.row.classList.toggle('is-revive', state === 'revive')
            }

            if(item.status.textContent !== text)
                item.status.textContent = text
        }

        const total = String(this.rows.length)
        if(this.aliveElement.textContent !== String(alive))
            this.aliveElement.textContent = String(alive)
        if(this.totalElement.textContent !== total)
            this.totalElement.textContent = total
    }
}
