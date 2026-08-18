# AGENTS.md — 给 AI 代理的项目说明

## 这是什么

`dsh-bigfishpet` 把 Bigfish 的桌面宠物（**鲸鱼娘**）做成 DeepSeek Harness 的一等公民：

- **DSH 插件**（仓库根目录）：**通用插件，不绑定任何特定壳/客户端**（Bigfish、dsh-desktop 都只是它运行的环境之一）。任何 DeepSeek Harness 环境只要执行 `dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet`（或用对应 profile 的 `dsh plugin add`）即可安装。它在 DSH 设置里提供「桌宠」卡片（**dsh-dafeiyu 同款**：即时保存、气泡显示/气泡大小/活跃程度/减少动态/响应子 Agent/走动冷却等），配置存 `~/.dsh/pet.json`；内置**状态机 + 桌面 Helper**（照抄 dsh-dafeiyu 架构）：监听 DSH 标准 `session/event` 归约为 思考/工作/等待/完成/出错 + 阶段/待办/进度，通过 JSONL 协议实时驱动 **PySide6 透明宠物窗口**（`runtime/helper.py`）。**无亲密度/零食系统**（已移除）。
- **桌面 Helper**（`runtime/` + `assets/`）：**PySide6 透明窗口**（`WA_TranslucentBackground`）——**本机已验证可正常合成**（此前的「不合成透明窗口」结论只对 Electron 成立，对 Qt 无效）；大圆角状态卡、浅底深图形状态图标、程序化动作（breathe 等）、拖动/右键菜单全部照抄 dsh-dafeiyu `helper.py`。窗口由插件 spawn，**与壳无关**——任何运行本插件的 DSH 环境都会出现宠物（一键安装，无壳侧整合）。

## 目录

```
dsh-bigfishpet/
├── lib/index.js               # 插件 Host：/bigfish-pet/* 路由、pet.json 配置、session/event → CompanionReducer → Helper（照抄 dsh-dafeiyu）
├── lib/client.js              # 插件 Client：「桌宠」设置卡片（dsh-dafeiyu 同款：即时保存、全部可配置项）
├── lib/protocol.js            # Helper JSONL 协议（照抄 dsh-dafeiyu：hello/state/pulse/task/tasks/config/ping/shutdown）
├── lib/companion-reducer.js   # 状态机归约器（照抄 dsh-dafeiyu：事件 → STATE/PULSE/TASK/TASKS 消息）
├── lib/helper-process.js      # Helper 进程管理（照抄 dsh-dafeiyu：spawn/心跳/崩溃重启/快照重放）
├── runtime/                   # PySide6 桌面 Helper（照抄 dsh-dafeiyu：helper.py + animation_model.py + layout_store.py）
├── assets/
│   ├── pet-manifest.json      # 动画清单（10 帧 → 状态映射；动作帧就位后升级）
│   └── pet/*.png              # 鲸鱼娘动画帧（与 bigfish/assets/pet 同步）
├── cordis.patch.yml           # 插件挂载行
├── package.json               # 插件包（dsh.bundle.patch + dsh.client；files 含 lib/runtime/assets）
└── bigfish/                   # 旧 Electron 壳侧桌宠（已停用：main.js 的 DISABLE_ELECTRON_PET=true；保留作参考/回退）
```

## 功能边界（改代码 / 排查「看不到宠物」前先读）

- **窗口由插件自带的 Helper 创建**（`runtime/helper.py`，PySide6 透明窗口）——任何 DSH 环境只要装了插件就会出宠物，**无需壳侧整合**（旧架构的「壳侧整合」已废弃，`bigfish/` 仅作参考）。
- 排查「看不到宠物」：(1) 重启 DSH（插件启动时 spawn Helper）；(2) `~/.dsh/pet.json` 的 `display.visible` 是否为 `true`；(3) Python/PySide6 是否可用（`py -3 -c "import PySide6"`；正式版将打包 exe 随插件分发）；(4) Helper 冒烟测试：`py -3 runtime/helper.py`（需从插件目录跑，读 assets/pet-manifest.json）。

