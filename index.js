/**
 * dsh-screen-snap — 宿主半边（划区截图）。
 *
 * 三个端点，全部给客户端那个相机按钮用：
 *   POST /dsh-screen-snap/region/start  藏窗口 → 冻结整块虚拟屏幕 → 恢复窗口，返回几何信息
 *   GET  /dsh-screen-snap/region/frame  把刚才那张冻结图给前端（前端铺在浮层当画布）
 *   POST /dsh-screen-snap/region/end    把窗口恢复回来（确认或取消时调）
 *
 * 为什么必须「先藏再抓」：按钮在 DSH 里，点下去的那一刻 DSH 就是前台窗口，
 * 直接抓屏只能抓到自己。藏 → 抓 → 恢复是这个交互唯一的正解，代价是屏幕闪一下。
 *
 * 为什么全屏由客户端调 requestFullscreen：浮层只能画在 DSH 窗口里，窗口必须铺满
 * 屏幕，用户在选区里拖框才有意义；浏览器全屏在用户手势里调用最稳，也省掉我们在
 * 宿主侧管窗口状态（放大/还原容易和用户自己的窗口布局打架）。
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const REGION = fileURLToPath(new URL('./scripts/region.ps1', import.meta.url))
const ROUTE = '/dsh-screen-snap'
const PS = 'powershell.exe'

let lastFramePath = null

/** 跑一次 region.ps1，只认它以 @@ 开头的那行 JSON。 */
function runRegion(args) {
  return new Promise((resolve, reject) => {
    execFile(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', REGION, ...args],
      { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
        const line = String(stdout || '').split(/\r?\n/).find((l) => l.startsWith('@@'))
        if (!line) {
          reject(new Error(String(stderr || (err && err.message) || 'region script failed').trim()))
          return
        }
        try {
          resolve(JSON.parse(line.slice(2)))
        } catch (e) {
          reject(new Error(`region script returned bad json: ${line.slice(0, 200)}`))
        }
      })
  })
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1e6) req.destroy() })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

export const inject = ['webServer']

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

      if (url.pathname === `${ROUTE}/region/start` && req.method === 'POST') {
        try {
          const r = await runRegion(['-Mode', 'frame', '-HidePid', String(process.pid)])
          if (!r.ok) throw new Error(r.error || 'frame failed')
          lastFramePath = r.path
          json(200, {
            ok: true,
            vsx: r.vsx, vsy: r.vsy, vsw: r.vsw, vsh: r.vsh,
            wasMax: r.wasMax === 1 || r.wasMax === true,
          })
        } catch (e) {
          json(500, { ok: false, error: String((e && e.message) || e) })
        }
        return
      }

      if (url.pathname === `${ROUTE}/region/frame`) {
        try {
          if (!lastFramePath) throw new Error('no frame')
          const buf = await readFile(lastFramePath)
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': String(buf.length),
            'Cache-Control': 'no-store',
          })
          res.end(buf)
        } catch (e) {
          json(404, { ok: false, error: String((e && e.message) || e) })
        }
        return
      }

      if (url.pathname === `${ROUTE}/region/end` && req.method === 'POST') {
        const body = await readJsonBody(req)
        try {
          await runRegion([
            '-Mode', 'restore',
            '-HidePid', String(process.pid),
            '-WasMax', body && body.wasMax ? '1' : '0',
          ])
          json(200, { ok: true })
        } catch (e) {
          // 恢复失败不该让前端卡在浮层里，照样回 200，把原因带上
          json(200, { ok: false, error: String((e && e.message) || e) })
        }
        return
      }

      json(404, { ok: false, error: 'not found' })
    },
  }))
}
