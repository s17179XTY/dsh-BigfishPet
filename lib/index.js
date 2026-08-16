/**
 * bigfish-pet — Host half.
 *
 * Turns the Bigfish desktop pet into a first-class DeepSeek Harness feature:
 *   - serves the pet PNG frames + pet state over HTTP routes on the DSH web
 *     server (/bigfish-pet/*);
 *   - persists pet state (name, affinity, treats, display, notify) to
 *     $DSH_HOME/pet.json;
 *   - listens to the REAL `agent/status` event and appends a completion marker
 *     line to $DSH_HOME/bigfish-completions.jsonl whenever a root session's
 *     agent finishes running → idle. Bigfish's Electron shell watches that one
 *     file for precise "task completed" OS notifications (no more guessing
 *     from directory mtimes), and the pet's turn counter advances here too.
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'bigfish-pet'

const FRAME_FILES = [
  'idle.png',
  'eat-1.png', 'eat-2.png', 'eat-3.png', 'eat-4.png',
  'sleep.png',
  'walk-left-1.png', 'walk-left-2.png',
  'walk-right-1.png', 'walk-right-2.png',
]

const DEFAULT_STATE = {
  name: '鲸鱼娘',
  affinity: { points: 0, lastPetAt: 0, lastFeedAt: 0, pets: 0, feeds: 0, turns: 0 },
  treats: { treats: 0, lastTreatGrantAt: 0, turnsAtLastTreatGrant: 0 },
  display: { visible: true, size: 160, right: 24, bottom: 24 },
  notify: { complete: true },
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
const assetsDir = () => path.join(pickHome(), 'pet', 'assets')
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

// ---------------------------------------------------------------------------
// Completion tracking (real signal, not mtime guessing)
// ---------------------------------------------------------------------------
const prevStatus = new Map()
const lastCompletionAt = new Map()

async function recordCompletion(ctx, agent) {
  const sessionId = agent.id
  const now = Date.now()
  const last = lastCompletionAt.get(sessionId) || 0
  if (now - last < 20000) return
  lastCompletionAt.set(sessionId, now)

  const state = await readState()
  const turns = (state.affinity.turns || 0) + 1
  state.affinity.turns = turns
  const grantEvery = 10
  const grantBucket = Math.floor(turns / grantEvery)
  const lastBucket = Math.floor((state.treats.turnsAtLastTreatGrant || 0) / grantEvery)
  if (grantBucket > lastBucket) {
    state.treats.treats = (state.treats.treats || 0) + (grantBucket - lastBucket)
    state.treats.lastTreatGrantAt = now
    state.treats.turnsAtLastTreatGrant = turns
  }
  await writeState(state)

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
// HTTP routes
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
          if (body.action === 'pet') {
            state.affinity.pets = (state.affinity.pets || 0) + 1
            state.affinity.points = (state.affinity.points || 0) + 1
            state.affinity.lastPetAt = Date.now()
          } else if (body.action === 'feed') {
            state.affinity.feeds = (state.affinity.feeds || 0) + 1
            state.affinity.points = (state.affinity.points || 0) + 2
            state.affinity.lastFeedAt = Date.now()
          } else {
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
          }
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

  if (pathname.startsWith('/bigfish-pet/assets/')) {
    if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
    const file = path.basename(decodeURIComponent(pathname.slice('/bigfish-pet/assets/'.length)))
    if (!FRAME_FILES.includes(file)) { response.writeHead(404); response.end(); return }
    try {
      const buffer = await readFile(path.join(assetsDir(), file))
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' })
      response.end(buffer)
    } catch {
      response.writeHead(404)
      response.end()
    }
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

  // Best-effort: make sure the PNG frames exist under $DSH_HOME/pet/assets
  // (copied from the Bigfish app on first run when the folder is empty).
  const ensureAssets = async () => {
    try {
      const dir = assetsDir()
      await mkdir(dir, { recursive: true })
      const present = new Set((await readdir(dir)).map((file) => file))
      const missing = FRAME_FILES.filter((file) => !present.has(file))
      if (missing.length === 0) return
      const candidates = []
      if (process.env.BIGFISH_APP_DIR) candidates.push(path.join(process.env.BIGFISH_APP_DIR, 'resources', 'app', 'assets', 'pet'))
      candidates.push(path.join(os.homedir(), 'Desktop', 'Bigfish', 'resources', 'app', 'assets', 'pet'))
      const executableDir = process.execPath ? path.dirname(process.execPath) : ''
      if (executableDir) candidates.push(path.join(executableDir, 'resources', 'app', 'assets', 'pet'))
      for (const source of candidates) {
        if (!existsSync(source)) continue
        for (const file of missing) {
          try { await copyFile(path.join(source, file), path.join(dir, file)) } catch { /* keep going */ }
        }
        break
      }
    } catch { /* non-fatal */ }
  }
  ensureAssets()
}
