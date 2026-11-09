import { Howler } from 'howler'

const STORAGE_KEY = 'landscape-test:settings'

const TIME_PRESETS = {
    noon: 0.05,
    dusk: 0.25,
    night: 0.45,
    dawn: 0.8
}

const WEATHER_PRESETS = {
    clear: {
        values: { rain: 0, snow: 0, clouds: 0.1, humidity: 0.35, wind: 0.3, temperature: 22, storm: 0 }
    },
    dust: {
        values: { rain: 0, snow: 0, clouds: 0.55, humidity: 0.2, wind: 1, temperature: 34, storm: 0 }
    },
    rain: {
        values: { rain: 1, snow: 0, clouds: 1, humidity: 1, wind: 0.55, temperature: 15, storm: 0 }
    },
    snow: {
        values: { rain: 0.5, snow: 1, clouds: 1, humidity: 1, wind: 0.4, temperature: -8, storm: 0 }
    },
    storm: {
        values: { rain: 1, snow: 0, clouds: 1, humidity: 1, wind: 1, electricField: 1, temperature: 13, storm: 1 }
    }
}

export class EscMenu
{
    constructor(game)
    {
        this.game = game
        this.isOpen = false
        this.timeDragging = false
        this.previousFilters = []
        this.previousPlayerState = null
        this.settings = this.loadSettings()
        this.currentWeatherPreset = null

        this.build()
        this.bind()
        this.applyVolume(this.settings.volume, false)
        this.syncAll()

        this.liveTimer = window.setInterval(() =>
        {
            if(this.isOpen)
                this.syncLive()
        }, 250)
    }

    build()
    {
        const menu = document.createElement('div')
        menu.className = 'esc-menu'
        menu.hidden = true
        menu.innerHTML = `
            <div class="esc-menu__backdrop" data-esc-close></div>
            <section class="esc-menu__panel" role="dialog" aria-modal="true" aria-labelledby="esc-menu-title">
                <header class="esc-menu__header">
                    <div>
                        <div class="esc-menu__eyebrow">LANDSCAPE TEST / PAUSE</div>
                        <h2 class="esc-menu__title" id="esc-menu-title">World settings</h2>
                    </div>
                    <button class="esc-menu__close" type="button" data-esc-close aria-label="Close settings">×</button>
                </header>

                <div class="esc-menu__layout">
                    <nav class="esc-menu__nav" aria-label="Settings sections">
                        <button class="esc-tab is-active" type="button" data-esc-tab="time"><span>01</span>Time</button>
                        <button class="esc-tab" type="button" data-esc-tab="weather"><span>02</span>Weather</button>
                        <button class="esc-tab" type="button" data-esc-tab="quality"><span>03</span>Quality</button>
                        <button class="esc-tab" type="button" data-esc-tab="audio"><span>04</span>Audio</button>
                    </nav>

                    <div class="esc-menu__body">
                        <section class="esc-panel is-active" data-esc-panel="time">
                            <h3>Time of day</h3>
                            <p class="esc-panel__intro">Move the sun without waiting for the cycle.</p>
                            <div class="esc-range-wrap">
                                <div class="esc-range-head">
                                    <span>Cycle progress</span>
                                    <strong data-esc-time-label>Day</strong>
                                </div>
                                <input class="esc-range" data-esc-time-range type="range" min="0" max="100" step="1" value="5">
                            </div>
                            <div class="esc-actions">
                                <button class="esc-button" type="button" data-esc-time="noon">Noon</button>
                                <button class="esc-button" type="button" data-esc-time="dusk">Dusk</button>
                                <button class="esc-button" type="button" data-esc-time="night">Night</button>
                                <button class="esc-button" type="button" data-esc-time="dawn">Dawn</button>
                                <button class="esc-button" type="button" data-esc-time-auto>Auto cycle</button>
                            </div>
                        </section>

                        <section class="esc-panel" data-esc-panel="weather">
                            <h3>Atmosphere</h3>
                            <p class="esc-panel__intro">Force a weather preset. The world reacts live.</p>
                            <div class="esc-actions">
                                <button class="esc-button is-active" type="button" data-esc-weather="clear">Clear</button>
                                <button class="esc-button" type="button" data-esc-weather="dust">Dust</button>
                                <button class="esc-button" type="button" data-esc-weather="rain">Rain</button>
                                <button class="esc-button" type="button" data-esc-weather="snow">Snow</button>
                                <button class="esc-button" type="button" data-esc-weather="storm" title="Thunderstorm">Thunder</button>
                                <button class="esc-button" type="button" data-esc-weather-auto>Auto</button>
                            </div>
                            <div class="esc-row">
                                <span class="esc-row__label">Wind</span>
                                <span class="esc-row__value" data-esc-weather-wind>—</span>
                            </div>
                            <div class="esc-row">
                                <span class="esc-row__label">Rain</span>
                                <span class="esc-row__value" data-esc-weather-rain>—</span>
                            </div>
                            <div class="esc-row">
                                <span class="esc-row__label">Snow</span>
                                <span class="esc-row__value" data-esc-weather-snow>—</span>
                            </div>
                            <div class="esc-row">
                                <span class="esc-row__label">Thunder</span>
                                <span class="esc-row__value" data-esc-weather-storm>—</span>
                            </div>
                        </section>

                        <section class="esc-panel" data-esc-panel="quality">
                            <h3>Render quality</h3>
                            <p class="esc-panel__intro">Changes shadows, bloom, water and pixel ratio.</p>
                            <div class="esc-choice-grid">
                                <button class="esc-choice" type="button" data-esc-quality="0">
                                    <strong>High</strong>
                                    <small>Shadows, bloom, depth of field, high pixel ratio.</small>
                                </button>
                                <button class="esc-choice" type="button" data-esc-quality="1">
                                    <strong>Performance</strong>
                                    <small>Lighter shadows and effects for laptops and mobile.</small>
                                </button>
                            </div>
                        </section>

                        <section class="esc-panel" data-esc-panel="audio">
                            <h3>Audio</h3>
                            <p class="esc-panel__intro">Mute everything or set the master volume.</p>
                            <div class="esc-row">
                                <span class="esc-row__label">Sound</span>
                                <button class="esc-toggle" type="button" data-esc-audio-toggle>On</button>
                            </div>
                            <div class="esc-range-wrap">
                                <div class="esc-range-head">
                                    <span>Master volume</span>
                                    <strong data-esc-volume-label>80%</strong>
                                </div>
                                <input class="esc-range" data-esc-volume type="range" min="0" max="100" step="1" value="80">
                            </div>
                        </section>
                    </div>
                </div>

                <footer class="esc-menu__footer">
                    <span>Esc to close</span>
                    <span>Changes apply live</span>
                </footer>
            </section>
        `

        document.body.append(menu)
        this.element = menu

        this.timeRange = menu.querySelector('[data-esc-time-range]')
        this.timeLabel = menu.querySelector('[data-esc-time-label]')
        this.weatherWind = menu.querySelector('[data-esc-weather-wind]')
        this.weatherRain = menu.querySelector('[data-esc-weather-rain]')
        this.weatherSnow = menu.querySelector('[data-esc-weather-snow]')
        this.weatherStorm = menu.querySelector('[data-esc-weather-storm]')
        this.audioToggle = menu.querySelector('[data-esc-audio-toggle]')
        this.volumeRange = menu.querySelector('[data-esc-volume]')
        this.volumeLabel = menu.querySelector('[data-esc-volume-label]')
    }

