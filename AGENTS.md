# AGENTS.md — 给 AI 代理的项目说明

## 这是什么

`dsh-bigfishpet` 把 Bigfish 的桌面宠物（**鲸鱼娘**）做成 DeepSeek Harness 的一等公民：

- **DSH 插件**（仓库根目录）：**通用插件，不绑定任何特定壳/客户端**（Bigfish、dsh-desktop 都只是它运行的环境之一）。任何 DeepSeek Harness 环境只要执行 `dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet`（或用对应 profile 的 `dsh plugin add`）即可安装。它在 DSH 设置里提供「桌宠」页（显示开关、大小[带默认刻度尺]、位置、改名、完成提醒），状态持久化到 `~/.dsh/pet.json`；内置**状态机**（借鉴 dsh-dafeiyu）：监听 DSH 标准 `session/event` 把真实任务归约为 思考/工作/等待/完成/出错 + 阶段/待办/进度，写 `pet.json#status` 驱动宠物。**无亲密度/零食系统**（已移除）。插件只依赖 DSH 标准接口，不依赖 Bigfish / dsh-desktop 的私有 API。
- **壳侧整合**（`bigfish/`，**可选**）：置顶的**剪影窗口**——部分系统不合成透明窗口，所以宠物窗口用 `win.setShape()` 按角色轮廓裁剪（不透明、无背景矩形），由 DSH 插件通过 `pet.json` 驱动。这是 Bigfish 壳的整合示例；其他客户端想显示宠物需做等价的窗口整合（见下文「功能边界」）。

## 目录

```
dsh-bigfishpet/
├── lib/index.js               # 插件 Host：/bigfish-pet/* HTTP 路由、pet.json 读写、状态机接入、完成标记、主目录探测
├── lib/pet-status-reducer.js  # 状态机归约器（借鉴 dsh-dafeiyu）：session/event → status（状态/阶段/待办/进度/项目）
├── lib/client.js              # 插件 Client：「桌宠」设置页（草稿+保存；大小滑块带默认刻度尺；当前状态只读区）
├── cordis.patch.yml           # 插件挂载行
├── package.json               # 插件包（dsh.bundle.patch + dsh.client）
└── bigfish/                   # 壳侧整合（可选，仅 Bigfish 壳需要）
    ├── main.js                # 0.1.1 基础 + 桌宠整合（置顶剪影窗口 / 状态卡 / 鼠标方向走动 / 右键最小化；无背景图注入）
    ├── pet.html / pet.js / pet-preload.js
    ├── pet-shapes.json        # 10 帧角色轮廓矩形（win.setShape 裁剪用，含原生宽高）
    └── assets/pet/*.png       # 鲸鱼娘动画帧
```

## 功能边界（改代码 / 排查「看不到宠物」前先读）

- **插件不创建窗口**：DSH 插件跑在 Web 后端里，建不了 Electron 窗口。宠物窗口必须由**壳侧代码**创建——本仓库 `bigfish/main.js` 就是 Bigfish 壳的整合实现。
- 因此在**没有壳侧整合**的客户端（如 dsh-desktop、纯 web profile、以及任何只装了插件没装壳侧文件的 Harness 环境）上，`dsh plugin add` 安装后**只会出现「桌宠」设置页**：`pet.json` 正常读写、`agent/status` 完成信号正常记录——但**不会有宠物窗口**。这是预期行为，不是插件 bug。
- 排查「看不到宠物」的顺序：(1) 壳侧整合文件是否已装入该客户端的应用目录（如 Bigfish 的 `resources\app`）并重启；(2) `pet.json` 的 `display.visible` 是否为 `true`；(3) 客户端是否为支持 Electron 窗口的桌面壳（纯浏览器访问 web profile 无窗口能力）。
- 若要让其他客户端也显示宠物，需要在该壳里做等价的窗口整合（参考 `bigfish/` 的实现），或让该客户端使用已整合的 Bigfish 壳。

## 关键约定（改代码前必读）

### 状态与通信

- **单一事实源**：`~/.dsh/pet.json`（name / display{visible,size,right,bottom} / notify / activity / bubbleScale / bubbleMode / bubbleStates / reducedMotion / walkCooldownMin / includeSubagents / status）。**无 affinity/treats**（亲密度系统已移除，POST /state 不再支持 action=pet|feed）。
- **状态机（主信号）**：Host 监听 DSH 标准 `session/event`（`{ global: true }`，事件类型 turn/start、assistant/message、tool/call、tool/result、todo/write、turn/end、session/disposed…），由 `lib/pet-status-reducer.js` 归约为 IDLE/THINKING/WORKING/WAITING/SUCCESS/ERROR + stage（查找/实现/验证/执行阶段）+ task/progress（来自 todo/write 的真实待办）+ project；多会话按 **等待>错误>工作>思考>空闲** 优先级选最需要注意的；结果防抖 200ms 写 `pet.json#status`。SUCCESS/ERROR 是一次性 flash（壳侧消费后状态本身回 IDLE）。**无真实待办时不编造进度百分比**。
- **完成标记（兼容旧壳）**：`agent/status` 根会话（`parentSession == null`）running → idle 仍向 `~/.dsh/bigfish-completions.jsonl` 追加一行；**本壳（bigfish/main.js）已不再监视该文件**——完成庆祝由状态机 SUCCESS flash 驱动。
- **主目录探测**：Host 的 `pickHome()` 在 `DSH_HOME` 与 `~/.dsh` 之间选有 `pet.json` 的那个，保证 DSH Desktop 与 Bigfish 共享状态。

