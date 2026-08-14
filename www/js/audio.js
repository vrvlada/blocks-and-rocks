/*
 * Blocks & Rocks — zvuk (Web Audio API) + haptika (Capacitor Haptics / navigator.vibrate).
 * ES modul — faza 2 modularizacije.
 * Modul poseduje `muted` i `hapticMode` stanje (localStorage perzistencija).
 * Jedinu zavisnost (prevod) dobija preko initAudio({ getT }).
 */

let audioCtx = null;
let muted = localStorage.getItem('blocksrocks_muted') === '1';
let hapticMode = localStorage.getItem('blocksrocks_haptic') || 'medium';
let _getT = () => ({}); // () => TRANSLATIONS[currentLang]

export function initAudio({ getT } = {}){
  if (getT) _getT = getT;
  // Unlock audio on first user gesture for mobile / WebView
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
}

function getAudioCtx(){
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if(!audioCtx) audioCtx = new AudioCtx();
  if(audioCtx.state === 'suspended') {
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}

function unlockAudio(){
  if(audioCtx && audioCtx.state === 'suspended'){
    audioCtx.resume().catch(()=>{});
  }
}

export function playTone(freq, duration, type, vol){
  if(muted) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol || 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch(e){}
    };
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch(e){}
}

export function haptic(type){
  if (hapticMode === 'off') return; // poštuj korisničko podešavanje
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

export function isMuted(){ return muted; }
export function getHapticMode(){ return hapticMode; }
export function setHapticMode(mode){
  hapticMode = mode;
  localStorage.setItem('blocksrocks_haptic', mode);
}

export function setMuted(v){
  muted = !!v;
  localStorage.setItem('blocksrocks_muted', muted ? '1' : '0');
  const icon = document.getElementById('btnMute');
  if(icon) icon.textContent = muted ? '🔇' : '🔊';
  const pm = document.getElementById('pauseMuteBtn');
  if(pm){
    const t = _getT();
    pm.textContent = (muted ? '🔇 ' : '🔊 ') + t.pauseMutePrefix + (muted ? t.soundOff : t.soundOn);
  }
}
export function toggleMute(){ setMuted(!muted); }

export function sfxPlace(){ playTone(520, 0.10, 'sine', 0.13); playTone(680, 0.08, 'triangle', 0.08); haptic('light'); }
export function sfxClear(){
  playTone(600, 0.12, 'sine', 0.1);
  setTimeout(()=> playTone(800, 0.14, 'sine', 0.1), 60);
  setTimeout(()=> playTone(1100, 0.18, 'triangle', 0.08), 120);
  haptic('success');
}
export function sfxBomb(){
  playTone(120, 0.35, 'sawtooth', 0.15);
  playTone(80, 0.5, 'sine', 0.12);
  haptic('heavy');
}
export function sfxHammer(){
  playTone(160, 0.15, 'sawtooth', 0.2);
  playTone(90, 0.22, 'triangle', 0.18);
  haptic('heavy');
}
export function sfxReroll(){
  playTone(440, 0.07, 'sine', 0.1);
  setTimeout(()=> playTone(554, 0.08, 'sine', 0.1), 50);
  setTimeout(()=> playTone(659, 0.09, 'sine', 0.1), 100);
  setTimeout(()=> playTone(880, 0.12, 'sine', 0.12), 150);
  haptic('medium');
}
export function sfxRotate(){
  playTone(720, 0.06, 'triangle', 0.1);
  haptic('light');
}
export function sfxNewBest(){
  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 triumph fanfare
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.18 + i * 0.04, 'sine', 0.14);
      if (i === notes.length - 1) playTone(freq, 0.35, 'triangle', 0.12);
    }, i * 90);
  });
  haptic('success');
}
export function playComboAudio(streak, lines){
  const baseFreqs = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
  const rootIdx = Math.min(Math.max(0, streak - 1), baseFreqs.length - 3);
  const f1 = baseFreqs[rootIdx] || 523.25;
  const f2 = baseFreqs[rootIdx + 1] || 659.25;
  const f3 = baseFreqs[rootIdx + 2] || 783.99;
  playTone(f1, 0.1, 'sine', 0.12);
  setTimeout(()=> playTone(f2, 0.12, 'sine', 0.12), 60);
  setTimeout(()=> playTone(f3, 0.18, 'triangle', 0.1), 120);
  haptic('success');
}
export function sfxGameOver(){
  playTone(440, 0.2, 'sine', 0.1);
  setTimeout(()=> playTone(370, 0.2, 'sine', 0.1), 150);
  setTimeout(()=> playTone(300, 0.4, 'sine', 0.12), 300);
  haptic('warning');
}
