import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const address = 'http://127.0.0.1:4195/'
const workspace = createHash('sha256').update(base.toLowerCase()).digest('hex')
const checkOnly = process.argv.includes('--check')
const noOpen = process.argv.includes('--no-open')

async function isEditorRunning() {
    try {
        const response = await fetch(address + '__scene-editor/status', { signal: AbortSignal.timeout(1200) })
        if (!response.ok) return false
        const status = await response.json()
        return status.application === 'bruno-scene-editor' && status.workspace === workspace
    } catch { return false }
}

function openEditor() {
    console.log('编辑器地址：' + address)
    if (noOpen || checkOnly) return
    // The URL is a fixed local address; no paths or user input enter the command.
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath '${address}'`], { windowsHide: true }, error => {
        if (error) console.log('浏览器未能自动打开，请手动访问上面的地址。')
    })
}

async function start() {
    if (await isEditorRunning()) {
        console.log('编辑器已经在运行，正在打开现有页面。')
        openEditor()
        return
    }
    if (checkOnly) {
        console.error('当前项目的编辑器尚未启动。')
        process.exitCode = 1
        return
    }
    const { createServer } = await import('vite')
    const server = await createServer({ configFile: path.join(base, 'editor.vite.config.js'), server: { open: false } })
    try {
        await server.listen()
    } catch (error) {
        await server.close()
        if (error.code !== 'EADDRINUSE' && !/Port 4195 is already in use/.test(error.message)) throw error
        // Another double-click may have started this same editor in the meantime.
        for (let attempt = 0; attempt < 8; attempt++) {
            if (await isEditorRunning()) {
                console.log('编辑器已经在运行，正在打开现有页面。')
                openEditor()
                return
            }
            await new Promise(resolve => setTimeout(resolve, 250))
        }
        console.error('4195 端口被其他程序或另一个项目占用。未关闭任何程序。')
        console.error('请关闭占用该端口的程序后，再次启动此编辑器。')
        process.exitCode = 1
        return
    }
    console.log('编辑器已启动。请保留此窗口，关闭窗口会停止本次启动的服务。')
    openEditor()
}

start().catch(error => {
    console.error('编辑器启动失败：' + error.message)
    process.exitCode = 1
})