    bind()
    {
        window.addEventListener('keydown', (event) =>
        {
            if(event.code !== 'Escape')
                return

            event.preventDefault()
            event.stopPropagation()
            this.toggle()
        }, true)

        for(const element of this.element.querySelectorAll('[data-esc-close]'))
            element.addEventListener('click', () => this.close())

        for(const element of document.querySelectorAll('[data-esc-open]'))
            element.addEventListener('click', () => this.open())

        for(const tab of this.element.querySelectorAll('[data-esc-tab]'))
        {
            tab.addEventListener('click', () => this.openTab(tab.dataset.escTab))
        }

        this.timeRange.addEventListener('input', () =>
        {
            this.timeDragging = true
            this.applyTime(Number(this.timeRange.value) / 100, 0.15)
        })
        this.timeRange.addEventListener('change', () =>
        {
            this.timeDragging = false
        })

        for(const button of this.element.querySelectorAll('[data-esc-time]'))
        {
            button.addEventListener('click', () =>
            {
                const key = button.dataset.escTime
                if(key)
                    this.setTimePreset(key)
            })
        }

        this.element.querySelector('[data-esc-time-auto]').addEventListener('click', () =>
        {
            this.game.dayCycles.override.end(0.8)
            this.syncTime()
        })

        for(const button of this.element.querySelectorAll('[data-esc-weather]'))
        {
            button.addEventListener('click', () =>
            {
                const key = button.dataset.escWeather
                if(key)
                    this.setWeatherPreset(key)
            })
        }

        this.element.querySelector('[data-esc-weather-auto]').addEventListener('click', () =>
        {
            this.currentWeatherPreset = null
            this.game.weather.override.end(1.2)
            this.syncWeather()
        })

        for(const button of this.element.querySelectorAll('[data-esc-quality]'))
        {
            button.addEventListener('click', () =>
            {
                this.game.quality.changeLevel(Number(button.dataset.escQuality))
                this.syncQuality()
            })
        }

        this.audioToggle.addEventListener('click', () =>
        {
            this.game.audio.mute.toggle()
            this.syncAudio()
        })

        this.volumeRange.addEventListener('input', () =>
        {
            this.applyVolume(Number(this.volumeRange.value) / 100, true)
        })
    }

    toggle()
    {
        if(this.isOpen)
            this.close()
        else
            this.open()
    }

