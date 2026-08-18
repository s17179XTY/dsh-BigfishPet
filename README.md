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

插件包是标准 DSH 插件，推荐用 `dsh plugin` 命令安装（bundle 挂载）：

```bash
# 在任意目录执行；profile 用你要装的目标环境（如 web）
dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet
```

装完后**重启对应的 Harness 客户端**，设置里就会出现「桌宠」卡片。

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

### 第 2 步：不需要！宠物窗口由插件自带

**新架构（v0.4+）**：宠物窗口由插件自带的 **PySide6 Helper**（`runtime/helper.py`，透明窗口，照抄 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)）创建——插件 Host 启动时自动 spawn，**与壳无关**。装完插件、重启 DSH，桌面上就会出现透明窗口的鲸鱼娘（大圆角状态卡、状态图标、拖动、右键菜单）。**任何 DSH 环境（Bigfish / DSH Desktop / 纯 web profile）都一样，无需任何壳侧整合。**

> 旧架构的 `bigfish/`（Electron 不透明窗口 + setShape 剪影）已**停用**（`bigfish/main.js` 的 `DISABLE_ELECTRON_PET = true`），仅保留作参考/回退。Helper 依赖 Python + PySide6（`py -3 -c "import PySide6"`），正式发布将打包 exe 随插件分发（见 AGENTS.md 待办）。

## 为什么安装后看不到宠物？（FAQ）

| 场景 | 结果 |
| --- | --- |
| 装了插件（`dsh plugin` 命令）+ 重启 DSH | ✅ 设置卡片 + 透明宠物窗口都出现（Helper 随插件启动） |
| 装了插件但没重启 | ⚠️ 重启前 Helper 未启动，没有宠物 |
| 目标环境缺 Python/PySide6 | ⚠️ 宠物窗口不出现（Helper 起不来）；设置页正常。正式版打包 exe 后不再依赖 |

排查顺序：① 重启 DSH → ② `~/.dsh/pet.json` 的 `display.visible` 是否为 `true` → ③ `py -3 -c "import PySide6"` 是否可用 → ④ 手动冒烟：在插件目录跑 `py -3 runtime/helper.py`（应出现宠物窗口）。

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
