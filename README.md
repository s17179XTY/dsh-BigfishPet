# dsh-BigfishPet — Bigfish 桌宠（鲸鱼娘）的 DeepSeek Harness 插件

把 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 的桌面壳）里的**内置桌宠**，改造成一个标准的 **DeepSeek Harness 插件**——桌宠不再是壳的私货，而是 DSH 的一等公民：在 DSH 设置里直接调整，状态持久化、任务完成走真实信号。

宠物名：**鲸鱼娘** 🐳

## 这是什么

Bigfish 自带一个桌面宠物窗口（透明悬浮、随机说话）。这个项目把它拆成两部分：

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| **DSH 插件** | 仓库根目录（`lib/`、`package.json`） | DSH 设置里的「桌宠」页：显示开关、大小（带默认刻度尺）、位置、改名、摸头/喂食、任务完成提醒；状态存 `~/.dsh/pet.json`；监听真实 `agent/status` 事件写完成标记 |
| **Bigfish 壳集成** | `bigfish/` 目录 | 置顶的**剪影宠物窗口**（`win.setShape()` 按角色轮廓裁剪，无背景矩形），由插件通过 `pet.json` 驱动；右键最小化/打开 Bigfish；任务完成时气泡「任务完成啦！🎉」 |

为什么要拆：宠物窗口本质是 Electron 窗口，DSH 插件跑在 Web 后端里建不了窗口，所以窗口由壳提供、配置与信号由插件管——两边通过 `~/.dsh/pet.json` 和 `~/.dsh/bigfish-completions.jsonl` 协作。

## 功能

- **置顶悬浮**，Bigfish 隐藏/最小化也不消失；
- **剪影显示**：部分系统不合成透明窗口（本项目目标机器即是），宠物用不透明窗口 + 角色轮廓裁剪，只显示鲸鱼本身、无背景矩形；
- **右键** = 最小化（到任务栏）/ 打开 Bigfish；**左键** = 说话 + 吃东西动画；1.5 分钟随机说话、3 分钟睡觉、随机散步；
- **拖动**换位置（回写 `pet.json`，设置页同步）；
- **任务完成**（根会话 agent running → idle）= 气泡提醒 + 亲密度回合 +1（每 10 回合奖励 1 颗零食）——真实信号，不是目录 mtime 猜测；
- 设置页**大小滑块带刻度尺**，默认 160px 突出标记。

## 安装插件到 DeepSeek Harness

插件包是标准 DSH 插件（`dsh.bundle.patch` + `dsh.client` 声明），两种装法任选：

### 方法一：dsh plugin 命令（推荐）

```bash
# 在任意目录执行（profile 用 web，即 Bigfish / DSH Desktop 用的 profile）
dsh plugin --profile web add github:s17179XTY/dsh-BigfishPet
```

装完后**重启 Bigfish / DSH Desktop**，DSH 设置里就会出现「桌宠」页。

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

## 应用 Bigfish 壳侧整合（让宠物窗口出现）

> 插件只提供设置页与状态；**宠物窗口本身由 Bigfish 的 main.js 创建**，需要把 `bigfish/` 里的文件装进 Bigfish 应用目录。

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
└── bigfish/            # Bigfish 壳侧（宠物窗口渲染 + 整合后的 main.js）
    ├── main.js
    ├── pet.html / pet.js / pet-preload.js
    ├── pet-shapes.json # 10 帧角色轮廓矩形（win.setShape 裁剪）
    └── assets/pet/*.png
```

## 致谢

桌宠原型来自 [Bigfish](https://github.com/turtle2209/Bigfish/)（DeepSeek Harness 第三方桌面壳）。

## License

MIT
