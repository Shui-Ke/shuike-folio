import { alea } from 'seedrandom'
import { ITEM_TYPES } from './ItemDefinitions.js'

const STORAGE_KEY = 'driving-games:setup'
const BOT_LIMIT = 5

// One row of pickups per type (3 upgrades + consumables) is spawned for each
// unit of `items`, so the setup screen can report a real total.
export const PICKUP_TYPE_COUNT = 3 + ITEM_TYPES.length

export const PAINTS = [
    { name: 'red',     label: '赤红', top: '#ff3a3a', bottom: '#721551' },
    { name: 'orange',  label: '橙焰', top: '#ff9a3c', bottom: '#a83c00' },
    { name: 'white',   label: '霜白', top: '#ffffff', bottom: '#9aa3b2' },
    { name: 'black',   label: '夜黑', top: '#4a4f5c', bottom: '#101218' },
    { name: 'magenta', label: '品红', top: '#ff4fd8', bottom: '#6b0a5e' },
    { name: 'gold',    label: '流金', top: '#ffc247', bottom: '#7a3d00' },
]

export const ITEM_PRESETS = [
    { label: '关闭', perType: 0 },
    { label: '稀疏', perType: 2 },
    { label: '标准', perType: 5 },
    { label: '密集', perType: 8 },
    { label: '混乱', perType: 11 },
]

// Driving numbers only. Physics stays shared with the player so difficulty
// never turns into a speed cheat; `normal` is the neutral baseline.
export const DIFFICULTIES = {
    easy: {
        label: '简单',
        description: '转向迟钝 · 不用道具 · 可复活 1 次',
        revives: 1,
        frenzy: false,
        botItems: false,
        steerGain: 1.2,
        routeInterval: 1.4,
        directRange: 24,
        chargeNear: 5,
        chargeFar: 14,
        chargeWindow: 0.65,
        chargeCooldown: 7,
        chargeCooldownRandom: 3,
        chargeError: 0.3,
        targetMin: 8,
        targetRandom: 3,
        stuckLimit: 2.4,
        reverseTime: 1.4,
        lead: 0,
        flank: 0,
        catchUp: 0,
        catchUpDuration: 0,
        itemInterval: 7,
        itemRandom: 4,
    },
    normal: {
        label: '普通',
        description: '原始手感 · 一命通关',
        revives: 0,
        frenzy: false,
        botItems: true,
        steerGain: 1.8,
        routeInterval: 0.9,
        directRange: 30,
        chargeNear: 6,
        chargeFar: 22,
        chargeWindow: 0.75,
        chargeCooldown: 4,
        chargeCooldownRandom: 2,
        chargeError: 0.22,
        targetMin: 5,
        targetRandom: 3,
        stuckLimit: 1.8,
        reverseTime: 1.3,
        lead: 0,
        flank: 0,
        catchUp: 0,
        catchUpDuration: 0,
        itemInterval: 4,
        itemRandom: 3,
    },
    hard: {
        label: '困难',
        description: '预判走位 · 包夹 · 乘胜追击',
        revives: 0,
        frenzy: true,
        frenzyRange: 60,
        frenzyDuration: 2.6,
        botItems: true,
        steerGain: 2.4,
        routeInterval: 0.55,
        directRange: 34,
        chargeNear: 8,
        chargeFar: 32,
        chargeWindow: 0.9,
        chargeCooldown: 2.5,
        chargeCooldownRandom: 1.5,
        chargeError: 0.16,
        targetMin: 3.5,
        targetRandom: 1.5,
        stuckLimit: 1.1,
        reverseTime: 1,
        lead: 0.6,
        flank: 6,
        catchUp: 45,
        catchUpDuration: 1.8,
        itemInterval: 2.2,
        itemRandom: 1.2,
        botLives: 1,
    },
    extreme: {
        label: '极限',
        description: '双命 · 3 追 2 搜 · 集火',
        revives: 0,
        frenzy: true,
        frenzyRange: 65,
        frenzyDuration: 3,
        botItems: true,
        steerGain: 2.6,
        routeInterval: 0.45,
        directRange: 36,
        chargeNear: 8,
        chargeFar: 34,
        chargeWindow: 1,
        chargeCooldown: 2,
        chargeCooldownRandom: 1.2,
        chargeError: 0.14,
        targetMin: 3,
        targetRandom: 1,
        stuckLimit: 1,
        reverseTime: 0.9,
        lead: 0.7,
        flank: 7,
        catchUp: 40,
        catchUpDuration: 2,
        itemInterval: 2,
        itemRandom: 1,
        botLives: 2,
        focusPlayer: true,
        chaseSquad: 3,
        roleRefresh: 2,
        buffRange: 60,
        heavyRam: true,
        ramStrength: 4,
        noFriendlyFire: true,
        packSpacing: true,
    },
}

const DEFAULT_VALUES = { paint: 'red', bots: 3, difficulty: 'normal', items: 5 }

export class Config
{
    constructor()
    {
        this.defaults = { ...DEFAULT_VALUES }
        this.spawn = new URLSearchParams(location.search).get('spawn')
        this.values = this.sanitize(this.defaults)
        this.load()
        this.seed = new URLSearchParams(location.search).get('seed') || `${Date.now()}`
        this.random = alea(this.seed)
    }

    get skipSetup()
    {
        return /skip/i.test(location.hash) || new URLSearchParams(location.search).get('setup') === '0'
    }

    get paint() { return this.values.paint }
    get bots() { return this.values.bots }
    get difficulty() { return this.values.difficulty }
    get items() { return this.values.items }
    get profile() { return DIFFICULTIES[this.values.difficulty] }
    get revives() { return this.profile?.revives ?? 0 }
    get pickupTotal() { return this.values.items * PICKUP_TYPE_COUNT }

    toInt(value, fallback)
    {
        const number = Number(value)
        return Number.isFinite(number) ? Math.round(number) : fallback
    }

    sanitize(source)
    {
        const paint = PAINTS.some(item => item.name === source.paint) ? source.paint : this.defaults.paint
        const bots = Math.max(0, Math.min(BOT_LIMIT, this.toInt(source.bots, this.defaults.bots)))
        const difficulty = DIFFICULTIES[source.difficulty] ? source.difficulty : this.defaults.difficulty
        const items = ITEM_PRESETS.some(item => item.perType === Number(source.items))
            ? Number(source.items)
            : this.defaults.items

        return { paint, bots, difficulty, items }
    }

    load()
    {
        let stored = null
        try
        {
            stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
        }
        catch
        {
            stored = null
        }

        const params = new URLSearchParams(location.search)
        const source = { ...this.defaults, ...(stored ?? {}) }
        if(params.has('paint'))
            source.paint = params.get('paint')
        if(params.has('bots'))
            source.bots = params.get('bots')
        if(params.has('ai'))
            source.difficulty = params.get('ai')
        if(params.has('items'))
            source.items = params.get('items')

        this.values = this.sanitize(source)
    }

    save()
    {
        try
        {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values))
        }
        catch
        {
            // Storage can be unavailable in private contexts; the match still works.
        }
    }

    apply(values)
    {
        this.values = this.sanitize({ ...this.values, ...values })
        this.save()
        this.syncUrl()
        this.random = alea(this.seed)
        return this.values
    }

    syncUrl()
    {
        const url = new URL(location.href)
        url.searchParams.set('paint', this.values.paint)
        url.searchParams.set('bots', String(this.values.bots))
        url.searchParams.set('ai', this.values.difficulty)
        url.searchParams.set('items', String(this.values.items))
        history.replaceState(null, '', url.href)
    }
}
