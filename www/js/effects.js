/*
 * Blocks & Rocks — vizuelni efekti: confetti (canvas), screen shake, score float,
 * line-clear/bomb particles, crack particles, shockwave, drag spark trail.
 * ES modul — faza 2 modularizacije. Zavisnosti: initEffects(deps).
 *   deps = { CONFIG, SIZE, boardEl, scoreEl, getGrid, getParticleTrailEnabled }
 */

let D = null;
export function initEffects(deps){ D = deps; }

/* Reduce Motion: kada je uključeno (ručni toggle ili OS signal) preskačemo
 * jake vizuelne efekte (shake/confetti/iskre/partikle/shockwave). */
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
  void target.offsetWidth;
  target.classList.add(cls);
  setTimeout(() => target.classList.remove(cls), intensity === 'heavy' ? 400 : 280);
}

/* ═══ CONFETTI SYSTEM (Canvas Particle Burst) ═══ */
const confettiCanvas = document.getElementById('confettiCanvas');
let confettiCtx = null;
let confettiParticles = [];
let confettiRAF = null;

function initConfetti(){
  if (!confettiCanvas) return;
  confettiCtx = confettiCanvas.getContext('2d');
  const resize = () => {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resize);
  resize();
}

export function triggerConfetti(count = 60){
  if(_reducedMotion()) return;
  if (!confettiCanvas) return;
  if (!confettiCtx) initConfetti();
  if (!confettiCtx) return;

  const colors = ['#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#a3e635', '#60a5fa', '#fb923c', '#ffffff'];
  const originX = confettiCanvas.width / 2;
  const originY = confettiCanvas.height * 0.42;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const speed = 5 + Math.random() * 10;
    confettiParticles.push({
      x: originX + (Math.random() - 0.5) * 90,
      y: originY + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4.5,
      size: 5 + Math.random() * 7,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 14,
      alpha: 1,
      life: 0,
      maxLife: 60 + Math.floor(Math.random() * 35),
    });
  }

  if (!confettiRAF) {
    animateConfetti();
  }
}

