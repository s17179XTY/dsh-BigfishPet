'use strict';
const img = document.getElementById('pet');
const bubble = document.getElementById('bubble');

const FRAMES = {
  idle: ['idle.png'],
  eat: ['eat-1.png', 'eat-2.png', 'eat-3.png', 'eat-4.png'],
  sleep: ['sleep.png'],
  'walk-left': ['walk-left-1.png', 'walk-left-2.png'],
  'walk-right': ['walk-right-1.png', 'walk-right-2.png'],
};
const FRAME_MS = { idle: 0, eat: 220, sleep: 0, 'walk-left': 240, 'walk-right': 240 };

let state = 'idle';
let frameIndex = 0;
let animTimer = null;
let petSize = 160;
let bubbleScale = 1;
let activity = 'normal';
let bubbleMode = 'always';
let bubbleStates = ['THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR'];
let reducedMotion = false;
let breathTimer = null;
let breathAnimTimer = null;
let idleBubbleTimer = null;

const api = (window.petAPI && typeof window.petAPI === 'object') ? window.petAPI : null;

// Idle micro-motion (dsh-dafeiyu style): the pet stays still, and every so
// often (randomized interval per activity level) does ONE visible breathing
// pulse (opacity envelope 0→amp→0). Opacity never changes the img rect, so
// the setShape silhouette stays aligned. Intervals are conservative.
const BREATH = {
  quiet: { interval: [20000, 35000], amp: 0 },
  normal: { interval: [12000, 22000], amp: 0.15 },
  lively: { interval: [6000, 12000], amp: 0.2 },
};
const BREATH_DURATION = 2500;

function stopBreath() {
  if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
  if (breathAnimTimer) { clearInterval(breathAnimTimer); breathAnimTimer = null; }
  if (img) img.style.opacity = '1';
}

function scheduleBreath() {
  stopBreath();
  if (reducedMotion) return;
  const spec = BREATH[activity] || BREATH.normal;
  if (!spec.amp || !img) return;
  const [lo, hi] = spec.interval;
  breathTimer = setTimeout(() => {
    breathTimer = null;
    if (state !== 'idle') { scheduleBreath(); return; }
    const started = Date.now();
    breathAnimTimer = setInterval(() => {
      const t = (Date.now() - started) / BREATH_DURATION;
      if (t >= 1) {
        stopBreath();
        scheduleBreath();
        return;
      }
      const env = Math.sin(Math.PI * t); // 0 → 1 → 0 envelope
      img.style.opacity = String(Math.max(0.5, 1 - spec.amp * env));
    }, 50);
  }, lo + Math.random() * (hi - lo));
}

// Unified config from the shell (pet-config): activity / bubbleScale /
// bubbleMode / bubbleStates / reducedMotion (dsh-dafeiyu style settings).
function applyConfig(config) {
  if (!config || typeof config !== 'object') return;
  if (config.activity === 'quiet' || config.activity === 'normal' || config.activity === 'lively') {
    activity = config.activity;
  }
  if (typeof config.bubbleScale === 'number') bubbleScale = Math.max(0.8, Math.min(1.2, config.bubbleScale));
  if (config.bubbleMode === 'always' || config.bubbleMode === 'hidden' || config.bubbleMode === 'custom') {
    bubbleMode = config.bubbleMode;
  }
  if (Array.isArray(config.bubbleStates)) bubbleStates = config.bubbleStates;
  if (typeof config.reducedMotion === 'boolean') reducedMotion = config.reducedMotion;
  if (bubble) bubble.style.maxWidth = Math.round(360 * bubbleScale) + 'px';
  if (state === 'idle') scheduleBreath();
}

function currentFrame() {
  return (FRAMES[state] || FRAMES.idle)[frameIndex] || FRAMES.idle[0];
}

function setSize(px) {
  petSize = px;
  // Fixed square box with object-fit: contain — the img element never changes
  // size/position between animation frames, so the setShape mask always lines
  // up with what is rendered (no clipping during eat/walk transitions).
  const box = Math.round(px * 0.98);
  if (img) {
    img.style.width = box + 'px';
    img.style.height = box + 'px';
  }
  // Bubble: dsh-dafeiyu style large card, scaled by bubbleScale (0.8–1.2).
  if (bubble) {
    bubble.style.fontSize = Math.max(11, Math.round(16 * bubbleScale)) + 'px';
    bubble.style.maxWidth = Math.round(360 * bubbleScale) + 'px';
    bubble.style.padding = Math.max(10, Math.round(14 * bubbleScale)) + 'px ' + Math.max(14, Math.round(20 * bubbleScale)) + 'px';
    bubble.style.borderRadius = '30px'; // 大圆角；四角由 setShape 5 矩形逼近裁掉
  }
}

function setState(s) {
  if (!FRAMES[s]) return;
  state = s;
  frameIndex = 0;
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
  if (s === 'idle') scheduleBreath(); else stopBreath();
  if (img) img.src = 'assets/pet/' + currentFrame();
  if (api) api.setFrame(currentFrame());
  if (FRAMES[s].length > 1 && FRAME_MS[s] > 0) {
    animTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % FRAMES[s].length;
      if (img) img.src = 'assets/pet/' + currentFrame();
      if (api) api.setFrame(currentFrame());
    }, FRAME_MS[s]);
  }
}

