import { Events } from './Events.js'

const STORAGE_KEY = 'driving-games:language'
const SUPPORTED = ['en', 'cn']

const STRINGS = {
    en: {
        'setup.title': 'Set up the match',
        'setup.lead': 'You and the rivals spawn at random spots across the island. Pick your setup and start.',
        'setup.paint': '01 / Vehicle paint',
        'setup.paintAria': 'Vehicle paint',
        'setup.bots': '02 / Rivals',
        'setup.botsAria': 'Number of rivals',
        'setup.difficulty': '03 / Difficulty',
        'setup.difficultyAria': 'Difficulty',
        'setup.items': '04 / Item spawns',
        'setup.itemsAria': 'Item spawns',
        'setup.solo': 'Solo',
        'setup.car': '1 car',
        'setup.cars': '{count} cars',
        'setup.itemsCount': '{count} pickups',
        'setup.hint': 'W A S D drive · Shift boost · Space jump · E use item · Esc settings',
        'setup.start': 'Start race',

        'paint.red': 'Crimson',
        'paint.orange': 'Ember',
        'paint.white': 'Frost',
        'paint.black': 'Midnight',
        'paint.magenta': 'Magenta',
        'paint.gold': 'Gold',

        'difficulty.easy': 'Easy',
        'difficulty.normal': 'Normal',
        'difficulty.hard': 'Hard',
        'difficulty.extreme': 'Extreme',
        'difficulty.easyDesc': 'Slow steering · no items · one revive',
        'difficulty.normalDesc': 'Original handling · one life',
        'difficulty.hardDesc': 'Lead aim · flanking · momentum',
        'difficulty.extremeDesc': 'Two lives · 3+2 or 4+3 · focus fire',

        'items.0': 'Off',
        'items.2': 'Sparse',
        'items.5': 'Standard',
        'items.8': 'Dense',
        'items.11': 'Chaos',

        'roster.alive': 'Alive',
        'roster.eliminated': 'Eliminated',
        'roster.reviving': 'Reviving',
        'roster.awaiting': 'Awaiting revive',
        'roster.chase': 'Chase',
        'roster.collect': 'Collect',
        'roster.you': 'You',

        'match.lives': 'Lives',
        'match.titleLost': "You're out",
        'match.titleWon': 'Last one standing',
        'match.textWon': 'All rivals have been eliminated.',
        'match.textLost': 'Your car is completely submerged.',
        'match.textLostLives': 'Your car is completely submerged and you are out of lives.',
        'match.retry': 'Race again',
        'match.changeSetup': 'Change setup',
        'match.meta': 'Difficulty · {difficulty} · Lives {lives} / {maxLives}',
        'match.reviveHint': 'Press R to revive · {lives} lives left',

        'damage.title': 'Vehicle wrecked',
        'damage.reason': 'The body is fully submerged',
        'damage.revive': 'Press R to revive',

        'items.hudAria': 'Items',
        'items.use': 'Use {item}',
        'items.select': 'Select {item}',
        'items.ctrlKeyboard': '← → switch · E use',
        'items.ctrlTouch': 'Tap an item to use',
        'items.slow': 'Slowed {seconds}s',
        'items.shieldCharges': 'Shield {charges}/3',
        'items.shieldCooldown': 'Shield cooldown {seconds}s',
        'items.jet': 'Jet · {jumps} jumps',
        'items.shieldActive': 'Shield is still active',
        'items.placeLand': 'Place it near land',
        'items.noTarget': 'No vehicle to track',
        'items.missileLocked': 'Missile locked · the ring marks the target',
        'items.shieldBlock': 'Shield blocked it · {charges} charges left',
        'items.caltropHit': 'Caltrop hit · slowed for 15s',

        'item.caltrop': 'Caltrop',
        'item.missile': 'Missile',
        'item.crate': 'Crate',
        'item.shield': 'Shield',
        'item.jetpack': 'Jetpack',

        'powerup.maxed': '{item} collected · already maxed',
        'powerup.consumable': '{item} +1 · press E to use',
        'powerup.power': 'POWER+ {level}/5 · hit ×{multiplier}',
        'powerup.speed': 'SPEED+ {level}/2 · speed ×{multiplier}',
        'powerup.jump': 'JUMP×2 · press Space again to double jump',
        'powerup.velocity': 'Speed {value} / {max}',

        'rotate.title': 'Turn your phone',
        'rotate.message': 'Rotate your phone to landscape for the full view and controls.',
        'rotate.button': 'Try landscape',
        'rotate.blocked': 'Rotate your phone manually. If the screen does not rotate, enable auto-rotate.'
    },
    cn: {
        'setup.title': '选择这一局',
        'setup.lead': '你和人机都会在全地图随机位置出生。选好配置，开始比赛。',
        'setup.paint': '01 / 车辆颜色',
        'setup.paintAria': '车辆颜色',
        'setup.bots': '02 / 人机数量',
        'setup.botsAria': '人机数量',
        'setup.difficulty': '03 / 人机难度',
        'setup.difficultyAria': '人机难度',
        'setup.items': '04 / 道具分布',
        'setup.itemsAria': '道具分布',
        'setup.solo': '单人',
        'setup.car': '1 辆',
        'setup.cars': '{count} 辆',
        'setup.itemsCount': '{count} 个',
        'setup.hint': 'W A S D 驾驶 · Shift 加速 · Space 跳跃 · E 使用道具 · Esc 设置',
        'setup.start': '开始比赛',

        'paint.red': '赤红',
        'paint.orange': '橙焰',
        'paint.white': '霜白',
        'paint.black': '夜黑',
        'paint.magenta': '品红',
        'paint.gold': '流金',

        'difficulty.easy': '简单',
        'difficulty.normal': '普通',
        'difficulty.hard': '困难',
        'difficulty.extreme': '极限',
        'difficulty.easyDesc': '转向迟钝 · 不用道具 · 可复活 1 次',
        'difficulty.normalDesc': '原始手感 · 一命通关',
        'difficulty.hardDesc': '预判走位 · 包夹 · 乘胜追击',
        'difficulty.extremeDesc': '双命 · 3+2 或 4+3 · 集火',

        'items.0': '关闭',
        'items.2': '稀疏',
        'items.5': '标准',
        'items.8': '密集',
        'items.11': '混乱',

        'roster.alive': '存活',
        'roster.eliminated': '淘汰',
        'roster.reviving': '复活中',
        'roster.awaiting': '待复活',
        'roster.chase': '追',
        'roster.collect': '搜',
        'roster.you': '你',

        'match.lives': '生命',
        'match.titleLost': '你被淘汰了',
        'match.titleWon': '最后的赢家',
        'match.textWon': '所有人机都被淘汰了。',
        'match.textLost': '车辆完全沉入水中。',
        'match.textLostLives': '车辆完全沉入水中，生命已经用完。',
        'match.retry': '再来一局',
        'match.changeSetup': '修改设置',
        'match.meta': '难度 · {difficulty} · 生命 {lives} / {maxLives}',
        'match.reviveHint': '按 R 复活 · 剩余 {lives} 条命',

        'damage.title': '车辆损坏',
        'damage.reason': '车身已完全没入水中',
        'damage.revive': '按 R 复活',

        'items.hudAria': '道具栏',
        'items.use': '使用{item}',
        'items.select': '选择{item}',
        'items.ctrlKeyboard': '← → 切换 · E 使用',
        'items.ctrlTouch': '点击道具使用',
        'items.slow': '减速 {seconds}s',
        'items.shieldCharges': '护盾 {charges}/3',
        'items.shieldCooldown': '护盾冷却 {seconds}s',
        'items.jet': '喷气 · 可跳跃 {jumps} 次',
        'items.shieldActive': '护盾仍在生效',
        'items.placeLand': '需要在陆地附近放置',
        'items.noTarget': '没有可追踪的车辆',
        'items.missileLocked': '导弹已锁定 · 同色圆环标记目标',
        'items.shieldBlock': '护盾抵挡 · 剩余 {charges} 次',
        'items.caltropHit': '铁蒺藜命中 · 减速 15s',

        'item.caltrop': '铁蒺藜',
        'item.missile': '导弹',
        'item.crate': '爆炸箱',
        'item.shield': '护盾',
        'item.jetpack': '喷气背包',

        'powerup.maxed': '{item} 已拾取 · 已满级，属性不变',
        'powerup.consumable': '{item} +1 · 按 E 使用',
        'powerup.power': 'POWER+ {level}/5 · 撞击 ×{multiplier}',
        'powerup.speed': 'SPEED+ {level}/2 · 速度 ×{multiplier}',
        'powerup.jump': 'JUMP×2 · 再按一次空格可二段跳',
        'powerup.velocity': '速度 {value} / {max}',

        'rotate.title': '横屏开战',
        'rotate.message': '请将手机横过来，获得完整视野和操作空间。',
        'rotate.button': '尝试切换横屏',
        'rotate.blocked': '请手动将手机横过来；若画面没有旋转，请开启系统自动旋转。'
    }
}

export class I18n
{
    constructor()
    {
        let language = 'en'

        try
        {
            const stored = localStorage.getItem(STORAGE_KEY)
            if(SUPPORTED.includes(stored))
                language = stored
        }
        catch
        {
            // Private browsing: keep the English default.
        }

        this.language = language
        this.events = new Events()
        document.documentElement.lang = language === 'cn' ? 'zh-CN' : 'en'
    }

    t(key, parameters = null)
    {
        const dictionary = STRINGS[this.language] ?? STRINGS.en
        let text = dictionary[key] ?? STRINGS.en[key] ?? key

        if(parameters)
            for(const [name, value] of Object.entries(parameters))
                text = text.replaceAll(`{${name}}`, String(value))

        return text
    }

    setLanguage(language)
    {
        if(!SUPPORTED.includes(language) || language === this.language)
            return

        this.language = language
        document.documentElement.lang = language === 'cn' ? 'zh-CN' : 'en'

        try
        {
            localStorage.setItem(STORAGE_KEY, language)
        }
        catch
        {
            // Ignore storage failures.
        }

        this.events.trigger('change', [language])
    }
}

export const i18n = new I18n()
export const t = (key, parameters) => i18n.t(key, parameters)
