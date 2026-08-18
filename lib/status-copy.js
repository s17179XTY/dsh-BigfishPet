/**
 * status-copy — 鲸鱼娘人设文案库（companion-reducer 专用）。
 *
 * 从旧版 pet-status-reducer 的 COPY 表抽取而来，供 CompanionReducer
 * 生成 STATE / PULSE / TASK 消息时使用。文案按分组（preparing /
 * thinking / searching / …）组织，每状态多句，按事件 seq 取模轮换。
 */

// 鲸鱼娘人设文案（每状态多句，按事件 seq 取模轮换）
const COPY = {
  idle: ['我在等你安排任务哦~', '随时可以开始新任务！', '今天也要一起加油哦~'],
  preparing: ['新任务来啦，让我先看看项目~', '正在梳理任务思路哦', '让我理清接下来要做什么呢'],
  thinking: ['正在思考下一步呢…', '让我整理一下刚才的结果~', '正在分析接下来怎么做呢'],
  searching: ['正在帮你找相关内容呢', '在项目里仔细翻找中~', '正在查看相关文件呢'],
  editing: ['正在把改动写进去哦', '正在实现这一步呢~', '正在认真调整代码中'],
  testing: ['正在验证改动有没有问题呢', '正在跑测试确认一下哦~', '正在检查这一步的结果呢'],
  commanding: ['正在执行项目命令呢', '正在让项目跑起来哦~', '正在看看命令执行得怎么样呢'],
  'using-tool': ['正在调用工具处理任务呢', '这一步正在进行中哦~', '大鲸鱼还在认真干活呢'],
  result: ['正在整理刚才的结果呢', '这一步处理好了，继续下一步~', '正在确认下一步怎么做呢'],
  waiting: ['需要你确认一下呢', '这里要等你看一下哦~', '轮到你来决定下一步啦'],
  success: ['任务完成啦！🎉', '这一轮顺利完成啦~', '搞定咯，辛苦啦！'],
  error: ['刚才的操作遇到一点问题呢', '任务好像遇到问题啦…', '这里需要回来看看啦'],
  toolError: ['工具调用好像出了点问题呢', '刚才那步操作没成功哦…', '需要回来看看这里啦'],
  stopped: ['任务停在这里啦~', '这次任务先停一停哦'],
  limit: ['这次任务超过长度限制啦', '内容太长了，需要分步继续哦~'],
}

function copyFor(group, seed = 0) {
  const variants = COPY[group] || COPY['using-tool'] || COPY.working
  const n = Math.abs(Number(seed) || 0)
  return variants[n % variants.length]
}

/** 状态文案：statusCopy('thinking', seq) */
export function statusCopy(group, seed = 0) {
  return copyFor(group, seed)
}

/** 活动文案：activityCopy('searching', seq)，activity 为 toolActivity 的返回值 */
export function activityCopy(activity, seed = 0) {
  return copyFor(String(activity || 'using-tool'), seed)
}

/** 阶段文案：activityStage('searching') → '查找阶段' */
export function activityStage(activity) {
  return {
    searching: '查找阶段',
    editing: '实现阶段',
    testing: '验证阶段',
    commanding: '执行阶段',
    'using-tool': '处理阶段',
    working: '处理阶段',
  }[String(activity || '')] || '处理阶段'
}

/** 任务文案：taskCopy('修复登录 bug') → '正在处理：修复登录 bug' */
export function taskCopy(task) {
  const text = String(task ?? '').trim()
  if (!text) return '正在处理当前任务'
  return `正在处理：${text}`
}
