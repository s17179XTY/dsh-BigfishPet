/**
 * pet-status-reducer — session/event → 桌宠状态 归约器。
 *
 * 设计借鉴 dsh-dafeiyu（QCYTSN，MIT）的 companion-reducer：监听 DSH 的
 * session/event 标准事件流，把每个会话归约为
 *   IDLE / THINKING / WORKING / WAITING / SUCCESS / ERROR
 * 六态，并附带阶段（stage）、活动类型（activity）、当前待办（task）、
 * 真实进度（progress）、项目名（project）与状态文案（message/detail）。
 *
 * 与 dsh-dafeiyu 的差异：
 *   - 不输出消息协议，只产出「当前最需要注意的会话」的 status 对象；
 *   - SUCCESS / ERROR 以一次性 flash 字段表达（壳侧据此播放庆祝/提示，
 *     状态本身回到 IDLE，无需壳侧定时恢复）；
 *   - 多会话按 等待 > 错误 > 工作 > 思考 > 空闲 的优先级选择。
 */

export const STATUS = {
  IDLE: 'IDLE',
  THINKING: 'THINKING',
  WORKING: 'WORKING',
  WAITING: 'WAITING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
}

const STATE_PRIORITY = {
  [STATUS.WAITING]: 60,
  [STATUS.ERROR]: 50,
  [STATUS.WORKING]: 30,
  [STATUS.THINKING]: 20,
  [STATUS.IDLE]: 0,
}

// 鲸鱼娘人设文案（每状态多句，按事件 seq 取模轮换）
const COPY = {
  idle: ['我在等你安排任务哦~', '随时可以开始新任务！', '今天也要一起加油哦~'],
  preparing: ['新任务来啦，让我先看看项目~', '正在梳理任务思路哦', '让我理清接下来要做什么呢'],
  thinking: ['正在思考下一步呢…', '让我整理一下刚才的结果~', '正在分析接下来怎么做呢'],
  searching: ['正在帮你找相关内容呢', '在项目里仔细翻找中~', '正在查看相关文件呢'],
  editing: ['正在把改动写进去哦', '正在实现这一步呢~', '正在认真调整代码中'],
  testing: ['正在验证改动有没有问题呢', '正在跑测试确认一下哦~', '正在检查这一步的结果呢'],
  commanding: ['正在执行项目命令呢', '正在让项目跑起来哦~', '正在看看命令执行得怎么样呢'],
  working: ['正在处理任务呢', '这一步正在进行中哦~', '大鲸鱼还在认真干活呢'],
  result: ['正在整理刚才的结果呢', '这一步处理好了，继续下一步~', '正在确认下一步怎么做呢'],
  waiting: ['需要你确认一下呢', '这里要等你看一下哦~', '轮到你来决定下一步啦'],
  success: ['任务完成啦！🎉', '这一轮顺利完成啦~', '搞定咯，辛苦啦！'],
  error: ['刚才的操作遇到一点问题呢', '任务好像遇到问题啦…', '这里需要回来看看啦'],
  stopped: ['任务停在这里啦~', '这次任务先停一停哦'],
}

function copyFor(group, seed = 0) {
  const variants = COPY[group] || COPY.working
  const n = Math.abs(Number(seed) || 0)
  return variants[n % variants.length]
}

function toolActivity(name) {
  const value = String(name || '').toLowerCase()
  if (/search|grep|find|glob|web|read|fetch|open/.test(value)) return 'searching'
  if (/write|edit|patch|replace|create|move|delete/.test(value)) return 'editing'
  if (/test|check|lint|build|verify/.test(value)) return 'testing'
  if (/shell|bash|exec|command|terminal|powershell/.test(value)) return 'commanding'
  return 'working'
}

function activityStage(activity) {
  return {
    searching: '查找阶段',
    editing: '实现阶段',
    testing: '验证阶段',
    commanding: '执行阶段',
    working: '处理阶段',
  }[activity] || '处理阶段'
}

function isUserQuestionTool(name) {
  const value = String(name || '').toLowerCase()
  return /ask.*user.*question|request.*user.*input|user[-_/.:]?questions?/u.test(value)
}

function isSubagent(session) {
  return session?.header?.origin === 'subagent'
    || Number(session?.header?.delegationDepth ?? 0) > 0
}

function sessionIdOf(session) {
  return String(session?.header?.id ?? session?.id ?? 'unknown-session')
}

function cleanProjectName(value) {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const parts = text.split(/[\\/]/u).filter(Boolean)
  const candidate = parts.length > 1 ? parts.at(-1) : text
  return candidate.replace(/\s+/gu, ' ').slice(0, 40) || undefined
}

function projectNameOf(session, event) {
  const candidates = [
    session?.header?.title,
    session?.header?.name,
    session?.title,
    session?.name,
    session?.header?.cwd,
    session?.cwd,
    session?.context?.cwd,
    event?.data?.projectName,
    event?.data?.cwd,
  ]
  return candidates.map(cleanProjectName).find(Boolean)
}

