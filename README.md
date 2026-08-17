# dsh-BigfishPet — DeepSeek Harness 桌宠插件（鲸鱼娘 🐳）

**这是针对 DeepSeek Harness 的通用桌宠插件**，不是 Bigfish 应用或 DSH Desktop 的专属功能——Bigfish、DSH Desktop 都只是它运行于其中的壳。任何 DeepSeek Harness 环境只要运行 `dsh plugin` 命令即可安装：插件内置**状态机**（借鉴 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)），把真实任务事件归约为 思考/工作/等待/完成/出错 并驱动桌宠状态卡；宠物窗口由「壳侧整合」提供（完整安装流程见下文，两步都要做）。

桌宠原型来自 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 的第三方桌面壳），本插件把它插件化，成为 DSH 的一等公民：在 DSH 设置里直接调整，状态持久化、任务状态走真实信号。

> **能力边界一句话**：插件（任何 DSH 环境都能装）提供设置页、`pet.json` 状态机输出与完成信号；宠物窗口需要 Electron 壳创建——本仓库提供 Bigfish 壳的现成整合，其他 Electron 壳（如 DSH Desktop）可做等价整合（见「安装到 DeepSeek Harness（完整流程）」）。

## 这是什么

DeepSeek Harness 本身是 Web 后端 + 浏览器界面，**没有创建桌面窗口的能力**——这是所有 DSH 壳（Bigfish、DSH Desktop 等 Electron 应用）存在的意义。因此桌宠被拆成两部分，插件管数据、壳管窗口：

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| **DSH 插件**（通用，必装） | 仓库根目录（`lib/`、`package.json`） | DSH 设置里的「桌宠」页：显示开关、大小（带默认刻度尺）、位置、改名、任务完成提醒；状态存 `~/.dsh/pet.json`。内置**状态机**（`lib/pet-status-reducer.js`，借鉴 dsh-dafeiyu）：监听 `session/event` 把真实任务归约为 思考/工作/等待/完成/出错 + 阶段/待办/进度，写 `pet.json#status`。任何 Harness 环境都能装，只依赖 DSH 标准接口，不依赖任何特定壳 |
| **壳侧整合**（按壳装） | `bigfish/` 目录（Bigfish 壳的参考实现） | 置顶的**剪影宠物窗口**（`win.setShape()` 按角色轮廓裁剪，无背景矩形），显示**状态卡**（主文案 + `项目 · 已完成 x/y 步 · 当前待办`）；动画随状态变化（等待→睡觉、完成→庆祝）；空闲时**朝鼠标方向走动**（鼠标在左→向左走，在右→向右走）。宠物窗口代码只依赖标准 Electron API + `pet.json`，**不绑定 Bigfish**——任何 Electron 壳都能做等价整合 |

为什么这么拆：宠物窗口本质是 Electron 窗口，DSH 插件跑在 Web 后端里建不了窗口，所以窗口由壳提供、状态与信号由插件管——两边通过 `~/.dsh/pet.json` 协作。

## 功能

- **置顶悬浮**，Bigfish 隐藏/最小化也不消失；
- **剪影显示**：部分系统不合成透明窗口（本项目目标机器即是），宠物用不透明窗口 + 角色轮廓裁剪，只显示鲸鱼本身、无背景矩形；
- **真实状态驱动**（借鉴 dsh-dafeiyu 状态机）：思考/工作/等待/完成/出错五态 + 阶段（查找/实现/验证/执行）+ 当前待办 + 真实进度（`已完成 3/5 步`，无待办数据不编造）；多任务时按 等待>出错>工作>思考 优先显示最需要注意的；
- **状态卡气泡**：常驻显示主文案 + detail 行（`项目 · 已完成 x/y 步 · 当前待办`）；完成时庆祝「任务完成啦！🎉」，等待确认时打盹，出错时提示；
- **鼠标方向走动**：空闲时鼠标在宠物左边 → 向左走（walk-left），在右边 → 向右走（walk-right）；
- **活跃程度**（安静/标准/活泼）：控制空闲呼吸动画与走动灵敏度（大肥鱼同款设置项，用呼吸代替眨眼/观察微动作）；
- **右键** = 最小化（到任务栏）/ 打开壳主窗口（在 Bigfish 壳中即为 Bigfish）；**左键** = 说话 + 吃东西动画；
- **拖动**换位置（回写 `pet.json`，设置页同步）；
- 设置页**大小滑块带刻度尺**，默认 160px 突出标记；底部只读展示当前状态机输出。

## 安装到 DeepSeek Harness（完整流程）

完整的桌宠体验需要两步：**① 安装 DSH 插件**（通用，任何 DSH 环境都做，得到设置页与状态管理）→ **② 壳侧整合**（让宠物窗口出现，按你的壳选方式）。只做第 ① 步时，设置里会有「桌宠」页但屏幕上看不到宠物——这是预期行为（插件不创建窗口），不是安装失败。

### 第 1 步：安装插件（所有 DeepSeek Harness 环境通用）

插件包是标准 DSH 插件（`dsh.bundle.patch` + `dsh.client` 声明），推荐用 `dsh plugin` 命令安装：

```bash
# 在任意目录执行；profile 用你要装的目标环境（如 web）
dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet
```

装完后**重启对应的 Harness 客户端**，设置里就会出现「桌宠」页。

也可以手动复制 + 挂载（等价）：

