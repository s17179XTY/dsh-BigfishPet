# dsh-BigfishPet — Bigfish 桌宠（鲸鱼娘）的 DeepSeek Harness 插件

把 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 的桌面壳）里的**内置桌宠**，改造成一个标准的 **DeepSeek Harness 插件**——桌宠不再是壳的私货，而是 DSH 的一等公民：在 DSH 设置里直接调整，状态持久化、任务完成走真实信号。

**通用插件**：不绑定 Bigfish 或 dsh-desktop 任何特定客户端。任何 DeepSeek Harness 环境只要运行 `dsh plugin` 命令即可安装（见下），插件只依赖 DSH 标准接口（HTTP 路由、client bundle、`agent/status` 事件）。注意：插件本身只提供设置页与状态——**宠物窗口需要壳侧整合**（见「为什么安装后看不到宠物？」），这是设计边界，不是插件缺陷。

宠物名：**鲸鱼娘** 🐳

## 这是什么

Bigfish 自带一个桌面宠物窗口（透明悬浮、随机说话）。这个项目把它拆成两部分：

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| **DSH 插件**（通用，必装） | 仓库根目录（`lib/`、`package.json`） | DSH 设置里的「桌宠」页：显示开关、大小（带默认刻度尺）、位置、改名、摸头/喂食、任务完成提醒；状态存 `~/.dsh/pet.json`；监听真实 `agent/status` 事件写完成标记。任何 Harness 环境都能装，不依赖特定壳 |
| **壳侧整合**（可选，按壳装） | `bigfish/` 目录 | 置顶的**剪影宠物窗口**（`win.setShape()` 按角色轮廓裁剪，无背景矩形），由插件通过 `pet.json` 驱动；右键最小化/打开 Bigfish；任务完成时气泡「任务完成啦！🎉」。目前只有 Bigfish 壳有这份整合 |

为什么要拆：宠物窗口本质是 Electron 窗口，DSH 插件跑在 Web 后端里建不了窗口，所以窗口由壳提供、配置与信号由插件管——两边通过 `~/.dsh/pet.json` 和 `~/.dsh/bigfish-completions.jsonl` 协作。

## 功能

- **置顶悬浮**，Bigfish 隐藏/最小化也不消失；
- **剪影显示**：部分系统不合成透明窗口（本项目目标机器即是），宠物用不透明窗口 + 角色轮廓裁剪，只显示鲸鱼本身、无背景矩形；
- **右键** = 最小化（到任务栏）/ 打开 Bigfish；**左键** = 说话 + 吃东西动画；1.5 分钟随机说话、3 分钟睡觉、随机散步；
- **拖动**换位置（回写 `pet.json`，设置页同步）；
- **任务完成**（根会话 agent running → idle）= 气泡提醒 + 亲密度回合 +1（每 10 回合奖励 1 颗零食）——真实信号，不是目录 mtime 猜测；
- 设置页**大小滑块带刻度尺**，默认 160px 突出标记。

## 安装插件到 DeepSeek Harness

插件包是标准 DSH 插件（`dsh.bundle.patch` + `dsh.client` 声明），两种装法任选。安装后**任何** DeepSeek Harness 环境（Bigfish 壳、DSH Desktop、纯 web profile…）的设置里都会出现「桌宠」页——安装只装插件本身，不涉及壳侧窗口代码。

### 方法一：dsh plugin 命令（推荐，通用）

```bash
# 在任意目录执行；profile 用你要装的目标环境（如 web）
dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet
```

装完后**重启对应的 Harness 客户端**，设置里就会出现「桌宠」页。

> 装完若**看不到宠物窗口**，属正常现象：插件不创建窗口，窗口由壳侧整合提供（见下文 FAQ）。

### 方法二：手动复制 + 挂载

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

重启后生效。插件会创建/读取 `~/.dsh/pet.json`（宠物状态）与 `~/.dsh/bigfish-completions.jsonl`（完成标记）。

## 为什么安装后看不到宠物？（FAQ）

插件**只提供设置页与状态**，它跑在 DSH 的 Web 后端里，**不能创建窗口**。宠物窗口由**壳侧代码**创建——本仓库 `bigfish/main.js` 就是 Bigfish 壳的整合实现。所以：

| 场景 | 结果 |
| --- | --- |
| 在任何 Harness 客户端用 `dsh plugin` 命令安装插件 | ✅ 设置里出现「桌宠」页；`pet.json` 正常读写；完成信号正常记录 |
| 该客户端**没有**壳侧整合（DSH Desktop、纯 web profile 等） | ⚠️ 只有设置页，**没有宠物窗口**——预期行为，不是插件 bug |
| 该客户端**有**壳侧整合（装入了 `bigfish/` 文件的 Bigfish 壳） | ✅ 设置页 + 宠物窗口都出现 |

要在其他客户端上也看到宠物，需要在该客户端的壳里做等价的窗口整合（参考 `bigfish/` 的实现），或使用已整合的 Bigfish 壳。排查顺序：① 壳侧文件是否装入客户端应用目录并重启 → ② `~/.dsh/pet.json` 的 `display.visible` 是否为 `true` → ③ 客户端是否为支持 Electron 窗口的桌面壳（纯浏览器访问无窗口能力）。

## （可选）应用 Bigfish 壳侧整合，让宠物窗口出现

> 插件只提供设置页与状态；**宠物窗口本身由 Bigfish 的 main.js 创建**。想让宠物在 Bigfish 壳里出现，才需要执行这一步——其他客户端请参考 `bigfish/` 做等价整合。

```powershell
# 目标：Bigfish 安装目录的 resources\app（按实际安装路径调整）
$app = 'E:\AI\Bigfish\resources\app'
Copy-Item bigfish\main.js bigfish\pet.html bigfish\pet.js bigfish\pet-preload.js bigfish\pet-shapes.json $app -Force
Copy-Item -Recurse bigfish\assets\pet $app\assets\ -Force
```

重启 Bigfish。宠物按 `~/.dsh/pet.json` 显示（默认鲸鱼娘 / 160px / 右下角 / 可见）。`bigfish/main.js` 基于 Bigfish 0.1.1（保留自动更新、失败重试、背景…等功能），详见 `bigfish/README.md`。

> 说明：`bigfish/main.js` 已移除背景图注入（恢复 DSH 默认主题）与旧的目录 mtime 任务完成通知；原版可备份为 `main.js.stock-0.1.1`。

## 目录结构

```
├── AGENTS.md           # 给 AI 代理的项目说明（关键约定/验证方式）
├── README.md
├── LICENSE             # MIT
├── package.json        # DSH 插件包声明（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml    # 插件挂载行
├── lib/
│   ├── index.js        # Host：/bigfish-pet/* 路由、pet.json、完成标记、主目录探测
│   └── client.js       # Client：「桌宠」设置页（草稿+保存、大小刻度尺）
└── bigfish/            # 壳侧整合（可选，仅 Bigfish 壳需要；其他客户端参考它做等价整合）
    ├── main.js
    ├── pet.html / pet.js / pet-preload.js
    ├── pet-shapes.json # 10 帧角色轮廓矩形（win.setShape 裁剪）
    └── assets/pet/*.png
```

## 致谢

桌宠原型来自 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 第三方桌面壳）。

## License

MIT
