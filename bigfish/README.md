# Bigfish 壳侧整合

这部分是 **Bigfish（DeepSeek Harness 桌面壳）** 里的桌宠实现，与 DSH 插件（仓库根目录）配合：

| 文件 | 作用 |
| --- | --- |
| `main.js` | 基于 Bigfish 0.1.1 的 main.js，整合了置顶剪影宠物窗口（`setShape` 裁剪、`pet.json` 驱动、右键最小化/打开、完成标记气泡），移除了旧的目录 mtime 任务完成通知 |
| `pet.html` / `pet.js` | 宠物渲染页：鲸鱼娘动画（idle/eat/sleep/walk）+ 气泡；按帧上报轮廓给主进程 |
| `pet-preload.js` | 渲染器桥（拖拽/点击/右键/帧/气泡） |
| `pet-shapes.json` | 10 帧角色轮廓矩形（`win.setShape` 裁剪用，含各帧原生宽高） |
| `assets/pet/*.png` | 鲸鱼娘动画帧（10 张） |

## 应用到 Bigfish 安装

```powershell
# 目标：Bigfish 安装目录的 resources\app
$app = 'E:\AI\Bigfish2\resources\app'   # 按实际安装路径调整
Copy-Item main.js pet.html pet.js pet-preload.js pet-shapes.json $app -Force
Copy-Item -Recurse assets\pet $app\assets\ -Force
```

然后重启 Bigfish。宠物按 `~/.dsh/pet.json` 显示；没有插件时也按默认配置（鲸鱼娘 / 160px / 右下角）显示，但设置页与完成标记需要 DSH 插件。

## 与官方 0.1.1 main.js 的差异

保留官方功能：后端清理与失败重试、启动检查更新、背景图、新手向导、托盘、右键菜单、`--open` 等。
移除/替换：

- 旧透明宠物窗口 → 不透明 + `setShape` 剪影窗口（透明窗口在某些系统不合成）；
- 旧的目录 mtime 任务完成启发式（`notifyOnComplete`）→ 完成标记文件监视（宠物气泡）；
- 托盘「桌面萌宠 / 任务完成时通知」项（宠物显示由 DSH 设置页通过 `pet.json` 控制）；
- 新增：`pet-drag-end`（拖动回写 `pet.json`）、`pet-right-clicked`（最小化/打开）、`pet-frame`/`pet-bubble-*`（按帧裁剪与气泡区域）、`pet-log-error`（渲染日志）。
