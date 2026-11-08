/**
 * dsh-screen-snap — 客户端半边。
 *
 * 在输入框左侧挂一个相机按钮：点一下 → 宿主藏起 DSH、抓下面那个窗口、恢复 DSH
 * → 返回图片路径 → 把路径插进输入框草稿。为什么插路径而不是插图片附件：
 * 宿主已经用 attachments.saveImage 存过一份，但客户端草稿的附件接口没有公开契约，
 * 插一个 `[截图] <路径>` 的文本是稳的 —— 助手读得到这个路径，效果一样。
 */
window.__ModuleLoader__.load((() => {
  // 子路径部署时接口也要带同一前缀；factory 执行时 currentScript 已经被摘掉，
  // 所以必须在 bundle 顶层算一次。
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

      function SnapButton(props) {
        const [busy, setBusy] = React.useState(false)
        const [tip, setTip] = React.useState('')
        ensureStyle()

        const insertToken = (token) => {
          const actions = props && props.inputActions
          if (actions && typeof actions.insertText === 'function' && typeof actions.captureInsertion === 'function') {
            try {
              if (actions.insertText(token, actions.captureInsertion()) === true) return true
            } catch (e) { /* 落到 setDraft */ }
          }
          if (actions && typeof actions.setDraft === 'function') {
            try {
              const cur = typeof actions.getDraft === 'function' ? String(actions.getDraft() || '') : ''
              actions.setDraft(cur ? `${cur} ${token}` : token)
              return true
            } catch (e) { return false }
          }
          return false
        }

        const onClick = async () => {
          if (busy) return
          setBusy(true)
          setTip('')
          try {
            const res = await fetch(`${APP_BASE}/dsh-screen-snap/capture`, { method: 'POST' })
            const body = await res.json()
            if (!body || !body.ok) throw new Error((body && body.error) || `HTTP ${res.status}`)
            const token = `[截图] ${body.path}`
            if (!insertToken(token)) {
              // 兜底：至少把路径放进剪贴板，用户能自己粘
              try { await navigator.clipboard.writeText(body.path) } catch (e) { /* ignore */ }
              setTip('路径已复制')
            }
          } catch (e) {
            setTip(String((e && e.message) || e).slice(0, 60))
            console.warn('[dsh-screen-snap]', e)
          } finally {
            setBusy(false)
          }
        }

        return React.createElement('button', {
          type: 'button',
          className: 'dss-btn',
          title: tip || '截图：把 DSH 藏一下，抓它下面的窗口',
          'data-busy': busy ? '1' : '0',
          onClick,
        }, React.createElement(CameraIcon))
      }

      exports.inject = ['slots']
      exports.apply = (ctx) => {
        const slots = ctx.get('slots')
        if (!slots) return
        slots.inject('conversation.input.left', () => slots.register(
          { name: 'conversation.input.left', id: 'screen-snap', order: 6, label: '截图' },
          (props) => React.createElement(SnapButton, props),
        ))
      }

      return module.exports
    },
  }
})())
