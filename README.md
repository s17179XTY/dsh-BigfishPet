# dsh-BigfishPet — DeepSeek Harness 桌宠插件（鲸鱼娘 🐳）

**这是针对 DeepSeek Harness 的通用桌宠插件**，不是 Bigfish 应用或 DSH Desktop 的专属功能——Bigfish、DSH Desktop 都只是它运行于其中的壳。任何 DeepSeek Harness 环境只要执行一行 `dsh plugin` 命令即可安装：插件内置**状态机 + 桌面 Helper**（架构借鉴 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)），监听真实任务事件归约为 思考/工作/等待/完成/出错，通过 JSONL 协议驱动 **PySide6 透明宠物窗口**（`runtime/helper.py`）——窗口由插件自带并 spawn，**与壳无关**，装完即用。

桌宠原型来自 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 的第三方桌面壳），本插件把它插件化，成为 DSH 的一等公民：在 DSH 设置里直接调整，状态持久化、任务状态走真实信号。

## 这是什么

DeepSeek Harness 本身是 Web 后端 + 浏览器界面，**没有创建桌面窗口的能力**。本插件的 Host 跑在 DSH 后端里，监听标准 `session/event` 归约出真实状态，再 spawn 一个 **PySide6 桌面 Helper**（透明窗口）来显示鲸鱼娘：

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| **DSH 插件**（通用，必装） | 仓库根目录（`lib/`、`package.json`） | DSH 设置里的「桌宠」页（显示/大小/气泡/活跃程度/走动冷却/减少动态/响应子 Agent/名字 等，即时保存）；状态存 `~/.dsh/pet.json`。内置**状态机**（`lib/companion-reducer.js`）：`session/event` → 思考/工作/等待/完成/出错 + 阶段/待办/进度，输出 STATE/PULSE/TASK/TASKS 协议消息 |
| **桌面 Helper**（自带，无需壳侧整合） | `runtime/`（PySide6）+ `assets/`（动画帧） | 透明置顶宠物窗口：大圆角状态卡、浅底深图形状态图标、程序化动作、拖动、右键 toggle 宿主、点击互动、空闲自动入睡。由插件 Host spawn，任何 DSH 环境都出现 |

## 功能

- **透明置顶窗口**（`WA_TranslucentBackground`，Qt 合成透明，本机已验证），鲸鱼娘悬浮桌面，Bigfish 隐藏/最小化也不消失；
- **真实状态驱动**：思考/工作/等待/完成/出错五态 + 阶段（查找/实现/验证/执行）+ 当前待办 + 真实进度（`已完成 3/5 步`，无待办数据不编造）；多任务时按 等待>出错>工作>思考 优先显示，≥2 个活跃会话时状态卡同时列出各任务；
- **动画随状态**：THINKING/WORKING（跑任务）→ **eat 吃东西动画**（持续循环）；WAITING → sleep 打盹；SUCCESS → eat 庆祝；IDLE → idle 站立呼吸（待状态动作帧美术资源就位后可升级为每状态专属帧）；
- **空闲自动入睡**：IDLE 持续 **3 分钟**无任务 → 自动切 sleep 睡觉动画（与走动互斥，入睡后不再响应走动；任务消息到来或**点击宠物**立即唤醒切回 idle）；可用环境变量 `DSH_DAFEIYU_IDLE_SLEEP_MS` 调整（毫秒）；
- **鲸鱼公主台词库**（旧版恢复）：左键点击（摸头/尾巴/戳/双击）随机冒一句台词气泡；空闲时每 45–90 秒自言自语一句；
- **右键 = 打开/最小化宿主**（无菜单）：自动检测宿主进程（Bigfish.exe / DSH Desktop.exe）——找到则最小化/还原其主窗口；找不到（纯 WebUI 模式）则打开 WebUI（`http://127.0.0.1:3080/`）；
- **状态卡气泡**：常驻显示主文案 + detail 行（`项目 · 已完成 x/y 步 · 当前待办`），dsh-dafeiyu 同款大卡片（30px 圆角白卡 + 浅灰细边框 + 右侧状态图标 + 原版阴影）；显示规则由 `bubbleMode` 控制（常驻/隐藏/自定义状态）；
- **气泡贴住宠物**：气泡底部按当前帧实际高度动态贴合宠物顶部（各状态帧高不同，不会离宠物过远）；
- **拖动**换位置（回写 `~/.dsh/pet.json`，设置页同步）；
- 设置页 **dsh-dafeiyu 同款卡片式**：每次改动即时保存，无「保存」按钮；底部只读展示当前状态机输出。

## 安装（一行命令）

插件是标准 DSH 插件，用 `dsh plugin` 命令安装（bundle 挂载）：

