# dsh-bigfishpet — DeepSeek Harness 桌宠插件（鲸鱼娘）

把 Bigfish 的桌面宠物（**鲸鱼娘**）做成 DeepSeek Harness 的一等公民：

- **DSH 插件**（本仓库根目录）：在 DSH 设置里提供「桌宠」页面（显示开关、大小、位置、改名、摸头/喂食、任务完成提醒），状态持久化到 `~/.dsh/pet.json`；监听真实的 `agent/status` 事件，任务完成时写入完成标记 `~/.dsh/bigfish-completions.jsonl` 并累计亲密度/回合数。
- **Bigfish 壳集成**（`bigfish/` 目录）：一个**置顶的剪影窗口**——由于部分系统无法合成透明窗口，宠物窗口用 `win.setShape()` 按角色轮廓裁剪，只显示鲸鱼本身、无背景矩形；配置由 DSH 插件通过 `pet.json` 驱动；右键宠物最小化/打开 Bigfish；任务完成时气泡「任务完成啦！🎉」。

## 结构

```
dsh-bigfishpet/
├── package.json          # DSH 插件包（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml      # 插件挂载行
├── lib/
│   ├── index.js          # Host：状态 HTTP 路由 / pet.json / 完成标记 / 主目录探测
│   └── client.js         # Client：「桌宠」设置页（草稿 + 保存）
└── bigfish/              # Bigfish 壳侧（宠物窗口渲染 + 整合后的 main.js）
    ├── main.js           # 0.1.1 基础 + 桌宠整合（置顶剪影窗口 / 右键最小化 / 完成气泡）
    ├── pet.html / pet.js / pet-preload.js
    ├── pet-shapes.json   # 10 个动画帧的轮廓矩形（win.setShape 裁剪用）
    └── assets/pet/*.png  # 鲸鱼娘动画帧
```

## 安装 DSH 插件

把仓库复制到 profile 的 node_modules 并挂载：

```powershell
# 1) 安装到 profile（手动方式；也可以用 dsh plugin 命令装发布包）
$profile = "$HOME\.dsh\profiles\web"
Copy-Item -Recurse . "$profile\node_modules\bigfish-pet"

# 2) 在 $HOME\.dsh\profiles\web\cordis.patch.yml 追加：
# - insert:
#     - id: bigfish-pet
#       name: 'bigfish-pet'
```

重启 Bigfish / DSH Desktop 后，DSH 设置里出现「桌宠」页。

## 应用 Bigfish 壳整合

1. 把 `bigfish/` 里的 `pet.html`、`pet.js`、`pet-preload.js`、`pet-shapes.json`、`assets/pet/` 复制到 Bigfish 安装目录的 `resources\app\` 下；
2. 用 `bigfish/main.js` 覆盖 `resources\app\main.js`（它基于 Bigfish 0.1.1，保留了自动更新、背景图、清理残留后端等功能，并移除了旧的目录 mtime 任务完成启发式通知）；
3. 重启 Bigfish。宠物按 `~/.dsh/pet.json` 的配置显示（默认 160px、右下角、可见）。

## 宠物行为

- 置顶悬浮，Bigfish 隐藏/最小化也不消失；
- **拖动**换位置（写回 `pet.json`，DSH 设置页同步）；
- **右键** = 最小化（到任务栏）/ 打开 Bigfish；
- **左键** = 说话 + 吃东西动画；3 分钟不动睡觉；1.5 分钟随机说话（鲸鱼公主台词）；
- **任务完成**（根会话 agent 从 running → idle）= 气泡「任务完成啦！🎉」，亲密度回合 +1（每 10 回合奖励 1 颗零食）。

## 说明

- 宠物默认名：**鲸鱼娘**（可在设置页改名，保存到 `~/.dsh/pet.json`）。
- 完成通知走真实信号（DSH 插件写标记文件），不是目录 mtime 猜测——不会再误报/漏报。
- `pet-render.log`（Bigfish userData 下）记录宠物窗口渲染日志，排查用。

## License

MIT
