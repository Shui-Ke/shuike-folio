export const GRID = 128
export function newTerrain(size = 192) {
    const count = (GRID + 1) ** 2
    return { size, segments: GRID, heights: Array(count).fill(0), grass: Array(count).fill(0), water: Array(count).fill(0), waterLevel: -0.3 }
}
export function validateTerrain(t) {
    if (!t || !Number.isFinite(t.size) || t.size < 32 || t.size > 512 || t.segments !== GRID) throw Error('地形尺寸或精度无效。')
    const count = (GRID + 1) ** 2
    for (const key of ['heights','grass','water']) {
        if (!Array.isArray(t[key]) || t[key].length !== count || t[key].some(v => !Number.isFinite(v) || (key === 'heights' ? Math.abs(v)>100 : v<0||v>1))) throw Error('地形数据无效：' + key)
    }
    if (!Number.isFinite(t.waterLevel) || Math.abs(t.waterLevel)>80) throw Error('水位无效。')
}
export function sample(t, x, z, field = 'heights') {
    const n=t.segments,u=(x/t.size+.5)*n,v=(z/t.size+.5)*n
    if(u<0||v<0||u>n||v>n) return field==='heights' ? -100 : 0
    const a=Math.min(n-1,Math.floor(u)),b=Math.min(n-1,Math.floor(v)),fx=u-a,fz=v-b,row=n+1,data=t[field]
    // Matches PlaneGeometry's diagonal, also used by the collision triangles.
    const h00=data[b*row+a],h10=data[b*row+a+1],h01=data[(b+1)*row+a],h11=data[(b+1)*row+a+1]
    return fx+fz<=1 ? h00+(h10-h00)*fx+(h01-h00)*fz : h11+(h01-h11)*(1-fx)+(h10-h11)*(1-fz)
}
export function brush(t, x, z, {mode,radius,strength,level=0,depth=3}, dt) {
    const n=t.segments,row=n+1,step=t.size/n,source=mode==='smooth'?t.heights.slice():t.heights
    let changed=false
    for(let j=Math.max(0,Math.floor((z-radius+t.size/2)/step));j<=Math.min(n,Math.ceil((z+radius+t.size/2)/step));j++)
    for(let i=Math.max(0,Math.floor((x-radius+t.size/2)/step));i<=Math.min(n,Math.ceil((x+radius+t.size/2)/step));i++) {
        const d=Math.hypot(i*step-t.size/2-x,j*step-t.size/2-z)/radius
        if(d>=1)continue
        const k=j*row+i,w=(1-d*d)**2,amount=strength*dt*w,h=t.heights[k]
        if(mode==='raise'||mode==='lower')t.heights[k]=Math.max(-100,Math.min(100,h+amount*(mode==='raise'?1:-1)))
        if(mode==='flatten')t.heights[k]=h+(level-h)*Math.min(1,amount)
        if(mode==='smooth') {
            let sum=0,count=0
            for(let a=Math.max(0,j-1);a<=Math.min(n,j+1);a++)for(let b=Math.max(0,i-1);b<=Math.min(n,i+1);b++){sum+=source[a*row+b];count++}
            t.heights[k]=h+(sum/count-h)*Math.min(1,amount)
        }
        if(mode==='grass')t.grass[k]=Math.min(1,t.grass[k]+amount)
        if(mode==='eraseGrass')t.grass[k]=Math.max(0,t.grass[k]-amount)
        if(mode==='river') {
            t.water[k]=Math.min(1,t.water[k]+amount)
            t.heights[k]=Math.min(h,h+(t.waterLevel-depth-h)*Math.min(1,amount))
            t.grass[k]=Math.max(0,t.grass[k]-amount)
        }
        if(mode==='eraseWater')t.water[k]=Math.max(0,t.water[k]-amount)
        changed=true
    }
    return changed
}
