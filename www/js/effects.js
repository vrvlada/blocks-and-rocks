/*
 * Blocks & Rocks — vizuelni efekti: confetti, line-clear sparkles, rock chips,
 * ice shards (Canvas 2D), screen shake, score float, arcade combo counter.
 * ES modul — zavisnosti: initEffects(deps).
 *   deps = { CONFIG, SIZE, boardEl, scoreEl, getGrid, getParticleTrailEnabled, getReducedMotionEnabled }
 */

let D = null;
export function initEffects(deps){
  D = deps;
  initCanvasEngine();
}

/* Reduce Motion: kada je uključeno preskačemo teže vizuelne efekte */
function _reducedMotion(){
  return !!(D && D.getReducedMotionEnabled && D.getReducedMotionEnabled());
}

import { DOMPool } from './utils.js';

/* ═══ SCREEN SHAKE ═══ */
export function triggerScreenShake(intensity = 'light'){
  if(_reducedMotion()) return;
  const target = document.getElementById('wrap') || (D && D.boardEl);
  if(!target) return;
  const cls = intensity === 'heavy' ? 'screen-shake-heavy' : 'screen-shake-light';
  target.classList.remove('screen-shake-light', 'screen-shake-heavy');
  requestAnimationFrame(() => {
    target.classList.add(cls);
    setTimeout(() => target.classList.remove(cls), intensity === 'heavy' ? 360 : 240);
  });
}

/* ══════════════════════════════════════════════════════════════════════
 *  HIGH-PERFORMANCE UNIFIED 2D CANVAS PARTICLE ENGINE (Zero DOM thrash)
 * ══════════════════════════════════════════════════════════════════════ */
let canvas = null;
let ctx = null;

const MAX_PARTICLES = 300;
const particles = Array.from({length: MAX_PARTICLES}, () => ({
  active: false, x: 0, y: 0, vx: 0, vy: 0, gravity: 0, drag: 0, 
  size: 0, aspect: 1, shape: 'circle', color: '#fff', 
  rotation: 0, rotationSpeed: 0, alpha: 0, life: 0, maxLife: 0
}));
let canvasRAF = null;
let cachedDPR = 1;

function getFreeParticle() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!particles[i].active) return particles[i];
  }
  return particles[0];
}

function initCanvasEngine(){
  canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  try {
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true, willReadFrequently: false });
  } catch(e) {
    ctx = canvas.getContext('2d');
  }
  const resize = () => {
    if(!canvas) return;
    // Ograniči DPR na maksimalno 1.5 na telefonima (štedi 50-60% GPU memorije i fillrate-a)
    cachedDPR = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * cachedDPR);
    canvas.height = Math.round(window.innerHeight * cachedDPR);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  };
  window.addEventListener('resize', resize, { passive: true });
  resize();
}

function ensureCanvas(){
  if(!canvas) canvas = document.getElementById('confettiCanvas');
  if(canvas && !ctx) initCanvasEngine();
  return !!ctx;
}

function startCanvasLoop(){
  if (!canvasRAF) {
    canvasRAF = requestAnimationFrame(animateCanvasParticles);
  }
}

function animateCanvasParticles(){
  if (!ctx) return;
  let hasActive = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (particles[i].active) { hasActive = true; break; }
  }

  if (!hasActive) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvasRAF = null;
    return;
  }

  const dpr = cachedDPR;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const screenW = window.innerWidth + 30;
  const screenH = window.innerHeight + 30;

  let activeCount = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (!p.active) continue;
    activeCount++;

    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.rotation += p.rotationSpeed;
    p.life++;
    p.alpha = Math.max(0, 1 - p.life / p.maxLife);

    if (p.alpha <= 0 || p.y > screenH || p.y < -30 || p.x > screenW || p.x < -30) {
      p.active = false;
      continue;
    }

    const rad = (p.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);

    ctx.setTransform(cosR * dpr, sinR * dpr, -sinR * dpr, cosR * dpr, p.x * dpr, p.y * dpr);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;

    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, 6.283185307179586);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * p.aspect);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (activeCount > 0) {
    canvasRAF = requestAnimationFrame(animateCanvasParticles);
  } else {
    canvasRAF = null;
  }
}