### 宠物窗口（bigfish/ 侧）

- **必须是不透明窗口**：这台目标机器不合成透明窗口、也不能改渲染配置（`disableHardwareAcceleration`/`disable-gpu-compositing`/`enable-transparent-visuals` 都会让主窗口卡死）。改动渲染开关前先记住这个限制。
- **形状裁剪**：`main.js` 的 `applyPetShape()` 用 `PET_SHAPES[当前帧]` 的矩形 + `petWindow.setShape()` 裁剪；映射必须与渲染一致——**img 固定在方形盒子里（宽=高=size×0.98，`object-fit: contain`）**，形状按 contain 公式 `scale=min(box/帧宽, box/160)` + 居中偏移计算；矩形宽高 +1 扩张以消除取整缝隙。改动画帧/尺寸时两者必须同步改。
- **气泡**：`pet.js` 显示气泡期间每 200ms 上报 `getBoundingClientRect` + radius（`pet-bubble-show` IPC），main.js 并入形状；气泡 CSS 必须 `box-sizing: border-box`（否则 max-width 不含 padding，会溢出窗口被裁剪——已踩过坑）。**dsh-dafeiyu 同款**：大卡片（max-width 360×bubbleScale）+ 大圆角 30px + 近白白卡 `#fcfcfd` + 浅灰细边框 `rgba(218,221,226,.9)` + 左对齐（标题 `#25282d` / detail `#747981`）+ 右侧状态图标（浅底深图形：思考 `#E2ECFF/#4C78E8` 三点、工作 `#DDEBFF/#3478F6`、等待 `#FFF0CE/#D88A00` 感叹号、完成 `#D9F7E4/#12B85A` 对勾、出错 `#FDE3E3/#E5484D` 红叉），**无 box-shadow**（不透明窗口下阴影会落在深色背景上变成黑块）。圆角四角由 setShape **5 矩形逼近**（中心 + 上下左右边条，四角落在裁剪区外 → 透桌面）。**显示规则**（`bubbleMode`）：hidden 永不显示；custom 仅 `bubbleStates` 内的状态；always（默认）下非持久状态（IDLE/SUCCESS）**4.2s 自动消失**，持久状态（THINKING/WORKING/WAITING/ERROR）常驻——空闲时桌面只有干净宠物。
- **轮廓数据（pet-shapes.json）**：由 `scripts/gen-shapes.ps1` 从 `assets/pet/*.png` 生成——**坐标在高归一化到 160 的空间**（`meta.w = 原宽×160/原高`，与 applyPetShape 的 contain 公式 `scale=min(box/meta.w, box/160)` 严格对应）；阈值 alpha>200（PNG alpha 是二值的，128/200 结果相同）。**教训：Bitmap.Width 会被 PNG DPI 元数据缩放，必须从 IHDR 读原始尺寸；原 shapes 的 idle w=160 与当前 idle.png（160×168）不匹配，导致 idle 帧裁剪错位、角色周围露深色背景（黑边）——重新生成后 idle w=152。改了动画帧后必须重新生成并核对各帧 meta.w。**
- **交互**：左键=说话+吃；右键=`toggleMainWindowMinimize()`（最小化到任务栏/打开，不隐藏到托盘）；拖动后 `pet-drag-end` 回写 `pet.json`。
- **状态驱动**：无随机说话/睡觉/散步。动画由 `pet.json#status` 映射（`STATUS_ANIMATION`：THINKING/WORKING→idle、WAITING→sleep、SUCCESS→eat 庆祝、ERROR→提示气泡），flash SUCCESS 时受 `notify.complete` 控制；状态卡气泡**常驻**（主文案 + detail 行：`项目 · 已完成 x/y 步 · 当前待办`），左键说话气泡 3 秒后自动恢复状态卡。
- **鼠标方向走动**：`startCursorWalk()` 按 `ACTIVITY_SPEC[activity]` 的间隔（默认 2000ms）比较光标与窗口中心（`screen.getCursorScreenPoint()`）：光标在左→`doWander('left')`（walk-left），在右→walk-right；仅 idle 时响应，偏移 <死区（默认 250px）不响应；**冷却 `walkCooldownMin`（默认 3 分钟，0=关闭走动）**；reducedMotion 时禁止走动；走动结束 force 重放真实状态动画（sleep 等）。
- **活跃程度**（`pet.json#activity`：quiet/normal/lively）：**间歇式空闲微动作**（大肥鱼同款时间尺度，pet.js 的 `scheduleBreath()`）——大部分时间静止，每隔 安静 20–35s / 标准 12–22s / 活泼 6–12s 随机间隔做一次 ~2.5s 的呼吸脉动（opacity 包络 0→15/20%→0，肉眼可见；quiet 无呼吸；reducedMotion 无呼吸；只改透明度不改 rect，形状不错位）；走动灵敏度 死区 350/250/150px、检测间隔 3000/2000/1000ms。
- **配置推送**：壳侧 `applyPetConfig()` 每 2s 读 pet.json，配置签名（activity/bubbleScale/bubbleMode/bubbleStates/reducedMotion）变化时推 `pet-config` IPC 给渲染进程，并按 reducedMotion/walkCooldownMin 启停走动检测。
- **渲染日志**：`appendPetLog` 写到 Bigfish userData 的 `pet-render.log`，排查显示问题先看它。

