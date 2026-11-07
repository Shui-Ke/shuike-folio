import * as THREE from 'three/webgpu'

function fract(value)
{
    return value - Math.floor(value)
}

function hash2(ix, iz, seed)
{
    return fract(Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453123)
}

function smooth(value)
{
    return value * value * (3 - 2 * value)
}

/** 周期性 value noise：保证左右/上下无缝，贴图可以 RepeatWrapping */
function valueNoise(x, y, period, seed)
{
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = smooth(x - ix)
    const fy = smooth(y - iy)

    const wrap = (v) => ((v % period) + period) % period

    const x0 = wrap(ix)
    const x1 = wrap(ix + 1)
    const y0 = wrap(iy)
    const y1 = wrap(iy + 1)

    const a = hash2(x0, y0, seed)
    const b = hash2(x1, y0, seed)
    const c = hash2(x0, y1, seed)
    const d = hash2(x1, y1, seed)

    const top = a + (b - a) * fx
    const bottom = c + (d - c) * fx

    return top + (bottom - top) * fy
}

/**
 * 生成一张可平铺的 fBm 噪声。
 * 同时给 GPU（DataTexture）和 CPU（sample）用，保证草的位置和地表花纹一致。
 */
export function createNoiseField(size = 256)
{
    const data = new Float32Array(size * size)

    const octaves = [
        { frequency: 4, amplitude: 0.5 },
        { frequency: 8, amplitude: 0.28 },
        { frequency: 16, amplitude: 0.14 },
        { frequency: 32, amplitude: 0.08 },
    ]

    for(let y = 0; y < size; y++)
    {
        for(let x = 0; x < size; x++)
        {
            let value = 0
            let total = 0

            for(let i = 0; i < octaves.length; i++)
            {
                const octave = octaves[i]
                const u = x / size * octave.frequency
                const v = y / size * octave.frequency
                value += valueNoise(u, v, octave.frequency, i + 1) * octave.amplitude
                total += octave.amplitude
            }

            data[y * size + x] = value / total
        }
    }

    const texture = new THREE.DataTexture(new Uint8Array(data.map((v) => v * 255)), size, size)
    texture.format = THREE.RedFormat
    texture.type = THREE.UnsignedByteType
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true

    const sample = (u, v) =>
    {
        const x = ((u % 1) + 1) % 1 * size
        const y = ((v % 1) + 1) % 1 * size

        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        const x1 = (x0 + 1) % size
        const y1 = (y0 + 1) % size
        const fx = x - x0
        const fy = y - y0

        const a = data[y0 * size + x0]
        const b = data[y0 * size + x1]
        const c = data[y1 * size + x0]
        const d = data[y1 * size + x1]

        const top = a + (b - a) * fx
        const bottom = c + (d - c) * fx

        return top + (bottom - top) * fy
    }

    return { texture, data, size, sample }
}
