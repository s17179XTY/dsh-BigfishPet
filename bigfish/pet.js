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

const api = (window.petAPI && typeof window.petAPI === 'object') ? window.petAPI : null;

function currentFrame() {
  return (FRAMES[state] || FRAMES.idle)[frameIndex] || FRAMES.idle[0];
}

function setSize(px) {
  petSize = px;
  if (img) img.style.height = Math.round(px * 0.98) + 'px';
}

function setState(s) {
  if (!FRAMES[s]) return;
  state = s;
  frameIndex = 0;
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
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

function showBubble(text) {
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  if (api) {
    const r = bubble.getBoundingClientRect();
    api.bubbleShow({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  }
  setTimeout(() => hideBubble(), 4500);
}
function hideBubble() {
  if (!bubble) return;
  bubble.classList.remove('show');
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
  if (dragging && api) api.dragEnd();
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
}

setState('idle');
setSize(160);