## 关键约定（改代码前必读）

### 状态与通信

- **单一事实源**：`~/.dsh/pet.json`（name / display{visible,size,right,bottom} / notify / activity / bubbleScale / bubbleMode / bubbleStates / reducedMotion / walkCooldownMin / includeSubagents / status）。**无 affinity/treats**（亲密度系统已移除，POST /state 不再支持 action=pet|feed）。
- **状态机（主信号）**：Host 监听 DSH 标准 `session/event`（`{ global: true }`，事件类型 turn/start、assistant/message、tool/call、tool/result、todo/write、turn/end、session/disposed…），由 `lib/companion-reducer.js`（照抄 dsh-dafeiyu）归约为 IDLE/THINKING/WORKING/WAITING/SUCCESS/ERROR + stage/task/progress/project，输出 STATE/PULSE/TASK/TASKS 协议消息经 stdin 驱动 Helper；多会话按 **等待>错误>工作>思考>空闲** 优先级选择；STATE 消息同时镜像到 `pet.json#status`（设置卡片只读区）。**无真实待办时不编造进度百分比**。
- **完成标记（兼容旧壳）**：`agent/status` 根会话（`parentSession == null`）running → idle 仍向 `~/.dsh/bigfish-completions.jsonl` 追加一行；**本壳（bigfish/main.js）已不再监视该文件**——完成庆祝由状态机 SUCCESS flash 驱动。
- **主目录探测**：Host 的 `pickHome()` 在 `DSH_HOME` 与 `~/.dsh` 之间选有 `pet.json` 的那个，保证 DSH Desktop 与 Bigfish 共享状态。

### 宠物窗口（旧 bigfish/ 侧——已停用，以下约定仅作参考/回退用）

> 新架构：宠物窗口由 `runtime/helper.py`（PySide6 透明窗口）渲染，**不再使用** Electron 的「不透明窗口 + setShape 剪影」方案——`bigfish/main.js` 的 `DISABLE_ELECTRON_PET = true` 已停用 Electron 桌宠。

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

- [ ] **状态动作帧**（需要美术资源）：每状态专属帧——思考（合十）、工作（拿扫帚）、等待（抬手）、完成（微笑）、出错（生气）+ 空闲微动作（眨眼/观察）+ 程序化 motion（think 浮动 / work 抖动 / bounce 跳跃 / shake 抖动 / wait 轻晃）。帧就位后改 `assets/pet-manifest.json` 的 clips/stateMap/idleMicroClips（Helper 已支持全部机制）
- [ ] **多任务状态列表**：≥2 个活跃会话时状态卡同时列出各任务（reducer 已输出 TASKS 消息，Helper 的 `_draw_multi_task_card` 已实现——验证接线即可）
- [ ] **Helper 打包 exe**：PyInstaller 打包 `runtime/` → `runtime/bin/win32-x64/dsh-bigfishpet-helper.exe` 随插件分发（照抄 dsh-dafeiyu scripts/build-helper.ps1），去掉对用户 Python 环境的依赖
- [ ] **「本次隐藏 / 本次关闭」**：Helper 右键菜单已有（本次隐藏/本次关闭），验证 CLOSED 消息与 Host 的 restartSuppressed 接线

## 注意事项

- 仓库是 Git 项目；每次改动记得 `git add -A && git commit`。
- **Helper 依赖 PySide6**（本机已装 6.11.2）；冒烟测试：`py -3 runtime/helper.py`（从插件目录跑，读 assets/pet-manifest.json），或 node 脚本 spawn 后发 hello/state 消息验证 READY。
- 状态机 smoke test：临时脚本模拟 session/event 流验证 `lib/companion-reducer.js`（turn/start→assistant→tool/call→tool/result→todo/write→turn/end，断言状态/阶段/进度/优先级/消息输出）。
- 完成庆祝由状态机 PULSE(SUCCESS) 驱动；`bigfish-completions.jsonl` 仅作旧壳兼容。
- `bigfish/` 为旧 Electron 桌宠（已停用），改宠物显示相关代码先看 `runtime/helper.py` + `assets/pet-manifest.json`。