/* ═══ CONFETTI BURST ═══ */
export function triggerConfetti(count = 30){
  if(_reducedMotion()) return;
  if (!ensureCanvas()) return;

  const colors = ['#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#a3e635', '#60a5fa', '#fb923c', '#ffffff'];
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.42;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const speed = 4 + Math.random() * 8;
    const p = getFreeParticle();
    p.active = true;
    p.x = originX + (Math.random() - 0.5) * 80;
    p.y = originY + (Math.random() - 0.5) * 30;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 4;
    p.gravity = 0.22;
    p.drag = 0.98;
    p.size = 5 + Math.random() * 6;
    p.aspect = 0.65;
    p.shape = 'rect';
    p.color = colors[Math.floor(Math.random() * colors.length)];
    p.rotation = Math.random() * 360;
    p.rotationSpeed = (Math.random() - 0.5) * 12;
    p.alpha = 1;
    p.life = 0;
    p.maxLife = 35 + Math.floor(Math.random() * 15);
  }

  startCanvasLoop();
}

/* ═══ SCORE FLOAT ANIMATION ═══ */
let _lastScoreFloat = 0;
export function showScoreFloat(points){
  if(points <= 0) return;
  const now = performance.now();
  if(now - _lastScoreFloat < 150) return; // prevent DOM flooding on rapid clears
  _lastScoreFloat = now;
  const el = DOMPool.acquire('div', 'score-float');
  el.textContent = '+' + points;
  
  const scorebox = D && D.scoreEl ? D.scoreEl.closest('.scorebox') : null;
  if(scorebox){
    scorebox.style.position = 'relative';
    scorebox.appendChild(el);
  } else {
    document.body.appendChild(el);
  }
  setTimeout(()=> DOMPool.release(el, 'score-float'), (D && D.CONFIG && D.CONFIG.SCORE_FLOAT_DURATION) || 1000);
}

/* ═══ BIG COMBO ROLLING BONUS COUNTER (Arkadni rastući brojač) ═══ */
let comboPopupEl = null;
let comboLabelEl = null;
let comboNumEl = null;
let comboRAF = null;
let comboFinishTimeout = null;

export function showBigComboBonusCounter(bonus, comboStreak = 1, linesCleared = 1, customLabel = null){
  if(bonus <= 0) return;
  const board = (D && D.boardEl) || document.getElementById('board');
  const boardParent = board ? (board.parentElement || document.body) : document.body;

  if(!comboPopupEl){
    comboPopupEl = document.createElement('div');
    comboLabelEl = document.createElement('div');
    comboLabelEl.className = 'combo-bonus-label';
    comboPopupEl.appendChild(comboLabelEl);
    
    comboNumEl = document.createElement('div');
    comboNumEl.className = 'combo-bonus-number';
    comboPopupEl.appendChild(comboNumEl);
    
    boardParent.appendChild(comboPopupEl);
  }

  // Otkazivanje starih animacija
  if(comboRAF) cancelAnimationFrame(comboRAF);
  if(comboFinishTimeout) clearTimeout(comboFinishTimeout);

  // Resetovanje stanja i animacija
  comboPopupEl.className = 'combo-bonus-popup';
  if(comboStreak >= 2 || bonus >= 300) comboPopupEl.classList.add('mega-combo');
  
  comboPopupEl.style.animation = 'none';
  void comboPopupEl.offsetWidth; // Force reflow za restartovanje CSS animacije
  comboPopupEl.style.animation = '';

  // Postavljanje labele
  if(customLabel){
    comboLabelEl.innerHTML = customLabel;
  } else if(comboStreak > 1) {
    comboLabelEl.innerHTML = `🔥 KOMBO NIZ <span class="combo-x">x${comboStreak}</span>`;
  } else if(linesCleared > 1) {
    comboLabelEl.innerHTML = `⚡ MULTI-LINIJA <span class="combo-x">x${linesCleared}</span>`;
  } else {
    comboLabelEl.textContent = '✨ BONUS POENI';
  }

  comboNumEl.textContent = '+0';

  if(_reducedMotion()){
    comboNumEl.textContent = '+' + bonus;
    comboFinishTimeout = setTimeout(() => {
      comboPopupEl.classList.add('fly-out');
    }, 700);
    return;
  }

  const duration = 350;
  const startTime = performance.now();
  let lastVal = -1;
  let lastTextUpdate = 0;

  function tick(now){
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Ease-out Quartic
    const ease = 1 - Math.pow(1 - progress, 4);
    const currentVal = Math.round(ease * bonus);

    // Throttle DOM text update to ~30 FPS (33ms) to prevent heavy repaint lag while dragging
    if(currentVal !== lastVal && (now - lastTextUpdate > 33 || progress === 1)){
      comboNumEl.textContent = '+' + currentVal;
      lastVal = currentVal;
      lastTextUpdate = now;
    }

    if(progress < 1){
      comboRAF = requestAnimationFrame(tick);
    } else {
      comboNumEl.textContent = '+' + bonus;
      comboPopupEl.classList.add('finished');
      comboFinishTimeout = setTimeout(()=>{
        comboPopupEl.classList.add('fly-out');
      }, 550);
    }
  }

  comboRAF = requestAnimationFrame(tick);
}