function progressOf(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return undefined
  const completed = todos.filter((todo) => ['completed', 'complete', 'done'].includes(todo?.status)).length
  const currentIndex = todos.findIndex((todo) => todo?.status === 'in_progress')
  return {
    completed,
    total: todos.length,
    current: currentIndex >= 0 ? currentIndex + 1 : undefined,
  }
}

function detailFor(record, stage = record.payload.stage) {
  const parts = []
  if (record.project) parts.push(record.project)
  if (record.progress?.total) parts.push(`已完成 ${record.progress.completed}/${record.progress.total} 步`)
  if (record.task) parts.push(record.task)
  else if (stage) parts.push(stage)
  return parts.join(' · ') || stage || 'DSH 任务'
}

export class PetStatusReducer {
  constructor({ includeSubagents = false } = {}) {
    this.includeSubagents = includeSubagents === true
    this.sessions = new Map()
    this.clock = 0
    this.selectedId = undefined
    this.signature = undefined
  }

  /** 处理一个 session/event；返回 { changed, status }，status 为最新「选中」会话的状态对象 */
  handle(session, event) {
    if (!event || typeof event.type !== 'string') return this.#none()
    if (!this.includeSubagents && isSubagent(session)) return this.#none()

    const sessionId = sessionIdOf(session)
    const record = this.#record(sessionId)
    record.subagent = isSubagent(session)
    record.lastSeq = Number(event.seq ?? record.lastSeq)
    record.project = projectNameOf(session, event) ?? record.project

    switch (event.type) {
      case 'turn/start':
        record.turnActive = true
        record.openTools.clear()
        record.waitingCallId = undefined
        record.task = undefined
        record.progress = undefined
        this.#update(record, STATUS.THINKING, {
          phase: 'turn-start',
          stage: '准备阶段',
          message: copyFor('preparing', event.seq),
        })
        return this.#render()

