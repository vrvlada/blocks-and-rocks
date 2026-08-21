/*
 * Blocks & Rocks — Premium Cheerful Arcade Audio Engine (Web Audio API) + Haptics.
 * ES modul — kompletno proceduralni, veseli arkadni set zvukova.
 * 
 * Čist, topao, arkadni audio dizajn:
 * - Uzorkovano-precizno zakazivanje na Web Audio vremenskoj liniji (bez setTimeout jittera i seckanja)
 * - Centralizovani audio mikser sa master / sfx / combo magistralama
 * - Automatsko čišćenje i diskonekcija audio čvorova (onended)
 * - Zvonki arpeggi za komboe, bombu, led, stene i bonuse
 */

let audioCtx = null;
let masterGainNode = null;
let sfxGainNode = null;
let comboGainNode = null;

let muted = localStorage.getItem('blocksrocks_muted') === '1';
let hapticMode = localStorage.getItem('blocksrocks_haptic') || 'medium';
let _getT = () => ({}); // () => TRANSLATIONS[currentLang]

let worldRecordAudioBuffer = null;
let worldRecordLoadPromise = null;

export async function loadWorldRecordBuffer() {
  if (worldRecordAudioBuffer) return worldRecordAudioBuffer;
  if (worldRecordLoadPromise) return worldRecordLoadPromise;

  worldRecordLoadPromise = (async () => {
    try {
      const ctx = getAudioCtx();
      const res = await fetch('./assets/new_world_record.mp3');
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        if (ctx) {
          try {
            worldRecordAudioBuffer = await ctx.decodeAudioData(arrayBuffer);
          } catch (_) {
            worldRecordAudioBuffer = await new Promise((resolve, reject) => {
              ctx.decodeAudioData(arrayBuffer, resolve, reject);
            });
          }
        }
      }
    } catch (err) {
      console.warn('[B&R] Failed to load/decode world record audio:', err);
    } finally {
      worldRecordLoadPromise = null;
    }
    return worldRecordAudioBuffer;
  })();

  return worldRecordLoadPromise;
}

export async function loadComboBuffer() {
  if (comboAudioBuffer) return comboAudioBuffer;
  if (comboLoadPromise) return comboLoadPromise;

  comboLoadPromise = (async () => {
    try {
      const ctx = getAudioCtx();
      const paths = ['./assets/combo.wav', 'assets/combo.wav', 'combo.wav'];
      let arrayBuffer = null;
      for (const path of paths) {
        try {
          const res = await fetch(path);
          if (res.ok) {
            arrayBuffer = await res.arrayBuffer();
            break;
          }
        } catch (_) {}
      }
      if (arrayBuffer && ctx) {
        try {
          comboAudioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        } catch (_) {
          comboAudioBuffer = await new Promise((resolve, reject) => {
            ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
          });
        }
      }
    } catch (err) {
      console.warn('[B&R] Failed to load/decode combo.wav:', err);
    } finally {
      comboLoadPromise = null;
    }
    return comboAudioBuffer;
  })();

  return comboLoadPromise;
}

export function initAudio({ getT } = {}){
  if (getT) _getT = getT;
  loadWorldRecordBuffer();
  loadComboBuffer();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
}