```powershell
# 1) 克隆/下载本仓库，把插件部分复制进 profile 的 node_modules
$profile = "$HOME\.dsh\profiles\web"
git clone https://github.com/s17179XTY/dsh-BigfishPet.git
Copy-Item -Recurse dsh-BigfishPet "$profile\node_modules\bigfish-pet"

# 2) 在 $HOME\.dsh\profiles\web\cordis.patch.yml 末尾追加：
# - insert:
#     - id: bigfish-pet
#       name: 'bigfish-pet'
```

插件会创建/读取 `~/.dsh/pet.json`（宠物状态 + 状态机输出）与 `~/.dsh/bigfish-completions.jsonl`（完成标记，兼容旧壳）。

### 第 2 步：壳侧整合（让宠物窗口出现，按你的壳选一种）

> **为什么需要这一步**：DeepSeek Harness 的 Web 后端不能创建窗口，宠物窗口由 Electron 壳的主进程创建，并从 `~/.dsh/pet.json` 读取显示配置。这一步就是把宠物窗口代码装进你的壳。

**方式 A——Bigfish 壳（现成整合，推荐）**：本仓库 `bigfish/` 目录提供完整文件，复制进 Bigfish 应用目录即可：

```powershell
# 目标：Bigfish 安装目录的 resources\app（按实际安装路径调整）
$app = 'E:\AI\Bigfish\resources\app'
Copy-Item bigfish\main.js bigfish\pet.html bigfish\pet.js bigfish\pet-preload.js bigfish\pet-shapes.json $app -Force
Copy-Item -Recurse bigfish\assets\pet $app\assets\ -Force
```

重启 Bigfish。宠物按 `~/.dsh/pet.json` 显示（默认鲸鱼娘 / 160px / 右下角 / 可见）。

**方式 B——其他 Electron 壳（如 DSH Desktop）做等价整合**：宠物窗口代码**不绑定 Bigfish**，只依赖标准 Electron 主进程 API 和一个文件（`~/.dsh/pet.json`，含状态机输出 `status`）。接入步骤：

1. 把 `bigfish/` 里的宠物资源复制进壳的应用目录：`pet.html`、`pet.js`、`pet-preload.js`、`pet-shapes.json`、`assets/pet/`；
2. 把 `bigfish/main.js` 中「Desktop pet」段（`createPetWindow` / `applyPetConfig` / `handlePetStatus` / `applyPetShape` / 鼠标方向走动等）以及 `pet-*` IPC 处理器并入该壳的 main 进程；
3. 在壳启动后调用 `startPetSync()`（含状态轮询与光标方向检测），退出时调用 `stopPetSync()` / `destroyPetWindow()`；
4. 注意沿用「不透明窗口 + `win.setShape()` 剪影」方案（透明窗口在部分系统不合成，渲染配置改动可能卡死主窗口）。

> 说明：`bigfish/main.js` 基于 Bigfish 0.1.1（保留自动更新、失败重试、新手向导、托盘等功能），并已移除背景图注入（恢复 DSH 默认主题）与旧的目录 mtime 任务完成通知；原版可备份为 `main.js.stock-0.1.1`。详见 `bigfish/README.md`。

## 为什么安装后看不到宠物？（FAQ）

插件**只提供设置页与状态**，它跑在 DSH 的 Web 后端里，**不能创建窗口**。宠物窗口由**壳侧整合**创建——本仓库 `bigfish/main.js` 就是 Bigfish 壳的整合参考实现。所以：

| 场景 | 结果 |
| --- | --- |
| 只装了插件（`dsh plugin` 命令，未做壳侧整合） | ✅ 设置里出现「桌宠」页；`pet.json` 正常读写；完成信号正常记录；⚠️ **没有宠物窗口**——预期行为，不是插件 bug |
| 插件 + 壳侧整合（方式 A：Bigfish 现成文件） | ✅ 设置页 + 宠物窗口都出现 |
| 插件 + 壳侧整合（方式 B：其他 Electron 壳等价整合） | ✅ 设置页 + 宠物窗口都出现 |

排查顺序：① 壳侧整合是否已装入你的壳并重启（见「安装到 DeepSeek Harness（完整流程）」第 2 步）→ ② `~/.dsh/pet.json` 的 `display.visible` 是否为 `true` → ③ 客户端是否为支持 Electron 窗口的桌面壳（纯浏览器访问 web profile 无窗口能力，需要 Electron 壳）。

## 目录结构

```
├── AGENTS.md           # 给 AI 代理的项目说明（关键约定/验证方式）
├── README.md
├── LICENSE             # MIT
├── package.json        # DSH 插件包声明（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml    # 插件挂载行
├── lib/
│   ├── index.js        # Host：/bigfish-pet/* 路由、pet.json、状态机接入、完成标记、主目录探测
│   ├── pet-status-reducer.js  # 状态机归约器（借鉴 dsh-dafeiyu）：session/event → status
│   └── client.js       # Client：「桌宠」设置页（草稿+保存、大小刻度尺、当前状态只读区）
└── bigfish/            # 壳侧整合参考实现（Bigfish 壳；其他 Electron 壳可做等价整合）
    ├── main.js         # Bigfish 0.1.1 main.js + 桌宠整合（状态卡 / 鼠标方向走动 / 置顶剪影窗口）
    ├── pet.html / pet.js / pet-preload.js
    ├── pet-shapes.json # 10 帧角色轮廓矩形（win.setShape 裁剪）
    └── assets/pet/*.png
```

## 致谢

- 桌宠原型来自 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 第三方桌面壳）；
- 状态机设计与状态展示借鉴 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（MIT，QCYTSN）。

## License

MIT