if (img) {
  img.addEventListener('error', () => {
    try { if (api && api.logError) api.logError('img failed: ' + img.src); } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Status card bubble (dsh-dafeiyu behavior):
//   - bubbleMode hidden → never shown;
//   - bubbleMode custom → only for states in bubbleStates;
//   - otherwise (always) → shown for non-IDLE states persistently; IDLE /
//     SUCCESS messages auto-hide after 4.2s (status_deadline semantics).
// ---------------------------------------------------------------------------
let lastStatus = null;
let sayTimer = null;

function setStatusIcon(state) {
  const icon = document.getElementById('bubble-icon');
  if (!icon) return;
  icon.className = '';
  icon.textContent = '';
  if (state === 'THINKING' || state === 'WORKING') {
    icon.classList.add('show', state === 'THINKING' ? 'thinking' : 'working');
    icon.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  } else if (state === 'WAITING') {
    icon.classList.add('show', 'waiting');
    icon.textContent = '!';
  } else if (state === 'SUCCESS') {
    icon.classList.add('show', 'success');
    icon.textContent = '✓';
  } else if (state === 'ERROR') {
    icon.classList.add('show', 'error');
    icon.textContent = '✕';
  }
}

function renderBubble(msg, detail, state) {
  if (!bubble) return;
  const msgEl = document.getElementById('bubble-msg');
  const detailEl = document.getElementById('bubble-detail');
  if (msgEl) msgEl.textContent = msg || '';
  if (detailEl) {
    detailEl.textContent = detail || '';
    detailEl.style.display = detail ? '' : 'none';
  }
  setStatusIcon(state);
  bubble.classList.add('show');
  const report = () => {
    if (!api || !bubble || !bubble.classList.contains('show')) return;
    const r = bubble.getBoundingClientRect();
    // radius lets the main process approximate the rounded corners with a
    // 5-rect setShape mask (corners fall outside the mask → desktop shows).
    api.bubbleShow({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), radius: 30 });
  };
  report();
  // Re-report while visible so the setShape mask always covers the CURRENT
  // bubble rect (self-correcting against stale/clipped shapes).
  if (bubble._reportTimer) clearInterval(bubble._reportTimer);
  bubble._reportTimer = setInterval(report, 200);
}

function bubbleAllowedFor(state) {
  if (bubbleMode === 'hidden') return false;
  if (bubbleMode === 'custom') return bubbleStates.includes(state);
  return true;
}

function showStatusCard(status) {
  if (!status) return;
  lastStatus = status;
  if (sayTimer) { clearTimeout(sayTimer); sayTimer = null; }
  if (idleBubbleTimer) { clearTimeout(idleBubbleTimer); idleBubbleTimer = null; }

  if (!bubbleAllowedFor(status.state)) {
    hideBubble();
    return;
  }
  renderBubble(status.message, status.detail, status.state);

  // dsh-dafeiyu status_deadline: non-persistent states (IDLE / SUCCESS)
  // auto-hide the card after 4.2s; persistent states stay until they change.
  const persistent = status.state === 'THINKING' || status.state === 'WORKING'
    || status.state === 'WAITING' || status.state === 'ERROR';
  if (!persistent) {
    idleBubbleTimer = setTimeout(() => {
      idleBubbleTimer = null;
      hideBubble();
    }, 4200);
  }
}

function showBubble(text) {
  // Temporary speech bubble (no status icon); restore the status card after a
  // few seconds.
  renderBubble(text, '', null);
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = setTimeout(() => {
    sayTimer = null;
    if (lastStatus) showStatusCard(lastStatus);
    else hideBubble();
  }, 3000);
}
function hideBubble() {
  if (!bubble) return;
  bubble.classList.remove('show');
  if (bubble._reportTimer) { clearInterval(bubble._reportTimer); bubble._reportTimer = null; }
  if (api) api.bubbleHide();
}

// The whole window is clipped to the whale shape (setShape); drag to move,
// a click pets, RIGHT-click toggles (minimize/open) Bigfish.
let dragging = false;
let moved = false;
let startX = 0;
let startY = 0;

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  moved = false;
  startX = e.screenX;
  startY = e.screenY;
  document.body.style.cursor = 'grabbing';
  if (api) api.dragStart(startX, startY);
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  if (Math.abs(e.screenX - startX) + Math.abs(e.screenY - startY) > 5) moved = true;
  if (api) api.dragMove(e.screenX, e.screenY);
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (dragging && !moved && api) api.clicked();
  if (dragging && moved && api) api.dragEnd();
  dragging = false;
  document.body.style.cursor = 'grab';
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (api) api.rightClicked();
});

if (api) {
  api.onSay((msg) => showBubble(msg));
  api.onState((s) => setState(s));
  api.onSize((px) => setSize(px));
  api.onStatus((status) => showStatusCard(status));
  api.onConfig((config) => applyConfig(config));
}

setState('idle');
setSize(160);
applyConfig({});