function animateConfetti(){
  if (!confettiCtx || confettiParticles.length === 0) {
    if (confettiCtx && confettiCanvas) {
      confettiCtx.setTransform(1, 0, 0, 1, 0, 0);
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
    confettiRAF = null;
    return;
  }

  confettiCtx.setTransform(1, 0, 0, 1, 0, 0);
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    const p = confettiParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.24; // gravity
    p.vx *= 0.98; // air drag
    p.rotation += p.rotationSpeed;
    p.life++;
    p.alpha = Math.max(0, 1 - p.life / p.maxLife);

    if (p.alpha <= 0 || p.y > confettiCanvas.height + 20) {
      confettiParticles.splice(i, 1);
      continue;
    }

    // setTransform u jednom pozivu primenjuje identitet + translaciju + rotaciju
    const rad = (p.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    confettiCtx.globalAlpha = p.alpha;
    confettiCtx.fillStyle = p.color;
    confettiCtx.setTransform(cosR, sinR, -sinR, cosR, p.x, p.y);
    confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
  }

  confettiCtx.setTransform(1, 0, 0, 1, 0, 0);
  confettiRAF = requestAnimationFrame(animateConfetti);
}

/* ═══ SCORE FLOAT ANIMATION ═══ */
export function showScoreFloat(points){
  if(points <= 0) return;
  const el = document.createElement('div');
  el.className = 'score-float';
  el.textContent = '+' + points;
  const scorebox = D.scoreEl.closest('.scorebox');
  scorebox.style.position = 'relative';
  scorebox.appendChild(el);
  el.style.right = '4px';
  el.style.bottom = '100%';
  setTimeout(()=> el.remove(), D.CONFIG.SCORE_FLOAT_DURATION);
}


/* ═══ LINE-CLEAR / BOMB PARTICLES ═══ */
export function spawnParticles(cellsToClear, colorOverride){
  if(_reducedMotion()) return;
  const SIZE = D.SIZE;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
  const total = cellsToClear.length || 1;
  const count = total > 12 ? 2 : (total > 6 ? 3 : D.CONFIG.PARTICLE_COUNT);
  const grid = D.getGrid();

  const existing = document.querySelectorAll('.particle');
  if (existing.length > 36) {
    for (let k = 0; k < existing.length - 20; k++) existing[k].remove();
  }

  cellsToClear.forEach(key=>{
    const [r,c] = key.split('_').map(Number);
    const cellData = grid[r][c];
    const color = colorOverride || (cellData && cellData.color) || '#5eead4';
    const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
    const cy = rect.top + padding + r*(cellW+gap) + cellW/2;

    for(let i=0;i<count;i++){
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.background = color;
      p.style.left = cx+'px';
      p.style.top = cy+'px';
      document.body.appendChild(p);

      const angle = (Math.PI*2*i/count) + Math.random()*0.6;
      const dist = 30 + Math.random()*40;
      const dx = Math.cos(angle)*dist;
      const dy = Math.sin(angle)*dist;
      const rot = (Math.random()*360)|0;

      p.animate([
        { transform:'translate3d(0,0,0) rotate(0deg) scale(1)', opacity:1 },
        { transform:`translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg) scale(0.3)`, opacity:0 }
      ], { duration: 420 + Math.random()*180, easing:'cubic-bezier(.2,.7,.3,1)' });

      setTimeout(()=>p.remove(), 650);
    }
  });
}

export function spawnCrackParticles(cellsToClear){
  if(_reducedMotion()) return;
  const SIZE = D.SIZE;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
  const total = cellsToClear.length || 1;
  const count = total > 12 ? 3 : (total > 6 ? 5 : (D.CONFIG.CRACK_PARTICLE_COUNT || 6));

  const existing = document.querySelectorAll('.particle');
  if (existing.length > 48) {
    for (let k = 0; k < existing.length - 24; k++) existing[k].remove();
  }

  const rockColors = ['#1e212b', '#3d4454', '#5a6378', '#8690a8', '#d0d7e8', '#fbbf24', '#f59e0b'];

  cellsToClear.forEach(key=>{
    const [r,c] = key.split('_').map(Number);
    const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
    const cy = rect.top + padding + r*(cellW+gap) + cellW/2;

    for(let i=0; i<count; i++){
      const p = document.createElement('div');
      p.className = 'particle';
      const szW = 3 + Math.floor(Math.random() * 5);
      const szH = 2 + Math.floor(Math.random() * 5);
      p.style.width = szW + 'px';
      p.style.height = szH + 'px';
      p.style.background = rockColors[Math.floor(Math.random() * rockColors.length)];
      p.style.borderRadius = `${1 + Math.random()*3}px ${2 + Math.random()*4}px ${1 + Math.random()*2}px ${2 + Math.random()*3}px`;
      p.style.boxShadow = '0 2px 4px rgba(0,0,0,0.6)';
      p.style.left = (cx + (Math.random() - 0.5) * 12) + 'px';
      p.style.top = (cy + (Math.random() - 0.5) * 12) + 'px';
      document.body.appendChild(p);

      const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.8;
      const dist = 16 + Math.random() * 26;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist + 10; // slight gravitational drop
      const rot = (Math.random() * 720 - 360) | 0;

      p.animate([
        { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${0.2 + Math.random()*0.4}) rotate(${rot}deg)`, opacity: 0 }
      ], { duration: 320 + Math.random() * 160, easing: 'cubic-bezier(.17,.67,.3,1)' });

      setTimeout(() => p.remove(), 490);
    }
  });
}

/* ═══ BOMB SHOCKWAVE ═══ */
export function spawnShockwave(r,c){
  if(_reducedMotion()) return;
  const SIZE = D.SIZE;
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
  setTimeout(()=> wave.remove(), 600);
}

/* ═══ ICE SHATTER PARTICLES (Hazard block destruction) ═══ */
export function spawnIceShatterParticles(r, c) {
  if (!D || !D.boardEl) return;
  if(_reducedMotion()) return;
  const SIZE = D.SIZE;
  const rect = D.boardEl.getBoundingClientRect();
  const padding = 8, gap = 4;
  const cellW = (rect.width - padding * 2 - gap * (SIZE - 1)) / SIZE;
  const cx = rect.left + padding + c * (cellW + gap) + cellW / 2;
  const cy = rect.top + padding + r * (cellW + gap) + cellW / 2;

  const iceColors = ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7', '#ffffff'];
  const count = 16;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const sz = 3 + Math.floor(Math.random() * 6);
    p.style.width = sz + 'px';
    p.style.height = (sz * (0.8 + Math.random() * 0.8)) + 'px';
    p.style.background = iceColors[Math.floor(Math.random() * iceColors.length)];
    p.style.borderRadius = '2px';
    p.style.boxShadow = '0 0 6px rgba(56, 189, 248, 0.85)';
    p.style.left = (cx + (Math.random() - 0.5) * 14) + 'px';
    p.style.top = (cy + (Math.random() - 0.5) * 14) + 'px';
    document.body.appendChild(p);

    const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.5;
    const dist = 24 + Math.random() * 32;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist + 12;
    const rot = (Math.random() * 720 - 360) | 0;

    p.animate([
      { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.1) rotate(${rot}deg)`, opacity: 0 }
    ], { duration: 400 + Math.random() * 150, easing: 'cubic-bezier(.17,.67,.3,1)' });

    setTimeout(() => p.remove(), 580);
  }
}

/* ═══ DRAG SPARK TRAIL ═══ */
let sparkThrottle = 0;
export function spawnSpark(x, y) {
  if(_reducedMotion()) return;
  if (!D || !D.getParticleTrailEnabled || !D.getParticleTrailEnabled()) return;
  sparkThrottle++;
  if (sparkThrottle % 2 !== 0) return;
  if (document.querySelectorAll('.drag-spark').length > 10) return;

  const spark = document.createElement('div');
  spark.className = 'drag-spark';
  spark.style.left = x + 'px';
  spark.style.top = y + 'px';
  const dx = (Math.random() - 0.5) * 36;
  const dy = (Math.random() - 0.5) * 36;
  spark.style.setProperty('--dx', dx + 'px');
  spark.style.setProperty('--dy', dy + 'px');

  document.body.appendChild(spark);
  setTimeout(() => spark.remove(), 420);
}
