import { Vector3 } from 'three'

// Original basalt is made of hexagonal columns with omitted hidden faces.
// Keep existing faces, restore missing vertical sides, then close each foot.
const key = p => p.toArray().map(v => Math.round(v * 10000)).join(',')
function boundaries(triangles) {
    const edges = new Map()
    for (const [a,b,c,color] of triangles) {
        const points = [a,b,c]
        for (let i=0;i<3;i++) {
            const a=points[i],b=points[(i+1)%3],id=[key(a),key(b)].sort().join('|')
            if (edges.has(id)) edges.get(id).count++
            else edges.set(id,{a,b,color,count:1})
        }
    }
    if ([...edges.values()].some(e=>e.count>2)) throw Error('Non-manifold basalt geometry')
    return [...edges.values()].filter(e=>e.count===1)
}
function loops(edges) {
    const next=new Map(edges.map(e=>[key(e.a),e])),result=[]
    if(next.size!==edges.length) throw Error('Ambiguous basalt boundary')
    while(next.size) {
        const start=next.keys().next().value,loop=[]
        let current=start
        do {
            const edge=next.get(current)
            if(!edge) throw Error('Broken basalt boundary')
            loop.push(edge);next.delete(current);current=key(edge.b)
        } while(current!==start)
        result.push(loop)
    }
    return result
}
export function closeBasalt(triangles) {
    for(const loop of loops(boundaries(triangles))) {
        const bottom=Math.min(...loop.map(e=>e.a.y))
        for(const {a,b,color} of loop) {
            if(a.y>bottom+1e-4&&b.y>bottom+1e-4) {
                const lowA=a.clone().setY(bottom),lowB=b.clone().setY(bottom)
                // Reverse the existing boundary so both faces face outward.
                triangles.push([b.clone(),a.clone(),lowA,color],[b.clone(),lowA,lowB,color])
            }
        }
    }
    for(const loop of loops(boundaries(triangles))) {
        const points=loop.map(e=>e.a)
        if(Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))>1e-4)
            throw Error('Expected a horizontal basalt foot')
        const center=points.reduce((sum,p)=>sum.add(p),new Vector3()).divideScalar(points.length)
        for(const {a,b,color} of loop) triangles.push([center.clone(),b.clone(),a.clone(),color])
    }
    if(boundaries(triangles).length) throw Error('Basalt still has open faces')
    return triangles
}
