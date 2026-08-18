/**
 * bigfish-pet — Host half.
 *
 * dsh-dafeiyu architecture (copied): the DSH plugin owns a desktop Helper
 * process (runtime/helper.py, PySide6) spawned from the plugin, feeds it
 * REAL `session/event` states over a JSONL stdin protocol, and the Helper
 * renders the always-on-top pet window (transparent, rounded status card,
 * state icons, idle micro-motion) — no Electron shell involvement, so the
 * pet works in ANY DeepSeek Harness environment that runs this plugin.
 *
 * Config remains in ~/.dsh/pet.json (single source of truth, edited by the
 * settings card via POST /bigfish-pet/state); the Host maps it to Helper
 * env vars + CONFIG messages. A status summary is written back to
 * pet.json#status for the settings card's read-only state block.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CompanionReducer } from './companion-reducer.js'
import { HelperProcess } from './helper-process.js'
import { CompanionMessageKind, CompanionState, createMessage } from './protocol.js'

export const name = 'bigfish-pet'

const DEFAULT_STATUS = {
  sessionId: undefined,
  state: 'IDLE',
  phase: 'plugin-start',
  stage: '等待任务',
  activity: undefined,
  toolName: undefined,
  message: '我在等你安排任务哦~',
  task: undefined,
  project: undefined,
  progress: undefined,
  detail: 'DSH · 等待下一次任务',
  flash: undefined,
  flashTtlMs: undefined,
  updatedAt: 0,
}

const DEFAULT_STATE = {
  name: '鲸鱼娘',
  display: { visible: true, size: 160, right: 24, bottom: 24 },
  notify: { complete: true },
  activity: 'normal',
  bubbleScale: 1,
  bubbleMode: 'always',
  bubbleStates: ['THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR'],
  reducedMotion: false,
  walkCooldownMin: 3,
  includeSubagents: false,
  status: { ...DEFAULT_STATUS },
}

// Home resolution: honor DSH_HOME when set, but PREFER the home that already
// holds the pet files (pet.json / pet/assets). This lets Bigfish (DSH_HOME
// unset → ~/.dsh) and DSH Desktop (DSH_HOME → its own harness home) share one
// pet state under ~/.dsh instead of each looking in its own home.
function homeCandidates() {
  const out = []
  const env = process.env.DSH_HOME
  if (env && String(env).trim() !== '') out.push(String(env).trim())
  out.push(path.join(os.homedir(), '.dsh'))
  return out
}
function pickHome() {
  const candidates = homeCandidates()
  for (const home of candidates) {
    try {
      if (existsSync(path.join(home, 'pet.json')) || existsSync(path.join(home, 'pet', 'assets'))) return home
    } catch { /* keep probing */ }
  }
  return candidates[0]
}
const stateFile = () => path.join(pickHome(), 'pet.json')
const completionsFile = () => path.join(pickHome(), 'bigfish-completions.jsonl')

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function deepMerge(base, patch) {
  const out = clone(base)
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const key of Object.keys(patch)) {
      const value = patch[key]
      if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
        out[key] = deepMerge(out[key], value)
      } else if (value !== undefined) {
        out[key] = value
      }
    }
  }
  return out
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), 'utf8'))
    return deepMerge(DEFAULT_STATE, parsed)
  } catch {
    return clone(DEFAULT_STATE)
  }
}

async function writeState(state) {
  await mkdir(pickHome(), { recursive: true })
  await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8')
}

function normalizeActivity(value) {
  return value === 'quiet' || value === 'lively' ? value : 'normal'
}

function normalizeBubbleStates(value) {
  const allowed = new Set(['IDLE', 'THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR'])
  return Array.isArray(value) ? value.filter((v) => allowed.has(v)) : DEFAULT_STATE.bubbleStates
}

