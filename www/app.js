
import { TRANSLATIONS } from './i18n.js';
import { escapeHtml } from './js/utils.js';
import { initAudio, haptic, setMuted, toggleMute, isMuted, getHapticMode, setHapticMode,
         sfxPlace, sfxClear, sfxBomb, sfxHammer, sfxRockCrack, sfxRockBreak, sfxReroll, sfxRotate, sfxNewBest, sfxWorldRecord,
         sfxLevelUp, sfxIceCrack, sfxIceBreak,
         playComboAudio, sfxGameOver, sfxBonusGem } from './js/audio.js';
import { initEffects, triggerScreenShake, triggerConfetti, showScoreFloat, spawnParticles,
         spawnCrackParticles, spawnShockwave, spawnSpark, spawnIceShatterParticles } from './js/effects.js';
import { initLeaderboard, updateBottomRecords, fetchMyTop3, getCachedGlobalTopScore } from './js/leaderboard.js';
import { checkAndUnlockBadges, renderBadgesGrid, getHighestBadge, loadBadges } from './js/achievements.js';

(function(){
  /* ═══════════════════════════════════════════════
   *  FIREBASE CONFIG — Zamenite sa vašim podacima
   * ═══════════════════════════════════════════════ */
  const firebaseConfig = {
    apiKey: "AIzaSyAKJ-j1nkalaTm5S2QrkLZofVYfae2ekJM",
    authDomain: "blocks-and-rocks.firebaseapp.com",
    projectId: "blocks-and-rocks",
    storageBucket: "blocks-and-rocks.firebasestorage.app",
    messagingSenderId: "556570853814",
    appId: "1:556570853814:web:9a6c66cc922c4da4870117"
  };

  /* ═══════════════════════════════════════════════
   *  FIREBASE APP CHECK (reCAPTCHA v3)
   *  Upisati reCAPTCHA v3 Site Key (Firebase Console → App Check).
   *  Ako je prazan — App Check se preskače i aplikacija radi kao i do sada.
   *  VAŽNO: "Enforce" uključiti u konzoli TEK KAD svi klijenti dobiju ključ!
   * ═══════════════════════════════════════════════ */
  const appCheckSiteKey = '6LeFh4UtAAAAAHyBkW5vpD_iWNa1-uOFrCUe_T7D'; // reCAPTCHA v3 Site Key (javni — sme u kod)

  /* ═══════════════════════════════════════════════
   *  FIREBASE INIT & GLOBAL APP STATE
   * ═══════════════════════════════════════════════ */
  let fb_app, fb_appCheck, fb_auth, fb_db, fb_userId = null;
  let firebaseReady = false;
  // muted / hapticMode stanje: vlasništvo js/audio.js modula
  // username/personalBest deklarisani rano (TDZ: init catch ispod ih sinhrono referencira)
  let username = localStorage.getItem('blocksrocks_username') || '';
  let personalBest = parseInt(localStorage.getItem('blocksrocks_personalBest') || '0');

  try {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      fb_app = firebase.initializeApp(firebaseConfig);

      // App Check (reCAPTCHA v3) — MORA pre auth/firestore poziva da bi tokeni važili
      if (appCheckSiteKey && typeof firebase.appCheck === 'function') {
        try {
          if (!window.Capacitor && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            // Dev mod: SDK ispisuje debug token u konzolu → registruj ga u
            // Firebase Console → App Check → Apps → Manage debug tokens
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
          }
          fb_appCheck = firebase.appCheck();
          fb_appCheck.activate(appCheckSiteKey, true); // true = automatsko osvežavanje tokena
          console.log('[B&R] App Check aktivan (reCAPTCHA v3)');
        } catch(acErr) {
          console.warn('[B&R] App Check init nije uspeo — nastavljam bez njega:', acErr && acErr.message);
        }
      }

      fb_auth = firebase.auth();
      fb_db = firebase.firestore();

      const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

      if (isNativeApp || !location.search.includes('apiKey')) {
        // U mobilnoj aplikaciji ili standardnom pokretanju, odmah se prijavljujemo anonimno
        if (!fb_auth.currentUser) {
          fb_auth.signInAnonymously().catch(err => {
            console.warn('[B&R] Firebase Auth failed:', err.message);
            if(!fb_userId){
              fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
            }
          });
        }
      } else {
        // Web redirect obrada (sa kratkim 2.5s timeout-om za web browser)
        const redirectTimeoutMs = 2500;
        let redirectTimerId = null;
        const redirectTimeout = new Promise((_, reject) => {
          redirectTimerId = setTimeout(() => reject(new Error('redirect_timeout')), redirectTimeoutMs);
        });
        const redirectRace = Promise.race([
          fb_auth.getRedirectResult().then(result => {
            if (result && result.user) {
              console.log('[B&R] Redirect Auth / Link OK:', result.user.uid);
              if (typeof handleGoogleSignInSuccess === 'function') {
                handleGoogleSignInSuccess(result.user);
              }
              if (typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
            }
          }).catch(err => {
            if (err.code === 'auth/credential-already-in-use' && err.credential) {
              console.warn('[B&R] Google account already linked to another profile, signing into Google profile...');
              fb_auth.signInWithCredential(err.credential).then(res => {
                console.log('[B&R] Signed into existing Google account:', res.user.uid);
                if (typeof handleGoogleSignInSuccess === 'function') {
                  handleGoogleSignInSuccess(res.user);
                }
                if (typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
              });
            } else {
              console.warn('[B&R] Redirect Auth error:', err.code, err.message);
            }
          }),
          redirectTimeout,
        ]);
        redirectRace.catch(err => {
          if (err && err.message === 'redirect_timeout') {
            console.warn('[B&R] Redirect Auth timed out after', redirectTimeoutMs, 'ms, continuing anonymously');
          }
        }).finally(() => {
          if (redirectTimerId) { clearTimeout(redirectTimerId); redirectTimerId = null; }
          if (fb_auth.currentUser) return;
          fb_auth.signInAnonymously().catch(err => {
            console.warn('[B&R] Firebase Auth failed:', err.message);
            if(!fb_userId){
              fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
            }
          });
        });
      }

      fb_auth.onAuthStateChanged(user => {
        if(user) {
          fb_userId = user.uid;
          localStorage.setItem('blocksrocks_userId', fb_userId);
          firebaseReady = true;
          console.log('[B&R] Firebase Auth OK:', fb_userId);
          if(typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
          setTimeout(async () => {
            if(typeof initUserIdentity === 'function') await initUserIdentity();
            if(typeof syncOfflineScores === 'function') await syncOfflineScores();
            if(typeof updateBottomRecords === 'function') updateBottomRecords(true);
            if(typeof migrateLegacyScore === 'function') migrateLegacyScore();
          }, 350);
        }
      });

      window.addEventListener('online', async () => {
        console.log('[B&R] Network connection online, syncing data...');
        if(countryCode === 'XX') detectCountry();
        if(typeof syncOfflineScores === 'function') await syncOfflineScores();
        if(typeof updateBottomRecords === 'function') updateBottomRecords(true);
      });

    } else {
      console.warn('[B&R] Firebase SDK not present, starting in offline local mode.');
      fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
      if(!username && typeof showUsernameModal === 'function'){
        showUsernameModal(null, true);
      }
    }
  } catch(e) {
    console.warn('[B&R] Firebase init failed:', e.message);
    if(!fb_userId){
      fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
    }
    if(!username && typeof showUsernameModal === 'function'){
      showUsernameModal(null, true);
    }
  }

  /* ═══════════════════════════════════════════════
   *  IP GEOLOCATION & DEVICE LOCATION FALLBACK
   * ═══════════════════════════════════════════════ */
  let countryCode = localStorage.getItem('blocksrocks_countryCode') || 'XX';

  function guessCountryFromDevice() {
    try {
      const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
      for (const l of langs) {
        if (l && l.includes('-')) {
          const parts = l.split('-');
          const region = parts[parts.length - 1].toUpperCase();
          if (region.length === 2 && region !== 'XX') return region;
        }
      }
      const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
      const tzMap = {
        'Europe/Belgrade': 'RS',
        'Europe/Zagreb': 'HR',
        'Europe/Sarajevo': 'BA',
        'Europe/Podgorica': 'ME',
        'Europe/Ljubljana': 'SI',
        'Europe/Skopje': 'MK',
        'Europe/Vienna': 'AT',
        'Europe/Berlin': 'DE',
        'Europe/Paris': 'FR',
        'Europe/Rome': 'IT',
        'Europe/Madrid': 'ES',
        'Europe/London': 'GB',
        'Europe/Moscow': 'RU',
        'Europe/Kiev': 'UA',
        'Europe/Kyiv': 'UA',
        'Europe/Athens': 'GR',
        'Europe/Budapest': 'HU',
        'Europe/Bucharest': 'RO',
        'Europe/Sofia': 'BG',
        'Europe/Zurich': 'CH',
        'Europe/Prague': 'CZ',
        'Europe/Warsaw': 'PL',
        'Europe/Bratislava': 'SK',
        'America/New_York': 'US',
        'America/Chicago': 'US',
        'America/Los_Angeles': 'US',
        'America/Toronto': 'CA',
        'Australia/Sydney': 'AU'
      };
      if (tz && tzMap[tz]) return tzMap[tz];
    } catch (e) {
      console.warn('[B&R] Device country fallback notice:', e);
    }
    return 'XX';
  }

  async function detectCountry(){
    const cached = localStorage.getItem('blocksrocks_countryCode');
    const cacheTime = parseInt(localStorage.getItem('blocksrocks_countryTime') || '0');
    // If cached within 24h and not XX
    if(cached && cached !== 'XX' && cached.length === 2 && (Date.now() - cacheTime) < 86400000){
      countryCode = cached;
      if(typeof updateBottomRecords === 'function') updateBottomRecords(false);
      return;
    }

    let detected = null;
    const apis = [
      { url: 'https://api.country.is/', parse: data => data.country || data.countryCode },
      { url: 'https://ipwho.is/', parse: data => data.country_code },
      { url: 'https://ipapi.co/json/', parse: data => data.country_code }
    ];

    for (const api of apis) {
      try {
        // Timeout od 4s po servisu — spor network ne sme blokirati detekciju doveka
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 4000) : null;
        let res;
        try {
          res = await fetch(api.url, { headers: { 'Accept': 'application/json' }, signal: controller ? controller.signal : undefined });
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
        if (res.ok) {
          const data = await res.json();
          const code = api.parse(data);
          if (code && typeof code === 'string' && code.length === 2 && code !== 'XX') {
            detected = code.toUpperCase();
            break;
          }
        }
      } catch(err) {
        // try next fallback
      }
    }

    if (!detected || detected === 'XX') {
      const devGuess = guessCountryFromDevice();
      if (devGuess && devGuess !== 'XX') {
        detected = devGuess;
      }
    }

    if (detected && detected !== 'XX') {
      countryCode = detected;
      localStorage.setItem('blocksrocks_countryCode', countryCode);
      localStorage.setItem('blocksrocks_countryTime', Date.now().toString());
      console.log('[B&R] Country detected:', countryCode);
      if(typeof updateBottomRecords === 'function') updateBottomRecords(true);
    } else {
      console.warn('[B&R] Geolocation could not detect country, using default fallback');
      if(typeof updateBottomRecords === 'function') updateBottomRecords(false);
    }
  }
  // NAPOMENA: detectCountry() se poziva na kraju fajla — ovde TRANSLATIONS i currentLang
  // još nisu inicijalizovani (TDZ), pa bi keš-grana izazvala ReferenceError.

  /* ═══════════════════════════════════════════════
   *  COUNTRY CODE → EMOJI FLAG & FULL NAME
   * ═══════════════════════════════════════════════ */
  function countryFlag(code){
    if(!code || code === 'XX' || code.length !== 2) return '🌐';
    const c = code.toUpperCase();
    return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  }

  function getFullCountryName(code, lang){
    if(!code || code === 'XX' || code.length !== 2){
      const t = TRANSLATIONS[lang || currentLang] || TRANSLATIONS.sr;
      return t.tabCountry || 'Država';
    }
    try {
      const langKey = lang || currentLang || 'sr';
      const localeMap = {
        sr: 'sr-Latn',
        en: 'en',
        de: 'de',
        es: 'es',
        fr: 'fr',
        ru: 'ru'
      };
      const locale = localeMap[langKey] || 'sr-Latn';
      if(typeof Intl !== 'undefined' && Intl.DisplayNames){
        const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
        const name = regionNames.of(code.toUpperCase());
        if(name) return name;
      }
    } catch(e){
      console.warn('[B&R] Country localization fallback:', e);
    }
    return code.toUpperCase();
  }

  /* ═══════════════════════════════════════════════
   *  USER PROFILE & IDENTITY STATE
   * ═══════════════════════════════════════════════ */
  // username / personalBest deklarisani na vrhu fajla (init catch ih referencira)
  let isOnboarding = false;
  let isUsernameAvailable = false;
  let isCheckingAvailability = false;
  let checkAvailabilityTimeout = null;
  let usernameCallback = null;

  const usernameModal = document.getElementById('username-modal');
  const usernameInput = document.getElementById('usernameInput');
  const usernameCount = document.getElementById('usernameCount');
  const usernameSaveBtn = document.getElementById('usernameSaveBtn');
  const usernameCloseBtn = document.getElementById('usernameCloseBtn');
  const usernameAvailability = document.getElementById('usernameAvailability');
  const usernameWelcomeDesc = document.getElementById('usernameWelcomeDesc');

  function saveUsername(name){
    username = name;
    localStorage.setItem('blocksrocks_username', name);
    track('username_set', { name: name });
  }
  function savePersonalBest(val){
    personalBest = val;
    localStorage.setItem('blocksrocks_personalBest', val.toString());
  }

  /* ═══════════════════════════════════════════════
   *  MULTILINGUAL i18n TRANSLATIONS (sr, en, de, es, fr, ru)
   * ═══════════════════════════════════════════════ */
  // Prevodi: ES modul www/i18n.js (import na vrhu fajla)

  let currentLang = localStorage.getItem('blocksrocks_lang') || 'sr';

  function applyLanguage(langCode) {
    if (!TRANSLATIONS[langCode]) langCode = 'sr';
    currentLang = langCode;
    localStorage.setItem('blocksrocks_lang', langCode);
    document.documentElement.lang = langCode;

    const t = TRANSLATIONS[langCode] || TRANSLATIONS.sr;

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText('headerSub', t.sub);
    const subEl = document.querySelector('.sub');
    if (subEl) subEl.textContent = t.sub;

    setText('scoreLabel', t.scoreLabel);
    const scoreBoxLabel = document.querySelector('.scorebox:not(.best) .label');
    if (scoreBoxLabel) scoreBoxLabel.textContent = t.scoreLabel;

    setText('bestLabel', t.bestLabel);
    const bestBoxLabel = document.querySelector('.scorebox.best .label');
    if (bestBoxLabel) bestBoxLabel.textContent = t.bestLabel;

    const bRestart = document.getElementById('btnRestart');
    if (bRestart) { bRestart.title = t.btnRestart; bRestart.setAttribute('aria-label', t.btnRestart); }

    const bMute = document.getElementById('btnMute');
    if (bMute) { bMute.title = t.btnMute; bMute.setAttribute('aria-label', t.btnMute); }

    const bPause = document.getElementById('btnPause');
    if (bPause) { bPause.title = t.btnPause; bPause.setAttribute('aria-label', t.btnPause); }

    const bTrophy = document.getElementById('btnTrophy');
    if (bTrophy) { bTrophy.title = t.btnTrophy; bTrophy.setAttribute('aria-label', t.btnTrophy); }

    const bSettings = document.getElementById('btnSettings');
    if (bSettings) { bSettings.title = t.btnSettings; bSettings.setAttribute('aria-label', t.btnSettings); }

    const msgEl = document.getElementById('msg');
    if (msgEl && !msgEl.classList.contains('msg-highlight')) {
      msgEl.textContent = (t.tips && t.tips[0]) || t.msgDefault;
    }

    const goTitle = document.getElementById('gameOverHeading') || document.querySelector('#overlay h2');
    if (goTitle) goTitle.textContent = t.gameOverTitle;

    setText('newbestLabel', t.newBestLabel);
    setText('gameOverDesc', t.noSpaceMsg);
    const noSpace = document.querySelector('#overlay p');
    if (noSpace) noSpace.textContent = t.noSpaceMsg;

    setText('restartBtn', t.restartBtn);
    setText('showLbBtn', t.showLbBtn);

    const pauseH2 = document.getElementById('pauseHeading') || document.querySelector('#pause-overlay h2');
    if (pauseH2) pauseH2.textContent = t.pauseTitle;

    setText('pauseDesc', t.pauseDesc);
    const pauseP = document.querySelector('#pause-overlay p');
    if (pauseP) pauseP.textContent = t.pauseDesc;

    setText('resumeBtn', t.resumeBtn);
    const pmBtn = document.getElementById('pauseMuteBtn');
    if (pmBtn) pmBtn.textContent = (isMuted() ? '🔇 ' : '🔊 ') + t.pauseMutePrefix + (isMuted() ? t.soundOff : t.soundOn);
    const pauseMuteBtn = document.getElementById('pauseMuteBtn');
    if (pauseMuteBtn) {
      pauseMuteBtn.title = t.pauseMutePrefix + (isMuted() ? t.soundOff : t.soundOn);
      pauseMuteBtn.setAttribute('aria-label', pauseMuteBtn.title);
    }
    setText('pauseRestartBtn', t.pauseRestartBtn);

    // Ažuriranje power-up dugmadi (Hammer / Reroll)
    const bHammer = document.getElementById('btnHammer');
    if (bHammer) {
      const titleHammer = (t.puHammerText || 'ČEKIĆ') + ' — ' + (t.puHammerActive || '');
      bHammer.title = titleHammer;
      bHammer.setAttribute('aria-label', titleHammer);
    }
    const bReroll = document.getElementById('btnReroll');
    if (bReroll) {
      const titleReroll = (t.puRerollText || 'ZAMENI');
      bReroll.title = titleReroll;
      bReroll.setAttribute('aria-label', titleReroll);
    }

    const settingsH3 = document.getElementById('settingsHeading') || document.querySelector('#username-modal h3');
    if (settingsH3) settingsH3.textContent = isOnboarding ? (t.onboardingTitle || '👋 DOBRODOŠLI!') : t.settingsTitle;

    const uCloseBtn = document.getElementById('usernameCloseBtn');
    if (uCloseBtn) { uCloseBtn.title = t.closeModal || 'Zatvori'; uCloseBtn.setAttribute('aria-label', t.closeModal || 'Zatvori'); }

    const lbClose = document.getElementById('lbCloseBtn');
    if (lbClose) { lbClose.title = t.closeModal || 'Zatvori'; lbClose.setAttribute('aria-label', t.closeModal || 'Zatvori'); }

    const bCountryCard = document.getElementById('bottomCountryCard');
    if (bCountryCard) bCountryCard.title = t.countryRecordTitle || 'Državni rekord';

    const bGlobalCard = document.getElementById('bottomGlobalCard');
    if (bGlobalCard) bGlobalCard.title = t.worldRecordTitle || 'Svetski rekord';

    const welcomeDesc = document.getElementById('usernameWelcomeDesc');
    if (welcomeDesc) welcomeDesc.textContent = t.onboardingDesc || 'Unesite jedinstveni nadimak za rang listu i profil.';

    setText('i18n_usernameLabel', t.usernameLabel);
    if (usernameInput) {
      usernameInput.placeholder = t.usernamePlaceholder || 'VašeIme';
      usernameInput.setAttribute('aria-label', t.usernameLabel);
    }
    setText('usernameSaveBtn', isOnboarding ? (t.onboardingBtn || 'ZAPOČNI IGRU') : t.usernameSaveBtn);
    setText('btnLinkGoogleText', t.btnLinkGoogle);
    setText('i18n_langLabel', t.langLabel);
    setText('i18n_dragOffsetLabel', t.dragOffsetLabel);
    setText('i18n_hapticLabel', t.hapticLabel);
    setText('i18n_particleTitle', t.particleTitle);
    setText('i18n_particleDesc', t.particleDesc);
    setText('puHammerText', t.puHammerText || 'ČEKIĆ');
    setText('puRerollText', t.puRerollText || 'ZAMENI');
    setText('btnShareScore', t.btnShareScore || '📤 PODELI REZULTAT');
    setText('i18n_historyLabel', t.historyLabel || '📜 POSLEDNJE PARTIJE');
    setText('i18n_statsLabel', t.statsLabel || '📊 STATISTIKA KARIJERE');
    setText('i18n_badgesLabel', t.badgesLabel || '🏅 DOSTIGNUĆA & BEDŽEVI');
    setText('i18n_statGames', t.statGames || 'Partija');
    setText('i18n_statLines', t.statLines || 'Linija');
    setText('i18n_statCombo', t.statCombo || 'Maks Kombo');
    setText('i18n_statBombs', t.statBombs || 'Bombi');
    setText('i18n_statRocks', t.statRocks || 'Kamenja');
    setText('i18n_statAvg', t.statAvg || 'Prosek');
    setText('i18n_highContrastTitle', t.highContrastTitle || '👁️ VISOKI KONTRAST');
    setText('i18n_highContrastDesc', t.highContrastDesc || 'Izražene ivice i konture blokova');

    updateDragOffsetSetting(userDragOffsetMultiplier);
    updateHapticSetting(getHapticMode());
    updateHighContrastSetting(highContrastMode);

    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
      langSelect.value = langCode;
    }

    const lbH3 = document.getElementById('leaderboardHeading') || document.querySelector('#lb-overlay h3');
    if (lbH3) lbH3.textContent = t.lbTitle;

    const lbPBLabel = document.querySelector('.pb-label');
    if (lbPBLabel) lbPBLabel.textContent = t.lbPersonalBestLabel;

    setText('tabCountry', t.tabCountry);
    setText('tabGlobal', t.tabGlobal);
    setText('lbLoadMoreBtn', t.lbLoadMoreBtn);

    if (typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
    // Ove tri funkcije čitaju `let` stanje deklarisano KASNIJE u fajlu —
    // pozvane pri startu (pre kraja IIFE) bacaju TDZ ReferenceError i ubiju init.
    // Odloženo izvršavanje garantuje da je ceo fajl već evaluiran.
    setTimeout(() => {
      if (typeof updateBottomRecords === 'function') updateBottomRecords(false);
      if (typeof renderMatchHistory === 'function') renderMatchHistory();
      if (typeof renderCareerStats === 'function') renderCareerStats();
    }, 0);
  }

  /* ═══════════════════════════════════════════════
   *  SETTINGS MANAGEMENT (Drag Offset, Haptics, High Contrast, Particles)
   * ═══════════════════════════════════════════════ */
  let userDragOffsetMultiplier = parseFloat(localStorage.getItem('blocksrocks_dragOffset') || '2.0');
  let highContrastMode = localStorage.getItem('blocksrocks_highContrast') === '1';
  let particleTrailEnabled = localStorage.getItem('blocksrocks_particles') !== '0';

  function updateDragOffsetSetting(val) {
    userDragOffsetMultiplier = parseFloat(val);
    localStorage.setItem('blocksrocks_dragOffset', val);
    const badge = document.getElementById('dragOffsetVal');
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const badgeSuffix = t.blocksBadge || 'Kockice';
    if (badge) badge.textContent = val + 'x ' + badgeSuffix;
    const range = document.getElementById('dragOffsetRange');
    if (range) range.value = val;
  }

  function updateHapticSetting(val) {
    setHapticMode(val); // stanje + localStorage: js/audio.js
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const container = document.getElementById('hapticGroup');
    if (container) {
      container.querySelectorAll('.haptic-btn, .haptic-opt').forEach(btn => {
        const mode = btn.getAttribute('data-haptic') || btn.getAttribute('data-val');
        btn.classList.toggle('active', mode === val);
        if (mode === 'strong') btn.textContent = t.hapticStrong;
        else if (mode === 'medium') btn.textContent = t.hapticMedium;
        else if (mode === 'light') btn.textContent = t.hapticLight;
        else if (mode === 'off') btn.textContent = t.hapticOff;
      });
    }
  }

  function updateHighContrastSetting(enabled) {
    highContrastMode = !!enabled;
    localStorage.setItem('blocksrocks_highContrast', highContrastMode ? '1' : '0');
    document.body.classList.toggle('high-contrast', highContrastMode);
    const toggle = document.getElementById('highContrastToggle');
    if (toggle) toggle.checked = highContrastMode;
  }

  function updateParticleSetting(enabled) {
    particleTrailEnabled = !!enabled;
    localStorage.setItem('blocksrocks_particles', particleTrailEnabled ? '1' : '0');
    const toggle = document.getElementById('particleTrailToggle');
    if (toggle) toggle.checked = particleTrailEnabled;
  }

  function initSettingsUI() {
    applyLanguage(currentLang);
    updateDragOffsetSetting(userDragOffsetMultiplier);
    updateHapticSetting(getHapticMode());
    updateHighContrastSetting(highContrastMode);
    updateParticleSetting(particleTrailEnabled);
    renderCareerStats();
  }

  // Initialize Language and High Contrast on load right away
  applyLanguage(currentLang);
  updateHighContrastSetting(highContrastMode);

  // Language selector dropdown change
  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      applyLanguage(e.target.value);
      haptic('light');
    });
  }

  // Drag offset slider
  const dragSlider = document.getElementById('dragOffsetRange');
  if (dragSlider) {
    dragSlider.addEventListener('input', (e) => {
      updateDragOffsetSetting(e.target.value);
    });
    dragSlider.addEventListener('change', () => haptic('light'));
  }

  // Haptic buttons
  const hapticContainer = document.getElementById('hapticGroup');
  if (hapticContainer) {
    hapticContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.haptic-btn, .haptic-opt');
      if (btn) {
        const h = btn.getAttribute('data-haptic') || btn.getAttribute('data-val');
        updateHapticSetting(h);
        haptic('medium');
      }
    });
  }

  // High contrast toggle
  const hcToggle = document.getElementById('highContrastToggle');
  if (hcToggle) {
    hcToggle.addEventListener('change', (e) => {
      updateHighContrastSetting(e.target.checked);
      haptic('light');
    });
  }

  // Particle trail toggle switch
  const pToggle = document.getElementById('particleTrailToggle');
  if (pToggle) {
    pToggle.addEventListener('change', (e) => {
      updateParticleSetting(e.target.checked);
      haptic('light');
    });
  }

  /* ═══════════════════════════════════════════════
   *  GOOGLE ACCOUNT LINKING & CLOUD SYNC
   * ═══════════════════════════════════════════════ */
  function updateGoogleLinkStatus() {
    const btnLinkGoogle = document.getElementById('btnLinkGoogle');
    const googleStatus = document.getElementById('googleStatus');
    if (!btnLinkGoogle || !googleStatus) return;
    const isLinked = localStorage.getItem('blocksrocks_googleLinked') === '1' || (fb_auth && fb_auth.currentUser && !fb_auth.currentUser.isAnonymous && fb_auth.currentUser.providerData.some(p => p.providerId === 'google.com'));
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    if (isLinked) {
      btnLinkGoogle.style.display = 'none';
      const email = localStorage.getItem('blocksrocks_googleEmail') || '';
      googleStatus.textContent = (t.googleLinked || '✅ Povezano') + (email ? ': ' + email : '');
      if (email) googleStatus.title = email;
      googleStatus.style.color = 'var(--accent)';
    } else {
      btnLinkGoogle.style.display = 'flex';
      googleStatus.textContent = t.googleUnlinked || 'Sačuvajte rezultat trajno';
      googleStatus.style.color = 'var(--dim)';
    }
  }

  async function performGoogleSignIn() {
    const googleStatus = document.getElementById('googleStatus');
    const btnLinkGoogle = document.getElementById('btnLinkGoogle');
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    if (btnLinkGoogle) {
      btnLinkGoogle.disabled = true;
      btnLinkGoogle.style.opacity = '0.6';
    }
    if (googleStatus) {
      googleStatus.textContent = t.googleConnecting || 'Povezivanje...';
      googleStatus.style.color = 'var(--dim)';
    }

    try {
      const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      const GoogleAuth = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;

      // 1. Native Google Sign-In on Android
      if (isNative && GoogleAuth) {
        console.log('[B&R] Launching Native Android Google Sign-In...');
        try {
          await GoogleAuth.initialize({
            clientId: '556570853814-42pn5174etkj86srceviqai3l701aofr.apps.googleusercontent.com',
            scopes: ['profile', 'email'],
            grantOfflineAccess: true
          }).catch(() => {});

          const googleUser = await GoogleAuth.signIn();
          const idToken = (googleUser.authentication && googleUser.authentication.idToken) || googleUser.idToken;

          if (idToken && fb_auth) {
            const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
            let authResult;
            if (fb_auth.currentUser && fb_auth.currentUser.isAnonymous) {
              try {
                authResult = await fb_auth.currentUser.linkWithCredential(credential);
              } catch (linkErr) {
                if (linkErr.code === 'auth/credential-already-in-use' || linkErr.code === 'auth/email-already-in-use') {
                  authResult = await fb_auth.signInWithCredential(credential);
                } else {
                  throw linkErr;
                }
              }
            } else {
              authResult = await fb_auth.signInWithCredential(credential);
            }

            const activeUser = authResult.user || fb_auth.currentUser;
            await handleGoogleSignInSuccess(activeUser, googleUser);
            updateGoogleLinkStatus();
            return true;
          }
        } catch (nativeErr) {
          if (nativeErr === 'cancelled' || (nativeErr && (nativeErr.message || '').toLowerCase().includes('cancel') || (nativeErr.message || '').includes('12501'))) {
            console.log('[B&R] Google Sign-In cancelled by user');
            if (googleStatus) updateGoogleLinkStatus();
            return false;
          }
          console.warn('[B&R] Native Google Auth error:', nativeErr);
          throw nativeErr;
        }
      }

      // 2. Web browser (Popup auth)
      if (fb_auth) {
        const provider = new firebase.auth.GoogleAuthProvider();
        let activeUser = null;
        if (fb_auth.currentUser) {
          try {
            const result = await fb_auth.currentUser.linkWithPopup(provider);
            if (result && result.user) activeUser = result.user;
          } catch (popupErr) {
            if (popupErr.code === 'auth/credential-already-in-use' && popupErr.credential) {
              const res = await fb_auth.signInWithCredential(popupErr.credential);
              if (res && res.user) activeUser = res.user;
            } else if (popupErr.code === 'auth/popup-closed-by-user') {
              console.log('[B&R] Google popup closed by user');
              if (googleStatus) updateGoogleLinkStatus();
              return false;
            } else {
              throw popupErr;
            }
          }
        } else {
          const res = await fb_auth.signInWithPopup(provider);
          if (res && res.user) activeUser = res.user;
        }
        if (activeUser) {
          await handleGoogleSignInSuccess(activeUser);
          updateGoogleLinkStatus();
          return true;
        }
      }
    } catch (err) {
      console.error('[B&R] Google Sign-In error:', err);
      if (googleStatus) {
        if (err.code === 'auth/credential-already-in-use') {
          googleStatus.textContent = t.googleAlreadyLinked || '⚠️ Google nalog je već povezan';
        } else {
          googleStatus.textContent = (t.googleError || '❌ Greška pri povezivanju');
        }
        googleStatus.style.color = 'var(--danger)';
      }
    } finally {
      if (btnLinkGoogle) {
        btnLinkGoogle.disabled = false;
        btnLinkGoogle.style.opacity = '1';
      }
    }
    return false;
  }

  const btnLinkGoogleBtn = document.getElementById('btnLinkGoogle');
  if (btnLinkGoogleBtn) {
    btnLinkGoogleBtn.addEventListener('click', performGoogleSignIn);
  }

  async function handleGoogleSignInSuccess(activeUser, nativeGoogleUser) {
    if (!activeUser) return;
    const gUid = activeUser.uid;
    fb_userId = gUid;
    firebaseReady = true;
    localStorage.setItem('blocksrocks_userId', fb_userId);
    localStorage.setItem('blocksrocks_googleLinked', '1');
    const email = activeUser.email || (nativeGoogleUser && nativeGoogleUser.email) || '';
    if (email) localStorage.setItem('blocksrocks_googleEmail', email);

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;

    // Check if this Google account already has a registered profile in Firestore
    if (fb_db) {
      try {
        const userDoc = await fb_db.collection('users').doc(gUid).get();
        if (userDoc.exists && userDoc.data()) {
          const udata = userDoc.data();
          if (udata.username) {
            const cloudName = udata.username;
            saveUsername(cloudName);
            username = cloudName;
            if (usernameInput) usernameInput.value = cloudName;

            const cloudBest = Number(udata.personalBest || udata.score || 0);
            if (cloudBest > personalBest) {
              savePersonalBest(cloudBest);
              best = personalBest;
              if (bestEl) bestEl.textContent = best;
            }

            if (isOnboarding) {
              isOnboarding = false;
              usernameModal.classList.remove('is-onboarding');
              usernameModal.style.display = 'none';
              setPaused(false);
            }

            showMsg((t.googleWelcomeBack || '✅ Dobrodošao nazad, ') + cloudName + '!', 3500);
            haptic('success');
            console.log('[B&R] Cloud profile restored for Google user:', cloudName, 'Best:', personalBest);
            if (typeof fetchMyTop3 === 'function') fetchMyTop3();
            if (typeof updateBottomRecords === 'function') updateBottomRecords(false);
            return;
          }
        }

        // New profile for this Google Account
        let finalUsername = username;
        if (!finalUsername || finalUsername.length < 3) {
          const rawDisp = (nativeGoogleUser && (nativeGoogleUser.displayName || nativeGoogleUser.name)) || activeUser.displayName || 'Igrač';
          finalUsername = rawDisp.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u0400-\u04FF]/g, '').substring(0, 12);
          if (finalUsername.length < 3) finalUsername = 'Igrač_' + Math.floor(1000 + Math.random() * 9000);
        }

        await registerAndSaveUsername(finalUsername);
        showMsg(t.googleLinkedSuccess || '✅ Google nalog uspešno povezan!', 3500);
        haptic('success');
        if (typeof fetchMyTop3 === 'function') fetchMyTop3();
        if (typeof updateBottomRecords === 'function') updateBottomRecords(false);
      } catch (e) {
        console.warn('[B&R] Error handling Google sign-in sync:', e);
      }
    }
  }

  /* ═══════════════════════════════════════════════
   *  UNIQUE USERNAME CHECK & REGISTRATION
   * ═══════════════════════════════════════════════ */
  function validateUsernameFormat(name) {
    // Jedina izvorna implementacija je GameCore.validateUsernameFormat (pokrivena testovima)
    return GameCore.validateUsernameFormat(name);
  }

  async function checkAvailability(rawName) {
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const availEl = document.getElementById('usernameAvailability');
    const clean = (rawName || '').trim();
    const format = validateUsernameFormat(clean);

    if (!format.valid) {
      isUsernameAvailable = false;
      usernameSaveBtn.disabled = true;
      if (availEl) {
        availEl.className = 'uavail invalid';
        if (format.reason === 'chars') {
          availEl.textContent = t.statusInvalidChars || '⚠️ Dozvoljena su slova, brojevi i _';
        } else {
          availEl.textContent = clean.length > 0 ? (t.statusTooShort || '⚠️ Min. 3 karaktera') : '';
        }
      }
      return;
    }

    // If matches user's current active name
    if (username && clean.toLowerCase() === username.toLowerCase()) {
      isUsernameAvailable = true;
      usernameSaveBtn.disabled = false;
      if (availEl) {
        availEl.className = 'uavail available';
        availEl.textContent = t.statusCurrent || '✅ Vaše trenutno ime';
      }
      return;
    }

    if (!fb_db || !firebaseReady) {
      // Offline fallback
      isUsernameAvailable = true;
      usernameSaveBtn.disabled = false;
      if (availEl) {
        availEl.className = 'uavail available';
        availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
      }
      return;
    }

    const lower = clean.toLowerCase();
    isCheckingAvailability = true;
    usernameSaveBtn.disabled = true;
    if (availEl) {
      availEl.className = 'uavail checking';
      availEl.textContent = t.statusChecking || '⏳ Proveravam...';
    }

    try {
      if (!fb_auth || !fb_auth.currentUser) {
        fb_auth && fb_auth.signInAnonymously && fb_auth.signInAnonymously().catch(()=>{});
      }

      const docRef = fb_db.collection('usernames').doc(lower);
      const docSnap = await docRef.get();

      // Ensure input hasn't changed while async call was pending
      if (usernameInput.value.trim().toLowerCase() !== lower) return;

      if (docSnap.exists) {
        const data = docSnap.data();
        if (data && data.uid === fb_userId) {
          isUsernameAvailable = true;
          usernameSaveBtn.disabled = false;
          if (availEl) {
            availEl.className = 'uavail available';
            availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
          }
        } else {
          isUsernameAvailable = false;
          usernameSaveBtn.disabled = true;
          if (availEl) {
            availEl.className = 'uavail taken';
            availEl.textContent = t.statusTaken || '❌ Nadimak je već zauzet';
          }
        }
      } else {
        isUsernameAvailable = true;
        usernameSaveBtn.disabled = false;
        if (availEl) {
          availEl.className = 'uavail available';
          availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
        }
      }
    } catch (err) {
      console.warn('[B&R] Availability check notice:', err);
      isUsernameAvailable = true;
      usernameSaveBtn.disabled = false;
      if (availEl) {
        availEl.className = 'uavail available';
        availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
      }
    } finally {
      isCheckingAvailability = false;
    }
  }

  async function registerAndSaveUsername(rawName) {
    const cleanName = (rawName || '').trim();
    const lowerName = cleanName.toLowerCase();
    const format = validateUsernameFormat(cleanName);
    if (!format.valid) return false;

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const availEl = document.getElementById('usernameAvailability');

    usernameSaveBtn.disabled = true;
    if (availEl) {
      availEl.className = 'uavail checking';
      availEl.textContent = t.statusSaving || 'Čuvam...';
    }

    try {
      if (fb_db && fb_auth) {
        if (!fb_auth.currentUser) {
          try {
            await fb_auth.signInAnonymously();
            if (fb_auth.currentUser) {
              fb_userId = fb_auth.currentUser.uid;
              localStorage.setItem('blocksrocks_userId', fb_userId);
            }
          } catch(authErr){
            console.warn('[B&R] Anonymous auth sign-in warning:', authErr);
          }
        }

        if (fb_userId) {
          const oldLower = username ? username.toLowerCase() : null;
          const newDocRef = fb_db.collection('usernames').doc(lowerName);

          // 1. Check if name is genuinely taken by another user
          try {
            const checkSnap = await newDocRef.get();
            if (checkSnap.exists) {
              const data = checkSnap.data() || {};
              if (data.uid && data.uid !== fb_userId) {
                usernameSaveBtn.disabled = false;
                if (availEl) {
                  availEl.className = 'uavail taken';
                  availEl.textContent = t.statusTaken || '❌ Nadimak je već zauzet';
                }
                return false;
              }
            }
          } catch(checkErr){
            console.warn('[B&R] Name existence check notice:', checkErr);
          }

          // 2. Set username in cloud registry
          await newDocRef.set({
            uid: fb_userId,
            originalName: cleanName,
            createdAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
          });

          // 3. Set user profile
          const userRef = fb_db.collection('users').doc(fb_userId);
          await userRef.set({
            username: cleanName,
            countryCode: countryCode || 'XX',
            updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
          }, { merge: true });

          // 4. Safely clean up old username if changed
          if (oldLower && oldLower !== lowerName) {
            try {
              const oldDocRef = fb_db.collection('usernames').doc(oldLower);
              const oldSnap = await oldDocRef.get();
              if (oldSnap.exists && oldSnap.data() && oldSnap.data().uid === fb_userId) {
                await oldDocRef.delete();
              }
            } catch(delErr){
              console.warn('[B&R] Old username cleanup notice:', delErr);
            }
          }
        }
      }

      const wasOnboarding = isOnboarding;
      saveUsername(cleanName);
      isOnboarding = false;
      usernameModal.classList.remove('is-onboarding');
      usernameModal.style.display = 'none';
      if (wasOnboarding) {
        setPaused(false);
      }

      if (usernameCallback) usernameCallback(cleanName);
      usernameCallback = null;
      console.log('[B&R] Nickname registered & saved:', cleanName);
      return true;
    } catch (err) {
      console.error('[B&R] Nickname registration fallback:', err);
      // Ako je server ODBIO upis, razlikuj dva slučaja:
      //  (a) ime je u međuvremenu zauzeto → prikaži "zauzeto", NE čuvaj lokalno
      //  (b) App Check / rules odbijanje (npr. nevažeći token) → privremena greška
      if (err && (err.code === 'permission-denied' || err.code === 'already-exists')) {
        let takenByOther = false;
        try {
          if (fb_db) {
            const verifySnap = await fb_db.collection('usernames').doc(lowerName).get();
            takenByOther = !!(verifySnap.exists && verifySnap.data() && verifySnap.data().uid && verifySnap.data().uid !== fb_userId);
          }
        } catch(verifyErr) { /* i čitanje odbijeno/offline → tretiraj kao privremenu grešku */ }
        if (takenByOther) {
          usernameSaveBtn.disabled = false;
          if (availEl) {
            availEl.className = 'uavail taken';
            availEl.textContent = t.statusTaken || '❌ Nadimak je već zauzet';
          }
          return false;
        }
        // Nije kolizija → pada na App Check/pravilima → nastavlja se u lokalni fallback ispod
      }
      // Fallback (samo mrežne/neočekivane greške): sačuvaj lokalno da korisnik ne bude blokiran
      const wasOnboarding = isOnboarding;
      saveUsername(cleanName);
      isOnboarding = false;
      usernameModal.classList.remove('is-onboarding');
      usernameModal.style.display = 'none';
      if (wasOnboarding) {
        setPaused(false);
      }

      if (usernameCallback) usernameCallback(cleanName);
      usernameCallback = null;
      return true;
    }
  }

  function showUsernameModal(callback, onboarding = false){
    isOnboarding = !!onboarding;
    if (isOnboarding) {
      setPaused(true, true); // silent — bez pause overlay-a ispod modala
    }
    usernameInput.value = username || '';
    const len = (username || '').length;
    usernameCount.textContent = len + ' / 12';
    usernameInput.classList.remove('invalid');
    usernameCallback = callback || null;

    usernameModal.classList.toggle('is-onboarding', isOnboarding);

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const settingsHeading = document.getElementById('settingsHeading');
    const welcomeDesc = document.getElementById('usernameWelcomeDesc');
    const availEl = document.getElementById('usernameAvailability');
    if (availEl) { availEl.textContent = ''; availEl.className = 'uavail'; }

    if (isOnboarding) {
      if (settingsHeading) settingsHeading.textContent = t.onboardingTitle || '👋 DOBRODOŠLI!';
      if (welcomeDesc) {
        welcomeDesc.textContent = t.onboardingDesc || 'Unesite jedinstveni nadimak za rang listu i profil.';
        welcomeDesc.style.display = 'block';
      }
      usernameSaveBtn.textContent = t.onboardingBtn || 'ZAPOČNI IGRU';
    } else {
      if (settingsHeading) settingsHeading.textContent = t.settingsTitle || '⚙️ PODEŠAVANJA & PROFIL';
      if (welcomeDesc) welcomeDesc.style.display = 'none';
      usernameSaveBtn.textContent = t.usernameSaveBtn || 'SAČUVAJ';
    }

    initSettingsUI();
    usernameModal.style.display = 'flex';

    if (username && username.length >= 3) {
      checkAvailability(username);
    } else {
      usernameSaveBtn.disabled = true;
      setTimeout(() => { try { usernameInput.focus(); } catch(e){} }, 150);
    }
  }

  async function initUserIdentity() {
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const GoogleAuth = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;

    // 1. Silent Google Account check in the background
    if (isNative && GoogleAuth) {
      try {
        await GoogleAuth.initialize({
          clientId: '556570853814-42pn5174etkj86srceviqai3l701aofr.apps.googleusercontent.com',
          scopes: ['profile', 'email'],
          grantOfflineAccess: true
        }).catch(() => {});

        const silent = await GoogleAuth.refresh().catch(() => null);
        if (silent && (silent.idToken || (silent.authentication && silent.authentication.idToken)) && fb_auth) {
          const idToken = (silent.authentication && silent.authentication.idToken) || silent.idToken;
          const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
          const res = await fb_auth.signInWithCredential(credential);
          if (res && res.user) {
            console.log('[B&R] Silent Google Account restored:', res.user.uid);
            await handleGoogleSignInSuccess(res.user, silent);
            if (username) return;
          }
        }
      } catch (silentErr) {
        console.warn('[B&R] Silent Google login note:', silentErr);
      }
    }

    // 2. Existing local username check & sync
    if (username && username.trim().length >= 3) {
      if (fb_db && firebaseReady && fb_userId) {
        try {
          const userRef = fb_db.collection('users').doc(fb_userId);
          const snap = await userRef.get();
          if (!snap.exists) {
            registerAndSaveUsername(username).catch(e => console.warn('[B&R] Auto-sync local username failed:', e));
          } else {
            const data = snap.data() || {};
            if (data.username && data.username !== username) {
              username = data.username;
              localStorage.setItem('blocksrocks_username', username);
            }
            if (data.personalBest && Number(data.personalBest) > personalBest) {
              savePersonalBest(Number(data.personalBest));
              best = personalBest;
              if (bestEl) bestEl.textContent = best;
            }
          }
        } catch (e) {
          console.warn('[B&R] User profile check notice:', e);
        }
      }
      if (typeof fetchMyTop3 === 'function') fetchMyTop3();
      return;
    }

    // 3. Check Firestore users/{uid} for previous anonymous session
    if (fb_db && firebaseReady && fb_userId) {
      try {
        const userRef = fb_db.collection('users').doc(fb_userId);
        const snap = await userRef.get();
        if (snap.exists) {
          const data = snap.data() || {};
          if (data.username) {
            username = data.username;
            localStorage.setItem('blocksrocks_username', username);
            console.log('[B&R] Restored username from cloud profile:', username);
          }
          if (data.personalBest && Number(data.personalBest) > personalBest) {
            savePersonalBest(Number(data.personalBest));
            best = personalBest;
            if (bestEl) bestEl.textContent = best;
          }
          if (typeof fetchMyTop3 === 'function') fetchMyTop3();
          if (username) return;
        }
      } catch (e) {
        console.warn('[B&R] Cloud profile check failed:', e);
      }
    }

    // 4. Zero Friction: If still no nickname, generate a default guest name so user plays INSTANTLY!
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const prefix = t.guestPrefix || 'Igrač';
    const guestNum = Math.floor(1000 + Math.random() * 9000);
    const guestName = `${prefix}_${guestNum}`;
    username = guestName;
    localStorage.setItem('blocksrocks_username', guestName);
    if (usernameInput) usernameInput.value = guestName;
    console.log('[B&R] Assigned seamless guest nickname:', guestName);

    // Register guest nickname in background without blocking
    if (fb_db && firebaseReady) {
      registerAndSaveUsername(guestName).catch(e => console.warn('[B&R] Guest auto-register notice:', e));
    }
  }

  // Username Input Listeners
  usernameInput.addEventListener('input', ()=>{
    const raw = usernameInput.value;
    const len = raw.trim().length;
    usernameCount.textContent = len + ' / 12';
    usernameInput.classList.toggle('invalid', len > 0 && (len < 3 || len > 12));
    usernameCount.classList.toggle('warn', len > 12);

    clearTimeout(checkAvailabilityTimeout);
    checkAvailabilityTimeout = setTimeout(() => {
      checkAvailability(raw);
    }, 280);
  });

  usernameSaveBtn.addEventListener('click', ()=>{
    registerAndSaveUsername(usernameInput.value);
  });

  // Enter key in username input
  usernameInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && !usernameSaveBtn.disabled){
      usernameSaveBtn.click();
    }
  });

  // Close button on username modal
  usernameCloseBtn.addEventListener('click', ()=>{
    if (isOnboarding) return;
    usernameModal.style.display = 'none';
    usernameCallback = null;
  });

  // Close on backdrop click
  usernameModal.addEventListener('click', (e)=>{
    if (isOnboarding) return;
    if (e.target === usernameModal){
      usernameModal.style.display = 'none';
      usernameCallback = null;
    }
  });

  // Settings button
  document.getElementById('btnSettings').addEventListener('click', ()=>{
    showUsernameModal(null, false);
    if(typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
  });



  /* ═══════════════════════════════════════════════
   *  OFFLINE SCORE QUEUE & FIRESTORE SCORE SUBMIT
   * ═══════════════════════════════════════════════ */
  function queueOfflineScore(scoreVal, userVal, countryVal){
    try {
      const queue = JSON.parse(localStorage.getItem('blocksrocks_pendingScores') || '[]');
      queue.push({
        score: scoreVal,
        username: userVal,
        countryCode: countryVal,
        createdAt: Date.now()
      });
      localStorage.setItem('blocksrocks_pendingScores', JSON.stringify(queue));
    } catch(e){}
  }

  async function syncOfflineScores(){
    if(!firebaseReady || !fb_userId || !fb_db || !username || username.trim().length < 3) return;
    try {
      const raw = localStorage.getItem('blocksrocks_pendingScores');
      if(!raw) return;
      const queue = JSON.parse(raw);
      if(!Array.isArray(queue) || !queue.length) return;

      console.log('[B&R] Syncing ' + queue.length + ' offline score(s)...');

      // PRVO profil — security rules vezuju leaderboard za users/{uid}.username,
      // pa upisi bez profila (ili sa zastarelim imenom) bivaju odbijeni.
      const profileCc = (countryCode && countryCode !== 'XX') ? countryCode : guessCountryFromDevice();
      await fb_db.collection('users').doc(fb_userId).set({
        username: username.trim(),
        countryCode: profileCc && profileCc.length === 2 ? profileCc : 'XX',
        personalBest: personalBest,
        updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
      }, { merge: true });

      for(const item of queue){
        if(!item || !item.score || isNaN(item.score)) continue;
        const cc = (item.countryCode && item.countryCode !== 'XX') ? item.countryCode : ((countryCode && countryCode !== 'XX') ? countryCode : guessCountryFromDevice());
        const validCc = (cc && cc.length === 2 && cc !== 'XX') ? cc : 'XX';

        await fb_db.collection('leaderboard').add({
          userId: fb_userId,
          username: username.trim(),
          score: parseInt(item.score, 10),
          countryCode: validCc,
          createdAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
        });
      }
      localStorage.removeItem('blocksrocks_pendingScores');

      await capUserEntries();
      if(typeof updateBottomRecords === 'function') await updateBottomRecords(true);
      console.log('[B&R] Offline scores sync completed successfully.');
    } catch(e){
      console.warn('[B&R] Offline scores sync notice:', e.message);
    }
  }

  async function submitScore(finalScore){
    const s = parseInt(finalScore, 10);
    if(isNaN(s) || s <= 0) return;

    // 1. Update personalBest locally immediately
    if(s > personalBest){
      savePersonalBest(s);
      best = s;
      if(bestEl) bestEl.textContent = best;
    }

    const cc = (countryCode && countryCode !== 'XX') ? countryCode : guessCountryFromDevice();
    const validCc = (cc && cc.length === 2 && cc !== 'XX') ? cc : 'XX';

    // 2. Add to local score history (offline resilience)
    try {
      let localHistory = JSON.parse(localStorage.getItem('blocksrocks_myScores') || '[]');
      localHistory.push({
        score: s,
        username: username || 'Igrač',
        countryCode: validCc,
        createdAt: Date.now()
      });
      localHistory = GameCore.sortScoresByTop(localHistory, MAX_ENTRIES_PER_USER);
      localStorage.setItem('blocksrocks_myScores', JSON.stringify(localHistory));
    } catch(e){}

    if(!username || username.trim().length < 3) return;

    if(!firebaseReady || !fb_userId){
      queueOfflineScore(s, username, validCc);
      return;
    }

    try {
      // 3. Update user profile in Firestore with personalBest & country
      //    AWAIT je obavezan — security rules vezuju leaderboard za users/{uid}.username,
      //    pa leaderboard upis pre osveženog profila biva odbijen (permission-denied).
      if(fb_db){
        await fb_db.collection('users').doc(fb_userId).set({
          username: username.trim(),
          countryCode: validCc,
          personalBest: personalBest,
          updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
        }, { merge: true });
      }

      // 4. Add to leaderboard collection
      const added = await fb_db.collection('leaderboard').add({
        userId: fb_userId,
        username: username.trim(),
        score: s,
        countryCode: validCc,
        createdAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
      });
      console.log('[B&R] Leaderboard entry added:', s, validCc, added.id);
      track('leaderboard_submit', { score: s });

      // 5. Also sync any pending offline scores if any exist
      await syncOfflineScores();

      // 6. Cap user entries to top 3
      await capUserEntries();

      // 7. Update bottom widget and leaderboard cache immediately
      if(typeof updateBottomRecords === 'function') await updateBottomRecords(true);
    } catch(err){
      console.warn('[B&R] Score submit network failed, queueing offline:', err.message);
      queueOfflineScore(s, username, validCc);
    }
  }

  // Keep only the top MAX_ENTRIES_PER_USER results per user (top-3 per user)
  async function capUserEntries(){
    if(!firebaseReady || !fb_userId || !fb_db) return;
    try {
      const snap = await fb_db.collection('leaderboard')
        .where('userId', '==', fb_userId)
        .get();
      if(snap.docs.length <= MAX_ENTRIES_PER_USER) return;

      const docs = snap.docs.slice().sort((a, b) => (Number(b.data().score) || 0) - (Number(a.data().score) || 0));
      const extras = docs.slice(MAX_ENTRIES_PER_USER);
      for(const doc of extras) await doc.ref.delete();
      if(extras.length) console.log('[B&R] Capped user entries:', extras.length);
    } catch(err){
      console.warn('[B&R] capUserEntries failed:', err.message);
    }
  }

  // Migrira stari jednodokumentni "scores/{uid}" u novi multi-score model.
  // Trči automatski pri logovanju — bez dodatnih kredencijala.
  async function migrateLegacyScore(){
    if(!firebaseReady || !fb_userId) return;
    try {
      const legacy = await fb_db.collection('scores').doc(fb_userId).get();
      if(!legacy.exists) return;
      const data = legacy.data();
      const legacyScore = Number(data && data.score) || 0;
      if(legacyScore <= 0) return;

      // Ako već imamo jednako ili bolje u novoj kolekciji, preskačemo
      const mine = await fb_db.collection('leaderboard')
        .where('userId', '==', fb_userId)
        .get();
      const myDocs = mine.docs.map(d => d.data());
      if(myDocs.some(d => (Number(d.score) || 0) >= legacyScore)) return;

      // Rules binding: leaderboard.username mora biti jednak users/{uid}.username,
      // pa migrirani rezultat upisujemo pod TRENUTNIM imenom korisnika (ne legacy).
      const uname = (username && username.trim().length >= 3) ? username.trim() : null;
      if (!uname) { console.warn('[B&R] Legacy migration skipped: no registered username yet.'); return; }
      const cc = (typeof data.countryCode === 'string' && data.countryCode.length === 2 && data.countryCode !== 'XX')
        ? data.countryCode : (countryCode && countryCode !== 'XX' ? countryCode : guessCountryFromDevice());

      // Osiguraj da profil postoji PRE upisa u leaderboard (rules proveravaju profil)
      await fb_db.collection('users').doc(fb_userId).set({
        username: uname,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const added = await fb_db.collection('leaderboard').add({
        userId: fb_userId,
        username: uname,
        score: legacyScore,
        countryCode: (cc && cc !== 'XX') ? cc : 'XX',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('[B&R] Legacy score migrated:', legacyScore, added.id);
    } catch(err){
      console.warn('[B&R] Legacy migration failed:', err.message);
    }
  }

  /* ═══════════════════════════════════════════════
   *  GAME CORE
   * ═══════════════════════════════════════════════ */
  const { SIZE, COLORS, SHAPES } = GameCore;

  // ── Centralised config (no more magic numbers) ──
  const CONFIG = {
    GHOST_CELL: 38,
    GHOST_RAISE: 120,
    LINE_CLEAR_STAGGER: 35,
    BOMB_STAGGER: 30,
    BOMB_TICK_MS: 800,
    PARTICLE_COUNT: 6,
    CRACK_PARTICLE_COUNT: 5,
    DEBRIS_COUNT: 10,
    SCORE_FLOAT_DURATION: 850,
    MSG_DURATION_TIP: 2500,
    MSG_DURATION_CLEAR: 2000,
    MSG_DURATION_COMBO: 2500,
    MSG_DURATION_BOMB: 2000,
    GAME_OVER_DELAY_AFTER_CLEAR: 900,
    GAME_OVER_DELAY_AFTER_BOMB: 300,
    POP_IN_DURATION: 220,
    CLEAR_ANIM_DURATION: 320,
    CRACK_ANIM_DURATION: 260,
    RESTART_DEBOUNCE_MS: 1200,
  };

  let grid, tray, score, best, dragging, gameOver, pieceCounter, bombCounter, nextBombAt;
  let comboStreak = 0;
  let hammersCount = 1;
  let rerollsCount = 1;
  let isHammerActive = false;
  let hasCelebratedNewBest = false;
  let hasCelebratedWorldRecord = false;
  let lastMilestoneHazardLevel = -1;
  let lastFibonacciMilestoneIndex = -1;
  let paused = false;
  let gameStartTime = 0;
  let previewCells = new Set();
  let previewRAF = null;
  let lineClearInProgress = false;
  let actionDebounce = {};
  let gameOverTimer = null;

  const boardEl = document.getElementById('board');
  const trayEl = document.getElementById('tray');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const msgEl = document.getElementById('msg');
  const ghostEl = document.getElementById('dragghost');
  const overlayEl = document.getElementById('overlay');

  const btnHammer = document.getElementById('btnHammer');
  const btnReroll = document.getElementById('btnReroll');
  const puHammerCount = document.getElementById('puHammerCount');
  const puRerollCount = document.getElementById('puRerollCount');
  const comboPill = document.getElementById('comboPill');
  const comboPillText = document.getElementById('comboPillText');

  best = personalBest;
  // Rekord na početku partije — potreban da bi se na ekranu kraja igre ispravno
  // prikazalo "NOVI REKORD" (best se tokom igre ažurira uživo, pa poređenje
  // finalScore > best biva lažno čak i kad je rekord postavljen u ovoj partiji).
  let bestAtGameStart = best;

  /* ═══ MODULE WIRING (ES moduli + dependency injection) ═══ */
  initAudio({ getT: () => TRANSLATIONS[currentLang] || TRANSLATIONS.sr });
  initEffects({ CONFIG, SIZE, boardEl, scoreEl,
                getGrid: () => grid,
                getParticleTrailEnabled: () => particleTrailEnabled });
  initLeaderboard({
    haptic, debounceAction, CONFIG,
    countryFlag, getFullCountryName, guessCountryFromDevice,
    getFirebase: () => ({ fb_db, firebaseReady, fb_userId }),
    getUsername: () => username,
    getCountryCode: () => countryCode,
    getCurrentLang: () => currentLang,
    getPersonalBest: () => personalBest,
    savePersonalBest,
    setBest: (v) => { best = v; if (bestEl) bestEl.textContent = best; },
    getGameOver: () => gameOver,
    overlayEl,
  });


  function updatePowerupUI(){
    if (puHammerCount) puHammerCount.textContent = hammersCount;
    if (puRerollCount) puRerollCount.textContent = rerollsCount;
    if (btnHammer) {
      btnHammer.disabled = (hammersCount <= 0 && !isHammerActive);
      btnHammer.classList.toggle('active', isHammerActive);
    }
    if (btnReroll) {
      btnReroll.disabled = (rerollsCount <= 0);
    }
    if (comboPill) {
      comboPill.style.display = (comboStreak > 1) ? 'flex' : 'none';
      if (comboPillText) comboPillText.textContent = (TRANSLATIONS[currentLang] || TRANSLATIONS.sr).msgCombo + comboStreak;
    }
  }

  // ── Power-up nagrade: poziva se posle SVAKE promene skora ──
  // (ranije: samo u clearLines → pragovi pređeni golim postavljanjem/bombom su se gubili)
  function grantPowerupRewards(prevScore, newScore, msgDelay){
    const rewards = GameCore.calculatePowerupRewards(prevScore, newScore);
    if(rewards.hammersEarned <= 0 && rewards.rerollsEarned <= 0) return;
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    if(rewards.hammersEarned > 0) hammersCount += rewards.hammersEarned;
    if(rewards.rerollsEarned > 0) rerollsCount += rewards.rerollsEarned;
    updatePowerupUI();
    const showHammer = ()=> showMsg(t.puRewardHammer || '🔨 Novi čekić osvojen! (+1)', 2200);
    const showReroll = ()=> showMsg(t.puRewardReroll || '🎲 Nova zamena osvojena! (+1)', 2200);
    const delay = msgDelay || 0;
    if(rewards.hammersEarned > 0 && rewards.rerollsEarned > 0){
      setTimeout(showHammer, delay);
      setTimeout(showReroll, delay + 2300);
    } else if(rewards.hammersEarned > 0){
      setTimeout(showHammer, delay);
    } else {
      setTimeout(showReroll, delay);
    }
  }

  function setHammerActive(active){
    isHammerActive = !!active;
    if (boardEl) boardEl.classList.toggle('hammer-mode', isHammerActive);
    updatePowerupUI();
  }

  if (btnHammer) {
    btnHammer.addEventListener('click', ()=>{
      if (gameOver || paused || lineClearInProgress) return;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      if (isHammerActive) {
        setHammerActive(false);
        showMsg((t.tips && t.tips[0]) || t.msgDefault, 1500);
      } else {
        if (hammersCount <= 0) {
          showMsg(t.puNoHammers || 'Nemate više čekića!', 2000);
          haptic('warning');
          return;
        }
        setHammerActive(true);
        showMsg(t.puHammerActive || '🔨 Dodirni bilo koju kocku na tabli da je razbiješ!', 3500);
        haptic('light');
      }
    });
  }

  if (btnReroll) {
    btnReroll.addEventListener('click', ()=>{
      if (gameOver || paused || lineClearInProgress) return;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      if (rerollsCount <= 0) {
        showMsg(t.puNoRerolls || 'Nemate više zamena!', 2000);
        haptic('warning');
        return;
      }
      rerollsCount--;
      sfxReroll();
      tray = [randomPiece(), randomPiece(), randomPiece()];
      updatePowerupUI();
      render();
      const slots = document.querySelectorAll('.piece-slot');
      slots.forEach(slot => {
        slot.classList.add('pop-in');
        setTimeout(() => slot.classList.remove('pop-in'), 280);
      });
      saveGameState();
      checkAndTriggerGameOver();
    });
  }

  // ── Debounce helper to prevent double-clicks on critical actions ──
  function debounceAction(key, fn, cooldown){
    const now = Date.now();
    if(actionDebounce[key] && now - actionDebounce[key] < cooldown) return;
    actionDebounce[key] = now;
    fn();
  }

  // ── Keyboard navigation ──
  function handleKeyDown(e){
    if(gameOver || paused || lineClearInProgress || !dragging) return;
    // Korak = širina jedne ćelije (+ gap) — akumulira se u dragging.x/y
    const step = ((cachedBoardGeometry || getCellGeometry()).cellW) + 4;
    let handled = true;
    switch(e.key){
      case 'ArrowLeft':  dragging.x -= step; break;
      case 'ArrowRight': dragging.x += step; break;
      case 'ArrowUp':    dragging.y -= step; break;
      case 'ArrowDown':  dragging.y += step; break;
      case 'Enter': case ' ':
        onUp(e); // onUp postavlja dragging = null
        break;
      case 'r': case 'R':
        sfxRotate();
        dragging.piece.shape = GameCore.rotateShapeCW(dragging.piece.shape);
        buildGhost(dragging.piece);
        break;
      case 'Escape':
        cancelDrag();
        break;
      default: handled = false;
    }
    if(!handled) return;
    e.preventDefault();
    if(dragging){
      moveGhost(dragging.x, dragging.y);
      updatePreview(dragging.x, dragging.y);
    }
  }
  document.addEventListener('keydown', handleKeyDown);

  // ── Cleanup particles when app goes to background ──
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden){
      document.querySelectorAll('.particle, .debris, .flash, .shockwave, .boom-emoji').forEach(el=>el.remove());
    }
  });

  /* ═══════════════════════════════════════════════
   *  ANALYTICS (Google Analytics 4 — zadržavanje igrača)
   *  Unesite svoj GA4 Measurement ID u `gaId`. Ukoliko je
   *  prazan sve analitičke funkcije bezbedno no-ope.
   * ═══════════════════════════════════════════════ */
  const gaId = ''; // ← prim.: 'G-XXXXXXXXXX'
  let gaScriptAdded = false;
  function loadAnalytics(){
    if(!gaId || gaScriptAdded) return;
    gaScriptAdded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    window.dataLayer.push(['js', new Date()]);
    window.dataLayer.push(['config', gaId, { anonymize_ip: true }]);
    const gaS = document.createElement('script');
    gaS.async = true;
    gaS.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
    document.head.appendChild(gaS);
  }
  function track(event, params){
    try{
      loadAnalytics();
      if(!gaId) return;
      if(typeof window.gtag === 'function') window.gtag('event', event, params || {});
      else console.log('[B&R analytics]', event, params || {});
    }catch(e){}
  }
  function trackRetention(){
    try{
      const now = Date.now();
      let first = parseInt(localStorage.getItem('blocksrocks_firstSeen') || '0', 10);
      if(!first){ first = now; localStorage.setItem('blocksrocks_firstSeen', String(first)); }
      let sessions = (parseInt(localStorage.getItem('blocksrocks_sessionCount') || '0', 10) || 0) + 1;
      localStorage.setItem('blocksrocks_sessionCount', String(sessions));
      const days = Math.max(0, Math.floor((now - first) / 86400000));
      track('app_open', { session_count: sessions, days_since_first_visit: days, returning: days >= 1 });
    }catch(e){}
  }

  /* ═══════════════════════════════════════════════
   *  DYNAMIC MESSAGES
   * ═══════════════════════════════════════════════ */
  const TIPS = [
    'Prevuci komad na mrežu',
    'Popuni ceo red ili kolonu da obrišeš',
    'Kamene kockice zahtevaju dva pogotka',
    'Bombe eksplodiraju posle 3 tika!',
    'Pokušaj da čistiš više linija odjednom'
  ];
  let msgTimer = null;
  function showMsg(text, duration){
    msgEl.textContent = text;
    msgEl.classList.add('msg-highlight');
    clearTimeout(msgTimer);
    const dur = duration || CONFIG.MSG_DURATION_TIP;
    msgTimer = setTimeout(()=>{
      msgEl.classList.remove('msg-highlight');
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      const tipsList = (t && t.tips) || TIPS;
      msgEl.textContent = tipsList[Math.floor(Math.random()*tipsList.length)];
    }, dur);
  }

  /* ═══════════════════════════════════════════════
   *  GAME STATE PERSISTENCE
   * ═══════════════════════════════════════════════ */
  function saveGameState(){
    if(gameOver) { localStorage.removeItem('blocksrocks_gameState'); return; }
    try {
      const state = { grid, tray, score, comboStreak, hammersCount, rerollsCount, pieceCounter, bombCounter, nextBombAt };
      localStorage.setItem('blocksrocks_gameState', JSON.stringify(state));
    } catch(e){
      if(e.name === 'QuotaExceededError' || e.code === 22){
        console.warn('[B&R] localStorage quota exceeded — clearing save');
        localStorage.removeItem('blocksrocks_gameState');
      }
    }
  }
  function loadGameState(){
    try {
      const raw = localStorage.getItem('blocksrocks_gameState');
      if(!raw) return null;
      const state = JSON.parse(raw);
      if(!state || !Array.isArray(state.grid) || state.grid.length !== SIZE) return null;
      if(!Array.isArray(state.tray)) return null;
      for(const p of state.tray){
        if(p && (!Array.isArray(p.shape) || p.shape.length === 0)) return null;
      }
      if(typeof state.score !== 'number') return null;
      return state;
    } catch(e){}
    return null;
  }
  function clearGameState(){
    localStorage.removeItem('blocksrocks_gameState');
  }

  function newGame(fromSave){
    try {
      const saved = !fromSave ? loadGameState() : null;
      best = parseInt(localStorage.getItem('blocksrocks_personalBest') || '0');
      personalBest = best;
      bestAtGameStart = best;
      if(bestEl) bestEl.textContent = best;
      paused = false;
      gameStartTime = Date.now();
      previewCells.clear();
      previewRAF = null;
      lineClearInProgress = false;
      actionDebounce = {};
      if (gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
      resetBombTickers();
      hasCelebratedNewBest = false;
      const bestBox = document.querySelector('.scorebox.best');
      if(bestBox) bestBox.classList.remove('record-breaking');
      if(saved){
        grid = saved.grid || GameCore.makeGrid(SIZE);
        tray = saved.tray || [null, null, null];
        score = saved.score || 0;
        comboStreak = saved.comboStreak || 0;
        hammersCount = typeof saved.hammersCount === 'number' ? saved.hammersCount : 1;
        rerollsCount = typeof saved.rerollsCount === 'number' ? saved.rerollsCount : 1;
        pieceCounter = saved.pieceCounter || 0;
        bombCounter = saved.bombCounter || 0;
        nextBombAt = saved.nextBombAt || 15;
        gameOver = false;
        dragging = null;
        setHammerActive(false);
        // Refill tray if empty or invalid
        if(!Array.isArray(tray) || tray.every(p => !p)){
          tray = [null, null, null];
          refillTray();
        }
        // Restart bomb timers for any active bombs on the board
        for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++){
          const d = grid[r][c];
          if(d && d.bomb && d.timer > 0) startBombCountdown(r,c);
        }
        // If loaded state cannot place any pieces (and no active bombs), start fresh
        if(checkGameOver() && !hasActiveBombs()){
          grid = GameCore.makeGrid(SIZE);
          score = 0;
          comboStreak = 0;
          hammersCount = 1;
          rerollsCount = 1;
          pieceCounter = 0;
          bombCounter = 0;
          tray = [null, null, null];
          refillTray();
          clearGameState();
        }
      } else {
        grid = GameCore.makeGrid(SIZE);
        score = 0;
        comboStreak = 0;
        hammersCount = 1;
        rerollsCount = 1;
        setHammerActive(false);
        gameOver = false;
        dragging = null;
        pieceCounter = 0;
        bombCounter = 0;
        nextBombAt = 15 + Math.floor(Math.random()*6);
        tray = [null,null,null];
        refillTray();
        clearGameState();
      }
      hasCelebratedNewBest = false;
      hasCelebratedWorldRecord = false;
      if(pulseBonusState.intervalId) { clearInterval(pulseBonusState.intervalId); pulseBonusState.intervalId = null; }
      if(pulseBonusState.nextSpawnTimeoutId) { clearTimeout(pulseBonusState.nextSpawnTimeoutId); pulseBonusState.nextSpawnTimeoutId = null; }
      pulseBonusState.r = -1;
      pulseBonusState.c = -1;
      pulseBonusState.timer = 0;
      scheduleNextPulseBonus();

      updatePowerupUI();
      track('game_start', { from_save: !!saved });
      render();
      overlayEl.style.display = 'none';
      document.getElementById('newbestLabel').style.display = 'none';
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      msgEl.textContent = (t.tips && t.tips[0]) || t.msgDefault;
    } catch(err) {
      console.error('[B&R] Error in newGame, starting clean game:', err);
      clearGameState();
      grid = GameCore.makeGrid(SIZE);
      tray = [null, null, null];
      refillTray();
      score = 0;
      comboStreak = 0;
      hammersCount = 1;
      rerollsCount = 1;
      setHammerActive(false);
      updatePowerupUI();
      gameOver = false;
      dragging = null;
      hasCelebratedNewBest = false;
      hasCelebratedWorldRecord = false;
      lastMilestoneHazardLevel = GameCore.getMilestoneHazardLevel(score);
      lastFibonacciMilestoneIndex = GameCore.getFibonacciRockMilestone(score);
      render();
    }
  }

  function checkFibonacciMilestones(currentScore){
    const reached = GameCore.getFibonacciRockMilestone(currentScore);
    if(reached > lastFibonacciMilestoneIndex){
      lastFibonacciMilestoneIndex = reached;
      const spawnList = GameCore.getFibonacciMilestoneSpawnConfig(reached);
      const threshold = GameCore.FIBONACCI_MILESTONES[reached];
      let spawnedCount = 0;
      spawnList.forEach(item => {
        const freeCell = GameCore.findRandomFreeCell(grid, SIZE);
        if(freeCell){
          grid[freeCell.r][freeCell.c] = {
            color: '#697287',
            hp: item.maxHp || 2,
            maxHp: item.maxHp || 2,
          };
          spawnedCount++;
          const idx = freeCell.r * SIZE + freeCell.c;
          const el = boardEl.children[idx];
          if(el){
            el.classList.add('pop-in');
            setTimeout(() => el.classList.remove('pop-in'), 350);
          }
        }
      });

      if(spawnedCount > 0){
        sfxRockCrack();
        triggerScreenShake('light');
        const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
        const msgTpl = t.msgFibonacciRockSpawn || '🪨 STENA NA TABLI! (%s PTS)';
        showMsg(msgTpl.replace('%s', threshold.toLocaleString()), 2500);
        render();
      }
    }
  }

  function checkMilestones(currentScore){
    const reached = GameCore.getMilestoneHazardLevel(currentScore);
    if(reached > lastMilestoneHazardLevel){
      lastMilestoneHazardLevel = reached;
      const freeCell = GameCore.findRandomFreeCell(grid, SIZE);
      if(freeCell){
        grid[freeCell.r][freeCell.c] = {
          color: '#38bdf8',
          hp: 1,
          maxHp: 1,
          isIceHazard: true,
        };
        sfxLevelUp();
        triggerScreenShake('light');
        triggerConfetti(40);
        const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
        showMsg(t.msgLevelUpHazard || '⚠️ LEVEL UP: ZONA OPASNOSTI! ❄️', 3500);
        render();
        const idx = freeCell.r * SIZE + freeCell.c;
        const el = boardEl.children[idx];
        if (el) {
          el.classList.add('pop-in');
          setTimeout(() => el.classList.remove('pop-in'), 300);
        }
      }
    }
  }

  function randomPiece(){
    pieceCounter++;
    bombCounter++;
    const shape = SHAPES[Math.floor(Math.random()*SHAPES.length)];
    const color = COLORS[Math.floor(Math.random()*COLORS.length)];

    const rockInterval = GameCore.getRockInterval(score);
    let stoneIndex = (pieceCounter % rockInterval === 0) ? Math.floor(Math.random()*shape.length) : null;
    let stoneMaxHp = stoneIndex !== null ? GameCore.getRockMaxHp(score) : 1;
    let bombIndex = null;
    let bombInitialTimer = 3;

    if(bombCounter >= nextBombAt){
      bombIndex = Math.floor(Math.random()*shape.length);
      if(bombIndex === stoneIndex){
        if(shape.length > 1) stoneIndex = (bombIndex+1) % shape.length;
        else stoneIndex = null;
      }
      bombInitialTimer = GameCore.getBombInitialTimer(score);
      bombCounter = 0;
      nextBombAt = GameCore.getBombInterval(score);
    }

    return {shape, color, stoneIndex, stoneMaxHp, bombIndex, bombInitialTimer, id: Math.random().toString(36).slice(2)};
  }

  function refillTray(){
    for(let i=0;i<tray.length;i++){
      if(!tray[i]) tray[i] = randomPiece();
    }
  }

  function shapeSize(shape){
    return GameCore.shapeSize(shape);
  }

  function canPlace(shape, row, col){
    return GameCore.canPlaceOn(grid, SIZE, shape, row, col);
  }

  function anyPlacementExists(shape){
    return GameCore.anyPlacementOn(grid, SIZE, shape);
  }

  function hasActiveBombs(){
    if(bombTickers && bombTickers.size > 0) return true;
    return GameCore.hasActiveBombsOn(grid, SIZE);
  }

  function checkGameOver(){
    // Game over only when no tray pieces can be placed in any rotation AND no hammers/rerolls available
    return GameCore.isGameOverOn(grid, SIZE, tray, hammersCount, rerollsCount);
  }

  function checkAndTriggerGameOver(delay = CONFIG.GAME_OVER_DELAY_AFTER_CLEAR){
    if(lineClearInProgress || hasActiveBombs()) return false;
    if(checkGameOver()){
      gameOver = true;
      if (gameOverTimer) clearTimeout(gameOverTimer);
      gameOverTimer = setTimeout(()=>{ gameOverTimer = null; handleGameOver(); }, delay);
      return true;
    }
    return false;
  }

  function placePiece(piece, row, col, onCleared){
    let bombPos = null;
    const placedIndices = [];
    piece.shape.forEach(([r,c], i)=>{
      const isStone = piece.stoneIndex === i;
      const isBomb = piece.bombIndex === i;
      const sHp = isStone ? (piece.stoneMaxHp || 2) : 1;
      const bTimer = isBomb ? (piece.bombInitialTimer || 3) : undefined;
      grid[row+r][col+c] = {
        color: piece.color,
        hp: sHp,
        maxHp: sHp,
        bomb: isBomb,
        timer: bTimer,
        initialTimer: bTimer,
      };
      placedIndices.push((row+r)*SIZE + (col+c));
      if(isBomb) bombPos = {r:row+r, c:col+c};
    });
    const prevScore = score;
    score += piece.shape.length;
    showScoreFloat(score - prevScore);
    if(score > personalBest){
      savePersonalBest(score);
      if(fb_db && firebaseReady && fb_userId){
        fb_db.collection('users').doc(fb_userId).set({
          personalBest: score,
          updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
        }, { merge: true }).catch(()=>{});
      }
    }
    grantPowerupRewards(prevScore, score);
    checkFibonacciMilestones(score);
    checkMilestones(score);
    checkAndUnlockBadges(careerStats, score, best, currentLang);
    sfxPlace();
    render();
    placedIndices.forEach(idx => {
      const el = boardEl.children[idx];
      if (el) {
        el.classList.add('pop-in');
        setTimeout(() => el.classList.remove('pop-in'), 280);
      }
    });
    if(bombPos) startBombCountdown(bombPos.r, bombPos.c);
    clearLines(onCleared);
    saveGameState();
  }

  /* ═══════════════════════════════════════════════
   *  PULSE BONUS CUBE (Every 2-3 min, 10s duration, +100 bonus pts)
   * ═══════════════════════════════════════════════ */
  let pulseBonusState = {
    r: -1,
    c: -1,
    timer: 0,
    intervalId: null,
    nextSpawnTimeoutId: null
  };

  function getRandomPulseInterval(){
    const min = GameCore.PULSE_BONUS_MIN_INTERVAL_MS || 100000;
    const max = GameCore.PULSE_BONUS_MAX_INTERVAL_MS || 150000;
    return Math.floor(Math.random() * (max - min)) + min;
  }

  function scheduleNextPulseBonus(delayMs = getRandomPulseInterval()){
    if(pulseBonusState.nextSpawnTimeoutId) {
      clearTimeout(pulseBonusState.nextSpawnTimeoutId);
    }
    pulseBonusState.nextSpawnTimeoutId = setTimeout(() => {
      pulseBonusState.nextSpawnTimeoutId = null;
      spawnPulseBonus();
    }, delayMs);
  }

  function spawnPulseBonus(){
    if(gameOver || paused || lineClearInProgress) {
      scheduleNextPulseBonus(5000);
      return;
    }
    if(pulseBonusState.r !== -1) return;

    const candidates = [];
    for(let r=0; r<SIZE; r++){
      for(let c=0; c<SIZE; c++){
        const d = grid && grid[r] ? grid[r][c] : null;
        if(d && !d.bomb) {
          candidates.push({r, c});
        }
      }
    }
    if(candidates.length === 0){
      scheduleNextPulseBonus(5000);
      return;
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    startPulseBonusAt(chosen.r, chosen.c);
  }

  function startPulseBonusAt(r, c){
    const cellData = grid && grid[r] ? grid[r][c] : null;
    if(!cellData) return;
    cellData.isPulseBonus = true;
    cellData.pulseTimer = GameCore.PULSE_BONUS_DURATION_SEC || 10;
    pulseBonusState.r = r;
    pulseBonusState.c = c;
    pulseBonusState.timer = cellData.pulseTimer;

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const pts = GameCore.PULSE_BONUS_POINTS || 250;
    showMsg(t.msgPulseBonusSpawn || ('✨ Zlatna kocka pulsira! Razbij je za +' + pts + '!'), 3000);
    haptic('medium');
    sfxBonusGem();
    render();

    if(pulseBonusState.intervalId) clearInterval(pulseBonusState.intervalId);
    pulseBonusState.intervalId = setInterval(() => {
      if(paused || gameOver) return;
      if(pulseBonusState.r === -1) {
        clearInterval(pulseBonusState.intervalId);
        pulseBonusState.intervalId = null;
        return;
      }
      pulseBonusState.timer -= 1;
      const d = (grid && grid[pulseBonusState.r]) ? grid[pulseBonusState.r][pulseBonusState.c] : null;
      if(d && d.isPulseBonus){
        d.pulseTimer = pulseBonusState.timer;
        if(pulseBonusState.timer <= 0){
          endPulseBonus(false);
        } else {
          render();
        }
      } else {
        endPulseBonus(false);
      }
    }, 1000);
  }

  function endPulseBonus(rewardClaimed = false){
    if(pulseBonusState.intervalId){
      clearInterval(pulseBonusState.intervalId);
      pulseBonusState.intervalId = null;
    }
    if(pulseBonusState.r !== -1 && grid && grid[pulseBonusState.r]){
      const d = grid[pulseBonusState.r][pulseBonusState.c];
      if(d) {
        delete d.isPulseBonus;
        delete d.pulseTimer;
      }
    }
    pulseBonusState.r = -1;
    pulseBonusState.c = -1;
    pulseBonusState.timer = 0;
    render();
    scheduleNextPulseBonus();
  }

  function checkAndCollectPulseBonus(r, c){
    if(pulseBonusState.r === r && pulseBonusState.c === c){
      const pts = GameCore.PULSE_BONUS_POINTS || 250;
      score += pts;
      showScoreFloat(pts);
      sfxBonusGem();
      triggerConfetti(25);
      haptic('success');
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      showMsg(t.msgPulseBonusClaimed || ('🌟 +' + pts + ' BONUS OSVOJEN!'), 2500);
      endPulseBonus(true);
      return true;
    }
    return false;
  }

  const bombTickers = new Map(); // key "r_c" -> {r,c}
  let bombInterval = null;

  function ensureBombInterval(){
    if(bombInterval || bombTickers.size === 0) return;
    bombInterval = setInterval(tickBombs, CONFIG.BOMB_TICK_MS);
  }
  function stopBombInterval(){
    if(bombInterval){
      clearInterval(bombInterval);
      bombInterval = null;
    }
  }
  function resetBombTickers(){
    bombTickers.clear();
    stopBombInterval();
  }
  function tickBombs(){
    if(paused || gameOver || lineClearInProgress) return;
    if(bombTickers.size === 0){
      stopBombInterval();
      return;
    }
    [...bombTickers.entries()].forEach(([key, pos])=>{
      const d = grid[pos.r][pos.c];
      if(!d || !d.bomb){ bombTickers.delete(key); return; }
      if(d.timer > 1){
        d.timer -= 1;
        updateBombVisual(pos.r,pos.c);
      } else {
        bombTickers.delete(key);
        explodeBomb(pos.r,pos.c);
      }
    });
    if(bombTickers.size === 0){
      stopBombInterval();
    }
  }
  function startBombCountdown(r,c){
    const cellData = grid[r][c];
    if(!cellData || !cellData.bomb) return;
    bombTickers.set(r+'_'+c, {r, c});
    ensureBombInterval();
    updateBombVisual(r,c);
  }

  function updateBombVisual(r,c){
    const idx = r*SIZE+c;
    const el = boardEl.children[idx];
    if(!el) return;
    const d = grid[r][c];
    if(!d) return;
    // Critical state on the last second
    el.classList.toggle('critical', d.timer <= 1);
    let label = el.querySelector('.bomb-label');
    if(!label){
      label = document.createElement('div');
      label.className = 'bomb-label';
      el.appendChild(label);
    }
    label.textContent = d.timer;
    label.classList.toggle('critical-num', d.timer <= 1);
    // Restart the countdown "pop" animation on every tick
    label.classList.remove('pop');
    void label.offsetWidth;
    label.classList.add('pop');
  }

  function explodeBomb(r,c){
    const cellData = grid[r][c];
    if(!cellData) return;

    lineClearInProgress = true;
    spawnShockwave(r,c);
    sfxBomb();
    triggerScreenShake('heavy');

    // Čista logika eksplozije (pokrivena testovima): uklonjeno/napuklo + uništene stene.
    const { affected, removedCount, crackedCount, rocksCrushed } = GameCore.countBombExplosionStats(grid, SIZE, r, c);

    // Očuvaj redosled "blizina = prvo" za stagger animaciju eksplozije
    affected.sort((a,b)=> Math.hypot(a.r-r,a.c-c) - Math.hypot(b.r-r,b.c-c));

    // Zajednička stagger animacija (pulse bonus, particles, clearance)
    animateStaggeredCellRemoval(affected, CONFIG.BOMB_STAGGER, CONFIG.CLEAR_ANIM_DURATION, ()=>{
      clearLines(()=>{
        checkAndTriggerGameOver(CONFIG.GAME_OVER_DELAY_AFTER_BOMB);
      });
    });

    // Career stats: stene uništene eksplozijom se broje (bedž rock_crusher).
    // Napomena: bomba koja je EKSPLODIRALA se ne računa kao "defused" (nije neutralisana).
    if(rocksCrushed > 0) recordCareerStat('rocksCrushed', rocksCrushed);
    const bombBonus = removedCount*2 + crackedCount*1 + 10;
    const prevBombScore = score;
    score += bombBonus;
    showScoreFloat(bombBonus);
    grantPowerupRewards(prevBombScore, score, CONFIG.MSG_DURATION_BOMB);
    const tBomb = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    showMsg((tBomb.msgExplosion || '💥 EKSPLOZIJA! +') + bombBonus, CONFIG.MSG_DURATION_BOMB);
    track('bomb_explode', { bonus: bombBonus });
  }

  /**
   * Zajednička asinhrona animacija za uklanjanje ćelija sa staggerom.
   * Postavlja vizual (clearing klasa, bomb label cleanup, particles),
   * zatim nakon totalDelay čisti grid i poziva onDone.
   *
   * @param {Array<{r:number, c:number, willRemove:boolean}>} cells — ćelije za animaciju
   * @param {number} stagger — kašnjenje po ćeliji (ms)
   * @param {number} animDuration — vreme dodatnog čekanja posle poslednje ćelije (ms)
   * @param {Function} onDone — poziva se posle čišćenja DOM-a i grida
   */
  function animateStaggeredCellRemoval(cells, stagger, animDuration, onDone){
    cells.forEach((pos, i)=>{
      if(pos.willRemove) checkAndCollectPulseBonus(pos.r, pos.c);
      setTimeout(()=>{
        const data = grid[pos.r][pos.c];
        if(!data) return;
        const idx = pos.r*SIZE+pos.c;
        const el = boardEl.children[idx];
        if(pos.willRemove){
          if(data.isIceHazard){
            score += GameCore.ICE_HAZARD_BONUS_POINTS || 500;
            showScoreFloat(GameCore.ICE_HAZARD_BONUS_POINTS || 500);
            spawnIceShatterParticles(pos.r, pos.c);
            sfxIceBreak();
            const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
            showMsg(t.msgIceDestroyed || '❄️ LED RAZBIJEN! +500', 2000);
          } else if(data.maxHp >= 2){
            sfxRockBreak();
            spawnParticles([pos.r+'_'+pos.c], '#8690a8');
          }
          if(el){
            el.style.color = el.style.backgroundColor;
            el.classList.remove('bomb-cell', 'ice-hazard');
            const lbl = el.querySelector('.bomb-label');
            if(lbl) lbl.remove();
            el.classList.remove('pop-in');
            el.classList.add('clearing');
          }
          spawnParticles([pos.r+'_'+pos.c]);
        } else {
          data.hp -= 1;
          if(el){
            el.classList.remove('stone-full', 'stone-granite-3', 'stone-granite-2');
            if(data.maxHp === 3 && data.hp === 2) el.classList.add('stone-granite-2', 'cracking');
            else el.classList.add('stone-cracked','cracking');
            el.style.backgroundColor = '';
          }
          sfxRockCrack();
          spawnCrackParticles([pos.r+'_'+pos.c]);
        }
      }, i*stagger);
    });

    const totalDelay = cells.length*stagger + animDuration;
    setTimeout(()=>{
      cells.forEach(({r,c,willRemove})=>{
        if(willRemove) {
          grid[r][c] = null;
          const idx = r*SIZE+c;
          const el = boardEl.children[idx];
          if(el) el.classList.remove('clearing');
        }
      });
      lineClearInProgress = false;
      render();
      if(onDone) onDone();
    }, totalDelay);
  }

  function clearLines(onCleared){
    if(lineClearInProgress) return;
    lineClearInProgress = true;

    const fullRows = [];
    const fullCols = [];
    for(let r=0;r<SIZE;r++){ if(grid[r].every(v=>v)) fullRows.push(r); }
    for(let c=0;c<SIZE;c++){ if(grid.every(row=>row[c])) fullCols.push(c); }

    if(fullRows.length===0 && fullCols.length===0){
      comboStreak = 0;
      updatePowerupUI();
      lineClearInProgress = false;
      render();
      if(onCleared) setTimeout(onCleared, 0);
      return;
    }
    track('line_clear', { rows: fullRows.length, cols: fullCols.length });
    sfxClear();

    const cellsToClear = new Set();
    fullRows.forEach(r=>{ for(let c=0;c<SIZE;c++) cellsToClear.add(r+'_'+c); });
    fullCols.forEach(c=>{ for(let r=0;r<SIZE;r++) cellsToClear.add(r+'_'+c); });

    const cellsArr = [...cellsToClear].map(key=>{
      const [r,c] = key.split('_').map(Number);
      const data = grid[r][c];
      const willRemove = !data || data.hp <= 1;
      return {r,c,key,willRemove};
    }).sort((a,b)=> (a.r-b.r) || (a.c-b.c));

    // Zajednička stagger animacija (pulse bonus, particles, clearance)
    animateStaggeredCellRemoval(cellsArr, CONFIG.LINE_CLEAR_STAGGER, CONFIG.CLEAR_ANIM_DURATION, onCleared);

    const removedCount = cellsArr.filter(c=>c.willRemove).length;
    const crackedCount = cellsArr.length - removedCount;
    const linesCleared = fullRows.length + fullCols.length;
    comboStreak++;

    // Track career statistics
    recordCareerStat('linesCleared', linesCleared);
    if(comboStreak > 1) recordCareerStat('maxCombo', comboStreak);
    const defusedCount = cellsArr.filter(c => { const d = grid[c.r][c.c]; return d && d.bomb && c.willRemove; }).length;
    if(defusedCount > 0) recordCareerStat('bombsDefused', defusedCount);
    const rockDestroyedCount = cellsArr.filter(c => { const d = grid[c.r][c.c]; return d && d.maxHp === 2 && c.willRemove; }).length;
    if(rockDestroyedCount > 0) recordCareerStat('rocksCrushed', rockDestroyedCount);

    const prevScoreBeforeLines = score;
    const bonus = GameCore.calculateComboScore(linesCleared, removedCount, crackedCount, comboStreak);
    score += bonus;
    showScoreFloat(bonus);
    if(score > personalBest){
      savePersonalBest(score);
      if(fb_db && firebaseReady && fb_userId){
        fb_db.collection('users').doc(fb_userId).set({
          personalBest: score,
          updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
        }, { merge: true }).catch(()=>{});
      }
    }
    checkFibonacciMilestones(score);
    checkMilestones(score);
    checkAndUnlockBadges(careerStats, score, best, currentLang);

    playComboAudio(comboStreak, linesCleared);
    updatePowerupUI();

    const tClear = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    if(comboStreak > 1) {
      boardEl.classList.add('board-combo');
      setTimeout(() => boardEl.classList.remove('board-combo'), 380);
      showMsg((tClear.msgComboStreak || '🔥 KOMBO NIZ x') + comboStreak + '! +' + bonus, CONFIG.MSG_DURATION_COMBO);
      if(comboStreak >= 3) triggerConfetti(35);
    } else if(linesCleared > 1) {
      boardEl.classList.add('board-combo');
      setTimeout(() => boardEl.classList.remove('board-combo'), 380);
      showMsg((tClear.msgCombo || '🔥 COMBO x') + linesCleared + '! +' + bonus, CONFIG.MSG_DURATION_COMBO);
    } else {
      showMsg((tClear.msgLineClear || '✨ Linija obrisana! +') + bonus, CONFIG.MSG_DURATION_CLEAR);
    }

    // Power-up nagrade (poruke odložene da ne prebiju poruku o čišćenju linija)
    grantPowerupRewards(prevScoreBeforeLines, score, CONFIG.MSG_DURATION_CLEAR);
  }

  function handleCellClick(r, c){
    if(!isHammerActive) return;
    if(!grid || !grid[r] || !grid[r][c]) return;
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const cellData = grid[r][c];
    sfxHammer();
    triggerScreenShake('light');
    spawnCrackParticles([r+'_'+c]);
    spawnParticles([r+'_'+c], '#fbbf24');

    if(cellData.isIceHazard){
      score += GameCore.ICE_HAZARD_BONUS_POINTS || 500;
      showScoreFloat(GameCore.ICE_HAZARD_BONUS_POINTS || 500);
      spawnIceShatterParticles(r, c);
      sfxIceBreak();
      grid[r][c] = null;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      showMsg(t.msgIceDestroyed || '❄️ LED RAZBIJEN! +500', 2000);
    } else if(cellData.hp > 1){
      cellData.hp -= 1;
      sfxRockCrack();
    } else {
      checkAndCollectPulseBonus(r, c);
      if(cellData.maxHp >= 2){
        recordCareerStat('rocksCrushed', 1);
        sfxRockBreak();
      }
      if(cellData.bomb) recordCareerStat('bombsDefused', 1);
      grid[r][c] = null;
      if(cellData.bomb) bombTickers.delete(r+'_'+c);
    }

    hammersCount = Math.max(0, hammersCount - 1);
    setHammerActive(false);
    updatePowerupUI();
    showMsg(t.puHammerUsed || '💥 Kocka razbijena!', 1500);
    render();
    clearLines(()=>{
      checkAndTriggerGameOver();
    });
    saveGameState();
  }

  let cellElements = [];
  // Per-Ćelija keš: čuvamo poslednju primenjenu boju i referencu na dekoratore
  // (bomb/pulse label) kako bi render() izbegao ponovne style write-ove i querySelector.
  const cellsMeta = new WeakMap();
  function initBoardDOM(){
    boardEl.innerHTML = '';
    cellElements = [];
    const frag = document.createDocumentFragment();
    for(let r=0; r<SIZE; r++){
      for(let c=0; c<SIZE; c++){
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.r = r;
        div.dataset.c = c;
        div.addEventListener('click', () => handleCellClick(r, c));
        frag.appendChild(div);
        cellElements.push(div);
        cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null });
      }
    }
    boardEl.appendChild(frag);
  }

  /**
   * Briše sve dinamičke dekoratore ćelije (bomb label, pulse bonus label).
   */
  function clearCellDecorators(div){
    const meta = cellsMeta.get(div);
    if(!meta) return;
    const lbl = meta.bombLabel;
    if(lbl){ lbl.remove(); meta.bombLabel = null; }
    const pb = meta.pulseLabel;
    if(pb){ pb.remove(); meta.pulseLabel = null; }
  }

  /**
   * Održava bomb label element unutar ćelije (stvara/briše).
   */
  function renderBombLabel(div, data){
    const meta = cellsMeta.get(div) || (cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null }), cellsMeta.get(div));
    if(data && data.bomb){
      let label = meta.bombLabel;
      if(!label){
        label = document.createElement('div');
        label.className = 'bomb-label';
        div.appendChild(label);
        meta.bombLabel = label;
      }
      const val = data.timer || 3;
      if(label.textContent != val) label.textContent = val;
    } else {
      const label = meta.bombLabel;
      if(label){ label.remove(); meta.bombLabel = null; }
    }
  }

  /**
   * Održava pulse bonus label element unutar ćelije (stvara/briše).
   */
  function renderPulseLabel(div, data){
    const meta = cellsMeta.get(div) || (cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null }), cellsMeta.get(div));
    if(data && data.isPulseBonus){
      let pbLabel = meta.pulseLabel;
      if(!pbLabel){
        pbLabel = document.createElement('div');
        pbLabel.className = 'pulse-bonus-label';
        div.appendChild(pbLabel);
        meta.pulseLabel = pbLabel;
      }
      const pts = GameCore.PULSE_BONUS_POINTS || 250;
      const html = '<span class="pb-sec">' + (data.pulseTimer || 10) + 's</span><span class="pb-pts">+' + pts + '</span>';
      if (pbLabel.innerHTML !== html) pbLabel.innerHTML = html;
    } else {
      const pbLabel = meta.pulseLabel;
      if(pbLabel){ pbLabel.remove(); meta.pulseLabel = null; }
    }
  }

  /**
   * Izračunava CSS klasu za ćeliju na osnovu podataka o kockici.
   */
  function cellClassName(data){
    if(!data) return 'cell';
    let cls = 'cell filled';
    if(data.isIceHazard) {
      cls += ' ice-hazard';
      return cls;
    }
    if(data.maxHp === 3){
      if(data.hp >= 3) cls += ' stone-granite-3';
      else if(data.hp === 2) cls += ' stone-granite-2';
      else cls += ' stone-cracked';
    } else if(data.maxHp === 2){
      if(data.hp >= 2) cls += ' stone-full';
      else cls += ' stone-cracked';
    }
    if(data.bomb){
      cls += ' bomb-cell';
      if(data.initialTimer === 2) cls += ' fast-bomb';
    }
    if(data.isPulseBonus){
      cls += ' pulse-bonus-cell';
      if(data.pulseTimer <= 3) cls += ' urgent';
    }
    return cls;
  }

  function render(){
    try {
      if (!cellElements || cellElements.length !== SIZE * SIZE) {
        initBoardDOM();
      }
      for(let r=0; r<SIZE; r++){
        for(let c=0; c<SIZE; c++){
          const div = cellElements[r * SIZE + c];
          if(!div) continue;
          if(div.classList.contains('clearing')) continue;

          const data = (grid && grid[r]) ? grid[r][c] : null;
          const cls = cellClassName(data);
          if (div.className !== cls) {
            div.className = cls;
          }
          if(data){
            const target = (data.maxHp === 2) ? '' : (data.color || '#5eead4');
            const meta = cellsMeta.get(div);
            if (meta && meta.lastColor !== target) {
              meta.lastColor = target;
              div.style.backgroundColor = target;
            }
            renderBombLabel(div, data);
            renderPulseLabel(div, data);
          } else {
            const meta = cellsMeta.get(div);
            if (meta && meta.lastColor !== '') {
              meta.lastColor = '';
              div.style.backgroundColor = '';
            }
            clearCellDecorators(div);
          }
        }
      }
      renderTray();
      if(scoreEl) scoreEl.textContent = score;

      const worldRecordScore = typeof getCachedGlobalTopScore === 'function' ? getCachedGlobalTopScore() : 0;
      if(worldRecordScore > 0 && score > worldRecordScore){
        if(!hasCelebratedWorldRecord){
          hasCelebratedWorldRecord = true;
          triggerConfetti(100);
          sfxWorldRecord();
          const globalBox = document.getElementById('bottomGlobalCard');
          if(globalBox) globalBox.classList.add('record-breaking');
          const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
          setMsg(t.worldRecordBroken || '🌍 NOVI SVETSKI REKORD! 🎉', CONFIG.MSG_DURATION_COMBO || 2500);
        }
      }

      if(score > best){
        if(best > 0 && !hasCelebratedNewBest){
          hasCelebratedNewBest = true;
          triggerConfetti(70);
          if (!hasCelebratedWorldRecord) {
            sfxNewBest();
          }
          const bestBox = document.querySelector('.scorebox.best');
          if(bestBox) bestBox.classList.add('record-breaking');
        }
        best = score;
        savePersonalBest(best);
      }
      if(bestEl) bestEl.textContent = best;
    } catch(err){
      console.error('[B&R] Error in render:', err);
    }
  }

  function renderTray(){
    try {
      const existing = Array.from(trayEl.children);
      const needed = tray ? tray.length : 3;

      while(existing.length > needed){
        trayEl.removeChild(trayEl.lastChild);
        existing.pop();
      }

      if(!tray || !Array.isArray(tray)) return;

      tray.forEach((piece, idx)=>{
        let slot = existing[idx];
        if(!slot){
          slot = document.createElement('div');
          trayEl.appendChild(slot);
        }
        if(!slot._dragAttached){
          slot._dragAttached = true;
          attachDrag(slot);
        }
        slot.className = 'piece-slot' + (piece ? '' : ' empty');
        // A11y: opis komada za screen reader-e
        const tA11y = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
        if (piece && piece.shape) slot.setAttribute('aria-label', (tA11y.trayPiece || 'Komad') + ' ' + (idx + 1) + ' (' + piece.shape.length + ')');
        else slot.removeAttribute('aria-label');

        const currentPiece = slot._piece;
        const shapeKey = (piece && Array.isArray(piece.shape)) ? piece.shape.map(([r,c])=>r+','+c).join('|') : '';
        const slotShapeKey = slot._shapeKey || '';
        if(currentPiece === piece && slot.dataset.idx == idx && slotShapeKey === shapeKey) return;
        slot._piece = piece;
        slot._shapeKey = shapeKey;
        slot.dataset.idx = idx;
        slot.innerHTML = '';

        if(piece && piece.shape && Array.isArray(piece.shape)){
          const {rows, cols} = shapeSize(piece.shape);
          const occMap = new Map();
          piece.shape.forEach(([sr,sc], i)=> occMap.set(sr+','+sc, i));
          const pg = document.createElement('div');
          pg.className = 'piece-grid';
          pg.style.gridTemplateColumns = `repeat(${cols}, 16px)`;
          pg.style.gridTemplateRows = `repeat(${rows}, 16px)`;
          for(let r=0;r<rows;r++){
            for(let c=0;c<cols;c++){
              const shapeIdx = occMap.get(r+','+c);
              const on = shapeIdx !== undefined;
              const isStone = on && shapeIdx === piece.stoneIndex;
              const isBomb = on && shapeIdx === piece.bombIndex;
              const cell = document.createElement('div');
              cell.className = 'piece-cell ' + (on?'on':'off') + (isStone?' stone':'') + (isBomb?' bomb':'');
              if(on && !isStone && !isBomb) cell.style.background = piece.color || '#5eead4';
              pg.appendChild(cell);
            }
          }
          slot.appendChild(pg);

          const rotateBtn = document.createElement('div');
          rotateBtn.className = 'slot-rotate';
          rotateBtn.innerHTML = '↻';
          rotateBtn.onpointerdown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (gameOver || paused || lineClearInProgress || !tray[idx]) return;
            sfxRotate();
            tray[idx].shape = GameCore.rotateShapeCW(tray[idx].shape);
            renderTray();
            saveGameState();
          };
          slot.appendChild(rotateBtn);

          const rotateBtnCCW = document.createElement('div');
          rotateBtnCCW.className = 'slot-rotate ccw';
          rotateBtnCCW.innerHTML = '↺';
          rotateBtnCCW.onpointerdown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (gameOver || paused || lineClearInProgress || !tray[idx]) return;
            sfxRotate();
            tray[idx].shape = GameCore.rotateShapeCCW(tray[idx].shape);
            renderTray();
            saveGameState();
          };
          slot.appendChild(rotateBtnCCW);
        } else {
          slot._piece = null;
          slot._shapeKey = '';
        }
      });
    } catch(err){
      console.error('[B&R] Error in renderTray:', err);
    }
  }

  function getPointerCoords(e){
    let x = e.clientX;
    let y = e.clientY;
    if((x == null || (x === 0 && y === 0)) && e.touches && e.touches.length > 0){
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    } else if((x == null || (x === 0 && y === 0)) && e.changedTouches && e.changedTouches.length > 0){
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    }
    return {x: x || 0, y: y || 0};
  }

  function attachDrag(slot){
    const startDrag = (e) => {
      if(gameOver || paused || lineClearInProgress || dragging || !slot._piece) return;
      if(e.target && e.target.closest && e.target.closest('.slot-rotate')) return;
      
      const coords = getPointerCoords(e);
      const piece = slot._piece;
      const idx = Number(slot.dataset.idx);
      cachedBoardGeometry = getCellGeometry();
      lastPreviewRow = null;
      lastPreviewCol = null;
      dragging = {piece: {...piece}, idx, x: coords.x, y: coords.y};
      slot.style.opacity = '0.25';
      boardEl.classList.add('dragging');
      buildGhost(dragging.piece);
      moveGhost(coords.x, coords.y);
      updatePreview(coords.x, coords.y);

      if (window.PointerEvent) {
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      } else {
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, {passive: true});
        window.addEventListener('touchend', onUp, {passive: true});
        window.addEventListener('touchcancel', onUp, {passive: true});
      }
    };

    slot.addEventListener('pointerdown', startDrag);

    // ── Keyboard pristupačnost ──
    // Slot je fokusabilan "dugme": Enter/Space = pokupi komad, R = rotiraj (Shift+R = suprotno).
    // Dok je komad "u ruci" rade globalne prečice (handleKeyDown): strelice, Enter, R, Esc.
    slot.tabIndex = 0;
    slot.setAttribute('role', 'button');
    slot.addEventListener('keydown', (e) => {
      if (gameOver || paused || lineClearInProgress) return;
      const idx = Number(slot.dataset.idx);
      const piece = slot._piece;
      if (!piece || !tray[idx]) return;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;

      // Rotacija u fioci, bez podizanja komada
      if ((e.key === 'r' || e.key === 'R') && !dragging) {
        e.preventDefault();
        sfxRotate();
        tray[idx].shape = e.shiftKey ? GameCore.rotateShapeCCW(tray[idx].shape) : GameCore.rotateShapeCW(tray[idx].shape);
        renderTray();
        saveGameState();
        return;
      }

      // Pokupi komad — ghost se pojavljuje iznad centra table
      if ((e.key === 'Enter' || e.key === ' ') && !dragging) {
        e.preventDefault();
        const rect = boardEl.getBoundingClientRect();
        cachedBoardGeometry = getCellGeometry();
        lastPreviewRow = null;
        lastPreviewCol = null;
        dragging = { piece: {...piece}, idx, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, keyboard: true };
        slot.style.opacity = '0.25';
        boardEl.classList.add('dragging');
        buildGhost(dragging.piece);
        moveGhost(dragging.x, dragging.y);
        updatePreview(dragging.x, dragging.y);
        showMsg(t.trayPieceKbHint || 'Enter: pokupi/spusti · Strelice: pomeri · R: rotiraj · Esc: odustani', 3500);
      }
    });
  }

  let cachedBoardGeometry = null;
  let lastPreviewRow = null;
  let lastPreviewCol = null;

  function buildGhost(piece){
    const {rows, cols} = shapeSize(piece.shape);
    const {cellW} = cachedBoardGeometry || getCellGeometry();
    const occMap = new Map();
    piece.shape.forEach(([sr,sc], i)=> occMap.set(sr+','+sc, i));
    ghostEl.innerHTML = '';
    ghostEl.style.display = 'grid';
    ghostEl.style.gridTemplateColumns = `repeat(${cols}, ${cellW}px)`;
    ghostEl.style.gridTemplateRows = `repeat(${rows}, ${cellW}px)`;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const shapeIdx = occMap.get(r+','+c);
        const on = shapeIdx !== undefined;
        const isStone = on && shapeIdx === piece.stoneIndex;
        const isBomb = on && shapeIdx === piece.bombIndex;
        const cell = document.createElement('div');
        cell.className = 'ghost-cell ' + (on?'':'off') + (isStone?' stone-full':'') + (isBomb?' bomb':'');
        if(on && !isStone && !isBomb) cell.style.background = piece.color || '#5eead4';
        ghostEl.appendChild(cell);
      }
    }
  }

  function getGhostRaise(rows = 1){
    const cellW = (cachedBoardGeometry || getCellGeometry()).cellW;
    return Math.round((rows * 0.5 + userDragOffsetMultiplier) * cellW);
  }

  function moveGhost(x,y){
    const {rows, cols} = shapeSize(dragging.piece.shape);
    const cellW = (cachedBoardGeometry || getCellGeometry()).cellW;
    const raise = getGhostRaise(rows);
    const gx = Math.round(x - cols*cellW/2);
    const gy = Math.round(y - rows*cellW/2 - raise);
    ghostEl.style.transform = `translate3d(${gx}px, ${gy}px, 0) scale(1.05)`;
  }

  function getCellGeometry(){
    const rect = boardEl.getBoundingClientRect();
    const padding = 8, gap = 4;
    const w = (rect && rect.width) ? rect.width : 360;
    const cellW = Math.max(20, (w - padding*2 - gap*(SIZE-1)) / SIZE);
    return {rect, padding, gap, cellW};
  }

  function boardTargetCell(x,y){
    const {rect, padding, gap, cellW} = cachedBoardGeometry || getCellGeometry();
    const {rows, cols} = shapeSize(dragging.piece.shape);
    const raise = getGhostRaise(rows);
    const localX = x - rect.left - padding;
    const localY = y - rect.top - padding - raise;
    const col = Math.round(localX / (cellW+gap) - (cols-1)/2);
    const row = Math.round(localY / (cellW+gap) - (rows-1)/2);
    return {row, col};
  }

  let previewLineCells = new Set();

  function clearPreview(){
    previewCells.forEach(el=>{
      el.classList.remove('preview-ok','preview-bad');
    });
    previewCells.clear();
    previewLineCells.forEach(el=>{
      el.classList.remove('preview-line-glow');
    });
    previewLineCells.clear();
  }

  function updatePreview(x,y){
    const {row, col} = boardTargetCell(x,y);
    if(row === lastPreviewRow && col === lastPreviewCol) return;
    lastPreviewRow = row;
    lastPreviewCol = col;

    clearPreview();
    const ok = canPlace(dragging.piece.shape, row, col);
    dragging.target = {row, col, ok};
    dragging.piece.shape.forEach(([r,c])=>{
      const rr=row+r, cc=col+c;
      if(rr>=0&&rr<SIZE&&cc>=0&&cc<SIZE){
        const idx = rr*SIZE+cc;
        const el = boardEl.children[idx];
        if(el){
          el.classList.add(ok?'preview-ok':'preview-bad');
          previewCells.add(el);
        }
      }
    });

    if(ok){
      const { cells } = GameCore.getCompletedLinesForPlacement(grid, SIZE, dragging.piece.shape, row, col);
      cells.forEach(({r, c}) => {
        const idx = r * SIZE + c;
        const el = boardEl.children[idx];
        if(el){
          el.classList.add('preview-line-glow');
          previewLineCells.add(el);
        }
      });
    }
  }

  let dragRAF = null;
  function onMove(e){
    if(!dragging) return;
    const coords = getPointerCoords(e);
    dragging.x = coords.x;
    dragging.y = coords.y;

    if(!dragRAF){
      dragRAF = requestAnimationFrame(()=>{
        dragRAF = null;
        if(!dragging) return;
        moveGhost(dragging.x, dragging.y);
        updatePreview(dragging.x, dragging.y);
      });
    }
  }

  function cleanupDragListeners(){
    if(dragRAF){
      cancelAnimationFrame(dragRAF);
      dragRAF = null;
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
    window.removeEventListener('touchcancel', onUp);
  }

  function cancelDrag(){
    if(!dragging) return;
    const draggedSlot = trayEl.children[dragging.idx];
    if(draggedSlot) draggedSlot.style.opacity = '';

    boardEl.classList.remove('dragging');
    clearPreview();
    ghostEl.style.display = 'none';
    cachedBoardGeometry = null;
    lastPreviewRow = null;
    lastPreviewCol = null;

    cleanupDragListeners();
    dragging = null;
  }

  window.addEventListener('blur', cancelDrag);
  window.addEventListener('contextmenu', cancelDrag);
  window.addEventListener('resize', () => {
    cachedBoardGeometry = null;
    if (dragging) cancelDrag();
  });
  window.addEventListener('orientationchange', () => {
    cachedBoardGeometry = null;
    if (dragging) cancelDrag();
  });

  function onUp(e){
    if(!dragging) return;

    const draggedSlot = trayEl.children[dragging.idx];
    if(draggedSlot) draggedSlot.style.opacity = '';

    boardEl.classList.remove('dragging');
    clearPreview();
    ghostEl.style.display = 'none';
    cachedBoardGeometry = null;
    lastPreviewRow = null;
    lastPreviewCol = null;

    cleanupDragListeners();

    const coords = getPointerCoords(e);
    const px = (dragging.x != null && dragging.x !== 0) ? dragging.x : coords.x;
    const py = (dragging.y != null && dragging.y !== 0) ? dragging.y : coords.y;
    const {row, col} = boardTargetCell(px, py);
    const ok = canPlace(dragging.piece.shape, row, col);

    const wasKeyboard = !!dragging.keyboard;
    if(ok){
      tray[dragging.idx] = null;
      placePiece(dragging.piece, row, col, ()=>{
        if(tray.every(p=>!p)) refillTray();
        render();
        checkAndTriggerGameOver(CONFIG.GAME_OVER_DELAY_AFTER_CLEAR);
      });
    } else {
      render();
    }
    dragging = null;
    // Posle keyboard spusta vrati fokus na prvi preostali komad (lančana igra tastaturom)
    if (wasKeyboard) {
      setTimeout(() => {
        const next = trayEl.querySelector('.piece-slot:not(.empty)');
        if (next) next.focus();
      }, 60);
    }
  }

  /**
   * localStorage.setItem sa eksplicitnim oporavkom na QuotaExceededError:
   * brise manje kritične ključeve (gameState, pendingScores, matchHistory) i pokušava ponovo.
   * Na kraju samo loguje — NE puca.
   */
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
        console.warn('[B&R] localStorage quota exceeded, clearing cached state');
        ['blocksrocks_gameState', 'blocksrocks_pendingScores', 'blocksrocks_matchHistory'].forEach(k => {
          if (k !== key) localStorage.removeItem(k);
        });
        try {
          localStorage.setItem(key, value);
          return;
        } catch (e2) { /* still full — give up */ }
      }
      console.warn('[B&R] localStorage write failed for', key, e && e.message);
    }
  }

  /* ═══════════════════════════════════════════════
   *  CAREER STATISTICS (Lifetime Stats Dashboard)
   * ═══════════════════════════════════════════════ */
  let careerStats = {
    gamesPlayed: 0,
    linesCleared: 0,
    bombsDefused: 0,
    rocksCrushed: 0,
    maxCombo: 1,
    totalScore: 0
  };

  function loadCareerStats(){
    try {
      const saved = JSON.parse(localStorage.getItem('blocksrocks_careerStats'));
      if (saved && typeof saved === 'object') {
        careerStats = { ...careerStats, ...saved };
      }
    } catch(e){}
  }

  function saveCareerStats() {
    safeSetItem('blocksrocks_careerStats', JSON.stringify(careerStats));
  }

  function recordCareerStat(key, increment = 1){
    loadCareerStats();
    if (key === 'maxCombo') {
      careerStats.maxCombo = Math.max(careerStats.maxCombo || 1, increment);
    } else {
      careerStats[key] = (careerStats[key] || 0) + increment;
    }
    saveCareerStats();
  }

  function renderCareerStats(){
    loadCareerStats();
    const gEl = document.getElementById('statGames');
    const lEl = document.getElementById('statLines');
    const cEl = document.getElementById('statMaxCombo');
    const bEl = document.getElementById('statBombs');
    const rEl = document.getElementById('statRocks');
    const aEl = document.getElementById('statAvgScore');

    if(gEl) gEl.textContent = (careerStats.gamesPlayed || 0).toLocaleString();
    if(lEl) lEl.textContent = (careerStats.linesCleared || 0).toLocaleString();
    if(cEl) cEl.textContent = 'x' + (careerStats.maxCombo || 1);
    if(bEl) bEl.textContent = (careerStats.bombsDefused || 0).toLocaleString();
    if(rEl) rEl.textContent = (careerStats.rocksCrushed || 0).toLocaleString();
    const avg = careerStats.gamesPlayed > 0 ? Math.round((careerStats.totalScore || 0) / careerStats.gamesPlayed) : 0;
    if(aEl) aEl.textContent = avg.toLocaleString();

    const bgEl = document.getElementById('badgesGrid');
    if(bgEl) renderBadgesGrid(bgEl, careerStats, score, best, currentLang);
  }

  /* ═══════════════════════════════════════════════
   *  MATCH HISTORY (Local Recent Matches)
   * ═══════════════════════════════════════════════ */
  function saveMatchToHistory(scoreVal, maxComboVal){
    try {
      let history = JSON.parse(localStorage.getItem('blocksrocks_matchHistory') || '[]');
      const dateStr = new Date().toLocaleDateString(currentLang === 'sr' ? 'sr-RS' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      history.unshift({
        score: scoreVal,
        maxCombo: maxComboVal || 1,
        date: dateStr,
        timestamp: Date.now()
      });
      if(history.length > 10) history = history.slice(0, 10);
      safeSetItem('blocksrocks_matchHistory', JSON.stringify(history));
    } catch(e){
      console.warn('[B&R] saveMatchToHistory failed:', e && e.message);
    }
  }

  function renderMatchHistory(){
    const listEl = document.getElementById('matchHistoryList');
    if(!listEl) return;
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('blocksrocks_matchHistory') || '[]');
    } catch(e){}
    if(!history.length){
      listEl.innerHTML = '<div style="font-size:11px; color:var(--dim); font-family:JetBrains Mono, monospace; text-align:center; padding:12px 0;">' + (t.noHistoryMsg || 'Nema odigranih partija.') + '</div>';
      return;
    }
    let html = '';
    history.forEach(item => {
      html += '<div class="match-history-item">'
        + '<div>'
        + '<span class="m-score">' + (item.score || 0).toLocaleString() + ' pts</span>'
        + (item.maxCombo > 1 ? '<span class="m-combo">🔥 x' + item.maxCombo + '</span>' : '')
        + '</div>'
        + '<span class="m-date">' + escapeHtml(item.date || '') + '</span>'
        + '</div>';
    });
    listEl.innerHTML = html;
  }

  /* ═══════════════════════════════════════════════
   *  SHARE SCORE FLOW
   * ═══════════════════════════════════════════════ */
  async function shareScore(){
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const shareTitle = "BLOCKS & ROCKS";
    const shareText = '🧱💥 BLOCKS & ROCKS — ' + (t.sub || '') + '\n🏆 ' + (t.shareScored || 'Osvojio sam') + ' ' + (score || 0).toLocaleString() + ' ' + (t.sharePoints || 'poena') + '!\n' + (comboStreak > 1 ? ('🔥 ' + (t.shareBestCombo || 'Najveći kombo: x') + comboStreak + '\n') : '') + (t.shareChallenge || 'Možeš li me stići? 🚀');

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText
        });
        haptic('success');
      } catch(err) {
        if (err.name !== 'AbortError') {
          copyScoreToClipboard(shareText);
        }
      }
    } else {
      copyScoreToClipboard(shareText);
    }
  }

  async function copyScoreToClipboard(text){
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showMsg(t.scoreCopiedMsg || '📋 Rezultat kopiran u privremenu memoriju!', 2500);
      haptic('light');
    } catch(e){
      showMsg(t.scoreCopyFailed || '❌ Nije moguće podeliti rezultat', 2000);
    }
  }

  /* ═══════════════════════════════════════════════
   *  GAME OVER HANDLER — integrates score submit, history & career stats
   * ═══════════════════════════════════════════════ */
  function handleGameOver(){
    const finalScore = score;
    const finalCombo = comboStreak;
    saveMatchToHistory(finalScore, finalCombo);
    recordCareerStat('gamesPlayed', 1);
    recordCareerStat('totalScore', finalScore);

    document.getElementById('finalscore').textContent = finalScore;
    // poredimo sa rekordom NA POČETKU partije, ne sa `best` (koji je tokom igre
    // već dopunjen do finalScore, pa bi poređenje uvek bilo lažno)
    const isNewBest = finalScore > 0 && finalScore > bestAtGameStart;
    const worldRecordScore = typeof getCachedGlobalTopScore === 'function' ? getCachedGlobalTopScore() : 0;
    const isNewWorldRecord = worldRecordScore > 0 && finalScore > worldRecordScore;

    if(isNewWorldRecord && !hasCelebratedWorldRecord){
      hasCelebratedWorldRecord = true;
      best = finalScore;
      savePersonalBest(best);
      if(bestEl) bestEl.textContent = best;
      triggerConfetti(100);
      sfxWorldRecord();
    } else if(isNewBest){
      best = finalScore;
      savePersonalBest(best);
      if(bestEl) bestEl.textContent = best;
      // Ako novi rekord već nije proslavljen tokom igre (npr. postignut poslednjim
      // čišćenjem linija koje nema vremena da se renderuje), slavimo ovde.
      if(!hasCelebratedNewBest){
        hasCelebratedNewBest = true;
        triggerConfetti(80);
        sfxNewBest();
      }
    }
    document.getElementById('newbestLabel').style.display = isNewBest ? '' : 'none';

    checkAndUnlockBadges(careerStats, finalScore, best, currentLang);
    const highestBadge = getHighestBadge(careerStats, best);
    const gob = document.getElementById('gameOverBadge');
    if (gob) {
      if (highestBadge) {
        const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
        const badgeTitle = t[`badge_${highestBadge.id}_title`] || highestBadge.id;
        gob.innerHTML = `${highestBadge.icon} <span>${escapeHtml(badgeTitle)}</span>`;
        gob.style.display = 'inline-flex';
      } else {
        gob.style.display = 'none';
      }
    }

    overlayEl.style.display = 'flex';
    sfxGameOver();
    clearGameState();
    const durationSec = Math.max(1, Math.round((Date.now() - (gameStartTime || Date.now())) / 1000));
    track('game_over', { score: finalScore, is_new_best: isNewBest, duration_sec: durationSec });

    // Submit to Firebase immediately if username exists & finalScore > 0
    if(username && finalScore > 0){
      submitScore(finalScore);
    }
  }

  /* ═══════════════════════════════════════════════
   *  GAME OVER SUBMIT & SHARE FLOW
   * ═══════════════════════════════════════════════ */
  const btnShare = document.getElementById('btnShareScore');
  if(btnShare){
    btnShare.addEventListener('click', ()=>{
      shareScore();
    });
  }

  document.getElementById('restartBtn').addEventListener('click', ()=>{
    debounceAction('restart', ()=>{
      newGame(true);
    }, CONFIG.RESTART_DEBOUNCE_MS);
  });

  // NAPOMENA: listener za #showLbBtn sada registruje js/leaderboard.js (initLeaderboard)

  /* ═══════════════════════════════════════════════
   *  PAUSE / MUTE CONTROLS
   * ═══════════════════════════════════════════════ */
  const pauseOverlay = document.getElementById('pause-overlay');
  function setPaused(v, silent){
    paused = !!v;
    // silent = pauziraj logiku (bombe staju) bez prikazivanja pause overlay-a (npr. onboarding modal)
    if (pauseOverlay) pauseOverlay.style.display = (paused && !silent) ? 'flex' : 'none';
    document.body.classList.toggle('app-paused', paused);
    if(paused) saveGameState();
  }

  document.getElementById('btnPause').addEventListener('click', ()=>{
    if(gameOver) return;
    setPaused(!paused);
  });

  document.getElementById('resumeBtn').addEventListener('click', ()=> setPaused(false));
  document.getElementById('pauseMuteBtn').addEventListener('click', toggleMute);
  document.getElementById('pauseRestartBtn').addEventListener('click', ()=>{
    debounceAction('restart', ()=>{
      setPaused(false);
      newGame(true);
    }, CONFIG.RESTART_DEBOUNCE_MS);
  });

  document.getElementById('btnMute').addEventListener('click', toggleMute);

  document.getElementById('btnRestart').addEventListener('click', ()=>{
    debounceAction('hdrRestart', ()=>{
      newGame(true);
    }, CONFIG.RESTART_DEBOUNCE_MS);
  });

  // Auto-pause and cancel drag when the app goes to the background
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden){
      cancelDrag();
      if(!gameOver && !paused) setPaused(true);
    }
  });

  // Startup: analytics + icon state
  setMuted(isMuted());
  loadAnalytics();
  trackRetention();

  // Tek sada su TRANSLATIONS / currentLang i ostali resursi sigurno inicijalizovani
  detectCountry();

  newGame();
})();
