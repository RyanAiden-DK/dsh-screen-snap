# dsh-screen-snap

DeepSeek Harness 的**划区截图**按钮：点一下，屏幕冻结，拖个框，回车，图直接进输入框。

和微信截图一个手感 —— 不存文件、不给你路径，选中的那块就是聊天里的一条图片消息。

> 只支持 Windows（Win32 窗口操作 + GDI 抓屏），macOS / Linux 不工作。

## 怎么用

1. 点输入框左边的相机图标
2. DSH 窗口消失一拍，整块屏幕被冻结成一张图，然后窗口全屏回来 —— 你看到的还是刚才那个画面，只是不动了
3. **拖出矩形**：选区内保持原样，外面压暗，边框蓝色，八向把手白点，左上角实时显示真实像素尺寸
4. 松手后还能改：**框内拖动**整体挪，**拉把手**改边
5. **回车**或点 **✓** 用这张；**Esc**、**✕** 或右键取消

确认后，那块图会作为**图片附件**贴进草稿，直接发送即可。

## 为什么这么绕

按钮在 DSH 里，点它的那一刻 DSH 就是前台窗口，直接抓屏只会抓到自己。所以：

```
点按钮 → requestFullscreen() + POST /region/start
       → 宿主让 DSH 窗口藏起来一拍（ShowWindow SW_HIDE）
       → 抓整块虚拟屏幕（一次 CopyFromScreen）
       → 窗口恢复并全屏
       → 客户端把这张冻结图铺满视口，在它上面画选区
       → 确认时 canvas 裁切 → 合成 paste 事件 → 进入输入框草稿
```

两个关键选择：

- **冻结后再选**，而不是选完再抓。选区期间屏幕内容不会变，选什么就得到什么。
- **全屏靠浏览器的 Fullscreen API**，不靠 Win32 最大化。浮层只能画在窗口里，窗口必须铺满屏幕；Fullscreen API 在用户手势里同步调用最稳，也省掉我们管窗口状态。

截图走**粘贴**而不是附件 API：DSH 的草稿附件是浏览器持有的（`conversation.createDrafts`，图片以 `File` 形式随 prompt 一起发），插件拿不到那个入口；但输入框的粘贴处理器不看 `isTrusted`，构造一个带 PNG 的 `DataTransfer` 丢进去，就走宿主自己的上传逻辑。

## 安装

```bash
dsh plugin --profile <profile> add ./dsh-screen-snap   # 相对路径按调用目录解析
dsh plugin --profile <profile> add C:\path\to\dsh-screen-snap
```

装完**完全退出并重启 DSH**（插件在启动时组装 bundle），输入框左边出现相机图标。

## 实现

| 半边 | 文件 | 职责 |
|---|---|---|
| 宿主 | `index.js` | 三个端点：`POST /region/start` 冻结屏幕、`GET /region/frame` 把 PNG 给前端、`POST /region/end` 恢复窗口 |
| 脚本 | `scripts/region.ps1` | 找窗口、藏、抓虚拟屏幕、恢复；只依赖 .NET Framework 自带能力 |
| 客户端 | `client.js` | 相机按钮、全屏冻结图浮层、选区与把手、裁切、粘贴注入 |

坐标换算：视口左上角在屏幕上的位置取 `window.screenX/screenY`，冻结图按 `devicePixelRatio` 贴到真实像素上，裁切时三者相加。多显示器时 `vsx/vsy` 可能为负，同一套公式兼容。

## 已知限制

- **多显示器**：一次冻结的是整个虚拟桌面，几何公式按虚拟屏原点算；理论上跨屏也能选，但只在单屏 + 100% 缩放下实测过。
- **全屏可能被拒**：Chromium 在某些策略下拒绝 `requestFullscreen()`，此时浮层只覆盖 DSH 窗口那块，选不到窗口外的区域。
- **输入框被锁时粘贴会失败**：正在提交/裁决中的输入框不接受注入，此时图会退到剪贴板，需要手动 Ctrl+V。
- 不做 OCR、标注、滚动截长图、截图历史。
- 每次点按钮屏幕会闪一下（约 0.3 秒），这是「先冻结再选」的代价。

## 单独用脚本

不装插件也能抓整块屏幕：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/region.ps1 -Mode frame -OutDir out\frames
```

输出最后一行是 `@@{...}`，带图片路径和虚拟屏/窗口的几何信息（`vsx/vsy/vsw/vsh`）。

## License

MIT