/* ═══ ARCADE 3D BOARD ACTION ALERT (BOMB PLACED / GOLDEN CUBE) ═══ */
export function showBoardActionAlert(text, type = 'bomb'){
  const board = (D && D.boardEl) || document.getElementById('board');
  const boardParent = board ? (board.parentElement || document.body) : document.body;

  const existing = document.querySelectorAll('.board-action-alert');
  existing.forEach(el => DOMPool.release(el, 'board-action-alert'));

  const alert = DOMPool.acquire('div', 'board-action-alert');
  
  const content = DOMPool.acquire('div', 'action-alert-content');
  content.innerHTML = type === 'golden' ? '💎' : '💣';
  
  const tag = DOMPool.acquire('div', 'action-alert-tag');
  if(type === 'bomb'){
    tag.innerHTML = '💣 WARNING';
  } else if(type === 'gold'){
    tag.innerHTML = '✨ PULSE BONUS';
  } else if(type === 'frost'){
    tag.innerHTML = '❄️ FROST HAZARD';
  } else  if (type === 'golden') {
    alert.classList.add('golden');
    tag.style.color = '#fbbf24';
  } else {
    tag.style.color = '#ef4444';
  }
  
  const title = DOMPool.acquire('div', 'action-alert-title');
  title.innerHTML = text;
  
  content.appendChild(tag);
  content.appendChild(title);
  alert.appendChild(content);
  boardParent.appendChild(alert);

  if(_reducedMotion()){
    setTimeout(() => {
      DOMPool.release(title, 'action-alert-title');
      DOMPool.release(tag, 'action-alert-tag');
      DOMPool.release(content, 'action-alert-content');
      DOMPool.release(alert, 'board-action-alert');
    }, 700);
    return;
  }

  void alert.offsetWidth; // Reflow
  
  setTimeout(() => {
    alert.style.animation = 'actionAlertExit 0.32s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
    setTimeout(() => {
      DOMPool.release(title, 'action-alert-title');
      DOMPool.release(tag, 'action-alert-tag');
      DOMPool.release(content, 'action-alert-content');
      DOMPool.release(alert, 'board-action-alert');
    }, 320);
  }, 1800);
}

/* ═══ LINE-CLEAR / BOMB PARTICLES (Canvas 2D) ═══ */
export function spawnParticles(cellsToClear, colorOverride){
  if(_reducedMotion()) return;
  if(!ensureCanvas()) return;
  if (!D || !D.boardEl) return;

  const SIZE = D.SIZE || 8;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
  const total = cellsToClear.length || 1;
  const count = total > 12 ? 2 : (total > 6 ? 3 : 4);
  const grid = D.getGrid ? D.getGrid() : null;
  cellsToClear.forEach(key=>{
    const [r,c] = key.split('_').map(Number);
    const cellData = grid && grid[r] ? grid[r][c] : null;
    const color = colorOverride || (cellData && cellData.color) || '#5eead4';
    const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
    const cy = rect.top + padding + r*(cellW+gap) + cellW/2;
    for(let i=0; i<count; i++){
      const angle = (Math.PI * 2 * i / count) + Math.random() * 0.5;
      const speed = 2.5 + Math.random() * 4;
      const p = getFreeParticle();
      p.active = true;
      p.x = cx;
      p.y = cy;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.gravity = 0.08;
      p.drag = 0.94;
      p.size = 3.5 + Math.random() * 3.5;
      p.aspect = 1;
      p.shape = 'circle';
      p.color = color;
      p.rotation = Math.random() * 360;
      p.rotationSpeed = (Math.random() - 0.5) * 8;
      p.alpha = 1;
      p.life = 0;
      p.maxLife = 20 + Math.floor(Math.random() * 10);
    }
  });

  startCanvasLoop();
}