// ---------------------------------------------------------------------------
// Completion marker (legacy signal, still consumed by stock shells)
// ---------------------------------------------------------------------------
const prevStatus = new Map()
const lastCompletionAt = new Map()

async function recordCompletion(ctx, agent) {
  const sessionId = agent.id
  const now = Date.now()
  const last = lastCompletionAt.get(sessionId) || 0
  if (now - last < 20000) return
  lastCompletionAt.set(sessionId, now)

  let title = ''
  try {
    const titleService = ctx.get('sessionTitle')
    const snapshot = titleService ? titleService.get(agent.session) : undefined
    if (snapshot && typeof snapshot.title === 'string') title = snapshot.title
  } catch { /* non-fatal */ }

  const line = JSON.stringify({ t: now, sessionId, title })
  try {
    await mkdir(pickHome(), { recursive: true })
    const file = completionsFile()
    let existing = ''
    try { existing = await readFile(file, 'utf8') } catch { /* fresh file */ }
    const trimmed = existing.split('\n').filter((l) => l.trim() !== '').slice(-200)
    trimmed.push(line)
    await writeFile(file, trimmed.join('\n') + '\n', 'utf8')
  } catch (error) {
    console.error('[bigfish-pet] completion marker failed:', error)
  }
}

// ---------------------------------------------------------------------------
// HTTP routes (config card)
// ---------------------------------------------------------------------------
function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 65536) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function clampNum(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

async function handleRequest(request, response) {
  let pathname = '/'
  try { pathname = new URL(request.url, 'http://localhost').pathname } catch { /* keep '/' */ }

  if (pathname === '/bigfish-pet/state') {
    if (request.method === 'GET') {
      sendJson(response, 200, await readState())
      return
    }
    if (request.method === 'POST') {
      if (!sameOrigin(request)) { response.writeHead(403); response.end(); return }
      try {
        const body = await readJsonBody(request)
        const state = await readState()
        if (body && typeof body === 'object') {
          if (typeof body.name === 'string' && body.name.trim() !== '') {
            state.name = body.name.trim().slice(0, 20)
          }
          if (body.display && typeof body.display === 'object') {
            const display = state.display
            if (typeof body.display.visible === 'boolean') display.visible = body.display.visible
            if (body.display.size !== undefined) display.size = clampNum(body.display.size, 80, 280, display.size)
            if (body.display.right !== undefined) display.right = clampNum(body.display.right, 0, 8000, display.right)
            if (body.display.bottom !== undefined) display.bottom = clampNum(body.display.bottom, 0, 8000, display.bottom)
          }
          if (body.notify && typeof body.notify === 'object') {
            if (typeof body.notify.complete === 'boolean') state.notify.complete = body.notify.complete
          }
          if (body.activity === 'quiet' || body.activity === 'normal' || body.activity === 'lively') {
            state.activity = body.activity
          }
          if (body.bubbleScale !== undefined) state.bubbleScale = clampNum(body.bubbleScale, 0.8, 1.2, state.bubbleScale)
          if (body.bubbleMode === 'always' || body.bubbleMode === 'hidden' || body.bubbleMode === 'custom') {
            state.bubbleMode = body.bubbleMode
          }
          if (Array.isArray(body.bubbleStates)) {
            state.bubbleStates = normalizeBubbleStates(body.bubbleStates)
          }
          if (typeof body.reducedMotion === 'boolean') state.reducedMotion = body.reducedMotion
          if (body.walkCooldownMin !== undefined) state.walkCooldownMin = clampNum(body.walkCooldownMin, 0, 30, state.walkCooldownMin)
          if (typeof body.includeSubagents === 'boolean') state.includeSubagents = body.includeSubagents
        }
        await writeState(state)
        sendJson(response, 200, state)
      } catch (error) {
        sendJson(response, 400, { error: String(error && error.message || error) })
      }
      return
    }
    response.writeHead(405, { allow: 'GET, POST' })
    response.end()
    return
  }

  response.writeHead(404)
  response.end()
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'prefix',
      path: '/bigfish-pet',
      handler: (request, response) => {
        handleRequest(request, response).catch(() => {
          try { response.writeHead(500); response.end() } catch { /* gone */ }
        })
      },
    }), 'bigfish-pet: http route')
  })

  // -------------------------------------------------------------------------
  // Companion runtime (dsh-dafeiyu architecture copied):
  //   pet.json config → HelperProcess (env) + CONFIG messages;
  //   session/event → CompanionReducer → protocol messages over stdin.
  // -------------------------------------------------------------------------
  let bridge
  let reducer
  let restartTimer
  let configTimer
  let lastConfigJson = ''
  let lastEnabled = true
  let statusWriteTimer = null
  let pendingStatus = null

  const stopRuntime = (reason = 'settings-change') => {
    bridge?.stop(reason)
    bridge = undefined
    reducer = undefined
  }

  const restartRuntime = (next) => {
    stopRuntime('settings-change')
    startRuntime(next)
  }

  const scheduleRestart = (next) => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      restartRuntime(next)
    }, 400)
    if (restartTimer.unref) restartTimer.unref()
  }

  // Mirror STATE messages into pet.json#status (settings card read-only).
  const flushStatus = async () => {
    statusWriteTimer = null
    const status = pendingStatus
    pendingStatus = null
    if (!status) return
    try {
      const state = await readState()
      state.status = status
      await writeState(state)
    } catch { /* non-fatal */ }
  }
  const pushStatusSummary = (message) => {
    if (!message || message.kind !== CompanionMessageKind.STATE) return
    pendingStatus = {
      sessionId: message.sessionId,
      state: message.state,
      phase: message.phase,
      stage: message.stage,
      activity: message.activity,
      toolName: message.toolName,
      message: message.message,
      task: message.task,
      project: message.project,
      progress: message.progress,
      detail: message.detail,
      flash: undefined,
      flashTtlMs: undefined,
      updatedAt: Date.now(),
    }
    if (statusWriteTimer) clearTimeout(statusWriteTimer)
    statusWriteTimer = setTimeout(() => { flushStatus() }, 200)
    if (statusWriteTimer.unref) statusWriteTimer.unref()
  }

  const startRuntime = (state) => {
    if (state.display.visible === false) {
      stopRuntime('disabled')
      return
    }
    const helperConfig = {
      env: {
        DSH_DAFEIYU_SCALE: String(clampNum(state.display.size / 160, 0.7, 1.4, 1)),
        DSH_DAFEIYU_BUBBLE_SCALE: String(state.bubbleScale ?? 1),
        DSH_DAFEIYU_ACTIVITY_LEVEL: normalizeActivity(state.activity),
        DSH_DAFEIYU_REDUCED_MOTION: state.reducedMotion === true ? '1' : '0',
        DSH_DAFEIYU_BUBBLE_MODE: state.bubbleMode === 'hidden' || state.bubbleMode === 'custom' ? state.bubbleMode : 'always',
        DSH_DAFEIYU_BUBBLE_STATES: normalizeBubbleStates(state.bubbleStates).join(','),
        DSH_DAFEIYU_LAYOUT_PATH: path.join(pickHome(), 'bigfishpet-layout.json'),
        DSH_DAFEIYU_WEBUI_URL: 'http://127.0.0.1:3080/',
      },
    }
    bridge = new HelperProcess(helperConfig, ctx.logger ?? console)
    reducer = new CompanionReducer({ includeSubagents: state.includeSubagents === true })
    const realSend = bridge.send.bind(bridge)
    bridge.send = (message) => {
      pushStatusSummary(message)
      return realSend(message)
    }
    bridge.start()
    bridge.send(createMessage(CompanionMessageKind.HELLO, {
      state: CompanionState.IDLE,
      host: 'deepseek-harness',
      pluginVersion: '0.4.0',
      message: '鲸鱼娘 connected to DSH',
    }))
    bridge.send(createMessage(CompanionMessageKind.STATE, {
      state: CompanionState.IDLE,
      phase: 'plugin-start',
      stage: '等待任务',
      message: '我在等你安排任务哦~',
      detail: 'DSH · 等待下一次任务',
    }))
    bridge.send(createMessage(CompanionMessageKind.CONFIG, {
      scale: clampNum(state.display.size / 160, 0.7, 1.4, 1),
      bubbleScale: state.bubbleScale ?? 1,
      activityLevel: normalizeActivity(state.activity),
      reducedMotion: state.reducedMotion === true,
      bubbleMode: state.bubbleMode === 'hidden' || state.bubbleMode === 'custom' ? state.bubbleMode : 'always',
      bubbleStates: normalizeBubbleStates(state.bubbleStates),
      includeSubagents: state.includeSubagents === true,
    }))
    try { ctx.logger?.info?.('bigfish-pet companion bridge started') } catch { /* noop */ }
  }

  // The companion intentionally observes every DSH session (unscoped root bus).
  const offEvent = ctx.on('session/event', (session, event) => {
    if (!bridge || !reducer) return
    for (const message of reducer.handle(session, event)) bridge.send(message)
  }, { global: true })
  const offDisposed = ctx.on('session/disposed', (session) => {
    if (!bridge || !reducer) return
    for (const message of reducer.disposeSession(session)) bridge.send(message)
  }, { global: true })

  // pet.json config polling: restart on enable/disable, CONFIG on changes.
  const applyConfig = async () => {
    try {
      const state = await readState()
      const enabled = state.display.visible !== false
      if (enabled !== lastEnabled) {
        lastEnabled = enabled
        if (enabled) scheduleRestart(state)
        else stopRuntime('disabled')
        return
      }
      if (!enabled) return
      const configJson = JSON.stringify({
        scale: clampNum(state.display.size / 160, 0.7, 1.4, 1),
        bubbleScale: state.bubbleScale ?? 1,
        activityLevel: normalizeActivity(state.activity),
        reducedMotion: state.reducedMotion === true,
        bubbleMode: state.bubbleMode === 'hidden' || state.bubbleMode === 'custom' ? state.bubbleMode : 'always',
        bubbleStates: normalizeBubbleStates(state.bubbleStates),
        includeSubagents: state.includeSubagents === true,
      })
      if (!bridge) {
        scheduleRestart(state)
        return
      }
      if (configJson !== lastConfigJson) {
        lastConfigJson = configJson
        if (reducer) reducer.includeSubagents = state.includeSubagents === true
        bridge.send(createMessage(CompanionMessageKind.CONFIG, JSON.parse(configJson)))
      }
    } catch { /* keep running */ }
  }
  applyConfig()
  configTimer = setInterval(() => { applyConfig() }, 2000)
  if (configTimer.unref) configTimer.unref()

  ctx.on('agent/status', (payload) => {
    const agent = payload && payload.agent
    const status = payload && payload.status
    if (!agent) return
    const previous = prevStatus.get(agent.id)
    prevStatus.set(agent.id, status)
    if (status !== 'idle' || previous !== 'running') return
    try {
      const header = agent.session && agent.session.header
      if (header && header.parentSession !== undefined && header.parentSession !== null) return
      recordCompletion(ctx, agent).catch((error) => console.error('[bigfish-pet] completion hook failed:', error))
    } catch (error) {
      console.error('[bigfish-pet] completion hook failed:', error)
    }
  })

  ctx.effect(() => () => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = undefined
    if (configTimer) clearInterval(configTimer)
    configTimer = undefined
    if (statusWriteTimer) clearTimeout(statusWriteTimer)
    statusWriteTimer = undefined
    offEvent?.()
    offDisposed?.()
    stopRuntime('dsh-host-stop')
  })
}