function getAudioCtx(){
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if(!audioCtx) {
    audioCtx = new AudioCtx({ latencyHint: 'interactive' });
  }
  if(audioCtx.state === 'suspended') {
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}

function getMixer(){
  const ctx = getAudioCtx();
  if (!masterGainNode) {
    masterGainNode = ctx.createGain();
    masterGainNode.gain.setValueAtTime(getMasterVol(), ctx.currentTime);
    masterGainNode.connect(ctx.destination);

    sfxGainNode = ctx.createGain();
    sfxGainNode.gain.setValueAtTime(Math.max(0, Math.min(1, audioSettings.sfxVolume)), ctx.currentTime);
    sfxGainNode.connect(masterGainNode);

    comboGainNode = ctx.createGain();
    comboGainNode.gain.setValueAtTime(Math.max(0, Math.min(1, audioSettings.comboVolume)), ctx.currentTime);
    comboGainNode.connect(masterGainNode);
  }
  return { ctx, master: masterGainNode, sfx: sfxGainNode, combo: comboGainNode };
}

function unlockAudio(){
  const ctx = getAudioCtx();
  if(ctx && ctx.state === 'suspended'){
    ctx.resume().catch(()=>{});
  }
  getMixer();
  loadComboBuffer();
  loadWorldRecordBuffer();
}

/* ═══════════════════════════════════════════════
 *  HAPTICS ENGINE
 * ═══════════════════════════════════════════════ */
export function haptic(type){
  if (hapticMode === 'off') return;
  try{
    const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if(cap){
      if(type === 'success') cap.notification({ type: 'SUCCESS' });
      else if(type === 'warning') cap.notification({ type: 'WARNING' });
      else if(type === 'heavy') cap.impact({ style: hapticMode === 'light' ? 'MEDIUM' : 'HEAVY' });
      else cap.impact({ style: hapticMode === 'strong' ? 'MEDIUM' : 'LIGHT' });
      return;
    }
    const scale = hapticMode === 'strong' ? 1 : hapticMode === 'light' ? 0.4 : 0.7;
    if(navigator.vibrate) navigator.vibrate(type === 'success' ? [15,40,15] : Math.round((type === 'heavy' ? 60 : 12) * scale));
  }catch(e){}
}

/* ═══════════════════════════════════════════════
 *  AUDIO SETTINGS & VOLUME CONTROLS
 * ═══════════════════════════════════════════════ */
let audioSettings = {
  masterVolume: localStorage.getItem('blocksrocks_vol_master') != null ? parseFloat(localStorage.getItem('blocksrocks_vol_master')) : 0.8,
  comboVolume: localStorage.getItem('blocksrocks_vol_combo') != null ? parseFloat(localStorage.getItem('blocksrocks_vol_combo')) : 0.7,
  sfxVolume: localStorage.getItem('blocksrocks_vol_sfx') != null ? parseFloat(localStorage.getItem('blocksrocks_vol_sfx')) : 0.8,
  movesEnabled: localStorage.getItem('blocksrocks_moves_sound') === '1',
  fanfareEnabled: localStorage.getItem('blocksrocks_fanfare_sound') !== '0',
};

export function getAudioSettings(){
  return { ...audioSettings, isMuted: muted };
}

export function setAudioSetting(key, val){
  if (key in audioSettings) {
    audioSettings[key] = val;
    if (key === 'masterVolume') {
      localStorage.setItem('blocksrocks_vol_master', String(val));
      if (masterGainNode && audioCtx) {
        masterGainNode.gain.setValueAtTime(getMasterVol(), audioCtx.currentTime);
      }
    }
    if (key === 'comboVolume') {
      localStorage.setItem('blocksrocks_vol_combo', String(val));
      if (comboGainNode && audioCtx) {
        comboGainNode.gain.setValueAtTime(Math.max(0, Math.min(1, val)), audioCtx.currentTime);
      }
    }
    if (key === 'sfxVolume') {
      localStorage.setItem('blocksrocks_vol_sfx', String(val));
      if (sfxGainNode && audioCtx) {
        sfxGainNode.gain.setValueAtTime(Math.max(0, Math.min(1, val)), audioCtx.currentTime);
      }
    }
    if (key === 'movesEnabled') localStorage.setItem('blocksrocks_moves_sound', val ? '1' : '0');
    if (key === 'fanfareEnabled') localStorage.setItem('blocksrocks_fanfare_sound', val ? '1' : '0');
  }
}

function getMasterVol(){
  if (muted) return 0;
  return Math.max(0, Math.min(1, audioSettings.masterVolume));
}

function getSfxVol(){
  return getMasterVol() * Math.max(0, Math.min(1, audioSettings.sfxVolume));
}

export function isMuted(){ return muted; }
export function getHapticMode(){ return hapticMode; }
export function setHapticMode(mode){
  hapticMode = mode;
  localStorage.setItem('blocksrocks_haptic', mode);
}

export function setMuted(v){
  muted = !!v;
  localStorage.setItem('blocksrocks_muted', muted ? '1' : '0');
  if (masterGainNode && audioCtx) {
    masterGainNode.gain.setValueAtTime(getMasterVol(), audioCtx.currentTime);
  }
  const icon = document.getElementById('btnMute');
  if(icon) icon.textContent = muted ? '🔇' : '🔊';
  const pm = document.getElementById('pauseMuteBtn');
  if(pm){
    const t = _getT();
    pm.textContent = (muted ? '🔇 ' : '🔊 ') + t.pauseMutePrefix + (muted ? t.soundOff : t.soundOn);
  }
}
export function toggleMute(){ setMuted(!muted); }

/* ═══════════════════════════════════════════════
 *  PROCEDURAL ARCADE SYNTHESIS CORE (PRECISE WEB AUDIO TIMELINE)
 * ═══════════════════════════════════════════════ */

let noiseBufferCache = null;
function getNoiseBuffer(ctx) {
  if (!noiseBufferCache || noiseBufferCache.sampleRate !== ctx.sampleRate) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.6);
    noiseBufferCache = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBufferCache.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.04 * white)) / 1.04;
      lastOut = output[i];
      output[i] *= 2.8;
    }
  }
  return noiseBufferCache;
}

