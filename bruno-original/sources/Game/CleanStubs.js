import { Events } from './Events.js'

// Minimal stand-ins for the portfolio UI systems that were removed.
// They keep the remaining world / player / vehicle systems decoupled from
// menus, achievements, server messages and external links.

export class CleanServer
{
    constructor()
    {
        this.events = new Events()
        this.connected = false
        this.initData = null
    }

    start() {}
    send() {}
}

export class CleanMenu
{
    constructor()
    {
        this.events = new Events()
        this.items = new Map()
        this.isOpen = false
    }

    preopen() {}
    open() {}
    close() {}
}

export class CleanModals
{
    constructor()
    {
        this.events = new Events()
    }

    open() {}
    close() {}
}

export class CleanNotifications
{
    show() {}
    hide() {}
}

export class CleanAchievements
{
    constructor()
    {
        this.events = new Events()
        this.groups = new Map()
        this.rewards = {
            current: { name: 'red' },
            events: new Events(),
            update() {}
        }
        this.globalProgress = {
            totalCount: 0,
            ratioUniform: null,
            update() {}
        }
    }

    setProgress() {}
    addProgress() {}
}
