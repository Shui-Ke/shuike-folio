import { validateTerrain } from './terrain-data.js'

export const SCENE_FORMAT = 'bruno-scene'
export const SCENE_VERSION = 1
export const DEFAULT_TERRAIN = 'wasteland/library/地形/嶙峋峡谷/嶙峋峡谷与朱红大桥.glb'

export function validateLayout(data) {
    if (!data || data.format !== SCENE_FORMAT || data.version !== SCENE_VERSION)
        throw new Error('请选择此编辑器保存的场景文件。')
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 64)
        throw new Error('场景名称应为 1–64 个字符。')
    if (!['canyon', 'flat', 'custom', 'bruno'].includes(data.terrain))
        throw new Error('场景中的地形类型无法识别。')
    if (data.terrain === 'custom') validateTerrain(data.terrainData)
    if (!Array.isArray(data.objects) || data.objects.length > 2000)
        throw new Error('单个场景最多支持 2000 个物件。')
    const ids = new Set()
    for (const item of data.objects) {
        if (typeof item.id !== 'string' || ids.has(item.id)) throw new Error('场景包含重复或无效的物件编号。')
        ids.add(item.id)
        if (typeof item.asset !== 'string' || !item.asset.startsWith('wasteland/library/') || !item.asset.endsWith('.glb') || item.asset.split('/').some(p => p === '..' || p === '.') || item.asset.includes('\\'))
            throw new Error('场景包含无效的素材路径。')
        if (typeof item.name !== 'string' || item.name.length > 120) throw new Error('物件名称无效。')
        for (const key of ['position', 'rotation', 'scale']) {
            if (!Array.isArray(item[key]) || item[key].length !== 3 || item[key].some(v => !Number.isFinite(v) || Math.abs(v) > 100000))
                throw new Error('物件的位置、旋转或缩放数据无效。')
        }
        if (item.scale.some(v => v < 0.01 || v > 100)) throw new Error('缩放范围为 0.01–100。')
    }
    return data
}