// Throttle brzih identičnih perkusivnih udaraca
const sfxLastPlayTimes = new Map();
function shouldPlayThrottled(key, minGapMs = 40) {
  const now = performance.now();
  const last = sfxLastPlayTimes.get(key) || 0;
  if (now - last < minGapMs) return false;
  sfxLastPlayTimes.set(key, now);
  return true;
}

/**
 * Sočni mekani arkadni "bubble / pop" (za postavljanje, rotaciju, sitne akcije).
 */
function playArcadePop(startFreq, endFreq, duration, volume, filterFreq = 2200, startTime = 0) {
  if (muted) return;
  const { ctx, sfx } = getMixer();
  const v = volume * 0.9;
  if (v <= 0) return;
  const t = Math.max(ctx.currentTime, startTime || ctx.currentTime);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.35), t + duration);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);

  gain.gain.setValueAtTime(v, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(sfx);

  osc.start(t);
  osc.stop(t + duration);
  osc.onended = () => {
    try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch(_){}
  };
}

/**
 * Veseli marimba / glockenspiel zvončić sa toplim harmonijama (zakazan na Web Audio timeline-u).
 */
function playArcadeBell(freq, duration, volume, shimmer = false, startTime = 0, customBus = null) {
  if (muted) return;
  const { ctx, sfx } = getMixer();
  const bus = customBus || sfx;
  const v = volume * 0.85;
  if (v <= 0) return;
  const t = Math.max(ctx.currentTime, startTime || ctx.currentTime);

  // 1. Osnovni topli ton (marimba / sine body)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, t);
  gain1.gain.setValueAtTime(v * 0.75, t);
  gain1.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc1.connect(gain1);
  gain1.connect(bus);
  osc1.start(t);
  osc1.stop(t + duration);
  osc1.onended = () => {
    try { osc1.disconnect(); gain1.disconnect(); } catch(_){}
  };

  // 2. Zvonki harmonik (kvinta / oktava za kristalnu bistrinu)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(freq * (shimmer ? 2.0 : 1.5), t);
  gain2.gain.setValueAtTime(v * 0.38, t);
  gain2.gain.exponentialRampToValueAtTime(0.0001, t + duration * 0.65);

  osc2.connect(gain2);
  gain2.connect(bus);
  osc2.start(t);
  osc2.stop(t + duration);
  osc2.onended = () => {
    try { osc2.disconnect(); gain2.disconnect(); } catch(_){}
  };

  // 3. Svetlucavi sparkle vrh
  if (shimmer) {
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 3.0, t);
    gain3.gain.setValueAtTime(v * 0.20, t);
    gain3.gain.exponentialRampToValueAtTime(0.0001, t + duration * 0.4);

    osc3.connect(gain3);
    gain3.connect(bus);
    osc3.start(t);
    osc3.stop(t + duration);
    osc3.onended = () => {
      try { osc3.disconnect(); gain3.disconnect(); } catch(_){}
    };
  }
}

