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
let particles = [];
let canvasRAF = null;

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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    if(ctx) ctx.scale(dpr, dpr);
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
  if (!canvasRAF && particles.length > 0) {
    canvasRAF = requestAnimationFrame(animateCanvasParticles);
  }
}

function animateCanvasParticles(){
  if (!ctx || particles.length === 0) {
    if (ctx && canvas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvasRAF = null;
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const screenW = window.innerWidth + 30;
  const screenH = window.innerHeight + 30;

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.rotation += p.rotationSpeed;
    p.life++;
    p.alpha = Math.max(0, 1 - p.life / p.maxLife);

    if (p.alpha <= 0 || p.y > screenH || p.y < -30 || p.x > screenW || p.x < -30) {
      particles.splice(i, 1);
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

  if (particles.length > 0) {
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

  if (particles.length > 120) particles.splice(0, particles.length - 80);

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const speed = 4 + Math.random() * 8;
    particles.push({
      x: originX + (Math.random() - 0.5) * 80,
      y: originY + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      gravity: 0.22,
      drag: 0.98,
      size: 5 + Math.random() * 6,
      aspect: 0.65,
      shape: 'rect',
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      alpha: 1,
      life: 0,
      maxLife: 35 + Math.floor(Math.random() * 15),
    });
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
  const el = document.createElement('div');
  el.className = 'score-float';
  el.textContent = '+' + points;
  const scorebox = D && D.scoreEl ? D.scoreEl.closest('.scorebox') : null;
  if(scorebox){
    scorebox.style.position = 'relative';
    scorebox.appendChild(el);
    el.style.right = '4px';
    el.style.bottom = '100%';
  }
  setTimeout(()=> el.remove(), (D && D.CONFIG && D.CONFIG.SCORE_FLOAT_DURATION) || 1000);
}

/* ═══ BIG COMBO ROLLING BONUS COUNTER (Arkadni rastući brojač) ═══ */
export function showBigComboBonusCounter(bonus, comboStreak = 1, linesCleared = 1, customLabel = null){
  if(bonus <= 0) return;
  const board = (D && D.boardEl) || document.getElementById('board');
  const boardParent = board ? (board.parentElement || document.body) : document.body;

  const existing = document.querySelectorAll('.combo-bonus-popup');
  existing.forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = 'combo-bonus-popup' + (comboStreak >= 2 || bonus >= 300 ? ' mega-combo' : '');

  // Oznaka / značka iznad brojača
  const label = document.createElement('div');
  label.className = 'combo-bonus-label';
  if(customLabel){
    label.innerHTML = customLabel;
  } else if(comboStreak > 1) {
    label.innerHTML = `🔥 KOMBO NIZ <span class="combo-x">x${comboStreak}</span>`;
  } else if(linesCleared > 1) {
    label.innerHTML = `⚡ MULTI-LINIJA <span class="combo-x">x${linesCleared}</span>`;
  } else {
    label.textContent = '✨ BONUS POENI';
  }
  popup.appendChild(label);

  // Veliki broj
  const numEl = document.createElement('div');
  numEl.className = 'combo-bonus-number';
  numEl.textContent = '+0';
  popup.appendChild(numEl);

  boardParent.appendChild(popup);

  if(_reducedMotion()){
    numEl.textContent = '+' + bonus;
    setTimeout(() => {
      popup.classList.add('fly-out');
      setTimeout(() => popup.remove(), 300);
    }, 700);
    return;
  }

  // Snappy i glatko odbrojavanje od +0 do ciljanog iznosa (260ms - 420ms)
  const duration = Math.min(420, Math.max(260, bonus * 0.6));
  const startTime = performance.now();
  let lastVal = -1;

  function tick(now){
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Ease-out cubic za sočan završetak
    const ease = 1 - Math.pow(1 - progress, 3);
    const currentVal = Math.round(ease * bonus);

    if(currentVal !== lastVal){
      numEl.textContent = '+' + currentVal;
      lastVal = currentVal;
    }

    if(progress < 1){
      requestAnimationFrame(tick);
    } else {
      numEl.textContent = '+' + bonus;
      popup.classList.add('finished');
      setTimeout(()=>{
        popup.classList.add('fly-out');
        setTimeout(() => popup.remove(), 320);
      }, 550);
    }
  }

  requestAnimationFrame(tick);
}

/* ═══ ARCADE 3D BOARD ACTION ALERT (BOMB PLACED / GOLDEN CUBE) ═══ */
export function showBoardActionAlert(text, type = 'bomb'){
  const board = (D && D.boardEl) || document.getElementById('board');
  const boardParent = board ? (board.parentElement || document.body) : document.body;

  const existing = document.querySelectorAll('.board-action-alert');
  existing.forEach(el => el.remove());

  const alert = document.createElement('div');
  alert.className = 'board-action-alert alert-' + type;

  // Header tag / badge
  const tag = document.createElement('div');
  tag.className = 'action-alert-tag';
  if(type === 'bomb'){
    tag.innerHTML = '💣 WARNING';
  } else if(type === 'gold'){
    tag.innerHTML = '✨ PULSE BONUS';
  } else if(type === 'frost'){
    tag.innerHTML = '❄️ FROST HAZARD';
  } else if(type === 'defused'){
    tag.innerHTML = '🛡️ DEFUSED';
  } else {
    tag.innerHTML = '⚡ ALERT';
  }
  alert.appendChild(tag);

  // Main 3D Text
  const title = document.createElement('div');
  title.className = 'action-alert-title';
  title.innerHTML = text;
  alert.appendChild(title);

  boardParent.appendChild(alert);

  if(_reducedMotion()){
    setTimeout(() => alert.remove(), 700);
    return;
  }

  setTimeout(() => {
    alert.classList.add('fly-out');
    setTimeout(() => alert.remove(), 320);
  }, 680);
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

  if (particles.length > 120) particles.splice(0, particles.length - 80);

  cellsToClear.forEach(key=>{
    const [r,c] = key.split('_').map(Number);
    const cellData = grid && grid[r] ? grid[r][c] : null;
    const color = colorOverride || (cellData && cellData.color) || '#5eead4';
    const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
    const cy = rect.top + padding + r*(cellW+gap) + cellW/2;

    for(let i=0; i<count; i++){
      const angle = (Math.PI * 2 * i / count) + Math.random() * 0.5;
      const speed = 2.5 + Math.random() * 4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0.08,
        drag: 0.94,
        size: 3.5 + Math.random() * 3.5,
        aspect: 1,
        shape: 'circle',
        color: color,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 8,
        alpha: 1,
        life: 0,
        maxLife: 20 + Math.floor(Math.random() * 10),
      });
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

  if (particles.length > 120) particles.splice(0, particles.length - 80);

  cellsToClear.forEach(key=>{
    const [r,c] = key.split('_').map(Number);
    const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
    const cy = rect.top + padding + r*(cellW+gap) + cellW/2;

    for(let i=0; i<count; i++){
      const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.8;
      const speed = 2 + Math.random() * 3.5;
      particles.push({
        x: cx + (Math.random() - 0.5) * 8,
        y: cy + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        gravity: 0.22,
        drag: 0.95,
        size: 3 + Math.random() * 3.5,
        aspect: 0.8,
        shape: 'rect',
        color: rockColors[Math.floor(Math.random() * rockColors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 14,
        alpha: 1,
        life: 0,
        maxLife: 22 + Math.floor(Math.random() * 10),
      });
    }
  });

  startCanvasLoop();
}

/* ═══ BOMB SHOCKWAVE ═══ */
export function spawnShockwave(r,c){
  if(_reducedMotion()) return;
  const SIZE = D && D.SIZE ? D.SIZE : 8;
  if (!D || !D.boardEl) return;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
  const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
  const cy = rect.top + padding + r*(cellW+gap) + cellW/2;
  const wave = document.createElement('div');
  wave.className = 'shockwave';
  wave.style.left = cx + 'px';
  wave.style.top = cy + 'px';
  document.body.appendChild(wave);
  setTimeout(()=> wave.remove(), 450);
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

  if (particles.length > 120) particles.splice(0, particles.length - 80);

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.5;
    const speed = 2.5 + Math.random() * 4;
    particles.push({
      x: cx + (Math.random() - 0.5) * 8,
      y: cy + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      gravity: 0.18,
      drag: 0.95,
      size: 3 + Math.random() * 3.5,
      aspect: 0.7,
      shape: 'rect',
      color: iceColors[Math.floor(Math.random() * iceColors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 18,
      alpha: 1,
      life: 0,
      maxLife: 24 + Math.floor(Math.random() * 10),
    });
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

  if (particles.length > 60) return;

  particles.push({
    x: x,
    y: y,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
    gravity: 0.04,
    drag: 0.92,
    size: 2.5 + Math.random() * 2.5,
    aspect: 1,
    shape: 'circle',
    color: '#5eead4',
    rotation: 0,
    rotationSpeed: 0,
    alpha: 0.85,
    life: 0,
    maxLife: 14,
  });

  startCanvasLoop();
}
