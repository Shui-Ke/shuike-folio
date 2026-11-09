export const UPGRADE_LIMITS = { power: 5, speed: 2, jump: 1 }
export const SPEED_MULTIPLIERS = [1, 1.5, 2]

export class VehicleUpgrades
{
    constructor() { this.reset() }
    reset() { this.power = 0; this.speed = 0; this.jump = 0 }
    canCollect(type) { return type in UPGRADE_LIMITS && this[type] < UPGRADE_LIMITS[type] }
    collect(type)
    {
        if(!this.canCollect(type)) return false
        this[type]++
        return true
    }
    get powerMultiplier() { return 1 + this.power }
    get speedMultiplier() { return SPEED_MULTIPLIERS[this.speed] }
    get maxJumps() { return 1 + this.jump }
}

// Normal driving = 1, full boost = 5. SPEED multiplies both the real speed
// and this combat value. A stationary car never produces a minimum-strength hit.
export function speedWhiteValue(speed, multiplier = 1, normalSpeed = 11, boostSpeed = 22)
{
    const normalized = Math.max(0, speed) / multiplier
    const value = normalized >= boostSpeed * 0.98 ? 5 : normalized < normalSpeed ? normalized / normalSpeed :
        1 + 4 * Math.min(1, (normalized - normalSpeed) / (boostSpeed - normalSpeed))
    return value * multiplier
}
