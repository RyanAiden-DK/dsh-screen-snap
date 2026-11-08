# dsh-screen-snap

DeepSeek Harness 的截图按钮：**点一下，把 DSH 藏起来，抓它下面那个窗口** —— 也就是你点按钮之前正在看的东西。

抓到的图存在临时目录，同时把 `[截图] <路径>` 填进输入框草稿。你接着打字提问，助手直接读那个路径看图，不用你再截、切窗口、粘贴。

> 只支持 Windows（用的是 Win32 的窗口枚举 + GDI 抓屏），macOS/Linux 上不工作。

## 为什么不是「直接抓前台窗口」

按钮在 DSH 里。你点它的那一刻，DSH 就是前台窗口，直接 `GetForegroundWindow` 抓到的永远是 DSH 自己。所以流程必须是：

```
点按钮 → 宿主按 PID 找到 DSH 窗口 → ShowWindow(SW_HIDE)
       → 枚举 Z 序，取第一个可见的非宿主窗口 → CopyFromScreen
       → ShowWindow(SW_SHOW) + SetForegroundWindow
```

代价是屏幕会闪一下（约 0.3 秒）。换来的是「随手一点」而不是「先切窗口再回来点」。

## 安装

```bash
dsh plugin --profile <profile> add ./dsh-screen-snap
```

在本仓库**父目录**执行（`dsh plugin add` 按调用目录解析相对路径），或者直接写绝对路径。装完重启 DSH，输入框左边多一个相机图标。

## 实现

| 半边 | 文件 | 职责 |
|---|---|---|
| 宿主 | `index.js` | 注册 `POST /dsh-screen-snap/capture`；spawn `powershell.exe` 跑脚本；读回 PNG，存进 DSH 附件（`attachments.saveImage`），回传 `{ok, path, width, height, attachment}` |
| 脚本 | `scripts/shot.ps1` | 藏窗口 / 抓窗口 / 恢复窗口；只依赖 .NET Framework 自带能力，没有第三方包 |
| 客户端 | `client.js` | 往 `conversation.input.left` 槽挂按钮；拿到路径后 `insertText` 进草稿，失败则 `setDraft`，再失败就复制到剪贴板 |

失败路径：按宿主 PID 找不到窗口时，退回按标题匹配 `DeepSeek Harness`；截图失败则按钮 tooltip 显示错误原因，不弹窗。

## 已知限制

- **隐藏窗口需要权限**：如果 DSH 以更高权限运行，或宿主进程被沙箱限制了窗口操作（`ShowWindow` 返回 `false`），藏不起来，这时抓到的还是 DSH 自己。
- 只抓**一个**窗口，不支持框选区域、整屏、滚动截长图。
- 不做 OCR / 标注 / 截图历史。
- 屏幕闪一下是设计的一部分，不是 bug。

## 单独用脚本

不装插件也能用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/shot.ps1 -Mode behind -OutDir out\shots
```

`-Mode` 可选 `behind`（默认）/ `topmost` / `foreground` / `screen` / `list`（列出当前可见窗口，排查「抓到的是哪个窗口」时用）。

## License

MIT