### 插件设置页（lib/client.js）

- **dsh-dafeiyu 同款卡片式**：`Field`（label+hint 左、控件右）、每次改动**即时保存**（POST /bigfish-pet/state 全量合并；滑块/输入防抖 250–400ms），无「保存」按钮。
- 设置项：显示桌宠 / 角色大小（80–280 滑块）/ 气泡大小（0.8–1.2）/ 气泡显示（常驻/隐藏/自定义 + 自定义状态多选）/ 活跃程度（安静/标准/活泼）/ 走动冷却（关闭/1/3/5/10 分钟）/ 减少动态效果 / 响应子 Agent / 名字 / 任务完成提醒 / 重置位置。
- 底部只读「当前状态」区展示状态机输出（状态/阶段/当前任务/进度/项目/气泡文案）。

## 验证方式

```powershell
# 语法检查（仓库 + 已安装插件）
$node = 'E:\AI\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
& $node --check D:\AI\DSH\dsh-bigfishpet\lib\index.js
& $node --check D:\AI\DSH\dsh-bigfishpet\bigfish\main.js
& $node --check D:\AI\DSH\dsh-bigfishpet\bigfish\pet.js

# 轮廓数据（pet-shapes.json）是从 PNG 生成的；改了动画帧后要重新生成
& .\scripts\gen-shapes.ps1   # 高归一化到 160 空间、alpha>200、IHDR 原始尺寸
```

插件安装路径（同步目标）：`C:\Users\Administrator\.dsh\profiles\web\node_modules\bigfish-pet\`
Bigfish 应用目录（壳侧同步目标）：`E:\AI\DSH\Bigfish\resources\app\`（注意：不是 `E:\AI\Bigfish`）

改完插件 Host/Client 后要同步到已安装插件；改完壳侧文件后要同步到 `resources\app` 并重启 Bigfish 生效。

## 待办（大肥鱼有、我们暂未做的功能，后续实现）

- [ ] **状态动作帧**（需要美术资源）：每状态专属帧——思考（合十）、工作（拿扫帚）、等待（抬手）、完成（微笑）、出错（生气）+ 空闲微动作（眨眼/观察）+ 程序化 motion（think 浮动 / work 抖动 / bounce 跳跃 / shake 抖动 / wait 轻晃）。帧就位后改 `FRAMES` 映射 + `STATUS_ANIMATION` + 呼吸微动作升级
- [ ] **多任务状态列表**：≥2 个活跃会话时状态卡同时列出各任务（reducer 输出 TASKS → 多行状态卡）
- [ ] **右键菜单增强**：调整大小 / 气泡大小 / 打开 WebUI / 本次隐藏 / 本次关闭
- [ ] **「本次隐藏 / 本次关闭」**：只隐藏窗口不关插件 / 关闭 Helper 本次不再启动
- [ ] **自带窗口宿主（一键安装）**：把壳侧窗口做成插件自带的独立 Helper（PySide6 或 Electron 宿主），彻底去掉壳侧整合步骤

## 注意事项

- 仓库是 Git 项目；每次改动记得 `git add -A && git commit`。
- 不要删除 `pet-shapes.json`（可从 `assets/pet/*.png` 重新生成，但别在运行时生成）。
- 状态机 smoke test：临时脚本模拟 session/event 流验证 `lib/pet-status-reducer.js`（参考上次提交的 `.tmp-smoke.mjs` 写法：turn/start→assistant→tool/call→tool/result→todo/write→turn/end，断言状态/阶段/进度/优先级/flash）。
- 完成庆祝由状态机 SUCCESS flash 驱动；壳侧不再监视 `bigfish-completions.jsonl`（插件仍写该文件兼容旧壳，测试时注意区分）。