/**
 * Arkadni perkusivni udarac / krckanje / lomljenje (kamen, led, čekić).
 */
function playArcadeImpact(bandFreq, noiseDuration, thudFreq, volume, startTime = 0) {
  if (muted) return;
  const { ctx, sfx } = getMixer();
  const v = volume * 0.85;
  if (v <= 0) return;
  const t = Math.max(ctx.currentTime, startTime || ctx.currentTime);

  // 1. Zvučni krckavi šum kroz bandpass filter
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(bandFreq, t);
  bandpass.Q.setValueAtTime(2.2, t);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(v * 0.7, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseDuration);

  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(sfx);
  noise.start(t);
  noise.stop(t + noiseDuration);
  noise.onended = () => {
    try { noise.disconnect(); bandpass.disconnect(); noiseGain.disconnect(); } catch(_){}
  };

  // 2. Topli duboki udarac
  if (thudFreq > 0) {
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(thudFreq, t);
    thud.frequency.exponentialRampToValueAtTime(Math.max(20, thudFreq * 0.25), t + noiseDuration * 1.3);
    thudGain.gain.setValueAtTime(v * 0.65, t);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseDuration * 1.3);

    thud.connect(thudGain);
    thudGain.connect(sfx);
    thud.start(t);
    thud.stop(t + noiseDuration * 1.3);
    thud.onended = () => {
      try { thud.disconnect(); thudGain.disconnect(); } catch(_){}
    };
  }
}

export function playTone(freq, duration, type, vol){
  if(muted) return;
  playArcadeBell(freq, duration, (vol || 0.12) / 0.12, false);
}

/* ═══════════════════════════════════════════════
 *  GAMEPLAY SFX HANDLERS (HARDWARE SAMPLE-ACCURATE SCHEDULING)
 * ═══════════════════════════════════════════════ */

/**
 * 🟩 Postavljanje kocke — sočan, mekani, prijatni arkadni pop.
 */
export function sfxPlace(){
  haptic('light');
  if (muted || !audioSettings.movesEnabled) return;
  playArcadePop(540, 260, 0.075, 0.40, 2400);
}

/**
 * 🔄 Rotacija kocke — brzi veseli "swoosh-pop".
 */
export function sfxRotate(){
  haptic('light');
  if (muted || !audioSettings.movesEnabled) return;
  playArcadePop(380, 820, 0.05, 0.35, 3200);
}

/**
 * ✨ Čišćenje 1 linije — vedri zvonki dvozvon (D5 -> A5).
 */
export function sfxClear(){
  if (muted) return;
  const { ctx, combo } = getMixer();
  const t0 = ctx.currentTime;
  playArcadeBell(587.33, 0.20, 0.45, true, t0, combo);        // D5
  playArcadeBell(880.00, 0.30, 0.50, true, t0 + 0.055, combo); // A5
  haptic('success');
}

/**
 * 🔥 COMBO / MULTI-LINE ORCHESTRA
 * Dinamički, veseli arkadni niz sa marimbom i zvončićima po dur skali.
 * Zakazan 100% unapred na Web Audio timeline-u bez ikakvog seckanja ili zastoja.
 */