    open()
    {
        if(this.isOpen || this.game.setupScreen?.isOpen || this.game.match?.ended)
            return

        this.isOpen = true
        this.element.hidden = false
        document.documentElement.classList.add('esc-menu-open')

        this.previousFilters = [...this.game.inputs.filters]
        this.previousPlayerState = this.game.player ? this.game.player.state : null

        this.game.inputs.filters.clear()
        this.game.inputs.filters.add('menu')

        if(this.game.player)
            this.game.player.state = 2

        if(document.pointerLockElement)
            document.exitPointerLock()

        this.syncAll()
    }

    close()
    {
        if(!this.isOpen)
            return

        this.isOpen = false
        this.element.hidden = true
        document.documentElement.classList.remove('esc-menu-open')

        this.game.inputs.filters.clear()
        for(const filter of this.previousFilters)
            this.game.inputs.filters.add(filter)

        if(this.game.player && this.previousPlayerState !== null)
            this.game.player.state = this.previousPlayerState
    }

    openTab(name)
    {
        for(const tab of this.element.querySelectorAll('[data-esc-tab]'))
            tab.classList.toggle('is-active', tab.dataset.escTab === name)

        for(const panel of this.element.querySelectorAll('[data-esc-panel]'))
            panel.classList.toggle('is-active', panel.dataset.escPanel === name)
    }

    applyTime(value, duration = 0.3)
    {
        const cycle = this.game.dayCycles
        if(!cycle)
            return

        const clamped = Math.max(0, Math.min(1, value))
        cycle.override.start({ progress: clamped }, duration)
        this.syncTime(clamped)
    }

    setTimePreset(name)
    {
        const value = TIME_PRESETS[name]
        if(typeof value === 'undefined')
            return

        this.timeDragging = false
        this.applyTime(value, 0.5)
    }

    syncTime(value = null)
    {
        const cycle = this.game.dayCycles
        if(!cycle)
            return

        const progress = value === null ? cycle.progress : value
        this.timeRange.value = String(Math.round(progress * 100))
        this.timeLabel.textContent = this.getTimeLabel(progress)
        this.setRangeFill(this.timeRange, progress * 100)
    }

    getTimeLabel(progress)
    {
        if(progress < 0.18) return 'Day'
        if(progress < 0.34) return 'Dusk'
        if(progress < 0.66) return 'Night'
        if(progress < 0.88) return 'Dawn'
        return 'Day'
    }

    setWeatherPreset(name)
    {
        const preset = WEATHER_PRESETS[name]
        if(!preset)
            return

        this.currentWeatherPreset = name
        this.game.weather.override.start(preset.values, 1.4)
        this.syncWeather()
    }

    syncWeather()
    {
        const weather = this.game.weather
        if(!weather)
            return

        this.weatherWind.textContent = this.formatValue(weather.wind?.value)
        this.weatherRain.textContent = this.formatValue(weather.rain?.value)
        this.weatherSnow.textContent = this.formatValue(weather.snow?.value)
        this.weatherStorm.textContent = this.formatValue(weather.storm?.value)

        for(const button of this.element.querySelectorAll('[data-esc-weather]'))
            button.classList.toggle('is-active', button.dataset.escWeather === this.currentWeatherPreset)
    }

    formatValue(value)
    {
        if(typeof value !== 'number' || Number.isNaN(value))
            return '—'

        return `${Math.round(value * 100)}%`
    }

    syncQuality()
    {
        const level = this.game.quality.level
        for(const button of this.element.querySelectorAll('[data-esc-quality]'))
            button.classList.toggle('is-active', Number(button.dataset.escQuality) === level)
    }

    syncAudio()
    {
        const muted = this.game.audio.mute.active
        this.audioToggle.textContent = muted ? 'Off' : 'On'
        this.audioToggle.classList.toggle('is-on', !muted)

        this.volumeRange.value = String(Math.round(this.settings.volume * 100))
        this.volumeLabel.textContent = `${Math.round(this.settings.volume * 100)}%`
        this.setRangeFill(this.volumeRange, this.settings.volume * 100)
    }

    applyVolume(value, save)
    {
        const volume = Math.max(0, Math.min(1, value))
        this.settings.volume = volume
        Howler.volume(volume)

        if(save)
            this.saveSettings()

        this.syncAudio()
    }

    syncAll()
    {
        this.syncTime()
        this.syncWeather()
        this.syncQuality()
        this.syncAudio()
    }

    syncLive()
    {
        const cycle = this.game.dayCycles
        if(cycle && !this.timeDragging && cycle.override.strength < 0.05)
            this.syncTime()

        this.syncWeather()
    }

    setRangeFill(range, percent)
    {
        range.style.setProperty('--fill', `${Math.max(0, Math.min(100, percent))}%`)
    }

    loadSettings()
    {
        try
        {
            const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
            return {
                volume: typeof settings.volume === 'number' ? settings.volume : 0.8
            }
        }
        catch
        {
            return { volume: 0.8 }
        }
    }

    saveSettings()
    {
        try
        {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
        }
        catch
        {
            // localStorage can be unavailable in privacy modes.
        }
    }
}