/* ═══ ROCK CRACK PARTICLES (Canvas 2D) ═══ */
export function spawnCrackParticles(cellsToClear){
  if(_reducedMotion()) return;
  if(!ensureCanvas()) return;
  if (!D || !D.boardEl) return;

  const SIZE = D.SIZE || 8;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
  const total = cellsToClear.length || 1;
  const count = total > 12 ? 3 : (total > 6 ? 4 : 5);
  const rockColors = ['#3d4454', '#5a6378', '#8690a8', '#d0d7e8', '#f59e0b'];

  cellsToClear.forEach(key=>{
    const [r,c] = key.split('_').map(Number);
    const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
    const cy = rect.top + padding + r*(cellW+gap) + cellW/2;

    for(let i=0; i<count; i++){
      const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.8;
      const speed = 2 + Math.random() * 3.5;
      const p = getFreeParticle();
      p.active = true;
      p.x = cx + (Math.random() - 0.5) * 8;
      p.y = cy + (Math.random() - 0.5) * 8;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 1;
      p.gravity = 0.22;
      p.drag = 0.95;
      p.size = 3 + Math.random() * 3.5;
      p.aspect = 0.8;
      p.shape = 'rect';
      p.color = rockColors[Math.floor(Math.random() * rockColors.length)];
      p.rotation = Math.random() * 360;
      p.rotationSpeed = (Math.random() - 0.5) * 14;
      p.alpha = 1;
      p.life = 0;
      p.maxLife = 22 + Math.floor(Math.random() * 10);
    }
  });

  startCanvasLoop();
}

/* ═══ BOMB SHOCKWAVE ═══ */
export function spawnShockwave(x, y){
  if(_reducedMotion()) return;
  const wave = DOMPool.acquire('div', 'touch-wave');
  wave.style.left = x + 'px';
  wave.style.top = y + 'px';
  document.body.appendChild(wave);
  setTimeout(()=> DOMPool.release(wave, 'touch-wave'), 450);
}

/* ═══ ICE SHATTER PARTICLES (Canvas 2D) ═══ */
export function spawnIceShatterParticles(r, c) {
  if (!D || !D.boardEl) return;
  if(_reducedMotion()) return;
  if(!ensureCanvas()) return;

  const SIZE = D.SIZE || 8;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding * 2 - gap * (SIZE - 1)) / SIZE;
  const cx = rect.left + padding + c * (cellW + gap) + cellW / 2;
  const cy = rect.top + padding + r * (cellW + gap) + cellW / 2;

  const iceColors = ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#ffffff'];
  const count = 10;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.5;
    const speed = 2.5 + Math.random() * 4;
    const p = getFreeParticle();
    p.active = true;
    p.x = cx + (Math.random() - 0.5) * 8;
    p.y = cy + (Math.random() - 0.5) * 8;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 1.2;
    p.gravity = 0.18;
    p.drag = 0.95;
    p.size = 3 + Math.random() * 3.5;
    p.aspect = 0.7;
    p.shape = 'rect';
    p.color = iceColors[Math.floor(Math.random() * iceColors.length)];
    p.rotation = Math.random() * 360;
    p.rotationSpeed = (Math.random() - 0.5) * 18;
    p.alpha = 1;
    p.life = 0;
    p.maxLife = 24 + Math.floor(Math.random() * 10);
  }

  startCanvasLoop();
}

/* ═══ DRAG SPARK TRAIL (Canvas 2D) ═══ */
let sparkThrottle = 0;
export function spawnSpark(x, y) {
  if(_reducedMotion()) return;
  if (!D || !D.getParticleTrailEnabled || !D.getParticleTrailEnabled()) return;
  sparkThrottle++;
  if (sparkThrottle % 2 !== 0) return;
  if (!ensureCanvas()) return;

  const p = getFreeParticle();
  p.active = true;
  p.x = x;
  p.y = y;
  p.vx = (Math.random() - 0.5) * 2;
  p.vy = (Math.random() - 0.5) * 2;
  p.gravity = 0.04;
  p.drag = 0.92;
  p.size = 2.5 + Math.random() * 2.5;
  p.aspect = 1;
  p.shape = 'circle';
  p.color = '#5eead4';
  p.rotation = 0;
  p.rotationSpeed = 0;
  p.alpha = 0.85;
  p.life = 0;
  p.maxLife = 14;

  startCanvasLoop();
}