export function playComboAudio(streak, lines){
  if(muted) return;
  haptic('success');

  const s = Math.max(1, streak || 1);
  const l = Math.max(1, lines || 1);
  const comboLevel = s > 1 ? (s + (l > 1 ? l - 1 : 0)) : l;

  const notes = [
    587.33,  // D5
    659.25,  // E5
    739.99,  // F#5
    880.00,  // A5
    987.77,  // B5
    1174.66, // D6
    1318.51, // E6
    1479.98, // F#6
    1760.00, // A6
    1975.53, // B6
    2349.32  // D7
  ];

  const baseIdx = Math.min(notes.length - 3, Math.max(0, comboLevel - 1));
  const { ctx, combo } = getMixer();
  const t0 = ctx.currentTime;

  if (l === 1 && s === 1) {
    // 1 obična linija: D5 -> A5
    playArcadeBell(notes[0], 0.22, 0.45, true, t0, combo);
    playArcadeBell(notes[3], 0.32, 0.52, true, t0 + 0.055, combo);
  } else if (l === 2 || comboLevel === 2) {
    // Double clear / 2x Combo: D5 -> F#5 -> A5
    playArcadeBell(notes[baseIdx], 0.20, 0.45, true, t0, combo);
    playArcadeBell(notes[baseIdx + 1], 0.22, 0.50, true, t0 + 0.050, combo);
    playArcadeBell(notes[baseIdx + 2], 0.35, 0.55, true, t0 + 0.100, combo);
  } else if (l === 3 || comboLevel === 3) {
    // Triple clear / 3x Combo: 4-note veseli arpeggio
    playArcadeBell(notes[baseIdx], 0.18, 0.45, true, t0, combo);
    playArcadeBell(notes[baseIdx + 1], 0.20, 0.48, true, t0 + 0.045, combo);
    playArcadeBell(notes[baseIdx + 2], 0.22, 0.52, true, t0 + 0.090, combo);
    playArcadeBell(notes[baseIdx + 3], 0.38, 0.60, true, t0 + 0.135, combo);
  } else {
    // Quad clear / 4x+ Mega Combo: 5-note trijumfalni kaskadni arpeggio!
    for (let i = 0; i < 5; i++) {
      const nIdx = Math.min(notes.length - 1, baseIdx + i);
      playArcadeBell(notes[nIdx], 0.24 + i * 0.03, 0.46 + i * 0.04, true, t0 + i * 0.040, combo);
    }
  }

  // Ako postoji comboAudioBuffer i uključen je u podešavanjima, sinhronizovano pusti
  if (comboAudioBuffer && audioSettings.comboVolume > 0) {
    try {
      const source = ctx.createBufferSource();
      source.buffer = comboAudioBuffer;
      const rate = Math.min(3.0, Math.pow(2, (comboLevel - 1) * 2 / 12));
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, t0); // Base volume
      source.connect(gain);
      gain.connect(combo);
      source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch(_){} };
      source.start(t0);
    } catch(_){}
  }
}

export function previewComboAudio(){
  playComboAudio(3, 2);
}

/**
 * 🌟 Zlatna kocka / Bonus Gem — Super Mario stil sjajnog novčića (B5 -> E6 -> B6).
 */
export function sfxBonusGem(){
  if (muted) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  playArcadeBell(987.77, 0.16, 0.50, true, t0);          // B5
  playArcadeBell(1318.51, 0.24, 0.56, true, t0 + 0.055); // E6
  playArcadeBell(1975.53, 0.32, 0.45, true, t0 + 0.110); // B6 sparkle
  haptic('success');
}

/**
 * 🔨 Čekić — crtani punchy arkadni bonk + svetlucavi klik.
 */
export function sfxHammer(){
  if (muted) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  playArcadeImpact(900, 0.14, 180, 0.65, t0);
  playArcadePop(320, 90, 0.09, 0.45, 1800, t0);
  playArcadeBell(1174.66, 0.18, 0.40, true, t0 + 0.035);
  haptic('heavy');
}

/**
 * 🎲 Zamena (Reroll) — razigrani tumbling arkadni roll (D5, G5, B5, D6).
 */
export function sfxReroll(){
  if (muted) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  const rollNotes = [587.33, 783.99, 987.77, 1174.66];
  rollNotes.forEach((freq, i) => {
    const t = t0 + i * 0.038;
    playArcadePop(freq * 0.8, freq * 1.2, 0.06, 0.38, 2800, t);
    playArcadeBell(freq, 0.14, 0.35, false, t);
  });
  haptic('medium');
}

/**
 * 🪨 Naprsnuće kamena — sočan i jasan kameni tap.
 */
export function sfxRockCrack(){
  if (muted || !shouldPlayThrottled('rock_crack', 40)) return;
  playArcadeImpact(750, 0.08, 140, 0.50);
  haptic('heavy');
}

/**
 * 💥 Uništenje kamena — zadovoljavajući arkadni crunch + nagradni ton!
 */