```bash
# 在任意目录执行；profile 用你要装的目标环境（如 web）
dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet
```

装完后**重启对应的 Harness 客户端**：设置里出现「桌宠」卡片，桌面上出现鲸鱼娘（Helper 随插件启动，无需任何壳侧整合）。

> ⚠️ **不要再往 profile 的 `cordis.patch.yml` 里手动追加 `- insert: id: bigfish-pet`**（前提是插件已通过 bundle 挂载）：bundle 挂载 + profile 级手动 insert **并存**时，同一 entry 被应用两次，DSH 启动崩溃（`duplicate loader entry id: bigfish-pet`）。用 `dsh plugin add`（bundle 挂载）时，**包内 `cordis.patch.yml` 自带 `- insert` 就是插件的 loader entry**，profile 级不需要再写。

也可以手动复制 + 挂载（仅当目标环境不支持 `dsh plugin` 命令时）：

```powershell
# 1) 克隆/下载本仓库，把插件部分复制进 profile 的 node_modules
$profile = "$HOME\.dsh\profiles\web"
git clone https://github.com/s17179XTY/dsh-BigfishPet.git
Copy-Item -Recurse dsh-BigfishPet "$profile\node_modules\bigfish-pet"

# 2) 若 profile 的 package.json 的 dsh.profile.bundles 没有 "bigfish-pet"，
#    在 profile 级 cordis.patch.yml 末尾追加（不是包内文件），并把包内
#    cordis.patch.yml 改为空 []（避免重复 insert）：
# - insert:
#     - id: bigfish-pet
#       name: 'bigfish-pet'
```

插件会创建/读取 `~/.dsh/pet.json`（宠物状态 + 配置）与 `~/.dsh/bigfish-completions.jsonl`（完成标记，兼容旧壳）。

## 为什么安装后看不到宠物？（FAQ）

| 场景 | 结果 |
| --- | --- |
| 装了插件（`dsh plugin` 命令）+ 重启 DSH | ✅ 设置卡片 + 透明宠物窗口都出现（Helper 随插件启动） |
| 装了插件但没重启 | ⚠️ 重启前 Helper 未启动，没有宠物 |
| 目标环境缺 Python/PySide6 | ⚠️ 宠物窗口不出现（Helper 起不来）；设置页正常。可用 `scripts/build-helper.ps1` 打包 exe 随插件分发（不再依赖 Python） |

排查顺序：① 重启 DSH → ② `~/.dsh/pet.json` 的 `display.visible` 是否为 `true` → ③ `py -3 -c "import PySide6"` 是否可用 → ④ 手动冒烟：在插件目录跑 `py -3 runtime/helper.py`（应出现宠物窗口）。改过动画/状态后 Helper 只在启动时读取 manifest，**改动后需重启 Helper 才生效**（可杀掉 Helper 进程，插件会自动重启）。

## 目录结构

```
├── AGENTS.md           # 给 AI 代理的项目说明（关键约定/验证方式/待办）
├── README.md
├── LICENSE             # MIT
├── package.json        # 插件包声明（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml    # bundle insert（- insert: id: bigfish-pet）——插件的 loader entry
├── lib/
│   ├── index.js              # Host：/bigfish-pet/* 路由、pet.json、session/event → Helper、完成标记
│   ├── companion-reducer.js  # 状态机归约器（事件 → STATE/PULSE/TASK/TASKS 消息）
│   ├── status-copy.js        # 鲸鱼娘人设文案库（statusCopy/activityCopy/activityStage/taskCopy）
│   ├── protocol.js           # Helper JSONL 协议（hello/state/pulse/task/tasks/config/ping/shutdown）
│   ├── helper-process.js     # Helper 进程管理（spawn/心跳/崩溃重启/快照重放）
│   └── client.js             # Client：「桌宠」设置卡片（即时保存、当前状态只读区）
├── runtime/            # PySide6 桌面 Helper（helper.py + animation_model.py + layout_store.py）
├── assets/
│   ├── pet-manifest.json     # 动画清单（状态 → clip 映射；动作帧就位后升级）
│   └── pet/*.png             # 鲸鱼娘动画帧（idle/eat/sleep/walk）
├── scripts/
│   ├── build-helper.ps1      # PyInstaller 打包 Helper 为单文件 exe
│   └── gen-shapes.ps1        # （旧壳用）轮廓数据生成
└── bigfish/            # 旧 Electron 壳侧桌宠（已停用：main.js 的 DISABLE_ELECTRON_PET=true；保留作参考/回退）
```

## 致谢

- 桌宠原型来自 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 第三方桌面壳）；
- 状态机设计与状态展示借鉴 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（MIT，QCYTSN）。

## License

MIT
