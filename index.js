/**
 * dsh-screen-snap — 宿主半边。
 *
 * 提供一个 HTTP 路由给客户端按钮调用：
 *   POST /dsh-screen-snap/capture
 * 流程：先按宿主进程 PID 找到 DSH 自己的窗口并藏起来 → 抓它下面那个窗口（也就是
 * 用户点按钮之前正在看的东西）→ 把窗口恢复 → 图片存成 DSH 附件并回传路径。
 *
 * 为什么必须「先藏再抓」：按钮在 DSH 里，点下去的那一刻 DSH 就是前台窗口，
 * 直接抓前台只能抓到自己。hide → capture → restore 是这个交互唯一的正解，
 * 代价是屏幕闪一下。
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const SCRIPT = fileURLToPath(new URL('./scripts/shot.ps1', import.meta.url))
const ROUTE = '/dsh-screen-snap'
const PS = 'powershell.exe'

/** 从 PNG 的 IHDR 里读宽高，不引第三方依赖。 */
function pngSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  return { width: 0, height: 0 }
}

function runCapture(hidePid) {
  const outDir = path.join(os.tmpdir(), 'dsh-screen-snap')
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-Mode', 'behind', '-OutDir', outDir, '-HidePid', String(hidePid),
  ]
  return new Promise((resolve, reject) => {
    execFile(PS, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || err.message || '').trim() || 'capture failed'))
        return
      }
      const file = String(stdout).trim().split(/\r?\n/).filter(Boolean).pop()
      if (!file) {
        reject(new Error('capture produced no file path'))
        return
      }
      resolve(file)
    })
  })
}

async function capture(hidePid) {
  // 宿主 PID 不一定就是窗口所属进程，按 PID 找不到时退回按标题匹配。
  try {
    return await runCapture(hidePid)
  } catch (first) {
    const outDir = path.join(os.tmpdir(), 'dsh-screen-snap')
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
      '-Mode', 'behind', '-OutDir', outDir, '-HideTitleLike', 'DeepSeek Harness',
    ]
    const file = await new Promise((resolve, reject) => {
      execFile(PS, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || first.message || '').trim()))
          return
        }
        resolve(String(stdout).trim().split(/\r?\n/).filter(Boolean).pop())
      })
    })
    if (!file) throw first
    return file
  }
}

export const inject = ['webServer', 'attachments']

export function apply(ctx) {
  const webServer = ctx.webServer ?? ctx.get('webServer')
  if (!webServer) {
    console.warn('[dsh-screen-snap] 没有 webServer，按钮将不可用')
    return
  }

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      const url = new URL(String(req.url || '/'), 'http://localhost')
      const json = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(JSON.stringify(body))
      }

      if (req.method !== 'POST' || url.pathname !== `${ROUTE}/capture`) {
        json(404, { ok: false, error: 'not found' })
        return
      }

      try {
        const file = await capture(process.pid)
        const buf = await readFile(file)
        const { width, height } = pngSize(buf)

        let attachment = null
        const store = ctx.get('attachments')
        if (store && typeof store.saveImage === 'function') {
          try {
            attachment = await store.saveImage({
              data: buf,
              mediaType: 'image/png',
              name: path.basename(file),
            })
          } catch (e) {
            // 附件存不进去不该让整个截图失败，路径照样能用
            console.warn('[dsh-screen-snap] saveImage 失败：', e && e.message)
          }
        }

        json(200, { ok: true, path: file, width, height, attachment })
      } catch (e) {
        json(500, { ok: false, error: String((e && e.message) || e) })
      }
    },
  }))
}