export function sfxRockBreak(){
  if (muted || !shouldPlayThrottled('rock_break', 40)) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  playArcadeImpact(600, 0.16, 110, 0.65, t0);
  playArcadePop(260, 90, 0.12, 0.40, 1600, t0);
  playArcadeBell(880.00, 0.22, 0.42, true, t0 + 0.050);
  haptic('heavy');
}

/**
 * ❄️ Naprsnuće leda — staklasti kristalni snap.
 */
export function sfxIceCrack(){
  if (muted || !shouldPlayThrottled('ice_crack', 40)) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  playArcadeImpact(2200, 0.07, 0, 0.45, t0);
  playArcadeBell(1567.98, 0.12, 0.35, true, t0 + 0.025);
  haptic('light');
}

/**
 * 🧊 Lomljenje leda / odmrzavanje — svetlucavo rasipanje ledenih kristala.
 */
export function sfxIceBreak(){
  if (muted || !shouldPlayThrottled('ice_break', 45)) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  playArcadeImpact(2600, 0.12, 0, 0.50, t0);
  const iceNotes = [1318.51, 1567.98, 2093.00, 2637.02];
  iceNotes.forEach((freq, i) => {
    playArcadeBell(freq, 0.14 + i * 0.03, 0.40, true, t0 + i * 0.030);
  });
  haptic('success');
}

/**
 * 💣 Bomba eksplozija — topao, filmski bas udarac.
 */
export function sfxBomb(){
  if (muted) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  playArcadeImpact(450, 0.28, 90, 0.85, t0);
  playArcadePop(140, 35, 0.35, 0.70, 800, t0);
  haptic('heavy');
}

/**
 * 🚀 Level Up / Fibonacci Milestone — vedra arkadna fanfarica (C5 -> E5 -> G5 -> C6).
 */
export function sfxLevelUp(){
  if (muted) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    playArcadeBell(freq, 0.20 + i * 0.04, 0.48, true, t0 + i * 0.065);
  });
  haptic('heavy');
}

/**
 * 🏆 Novi rekord — vesela trijumfalna fanfara!
 */
export function sfxNewBest(){
  if (muted || !audioSettings.fanfareEnabled) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  const fanfare = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6
  fanfare.forEach((freq, i) => {
    playArcadeBell(freq, 0.26 + i * 0.05, 0.52, true, t0 + i * 0.075);
  });
  haptic('success');
}

/**
 * 🌍 Svetski rekord — audio glas + velika arkadna pobednička fanfara.
 */
export function sfxWorldRecord(){
  if(muted || !audioSettings.fanfareEnabled) return;
  const m = getMasterVol();
  if(worldRecordAudioBuffer) {
    try {
      const ctx = getAudioCtx();
      const { master } = getMixer();
      const source = ctx.createBufferSource();
      source.buffer = worldRecordAudioBuffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(m, ctx.currentTime);
      source.connect(gain);
      gain.connect(master);
      source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch(_){} };
      source.start(ctx.currentTime);
    } catch(err){}
  }

  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
  notes.forEach((freq, i) => {
    playArcadeBell(freq, 0.30 + i * 0.04, 0.55, true, t0 + i * 0.070);
  });
  haptic('success');
}

/**
 * 🎖️ Otključan bedž — vesela arkadna nagrada (D5 -> F#5 -> A5 -> D6).
 */
export function sfxBadgeUnlock(){
  if(muted || !audioSettings.fanfareEnabled) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  const notes = [587.33, 739.99, 880.00, 1174.66];
  notes.forEach((freq, i) => {
    playArcadeBell(freq, 0.25 + i * 0.05, 0.50, true, t0 + i * 0.075);
  });
  haptic('success');
}

/**
 * 🏁 Kraj igre (Game Over) — nostalgični, topli arkadni završni akord (G4 -> E4 -> C4).
 */
export function sfxGameOver(){
  if (muted) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  const notes = [392.00, 329.63, 261.63]; // G4, E4, C4
  notes.forEach((freq, i) => {
    playArcadeBell(freq, 0.35 + i * 0.1, 0.40, false, t0 + i * 0.140);
  });
  haptic('warning');
}
