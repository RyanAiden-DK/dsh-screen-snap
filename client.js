/**
 * dsh-screen-snap — 客户端半边（划区版）。
 *
 * 交互照微信截图来：
 *   点相机 → 宿主藏起 DSH、冻结整块屏幕、再把窗口最大化还回来 →
 *   客户端用那张冻结图铺满窗口当画布 → 拖出矩形 → 松开后可拖动/拉边调整 →
 *   ✓ 或回车确认、✕ 或 Esc 取消 → 确认的那块裁下来，直接塞进输入框当图片附件。
 *
 * 为什么要把 DSH 最大化：选区要覆盖整个屏幕，而浮层只能画在 DSH 自己的窗口里。
 * 窗口铺满屏幕后，冻结图按屏幕坐标贴上去，看起来就跟没动过一样。
 */
window.__ModuleLoader__.load((() => {
  const APP_BASE = (() => {
    try {
      const src = document.currentScript && document.currentScript.src
      const m = src ? /^(.*?)\/plugins\//.exec(new URL(src, location.href).pathname) : null
      return m ? String(m[1]).replace(/\/+$/, '') : ''
    } catch (e) {
      return ''
    }
  })()

  return {
    id: 'dsh-screen-snap',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      const React = require('react')

      const CSS_ID = 'dsh-screen-snap-style'
      const CSS = [
        '.dss-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .12s ease,color .12s ease}',
        '.dss-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
        '.dss-btn[data-busy="1"]{opacity:.55;cursor:progress}',
        '.dss-btn svg{width:16px;height:16px;display:block}',

        '.dss-ov{position:fixed;inset:0;z-index:2147483000;background:#0a0a0b;cursor:crosshair;user-select:none;overflow:hidden}',
        '.dss-ov img{position:absolute;display:block;pointer-events:none;user-select:none;-webkit-user-drag:none}',
        '.dss-ov-sel{position:absolute;box-sizing:border-box;border:1px solid #6aa9ff;box-shadow:0 0 0 9999px rgba(0,0,0,.52);pointer-events:none}',
        '.dss-ov-sel::after{content:"";position:absolute;inset:0;border:1px solid rgba(255,255,255,.35)}',
        '.dss-ov-size{position:absolute;left:0;top:-24px;padding:2px 7px;border-radius:5px;background:rgba(18,20,24,.86);color:#e8ecf3;font:11px/16px ui-monospace,Consolas,monospace;white-space:nowrap}',
        '.dss-ov-h{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;border-radius:2px;background:#fff;border:1px solid #3f7fe0;pointer-events:auto}',
        '.dss-ov-h[data-d="nw"]{cursor:nwse-resize}.dss-ov-h[data-d="n"]{cursor:ns-resize}',
        '.dss-ov-h[data-d="ne"]{cursor:nesw-resize}.dss-ov-h[data-d="e"]{cursor:ew-resize}',
        '.dss-ov-h[data-d="se"]{cursor:nwse-resize}.dss-ov-h[data-d="s"]{cursor:ns-resize}',
        '.dss-ov-h[data-d="sw"]{cursor:nesw-resize}.dss-ov-h[data-d="w"]{cursor:ew-resize}',
        '.dss-ov-bar{position:absolute;display:flex;gap:8px;padding:7px;border-radius:12px;background:rgba(20,22,27,.92);box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:auto}',
        '.dss-ov-bar button{width:34px;height:34px;border-radius:9px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1}',
        '.dss-ov-ok{background:#2fa84f;color:#fff}.dss-ov-ok:hover{background:#37bd5b}',
        '.dss-ov-no{background:#333842;color:#cfd6e2}.dss-ov-no:hover{background:#3f4653}',
        '.dss-ov-tip{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;background:rgba(20,22,27,.86);color:#cfd6e2;font-size:12px}',
      ].join('\n')

      function ensureStyle() {
        if (document.getElementById(CSS_ID)) return
        const el = document.createElement('style')
        el.id = CSS_ID
        el.textContent = CSS
        document.head.appendChild(el)
      }

      function CameraIcon() {
        return React.createElement('svg', {
          viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        },
        React.createElement('path', { d: 'M4 8.5h2.2l1.3-2h9l1.3 2H20v10H4z' }),
        React.createElement('circle', { cx: 12, cy: 13, r: 3.2 }))
      }

      // 会话级的小 store：按钮和浮层分别挂在两个槽里，靠它同步。
      const store = {
        open: false,
        frame: null,
        busy: false,
        listeners: new Set(),
        subscribe(fn) {
          store.listeners.add(fn)
          return () => store.listeners.delete(fn)
        },
        emit() {
          store.listeners.forEach((fn) => { try { fn() } catch (e) { /* ignore */ } })
        },
        set(patch) {
          Object.assign(store, patch)
          store.emit()
        },
      }
      function useStore() {
        const [, force] = React.useState(0)
        React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
        return store
      }

      const post = async (path, body) => {
        const res = await fetch(`${APP_BASE}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`)
        return data
      }

      const restoreHost = (wasMax) => post('/dsh-screen-snap/region/end', { wasMax })
        .catch((e) => console.warn('[dsh-screen-snap] restore failed', e))

      /** 把一张图变成输入框里的附件：合成一次 paste，交给宿主自己的粘贴逻辑。 */
      function injectImageFile(file) {
        const editor = document.querySelector('[contenteditable="true"]')
        if (!editor) return false
        try {
          editor.focus()
          const dt = new DataTransfer()
          dt.items.add(file)
          const ev = new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          })
          editor.dispatchEvent(ev)
          return true
        } catch (e) {
          console.warn('[dsh-screen-snap] paste 注入失败', e)
          return false
        }
      }

      function cropToBlob(imgEl, frame, rect) {
        const dpr = window.devicePixelRatio || 1
        // 视口 CSS 坐标 → 冻结图上的像素
        const sx = ((window.screenX || 0) + rect.left) * dpr - frame.vsx
        const sy = ((window.screenY || 0) + rect.top) * dpr - frame.vsy
        return new Promise((resolve) => {
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(rect.width * dpr))
          canvas.height = Math.max(1, Math.round(rect.height * dpr))
          const ctx = canvas.getContext('2d')
          ctx.drawImage(imgEl, Math.round(sx), Math.round(sy), canvas.width, canvas.height,
            0, 0, canvas.width, canvas.height)
          canvas.toBlob((blob) => resolve(blob), 'image/png')
        })
      }

      function SnapButton() {
        const [busy, setBusy] = React.useState(false)
        ensureStyle()

        const onClick = async () => {
          if (busy || store.open) return
          setBusy(true)
          // 先把窗口顶成全屏：选区要覆盖整块屏幕，而浮层只能画在 DSH 窗口里。
          // 必须在用户手势的同一拍里调用，不然会被浏览器拒。
          try {
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
              const p = document.documentElement.requestFullscreen()
              if (p && p.catch) p.catch(() => {})
            }
          } catch (e) { /* 全屏被拒就走窗口内选区 */ }
          try {
            const data = await post('/dsh-screen-snap/region/start')
            store.set({
              open: true,
              busy: false,
              frame: {
                url: `${APP_BASE}/dsh-screen-snap/region/frame?t=${Date.now()}`,
                vsx: data.vsx, vsy: data.vsy, vsw: data.vsw, vsh: data.vsh,
                wasMax: data.wasMax,
              },
            })
          } catch (e) {
            console.warn('[dsh-screen-snap]', e)
            store.set({ open: false, busy: false, frame: null })
            await restoreHost(0)
          } finally {
            setBusy(false)
          }
        }

        return React.createElement('button', {
          type: 'button',
          className: 'dss-btn',
          title: '截图：拖框选一块区域，回车确认',
          'data-busy': busy ? '1' : '0',
          onClick,
        }, React.createElement(CameraIcon))
      }

      const HANDLES = [
        ['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0],
        ['w', 0, 50], ['e', 100, 50],
        ['sw', 0, 100], ['s', 50, 100], ['se', 100, 100],
      ]

      function RegionOverlay() {
        const s = useStore()
        const frame = s.frame
        const [rect, setRect] = React.useState(null)
        const [tip, setTip] = React.useState('')
        const imgRef = React.useRef(null)
        const dragRef = React.useRef(null)
        const [imgReady, setImgReady] = React.useState(false)
        ensureStyle()

        React.useEffect(() => {
          if (!frame) { setRect(null); setImgReady(false) }
        }, [frame])

        React.useEffect(() => {
          if (!frame) return
          const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            else if (e.key === 'Enter') { e.preventDefault(); confirm() }
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        })

        if (!frame) return null

        const dpr = window.devicePixelRatio || 1
        // 全屏后视口左上角在屏幕上的位置（CSS px）；冻结图按它对齐到真实像素上。
        const ox = window.screenX || 0
        const oy = window.screenY || 0
        const imgStyle = {
          left: `${frame.vsx / dpr - ox}px`,
          top: `${frame.vsy / dpr - oy}px`,
          width: `${frame.vsw / dpr}px`,
          height: `${frame.vsh / dpr}px`,
        }

        const close = async () => {
          store.set({ open: false, frame: null })
          try {
            if (document.fullscreenElement) await document.exitFullscreen()
          } catch (e) { /* ignore */ }
          await restoreHost(frame.wasMax)
        }

        const cancel = async () => {
          if (s.busy) return
          await close()
        }

        const confirm = async () => {
          if (s.busy) return
          const r = rect
          if (!r || r.width < 4 || r.height < 4) { setTip('先拖出一块区域'); return }
          const img = imgRef.current
          if (!img || !imgReady) { setTip('截图还没准备好'); return }
          store.set({ busy: true })
          try {
            const blob = await cropToBlob(img, frame, r)
            if (!blob) throw new Error('裁图失败')
            const file = new File([blob], `snap-${Date.now()}.png`, { type: 'image/png' })
            const ok = injectImageFile(file)
            if (!ok) {
              try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) } catch (e) { /* ignore */ }
              setTip('已复制到剪贴板，Ctrl+V 粘贴')
              store.set({ busy: false })
              await close()
              return
            }
            store.set({ busy: false })
            await close()
          } catch (e) {
            console.warn('[dsh-screen-snap]', e)
            setTip(String((e && e.message) || e).slice(0, 50))
            store.set({ busy: false })
          }
        }

        const pointOf = (e) => {
          const host = e.currentTarget.getBoundingClientRect()
          return { x: e.clientX - host.left, y: e.clientY - host.top }
        }

        const onDown = (e) => {
          if (e.button !== 0) return
          const p = pointOf(e)
          const inside = rect && p.x >= rect.left && p.x <= rect.left + rect.width
            && p.y >= rect.top && p.y <= rect.top + rect.height
          if (inside) {
            dragRef.current = { mode: 'move', startX: p.x, startY: p.y, base: { ...rect } }
          } else {
            dragRef.current = { mode: 'new', startX: p.x, startY: p.y }
            setRect({ left: p.x, top: p.y, width: 0, height: 0 })
          }
          setTip('')
        }

        const onMove = (e) => {
          const d = dragRef.current
          if (!d) return
          const p = pointOf(e)
          if (d.mode === 'new') {
            setRect(normalize(d.startX, d.startY, p.x, p.y))
            return
          }
          if (d.mode === 'move') {
            setRect({ left: d.base.left + (p.x - d.startX), top: d.base.top + (p.y - d.startY), width: d.base.width, height: d.base.height })
            return
          }
          setRect(resize(d.base, d.dir, p.x - d.startX, p.y - d.startY))
        }

        const onUp = () => {
          const d = dragRef.current
          dragRef.current = null
          if (!d) return
          setRect((r) => (r && (r.width < 3 || r.height < 3) ? null : r))
        }

        const handleDown = (dir) => (e) => {
          e.stopPropagation()
          if (e.button !== 0) return
          const p = pointOf(e)
          dragRef.current = { mode: 'resize', dir, startX: p.x, startY: p.y, base: { ...rect } }
        }

        const barStyle = rect ? barPositionOf(rect) : null

        return React.createElement('div', {
          className: 'dss-ov',
          onMouseDown: onDown,
          onMouseMove: onMove,
          onMouseUp: onUp,
          onMouseLeave: onUp,
          onContextMenu: (e) => { e.preventDefault(); cancel() },
        },
        React.createElement('img', {
          ref: imgRef, src: frame.url, style: imgStyle, draggable: false,
          onLoad: () => setImgReady(true),
        }),
        rect && rect.width > 0 && rect.height > 0 ? React.createElement('div', {
          className: 'dss-ov-sel',
          style: { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` },
        },
        React.createElement('span', { className: 'dss-ov-size' },
          `${Math.round(rect.width * dpr)} × ${Math.round(rect.height * dpr)}`),
        HANDLES.map(([dir, x, y]) => React.createElement('div', {
          key: dir, className: 'dss-ov-h', 'data-d': dir,
          style: { left: `${x}%`, top: `${y}%` },
          onMouseDown: handleDown(dir),
        }))) : null,
        rect && rect.width > 0 && rect.height > 0 && barStyle ? React.createElement('div', {
          className: 'dss-ov-bar', style: barStyle,
          onMouseDown: (e) => e.stopPropagation(),
        },
        React.createElement('button', {
          type: 'button', className: 'dss-ov-ok', title: '使用这张图（回车）',
          onClick: confirm, disabled: s.busy,
        }, '✓'),
        React.createElement('button', {
          type: 'button', className: 'dss-ov-no', title: '取消（Esc）',
          onClick: cancel, disabled: s.busy,
        }, '✕')) : null,
        !rect && React.createElement('div', { className: 'dss-ov-tip' },
          '拖拽选择区域 · 回车确认 · Esc 取消'),
        tip && React.createElement('div', { className: 'dss-ov-tip', style: { top: '56px' } }, tip))
      }

      function normalize(x1, y1, x2, y2) {
        return {
          left: Math.min(x1, x2),
          top: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        }
      }

      function resize(base, dir, dx, dy) {
        let left = base.left
        let top = base.top
        let right = base.left + base.width
        let bottom = base.top + base.height
        if (dir.includes('w')) left += dx
        if (dir.includes('e')) right += dx
        if (dir.includes('n')) top += dy
        if (dir.includes('s')) bottom += dy
        if (right - left < 4) right = left + 4
        if (bottom - top < 4) bottom = top + 4
        return { left, top, width: right - left, height: bottom - top }
      }

      function barPositionOf(rect) {
        const w = window.innerWidth
        const h = window.innerHeight
        const bw = 92
        const bh = 48
        let left = rect.left + rect.width - bw
        if (left < 8) left = 8
        if (left + bw > w - 8) left = w - bw - 8
        let top = rect.top + rect.height + 10
        if (top + bh > h - 8) top = rect.top - bh - 10
        if (top < 8) top = rect.top + 10
        return { left: `${left}px`, top: `${top}px` }
      }

      exports.inject = ['slots']
      exports.apply = (ctx) => {
        const slots = ctx.get('slots')
        if (!slots) return
        slots.inject('conversation.input.left', () => slots.register(
          { name: 'conversation.input.left', id: 'screen-snap', order: 6, label: '截图' },
          () => React.createElement(SnapButton),
        ))
        slots.inject('conversation.input.overlay', () => slots.register(
          { name: 'conversation.input.overlay', id: 'screen-snap', order: 6, label: '截图' },
          () => React.createElement(RegionOverlay),
        ))
      }

      return module.exports
    },
  }
})())
