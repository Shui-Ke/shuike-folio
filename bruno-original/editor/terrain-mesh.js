// Shared geometry for the editor and the original game's test drive.
export function terrainGeometry(T, data) {
    const geometry=new T.PlaneGeometry(data.size,data.size,data.segments,data.segments)
    geometry.rotateX(-Math.PI/2)
    geometry.setAttribute('color',new T.BufferAttribute(new Float32Array(data.heights.length*3),3))
    updateTerrainGeometry(T,geometry,data)
    return geometry
}
export function updateTerrainGeometry(T,geometry,data) {
    const p=geometry.attributes.position,c=geometry.attributes.color,dirt=new T.Color('#bba17b'),grass=new T.Color('#b8b62e'),wet=new T.Color('#867c65'),color=new T.Color()
    for(let i=0;i<p.count;i++) {
        p.setY(i,data.heights[i])
        color.copy(dirt).lerp(grass,data.grass[i]).lerp(wet,data.water[i]*.4)
        c.setXYZ(i,color.r,color.g,color.b)
    }
    p.needsUpdate=c.needsUpdate=true
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
}
export function waterGeometry(T,data) {
    const positions=[],n=data.segments,row=n+1,step=data.size/n,y=data.waterLevel
    function triangle(ids){
        if(ids.every(i=>data.water[i]<.05)||ids.every(i=>data.heights[i]>=y))return
        for(const i of ids)positions.push((i%row)*step-data.size/2,y,Math.floor(i/row)*step-data.size/2)
    }
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
        const a=z*row+x,b=a+1,c=a+row,d=c+1
        triangle([a,c,b]);triangle([b,c,d])
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g
}
