# AGENTS.md — 给 AI 代理的项目说明

## 这是什么

`dsh-bigfishpet` 把 Bigfish 的桌面宠物（**鲸鱼娘**）做成 DeepSeek Harness 的一等公民：

- **DSH 插件**（仓库根目录）：**通用插件，不绑定任何特定壳/客户端**（Bigfish、dsh-desktop 都只是它运行的环境之一）。任何 DeepSeek Harness 环境只要执行 `dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet`（或用对应 profile 的 `dsh plugin add`）即可安装。它在 DSH 设置里提供「桌宠」页（显示开关、大小[带默认刻度尺]、位置、改名、摸头/喂食、完成提醒），状态持久化到 `~/.dsh/pet.json`；监听 `agent/status` 写完成标记并累计亲密度。插件只依赖 DSH 标准接口（HTTP 路由 `/bigfish-pet/*`、client bundle、`agent/status` 事件），不依赖 Bigfish / dsh-desktop 的私有 API。
- **壳侧整合**（`bigfish/`，**可选**）：置顶的**剪影窗口**——部分系统不合成透明窗口，所以宠物窗口用 `win.setShape()` 按角色轮廓裁剪（不透明、无背景矩形），由 DSH 插件通过 `pet.json` 驱动。这是 Bigfish 壳的整合示例；其他客户端想显示宠物需做等价的窗口整合（见下文「功能边界」）。

## 目录

```
dsh-bigfishpet/
├── lib/index.js      # 插件 Host：/bigfish-pet/* HTTP 路由、pet.json 读写、完成标记、主目录探测
├── lib/client.js     # 插件 Client：「桌宠」设置页（草稿+保存；大小滑块带默认刻度尺）
├── cordis.patch.yml  # 插件挂载行
├── package.json      # 插件包（dsh.bundle.patch + dsh.client）
└── bigfish/          # 壳侧整合（可选，仅 Bigfish 壳需要）
    ├── main.js       # 0.1.1 基础 + 桌宠整合（置顶剪影窗口 / 右键最小化 / 完成气泡；无背景图注入）
    ├── pet.html / pet.js / pet-preload.js
    ├── pet-shapes.json   # 10 帧角色轮廓矩形（win.setShape 裁剪用，含原生宽高）
    └── assets/pet/*.png  # 鲸鱼娘动画帧
```

## 功能边界（改代码 / 排查「看不到宠物」前先读）

- **插件不创建窗口**：DSH 插件跑在 Web 后端里，建不了 Electron 窗口。宠物窗口必须由**壳侧代码**创建——本仓库 `bigfish/main.js` 就是 Bigfish 壳的整合实现。
- 因此在**没有壳侧整合**的客户端（如 dsh-desktop、纯 web profile、以及任何只装了插件没装壳侧文件的 Harness 环境）上，`dsh plugin add` 安装后**只会出现「桌宠」设置页**：`pet.json` 正常读写、`agent/status` 完成信号正常记录——但**不会有宠物窗口**。这是预期行为，不是插件 bug。
- 排查「看不到宠物」的顺序：(1) 壳侧整合文件是否已装入该客户端的应用目录（如 Bigfish 的 `resources\app`）并重启；(2) `pet.json` 的 `display.visible` 是否为 `true`；(3) 客户端是否为支持 Electron 窗口的桌面壳（纯浏览器访问 web profile 无窗口能力）。
- 若要让其他客户端也显示宠物，需要在该壳里做等价的窗口整合（参考 `bigfish/` 的实现），或让该客户端使用已整合的 Bigfish 壳。

## 关键约定（改代码前必读）

### 状态与通信

- **单一事实源**：`~/.dsh/pet.json`（name / affinity / treats / display{visible,size,right,bottom} / notify）。
- **完成信号**：插件 Host 监听 `agent/status`，根会话（`session.header.parentSession == null`）从 running → idle 时向 `~/.dsh/bigfish-completions.jsonl` 追加一行；Bigfish 的 main.js 监视该文件让宠物气泡「任务完成啦！🎉」。不要用目录 mtime 猜测。
- **主目录探测**：Host 的 `pickHome()` 在 `DSH_HOME` 与 `~/.dsh` 之间选有 `pet.json` 的那个，保证 DSH Desktop 与 Bigfish 共享状态。

### 宠物窗口（bigfish/ 侧）

- **必须是不透明窗口**：这台目标机器不合成透明窗口、也不能改渲染配置（`disableHardwareAcceleration`/`disable-gpu-compositing`/`enable-transparent-visuals` 都会让主窗口卡死）。改动渲染开关前先记住这个限制。
- **形状裁剪**：`main.js` 的 `applyPetShape()` 用 `PET_SHAPES[当前帧]` 的矩形 + `petWindow.setShape()` 裁剪；映射必须与渲染一致——**img 固定在方形盒子里（宽=高=size×0.98，`object-fit: contain`）**，形状按 contain 公式 `scale=min(box/帧宽, box/160)` + 居中偏移计算；矩形宽高 +1 扩张以消除取整缝隙。改动画帧/尺寸时两者必须同步改。
- **气泡**：`pet.js` 显示气泡期间每 200ms 上报 `getBoundingClientRect`（`pet-bubble-show` IPC），main.js 并入形状；气泡 CSS 必须 `box-sizing: border-box`（否则 max-width 不含 padding，会溢出窗口被裁剪——已踩过坑）。
- **交互**：左键=说话+吃；右键=`toggleMainWindowMinimize()`（最小化到任务栏/打开，不隐藏到托盘）；拖动后 `pet-drag-end` 回写 `pet.json`。
- **渲染日志**：`appendPetLog` 写到 Bigfish userData 的 `pet-render.log`，排查显示问题先看它。

### 插件设置页（lib/client.js）

- 草稿式编辑，点「保存」才提交（POST `/bigfish-pet/state`）。
- 大小滑块下有一条刻度尺（80–280，默认 160 突出标记、蓝色标当前值），用户需要知道默认大小。

## 验证方式

```powershell
# 语法检查（仓库 + 已安装插件）
$node = 'E:\AI\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
& $node --check D:\AI\DSH\dsh-bigfishpet\lib\index.js
& $node --check D:\AI\DSH\dsh-bigfishpet\bigfish\main.js
& $node --check D:\AI\DSH\dsh-bigfishpet\bigfish\pet.js

# 轮廓数据（pet-shapes.json）是从 PNG 生成的；改了动画帧后要重新生成
# 生成脚本：按 alpha>128 逐行扫描 + 纵向合并矩形，输出 {frame: {w, rects}}
```

插件安装路径（同步目标）：`C:\Users\Administrator\.dsh\profiles\web\node_modules\bigfish-pet\`
Bigfish 应用目录（壳侧同步目标）：`E:\AI\Bigfish\resources\app\`

改完插件 Host/Client 后要同步到已安装插件；改完壳侧文件后要同步到 `resources\app` 并重启 Bigfish 生效。

## 注意事项

- 仓库是 Git 项目；每次改动记得 `git add -A && git commit`。
- 不要删除 `pet-shapes.json`（可从 `assets/pet/*.png` 重新生成，但别在运行时生成）。
- 测试完成标记时可用 `Add-Content` 往 `~/.dsh/bigfish-completions.jsonl` 追加一行触发气泡，测完清理测试行。
