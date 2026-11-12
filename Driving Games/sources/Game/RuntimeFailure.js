// Preserve the first failure: subsequent Rapier errors can obscure its cause.
export class RuntimeFailure
{
    constructor(game) { this.game = game; this.report = null }

    capture(error, phase)
    {
        if(this.report) return
        const game = this.game
        this.report = {
            time: new Date().toISOString(), phase,
            message: error?.message ?? String(error), stack: error?.stack ?? '',
            delta: game.ticker?.delta, deltaScaled: game.ticker?.deltaScaled,
            difficulty: game.config?.difficulty,
            rivals: game.world?.rivals?.items.map(bot => ({
                index: bot.index, state: bot.state, lives: bot.lives,
                destroyed: bot.vehicle.destroyed, position: bot.vehicle.position.toArray(),
            })) ?? [],
        }
        // Only plain JS state above: a failed WASM world may reject further reads.
        try { sessionStorage.setItem('driving-games:last-runtime-failure', JSON.stringify(this.report)) } catch {}
        console.error('[Driving Games] First runtime failure', this.report)
        game.rendering?.renderer.setAnimationLoop(null)

        const panel = document.createElement('div')
        panel.setAttribute('role', 'alert')
        panel.style.cssText = 'position:fixed;z-index:10000;inset:50% auto auto 50%;transform:translate(-50%,-50%);width:min(360px,85vw);padding:24px;border:3px solid #171714;background:#fff9e9;color:#171714;box-shadow:8px 8px 0 #171714;font:16px sans-serif;pointer-events:auto'
        const title = document.createElement('strong')
        title.textContent = '游戏运行中断'
        const description = document.createElement('p')
        description.textContent = '错误信息已保留。可以复制错误信息以便排查，或重新载入游戏。'
        const copy = document.createElement('button')
        copy.textContent = '复制错误信息'
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(JSON.stringify(this.report, null, 2)); copy.textContent = '已复制' }
            catch { description.textContent = JSON.stringify(this.report); description.style.cssText = 'max-height:35vh;overflow:auto;user-select:text;word-break:break-all' }
        }
        const reload = document.createElement('button')
        reload.textContent = '重新载入'
        reload.onclick = () => location.reload()
        panel.append(title, description, copy, reload)
        document.body.append(panel)
    }
}