      case 'step/start':
      case 'assistant/chunk':
      case 'assistant/message':
        if (!record.turnActive || record.openTools.size > 0) return this.#none()
        if (record.state === STATUS.THINKING && record.payload.phase === 'thinking') return this.#none()
        this.#update(record, STATUS.THINKING, {
          phase: 'thinking',
          stage: '分析阶段',
          message: copyFor('thinking', event.seq),
        })
        return this.#render()

      case 'tool/call': {
        const callId = this.#toolCallIdOf(event)
        const name = String(event.data?.name ?? event.data?.message?.name ?? 'tool')
        record.openTools.set(callId, name)
        if (isUserQuestionTool(name)) {
          record.waitingCallId = callId
          this.#update(record, STATUS.WAITING, {
            phase: 'user-question',
            stage: '等待确认',
            toolName: name,
            message: copyFor('waiting', event.seq),
          })
          return this.#render()
        }
        const activity = toolActivity(name)
        this.#update(record, STATUS.WORKING, {
          phase: 'tool-call',
          activity,
          stage: activityStage(activity),
          toolName: name,
          message: copyFor(activity, event.seq),
        })
        return this.#render()
      }

      case 'tool/result':
        return this.#toolResult(record, event)

      case 'user/message':
        return this.#userMessage(record, event)

      case 'todo/write':
        return this.#todo(record, event)

      case 'turn/end':
        return this.#turnEnd(record, event)

      default:
        return this.#none()
    }
  }

  /** 会话被销毁时清理；返回 { changed, status } */
  disposeSession(session) {
    const sessionId = sessionIdOf(session)
    const existed = this.sessions.delete(sessionId)
    if (!existed) return this.#none()
    return this.#render()
  }

  // -- internals ------------------------------------------------------------

  #toolResult(record, event) {
    const callId = this.#toolCallIdOf(event)
    if (callId) record.openTools.delete(callId)
    if (callId && callId === record.waitingCallId) record.waitingCallId = undefined
    return this.#resumeAfterTool(record, event)
  }

  #userMessage(record, event) {
    if (!record.waitingCallId) return this.#none()
    record.openTools.delete(record.waitingCallId)
    record.waitingCallId = undefined
    return this.#resumeAfterTool(record, event)
  }

  #resumeAfterTool(record, event) {
    if (record.waitingCallId && record.openTools.has(record.waitingCallId)) return this.#render()
    const next = record.openTools.size > 0 ? STATUS.WORKING : STATUS.THINKING
    const activity = next === STATUS.WORKING ? toolActivity(record.openTools.values().next().value) : undefined
    this.#update(record, next, {
      phase: 'tool-result',
      activity,
      stage: next === STATUS.WORKING ? activityStage(activity) : '整理阶段',
      message: next === STATUS.WORKING ? copyFor(activity, event.seq) : copyFor('result', event.seq),
    })
    if (!event.data?.error) return this.#render()

    // 工具出错：短暂 flash ERROR（状态回到工具结果态，不阻塞后续渲染）
    const selection = this.#select()
    if (selection.state === STATUS.WAITING || selection.state === STATUS.ERROR) return this.#render()
    return this.#renderWithFlash(selection, STATUS.ERROR, copyFor('error', event.seq), 1800)
  }

  #todo(record, event) {
    const todos = Array.isArray(event.data?.todos) ? event.data.todos : []
    const current = todos.find((todo) => todo?.status === 'in_progress')
      ?? todos.find((todo) => todo?.status === 'pending')
    const progress = progressOf(todos)
    if (!current?.content && !progress) return this.#none()
    const nextTask = current?.content ? String(current.content) : record.task
    const unchanged = nextTask === record.task
      && progress?.completed === record.progress?.completed
      && progress?.total === record.progress?.total
    if (unchanged) return this.#none()
    record.task = nextTask
    record.progress = progress
    record.updatedAt = ++this.clock
    return this.#render()
  }

  #turnEnd(record, event) {
    record.turnActive = false
    record.openTools.clear()
    record.waitingCallId = undefined
    const kind = String(event.data?.reason?.kind ?? 'completed')

    if (kind === 'blocked') {
      this.#update(record, STATUS.WAITING, {
        phase: 'turn-end',
        stage: '等待确认',
        message: copyFor('waiting', event.seq),
      })
      return this.#render()
    }

    if (kind === 'aborted') {
      this.#update(record, STATUS.IDLE, {
        phase: 'turn-end',
        stage: '已停止',
        message: copyFor('stopped', event.seq),
      })
      return this.#render()
    }

    if (kind !== 'completed') {
      this.#update(record, STATUS.ERROR, {
        phase: 'turn-end',
        stage: '需要处理',
        message: copyFor('error', event.seq),
      })
      return this.#render()
    }

    // 正常完成：状态回 IDLE，一次性 flash SUCCESS 让壳侧庆祝
    this.#update(record, STATUS.IDLE, {
      phase: 'turn-end',
      stage: '已完成',
      message: copyFor('success', event.seq),
    })
    const selection = this.#select()
    if (selection.state === STATUS.WAITING || selection.state === STATUS.ERROR) return this.#render()
    return this.#renderWithFlash(selection, STATUS.SUCCESS, copyFor('success', event.seq), 2200)
  }

  #record(sessionId) {
    let record = this.sessions.get(sessionId)
    if (record) return record
    record = {
      id: sessionId,
      state: STATUS.IDLE,
      payload: { phase: 'session-created', message: copyFor('idle', 0) },
      turnActive: false,
      openTools: new Map(),
      waitingCallId: undefined,
      task: undefined,
      progress: undefined,
      project: undefined,
      subagent: false,
      lastSeq: -1,
      updatedAt: ++this.clock,
    }
    this.sessions.set(sessionId, record)
    return record
  }

  #update(record, state, payload) {
    record.state = state
    record.payload = payload
    record.updatedAt = ++this.clock
  }

  #select() {
    const records = [...this.sessions.values()]
    if (records.length === 0) return undefined
    records.sort((left, right) => {
      const priority = (STATE_PRIORITY[right.state] ?? 0) - (STATE_PRIORITY[left.state] ?? 0)
      return priority || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    })
    return records[0]
  }

  #none() {
    return { changed: false, status: undefined }
  }

  #render() {
    const selection = this.#select()
    if (!selection) return this.#none()
    return this.#emit(selection)
  }

  #renderWithFlash(selection, flashState, flashMessage, ttlMs) {
    return this.#emit(selection, { flashState, flashMessage, flashTtlMs: ttlMs })
  }

  #emit(selection, flash) {
    const status = this.#statusOf(selection, flash)
    const signature = this.#signature(status)
    if (signature === this.signature) return this.#none()
    this.selectedId = selection.id
    this.signature = signature
    return { changed: true, status }
  }

  #statusOf(selection, flash) {
    return {
      sessionId: selection.id,
      state: selection.state,
      phase: selection.payload.phase,
      stage: selection.payload.stage,
      activity: selection.payload.activity,
      toolName: selection.payload.toolName,
      message: flash?.flashMessage ?? selection.payload.message,
      task: selection.task,
      project: selection.project,
      progress: selection.progress,
      detail: detailFor(selection),
      flash: flash?.flashState,
      flashTtlMs: flash?.flashTtlMs,
      updatedAt: selection.updatedAt,
    }
  }

  #signature(status) {
    return [
      status.sessionId,
      status.state,
      status.activity ?? '',
      status.toolName ?? '',
      status.message ?? '',
      status.project ?? '',
      status.task ?? '',
      status.progress?.completed ?? '',
      status.progress?.total ?? '',
      status.flash ?? '',
    ].join('|')
  }

  #toolCallIdOf(event) {
    const content = event?.data?.message?.content
    const contentCallId = Array.isArray(content)
      ? content.find((item) => item?.toolCallId)?.toolCallId
      : undefined
    return String(event?.data?.message?.source?.callId
      ?? contentCallId
      ?? event?.data?.message?.toolCallId
      ?? event?.data?.message?.callId
      ?? event?.data?.callId
      ?? `seq-${String(event?.seq ?? 'unknown')}`)
  }
}
