import fs from 'node:fs/promises'
import {NodeIO,Document} from '@gltf-transform/core'
import {copyToDocument} from '@gltf-transform/functions'
import {fileURLToPath} from 'node:url'
const library=fileURLToPath(new URL('../static/wasteland/library/',import.meta.url)),io=new NodeIO()
const source=await io.read(library+'地形/嶙峋峡谷/嶙峋峡谷与朱红大桥.glb')
const bridge=source.getRoot().listScenes()[0].listChildren().find(n=>n.getName()==='Vermilion bridge')
if(!bridge)throw Error('Bridge missing')
const doc=new Document(),copy=copyToDocument(doc,source,[bridge]).get(bridge)
copy.setTranslation([0,.04,0])
doc.createScene('朱红大桥').addChild(copy).setExtras({singleAsset:true,units:'metres',placementPivot:'deck'})
doc.getRoot().getAsset().copyright=source.getRoot().getAsset().copyright
await io.write(library+'道路/朱红大桥.glb',doc)
const manifest=JSON.parse(await fs.readFile(library+'素材清单.json','utf8'))
manifest.目录.道路=manifest.目录.道路.filter(a=>a.中文名!=='朱红大桥')
manifest.目录.道路.push({中文名:'朱红大桥',文件:'道路/朱红大桥.glb',用途:'独立桥廊与底部承重拱门，放置高度以桥面为准；不含峡谷和两端引道',碰撞建议:'桥面、护栏与拱门分开配置，保留桥下通道'})
await fs.writeFile(library+'素材清单.json',JSON.stringify(manifest,null,2)+'\n')
console.log('Exported standalone bridge with under-deck arches')
