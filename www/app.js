
import { TRANSLATIONS } from './i18n.js';
import { escapeHtml } from './js/utils.js';
import { initAudio, haptic, setMuted, toggleMute, isMuted, getHapticMode, setHapticMode,
         getAudioSettings, setAudioSetting, previewComboAudio,
         sfxPlace, sfxBomb, sfxHammer, sfxRockCrack, sfxRockBreak, sfxReroll, sfxRotate, sfxNewBest, sfxWorldRecord,
         sfxIceCrack, sfxIceBreak,
         playComboAudio, sfxGameOver, sfxBonusGem } from './js/audio.js';
import { initEffects, triggerScreenShake, triggerConfetti, showScoreFloat, showBigComboBonusCounter, showBoardActionAlert, spawnParticles,
         spawnCrackParticles, spawnShockwave, spawnSpark, spawnIceShatterParticles } from './js/effects.js';
import { initLeaderboard, updateBottomRecords, fetchMyTop3, getCachedGlobalTopScore, MAX_ENTRIES_PER_USER } from './js/leaderboard.js';
import { initAchievements, checkAndUnlockBadges, renderBadgesGrid, getHighestBadge, loadBadges } from './js/achievements.js';

/* ── PHASE 2 MODULE IMPORTS ── */
import { initUserAuth, updateGoogleLinkStatus, performGoogleSignIn, handleGoogleSignInSuccess,
         showUsernameModal, saveUsername, savePersonalBest, initUserIdentity, showFirstRunModal,
         checkAvailability, registerAndSaveUsername, bindUserAuthEvents } from './js/modules/username-auth.js';
import { initScoresSync, submitScore, syncOfflineScores, migrateLegacyScore, queueOfflineScore, capUserEntries } from './js/modules/scores-sync.js';
import { initStatsHistory, recordCareerStat, renderCareerStats, getCareerStats,
         saveMatchToHistory, renderMatchHistory } from './js/modules/stats-history.js';
import { initShareUI, showGameToast, showShareFeedback, copyScoreToClipboard,
         shareScore } from './js/modules/share-ui.js';

(function(){
  const GameCore = window.GameCore;  // Eksplicitni global import (jedina referenca van gameCore.js)
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

  // App Check DEBUG provider (samo Android/iOS native ili localhost).
  // false za production/release (Play Store) build — Play Integrity verifikacija.
  // Za lokalni debug/emulator može se aktivirati preko localStorage.getItem('blocksrocks_appcheck_debug') === '1'
  // ili ako je pokrenuto sa localhost/127.0.0.1.
  const APP_CHECK_DEBUG = (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) || (typeof localStorage !== 'undefined' && localStorage.getItem('blocksrocks_appcheck_debug') === '1');

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

      // App Check — MORA pre auth/firestore poziva da bi tokeni važili.
      // Web: reCAPTCHA v3. Android/iOS: Play Integrity (Android) / DeviceCheck (iOS)
      // preko native plugina, a web SDK (Firestore/Auth) token dobija kroz
      // CustomProvider koji poziva nativni getToken — bez reCAPTCHA iframe-a u WebView-u.
      // Napomena: backend pravila trenutno NE zahtevaju App Check (samo request.auth),
      // pa je ovo bezbedno — ako token ne uspe, igra i dalje radi.
      if (typeof firebase.appCheck === 'function') {
        try {
          const isNativeAppCheck = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
          const NativeAppCheck = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAppCheck;

          if (!isNativeAppCheck && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            // Dev mod (web): SDK ispisuje debug token u konzolu → registruj ga u
            // Firebase Console → App Check → Apps → Manage debug tokens
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
          }

          fb_appCheck = firebase.appCheck();

          if (isNativeAppCheck && NativeAppCheck && typeof NativeAppCheck.getToken === 'function'
              && typeof firebase.appCheck.CustomProvider === 'function') {
            // Nativni App Check (Play Integrity) + most za web SDK.
            if (typeof NativeAppCheck.initialize === 'function') {
              NativeAppCheck.initialize({ debug: APP_CHECK_DEBUG, isTokenAutoRefreshEnabled: true }).catch(()=>{});
            }
            const nativeProvider = new firebase.appCheck.CustomProvider({
              getToken: async () => {
                const res = await NativeAppCheck.getToken();
                return {
                  token: res.token,
                  expireTimeMillis: (typeof res.expireTimeMillis === 'number') ? res.expireTimeMillis : (Date.now() + 3600*1000)
                };
              }
            });
            fb_appCheck.activate(nativeProvider, true);
            console.log('[B&R] App Check aktivan (Play Integrity / native)');
          } else if (appCheckSiteKey) {
            // Web browser: reCAPTCHA v3
            fb_appCheck.activate(appCheckSiteKey, true); // true = automatsko osvežavanje tokena
            console.log('[B&R] App Check aktivan (reCAPTCHA v3)');
          }
        } catch(acErr) {
          console.warn('[B&R] App Check init nije uspeo — nastavljam bez njega:', acErr && acErr.message);
        }
      }

      fb_auth = firebase.auth();
      fb_db = firebase.firestore();

      const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

      if (isNativeApp || !location.search.includes('apiKey')) {
        const PlayGames = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PlayGames;
        
        if (isNativeApp && PlayGames && !fb_auth.currentUser) {
          console.log('[B&R] Pokušaj automatske Play Games prijave (Silent Sign-In)...');
          PlayGames.signIn({
            webClientId: '556570853814-42pn5174etkj86srceviqai3l701aofr.apps.googleusercontent.com'
          }).then(playGamesResult => {
            if (playGamesResult && playGamesResult.serverAuthCode) {
              if (playGamesResult.displayName) {
                localStorage.setItem('blocksrocks_pgsDisplayName', playGamesResult.displayName);
              }
              const credential = firebase.auth.PlayGamesAuthProvider.credential(playGamesResult.serverAuthCode);
              return fb_auth.signInWithCredential(credential);
            }
          }).then(() => {
            console.log('[B&R] Play Games silent sign-in uspešan!');
          }).catch(err => {
            console.warn('[B&R] Play Games silent sign-in nije uspeo, fallback na anonimno:', err);
            return fb_auth.signInAnonymously();
          }).catch(err => {
            console.warn('[B&R] Firebase Anon Auth failed:', err && err.message);
            if(!fb_userId) fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
          });
        } else if (!fb_auth.currentUser) {
          // Fallback za web ili ako PGS plugin nije dostupan
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

    // FIX (#5): paralelno ispitivanje svih servisa sa JEDNIM kratkim timeout-om (2.5s).
    // Ranije je sekvencijalni pristup (4s po servisu) mogao da blokira start do 12s+
    // na sporom netu, a pošto se IP ionako šalje tim servisima, ne čekamo redom.
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 2500) : null;
    try {
      const results = await Promise.all(apis.map(async (api) => {
        try {
          const res = await fetch(api.url, {
            headers: { 'Accept': 'application/json' },
            signal: controller ? controller.signal : undefined
          });
          if (!res.ok) return null;
          const data = await res.json();
          const code = api.parse(data);
          if (code && typeof code === 'string' && code.length === 2 && code !== 'XX') {
            return code.toUpperCase();
          }
        } catch(err) {
          // neuspešan servis — probaj sledeći
        }
        return null;
      }));
      detected = results.find(Boolean) || null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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
      const t = TRANSLATIONS[lang || currentLang] || TRANSLATIONS.en;
      return t.tabCountry || 'Država';
    }
    try {
      const langKey = lang || currentLang || 'en';
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
   *  MULTILINGUAL i18n TRANSLATIONS (sr, en, de, es, fr, ru)
   * ═══════════════════════════════════════════════ */
  // Prevodi: ES modul www/i18n.js (import na vrhu fajla)

  let currentLang = localStorage.getItem('blocksrocks_lang') || 'en';

  function applyLanguage(langCode) {
    if (!TRANSLATIONS[langCode]) langCode = 'en';
    currentLang = langCode;
    localStorage.setItem('blocksrocks_lang', langCode);
    document.documentElement.lang = langCode;

    const t = TRANSLATIONS[langCode] || TRANSLATIONS.en;

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

    setText('firstRunTitle', t.onboardingTitle);
    setText('firstRunDesc', t.onboardingDesc);
    setText('firstRunStartBtn', t.onboardingBtn);
    setText('btnLinkGoogleText', t.btnLinkGoogle);

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

    const uModal = document.getElementById('username-modal');
    const isModalOnboarding = !!(uModal && uModal.classList.contains('is-onboarding'));
    const settingsH3 = document.getElementById('settingsHeading') || (uModal ? uModal.querySelector('h3') : null);
    if (settingsH3) settingsH3.textContent = isModalOnboarding ? (t.onboardingTitle || '👋 DOBRODOŠLI!') : t.settingsTitle;

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
    const uInput = document.getElementById('usernameInput');
    if (uInput) {
      uInput.placeholder = t.usernamePlaceholder || 'VašeIme';
      uInput.setAttribute('aria-label', t.usernameLabel);
    }
    setText('usernameSaveBtn', isModalOnboarding ? (t.onboardingBtn || 'ZAPOČNI IGRU') : t.usernameSaveBtn);
    setText('btnLinkGoogleText', t.btnLinkGoogle);
    setText('i18n_langLabel', t.langLabel);
    setText('i18n_audioLabel', t.audioLabel);
    setText('i18n_masterVolLabel', t.masterVolLabel);
    setText('i18n_audioMixerToggle', t.audioMixerToggle);
    setText('i18n_comboVolLabel', t.comboVolLabel);
    setText('i18n_movesSoundLabel', t.movesSoundLabel);
    setText('i18n_movesSoundDesc', t.movesSoundDesc);
    setText('i18n_sfxVolLabel', t.sfxVolLabel);
    setText('i18n_fanfareSoundLabel', t.fanfareSoundLabel);
    setText('i18n_fanfareSoundDesc', t.fanfareSoundDesc);
    setText('pauseAudioSettingsBtn', t.pauseAudioSettings || '⚙️ PODEŠAVANJE ZVUKA');
    setText('i18n_dragOffsetLabel', t.dragOffsetLabel);
    setText('i18n_hapticLabel', t.hapticLabel);
    setText('i18n_particleTitle', t.particleTitle);
    setText('i18n_particleDesc', t.particleDesc);
    setText('i18n_reduceMotionTitle', t.reduceMotionTitle || '🧘 SMANJEN POKRET');
    setText('i18n_reduceMotionDesc', t.reduceMotionDesc || 'Smanjuje animacije i efekte');
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
    setText('i18n_legalLabel', t.legalLabel || '⚖️ PRAVILNIK & USLOVI');
    setText('i18n_privacyLink', t.privacyLink || '🔒 Politika privatnosti');
    setText('i18n_termsLink', t.termsLink || '📄 Uslovi korišćenja');

    updateDragOffsetSetting(userDragOffsetMultiplier);
    updateAudioMixerUI();
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
  // Reduce Motion: '1'/'0' = eksplicitni izbor korisnika, null = prati OS signal
  let reducedMotionOverride = (() => {
    const v = localStorage.getItem('blocksrocks_reducedMotion');
    return (v === '1' || v === '0') ? (v === '1') : null;
  })();
  function getReducedMotionEnabled(){
    if (reducedMotionOverride !== null) return reducedMotionOverride;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch(e){ return false; }
  }

  function updateDragOffsetSetting(val) {
    userDragOffsetMultiplier = parseFloat(val);
    localStorage.setItem('blocksrocks_dragOffset', val);
    const badge = document.getElementById('dragOffsetVal');
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    const badgeSuffix = t.blocksBadge || 'Kockice';
    if (badge) badge.textContent = val + 'x ' + badgeSuffix;
    const range = document.getElementById('dragOffsetRange');
    if (range) range.value = val;
  }

  function updateHapticSetting(val) {
    setHapticMode(val); // stanje + localStorage: js/audio.js
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
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

  function updateReducedMotionSetting(enabled, explicit) {
    if (explicit) {
      reducedMotionOverride = !!enabled;
      localStorage.setItem('blocksrocks_reducedMotion', reducedMotionOverride ? '1' : '0');
    }
    const on = getReducedMotionEnabled();
    document.body.classList.toggle('reduced-motion', on);
    const toggle = document.getElementById('reducedMotionToggle');
    if (toggle) toggle.checked = on;
  }

  function updateAudioMixerUI() {
    const settings = getAudioSettings();
    
    const masterSlider = document.getElementById('masterVolRange');
    const masterBadge = document.getElementById('masterVolBadge');
    if (masterSlider) masterSlider.value = settings.masterVolume;
    if (masterBadge) masterBadge.textContent = Math.round(settings.masterVolume * 100) + '%';

    const comboSlider = document.getElementById('comboVolRange');
    const comboBadge = document.getElementById('comboVolBadge');
    if (comboSlider) comboSlider.value = settings.comboVolume;
    if (comboBadge) comboBadge.textContent = Math.round(settings.comboVolume * 100) + '%';

    const sfxSlider = document.getElementById('sfxVolRange');
    const sfxBadge = document.getElementById('sfxVolBadge');
    if (sfxSlider) sfxSlider.value = settings.sfxVolume;
    if (sfxBadge) sfxBadge.textContent = Math.round(settings.sfxVolume * 100) + '%';

    const movesToggle = document.getElementById('movesSoundToggle');
    if (movesToggle) movesToggle.checked = !!settings.movesEnabled;

    const fanfareToggle = document.getElementById('fanfareSoundToggle');
    if (fanfareToggle) fanfareToggle.checked = !!settings.fanfareEnabled;
  }

  function initSettingsUI() {
    applyLanguage(currentLang);
    updateDragOffsetSetting(userDragOffsetMultiplier);
    updateAudioMixerUI();
    updateHapticSetting(getHapticMode());
    updateHighContrastSetting(highContrastMode);
    updateParticleSetting(particleTrailEnabled);
    updateReducedMotionSetting(getReducedMotionEnabled(), false);
    renderCareerStats();
  }

  // Initialize Language and High Contrast on load right away
  applyLanguage(currentLang);
  updateHighContrastSetting(highContrastMode);
  updateReducedMotionSetting(getReducedMotionEnabled(), false);

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

  // Reduce Motion toggle switch
  const rmToggle = document.getElementById('reducedMotionToggle');
  if (rmToggle) {
    rmToggle.addEventListener('change', (e) => {
      updateReducedMotionSetting(e.target.checked, true);
      haptic('light');
    });
  }

  // Prati promenu OS podešavanja (prefers-reduced-motion) ako korisnik nije eksplicitno izabrao
  try {
    const _rmMq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (_rmMq && _rmMq.addEventListener) {
      _rmMq.addEventListener('change', () => {
        if (reducedMotionOverride === null) updateReducedMotionSetting(getReducedMotionEnabled(), false);
      });
    }
  } catch(e){}

  /* ═══════════════════════════════════════════════
   *  AUDIO MIXER & SOUND CONTROLS
   * ═══════════════════════════════════════════════ */
  // Audio Mixer Accordion Toggle
  const toggleMixerBtn = document.getElementById('toggleAudioMixerBtn');
  const mixerPanel = document.getElementById('audioMixerPanel');
  if (toggleMixerBtn && mixerPanel) {
    toggleMixerBtn.addEventListener('click', () => {
      const isOpen = mixerPanel.style.display !== 'none';
      mixerPanel.style.display = isOpen ? 'none' : 'block';
      toggleMixerBtn.classList.toggle('open', !isOpen);
      toggleMixerBtn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
      haptic('light');
    });
  }

  // Master Volume Slider
  const masterSlider = document.getElementById('masterVolRange');
  if (masterSlider) {
    masterSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      setAudioSetting('masterVolume', val);
      const badge = document.getElementById('masterVolBadge');
      if (badge) badge.textContent = Math.round(val * 100) + '%';
      if (isMuted() && val > 0) setMuted(false);
    });
    masterSlider.addEventListener('change', () => {
      haptic('light');
    });
  }

  // Combo Volume Slider
  const comboSlider = document.getElementById('comboVolRange');
  if (comboSlider) {
    comboSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      setAudioSetting('comboVolume', val);
      const badge = document.getElementById('comboVolBadge');
      if (badge) badge.textContent = Math.round(val * 100) + '%';
    });
    comboSlider.addEventListener('change', () => {
      previewComboAudio();
      haptic('light');
    });
  }

  // Special SFX Volume Slider
  const sfxSlider = document.getElementById('sfxVolRange');
  if (sfxSlider) {
    sfxSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      setAudioSetting('sfxVolume', val);
      const badge = document.getElementById('sfxVolBadge');
      if (badge) badge.textContent = Math.round(val * 100) + '%';
    });
    sfxSlider.addEventListener('change', () => {
      sfxHammer();
      haptic('medium');
    });
  }

  // Moves Sound Toggle (Placement & Rotation)
  const movesToggle = document.getElementById('movesSoundToggle');
  if (movesToggle) {
    movesToggle.addEventListener('change', (e) => {
      setAudioSetting('movesEnabled', e.target.checked);
      if (e.target.checked) sfxRotate();
      haptic('light');
    });
  }

  // Fanfare Sound Toggle
  const fanfareToggle = document.getElementById('fanfareSoundToggle');
  if (fanfareToggle) {
    fanfareToggle.addEventListener('change', (e) => {
      setAudioSetting('fanfareEnabled', e.target.checked);
      haptic('light');
    });
  }

  // Pause Audio Settings button
  const pauseAudioBtn = document.getElementById('pauseAudioSettingsBtn');
  if (pauseAudioBtn) {
    pauseAudioBtn.addEventListener('click', () => {
      showUsernameModal(() => {}, false);
      const mPanel = document.getElementById('audioMixerPanel');
      const tMixerBtn = document.getElementById('toggleAudioMixerBtn');
      if (mPanel) mPanel.style.display = 'block';
      if (tMixerBtn) {
        tMixerBtn.classList.add('open');
        tMixerBtn.setAttribute('aria-expanded', 'true');
      }
      setTimeout(() => {
        const audioSection = document.getElementById('audioSettingsSection');
        if (audioSection) audioSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    });
  }


  /* ═══════════════════════════════════════════════
   *  GAME CORE
   * ═══════════════════════════════════════════════ */
  const { SIZE, COLORS, SHAPES } = GameCore;

  // ── Centralised config ──
  const CONFIG = {
    LINE_CLEAR_STAGGER: 35,
    MSG_DURATION_TIP: 2500,
    MSG_DURATION_CLEAR: 2000,
    MSG_DURATION_COMBO: 2500,
    GAME_OVER_DELAY_AFTER_CLEAR: 900,
    GAME_OVER_DELAY_AFTER_BOMB: 300,
    CLEAR_ANIM_DURATION: 320,
    RESTART_DEBOUNCE_MS: 1200,
  };

  let grid, tray, score, best, dragging, gameOver, pieceCounter, bombCounter, nextBombAt;
  let comboStreak = 0;
  let hammersCount = 0;
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
  let stuckHintShown = false;

  const boardEl = document.getElementById('board');
  const trayEl = document.getElementById('tray');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const msgEl = document.getElementById('msg');
  const ghostEl = document.getElementById('dragghost');
  const overlayEl = document.getElementById('overlay');

  // Object Pool za Ghost (fiksna struktura 5x5)
  const ghostCells = [];
  if (ghostEl) {
    ghostEl.innerHTML = '';
    for(let i=0; i<25; i++){
      const cell = document.createElement('div');
      cell.style.display = 'none';
      ghostEl.appendChild(cell);
      ghostCells.push(cell);
    }
  }

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
  initAudio({ getT: () => TRANSLATIONS[currentLang] || TRANSLATIONS.en });
  initAchievements({ GameCore });
  initEffects({ CONFIG, SIZE, boardEl, scoreEl,
                getGrid: () => grid,
                getParticleTrailEnabled: () => particleTrailEnabled,
                getReducedMotionEnabled });
  initLeaderboard({
    haptic, debounceAction, CONFIG,
    countryFlag, getFullCountryName, guessCountryFromDevice,
    GameCore,
    getFirebase: () => ({ fb_app, fb_appCheck, fb_auth, fb_db, fb_userId, firebaseReady }),
    getUsername: () => username,
    getCountryCode: () => countryCode,
    getCurrentLang: () => currentLang,
    getPersonalBest: () => personalBest,
    savePersonalBest,
    setBest: (v) => { best = v; if (bestEl) bestEl.textContent = best; },
    getGameOver: () => gameOver,
    overlayEl,
  });

  const authDeps = {
    getFirebase: () => ({ fb_app, fb_appCheck, fb_auth, fb_db, fb_userId, firebaseReady }),
    get username() { return username; },
    set username(v) { username = v; },
    get personalBest() { return personalBest; },
    set personalBest(v) { personalBest = v; },
    get best() { return best; },
    set best(v) { best = v; if (bestEl) bestEl.textContent = best; },
    bestEl,
    get countryCode() { return countryCode; },
    get currentLang() { return currentLang; },
    guessCountryFromDevice,
    setPaused,
    showMsg,
    haptic,
    track,
    fetchMyTop3,
    updateBottomRecords,
    initSettingsUI,
    submitScore,
    GameCore
  };
  initUserAuth(authDeps);
  bindUserAuthEvents();

  const scoresDeps = {
    getFirebase: () => ({ fb_app, fb_appCheck, fb_auth, fb_db, fb_userId, firebaseReady }),
    getUsername: () => username,
    getCountryCode: () => countryCode,
    getPersonalBest: () => personalBest,
    getCurrentLang: () => currentLang,
    get username() { return username; },
    get countryCode() { return countryCode; },
    get personalBest() { return personalBest; },
    get currentLang() { return currentLang; },
    get best() { return best; },
    set best(v) { best = v; if (bestEl) bestEl.textContent = best; },
    bestEl,
    guessCountryFromDevice,
    savePersonalBest,
    showMsg,
    track,
    updateBottomRecords,
    GameCore
  };
  initScoresSync(scoresDeps);

  const statsDeps = {
    get currentLang() { return currentLang; },
    get score() { return score; },
    get best() { return best; },
    safeSetItem,
    renderBadgesGrid
  };
  initStatsHistory(statsDeps);

  let lastGameOverScore = 0;
  let lastGameOverCombo = 0;

  const shareDeps = {
    get currentLang() { return currentLang; },
    get lastGameOverScore() { return lastGameOverScore; },
    get lastGameOverCombo() { return lastGameOverCombo; },
    get score() { return score; },
    get comboStreak() { return comboStreak; },
    showMsg,
    haptic,
    GameCore
  };
  initShareUI(shareDeps);


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
      if (comboPillText) comboPillText.textContent = (TRANSLATIONS[currentLang] || TRANSLATIONS.en).msgCombo + comboStreak;
    }
  }

  // ── Power-up nagrade: poziva se posle SVAKE promene skora ──
  // (ranije: samo u clearLines → pragovi pređeni golim postavljanjem/bombom su se gubili)
  function grantPowerupRewards(prevScore, newScore, msgDelay){
    const rewards = GameCore.calculatePowerupRewards(prevScore, newScore);
    if(rewards.hammersEarned <= 0 && rewards.rerollsEarned <= 0) return;
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    const delay = msgDelay || 0;

    const maxR = GameCore.MAX_REROLLS || 2;
    if(rewards.rerollsEarned > 0){
      if(rerollsCount < maxR){
        rerollsCount = Math.min(maxR, rerollsCount + rewards.rerollsEarned);
        setTimeout(() => showMsg(t.puRewardReroll || '🎲 Nova zamena osvojena! (+1)', 2200), delay);
      } else {
        const overflow = (GameCore.POWERUP_OVERFLOW_POINTS || 500) * rewards.rerollsEarned;
        score += overflow;
        showScoreFloat(overflow);
        setTimeout(() => showMsg(t.puRerollCapped || '🎲 Zamene pune (max 2)! +500 PTS', 2200), delay);
      }
    }
    updatePowerupUI();
  }

  function setHammerActive(active){
    isHammerActive = !!active;
    if (boardEl) boardEl.classList.toggle('hammer-mode', isHammerActive);
    updatePowerupUI();
  }

  if (btnHammer) {
    btnHammer.addEventListener('click', ()=>{
      if (gameOver || paused || lineClearInProgress) return;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
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
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
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
      stuckHintShown = false;
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
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      const tipsList = (t && t.tips) || TIPS;
      msgEl.textContent = tipsList[Math.floor(Math.random()*tipsList.length)];
    }, dur);
  }

  /* ═══════════════════════════════════════════════
   *  GAME STATE PERSISTENCE
   * ═══════════════════════════════════════════════ */
  let saveGameTimeout = null;
  function saveGameStateSync(){
    if(gameOver) { localStorage.removeItem('blocksrocks_gameState'); return; }
    try {
      // Pulse-bonus stanje se čuva da kocka ne bi bila "zamrznuta" posle re-load-a
      const pulse = (pulseBonusState.r >= 0) ? {
        r: pulseBonusState.r,
        c: pulseBonusState.c,
        timer: pulseBonusState.timer,
      } : null;
      const frost = (frostHazardState.r >= 0) ? {
        r: frostHazardState.r,
        c: frostHazardState.c,
        timer: frostHazardState.timer,
      } : null;
      const state = { grid, tray, score, comboStreak, hammersCount, rerollsCount, pieceCounter, bombCounter, nextBombAt, pulse, frost };
      localStorage.setItem('blocksrocks_gameState', JSON.stringify(state));
    } catch(e){
      if(e.name === 'QuotaExceededError' || e.code === 22){
        console.warn('[B&R] localStorage quota exceeded — clearing save');
        localStorage.removeItem('blocksrocks_gameState');
      }
    }
  }

  function saveGameState(){
    if (document.hidden) {
      if (saveGameTimeout) clearTimeout(saveGameTimeout);
      saveGameStateSync();
      return;
    }
    if (saveGameTimeout) clearTimeout(saveGameTimeout);
    saveGameTimeout = setTimeout(saveGameStateSync, 500);
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
      stuckHintShown = false;
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
        hammersCount = typeof saved.hammersCount === 'number' ? saved.hammersCount : 0;
        rerollsCount = typeof saved.rerollsCount === 'number' ? saved.rerollsCount : 1;
        pieceCounter = saved.pieceCounter || 0;
        bombCounter = saved.bombCounter || 0;
        nextBombAt = saved.nextBombAt || GameCore.getBombInterval(score);
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
          hammersCount = 0;
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
        hammersCount = 0;
        rerollsCount = 1;
        setHammerActive(false);
        gameOver = false;
        dragging = null;
        pieceCounter = 0;
        bombCounter = 0;
        nextBombAt = GameCore.getBombInterval(0);
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
      clearFrostHazard();

      // Ako je sačuvana igra imala aktivnu puls-bonus kocku, nastavi odbrojavanje
      const savedPulse = saved && saved.pulse;
      if(savedPulse && savedPulse.r >= 0
          && grid && grid[savedPulse.r] && grid[savedPulse.r][savedPulse.c]
          && grid[savedPulse.r][savedPulse.c].isPulseBonus){
        pulseBonusState.r = savedPulse.r;
        pulseBonusState.c = savedPulse.c;
        pulseBonusState.timer = (typeof savedPulse.timer === 'number' && savedPulse.timer > 0)
          ? savedPulse.timer
          : (grid[savedPulse.r][savedPulse.c].pulseTimer || (GameCore.PULSE_BONUS_DURATION_SEC || 10));
        grid[savedPulse.r][savedPulse.c].pulseTimer = pulseBonusState.timer;
        startPulseCountdownInterval();
      } else {
        scheduleNextPulseBonus();
      }

      // Ako je sačuvana igra imala aktivnu frost-hazard kocku, nastavi odbrojavanje
      const savedFrost = saved && saved.frost;
      if(savedFrost && savedFrost.r >= 0
          && grid && grid[savedFrost.r] && grid[savedFrost.r][savedFrost.c]
          && grid[savedFrost.r][savedFrost.c].isIceHazard){
        frostHazardState.r = savedFrost.r;
        frostHazardState.c = savedFrost.c;
        frostHazardState.timer = (typeof savedFrost.timer === 'number' && savedFrost.timer > 0)
          ? savedFrost.timer
          : (grid[savedFrost.r][savedFrost.c].frostTimer || (GameCore.FROST_HAZARD_MOVES || 5));
        grid[savedFrost.r][savedFrost.c].frostTimer = frostHazardState.timer;
      }

      updatePowerupUI();

      lastFrostHazardMilestone = (GameCore.getFrostHazardMilestone) ? GameCore.getFrostHazardMilestone(score) : -1;
      lastFibonacciMilestoneIndex = GameCore.getFibonacciRockMilestone(score);

      track('game_start', { from_save: !!saved });
      render();
      overlayEl.style.display = 'none';
      document.getElementById('newbestLabel').style.display = 'none';
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      msgEl.textContent = (t.tips && t.tips[0]) || t.msgDefault;

      if(!saved){
        if(typeof syncOfflineScores === 'function') syncOfflineScores();
        if(typeof updateBottomRecords === 'function') updateBottomRecords(true);
      }
    } catch(err) {
      console.error('[B&R] Error in newGame, starting clean game:', err);
      clearGameState();
      grid = GameCore.makeGrid(SIZE);
      tray = [null, null, null];
      refillTray();
      score = 0;
      comboStreak = 0;
      hammersCount = 0;
      rerollsCount = 1;
      setHammerActive(false);
      updatePowerupUI();
      gameOver = false;
      dragging = null;
      hasCelebratedNewBest = false;
      hasCelebratedWorldRecord = false;
      lastFrostHazardMilestone = (GameCore.getFrostHazardMilestone) ? GameCore.getFrostHazardMilestone(score) : -1;
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
        setTimeout(() => {
          sfxRockCrack();
          triggerScreenShake('light');
        }, 500);
        const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
        const msgTpl = t.msgFibonacciRockSpawn || '🪨 STENA NA TABLI! (%s PTS)';
        showMsg(msgTpl.replace('%s', threshold.toLocaleString()), 2500);
        render();
      }
    }
  }

  let lastFrostHazardMilestone = -1;
  let frostHazardState = {
    r: -1,
    c: -1,
    timer: 0,
    intervalId: null
  };

  function tickFrostHazardOnMove(){
    if(paused || gameOver || lineClearInProgress) return;
    if(frostHazardState.r === -1 || !grid || !grid[frostHazardState.r] || !grid[frostHazardState.r][frostHazardState.c]) {
      clearFrostHazard();
      return;
    }
    const cellData = grid[frostHazardState.r][frostHazardState.c];
    if(!cellData || !cellData.isIceHazard){
      clearFrostHazard();
      return;
    }

    frostHazardState.timer = Math.max(0, (cellData.frostTimer != null ? cellData.frostTimer : frostHazardState.timer) - 1);
    cellData.frostTimer = frostHazardState.timer;

    if(frostHazardState.timer <= 1 && frostHazardState.timer > 0){
      sfxIceCrack();
      haptic('light');
    }

    if(frostHazardState.timer <= 0){
      detonateFrostHazard(frostHazardState.r, frostHazardState.c);
    } else {
      render();
    }
  }

  function clearFrostHazard(){
    frostHazardState.r = -1;
    frostHazardState.c = -1;
    frostHazardState.timer = 0;
  }

  function detonateFrostHazard(r, c){
    clearFrostHazard();
    if(!grid || !grid[r] || !grid[r][c]) return;

    // Primenjujemo Frost Freeze na kocke duž dijagonala
    const frozenCells = (GameCore.applyFrostFreeze) ? GameCore.applyFrostFreeze(grid, SIZE, r, c) : [];

    // Kocka leda na toj poziciji puca i oslobađa polje
    grid[r][c] = null;

    sfxIceCrack();
    triggerScreenShake('heavy');
    spawnIceShatterParticles(r, c);

    showBoardActionAlert('FROST<br>FREEZE', 'frost');
    haptic('heavy');

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    if(frozenCells.length > 0){
      showMsg(t.msgFrostFreezeTriggered || '❄️ MRAZ! Kocke ukoso su zamrznute (+1 HP)!', 3500);
      frozenCells.forEach(pos => {
        spawnIceShatterParticles(pos.r, pos.c);
      });
    } else {
      showMsg(t.msgFrostFreezeEmpty || '❄️ MRAZ JE DETONIRAO! (Nema kocki ukoso)', 2500);
    }

    render();
    saveGameState();
  }

  function checkMilestones(currentScore){
    const reached = (GameCore.getFrostHazardMilestone) ? GameCore.getFrostHazardMilestone(currentScore) : -1;
    if(reached > lastFrostHazardMilestone){
      lastFrostHazardMilestone = reached;
      const freeCell = GameCore.findRandomFreeCell(grid, SIZE);
      if(freeCell){
        const duration = GameCore.FROST_HAZARD_MOVES || 5;
        grid[freeCell.r][freeCell.c] = {
          color: '#38bdf8',
          hp: 1,
          maxHp: 1,
          isIceHazard: true,
          frostTimer: duration
        };
        frostHazardState.r = freeCell.r;
        frostHazardState.c = freeCell.c;
        frostHazardState.timer = duration;

        sfxIceCrack();
        triggerScreenShake('light');
        showBoardActionAlert('FROST CUBE<br>ACTIVE', 'frost');
        const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
        showMsg(t.msgFrostSpawn || '❄️ LEDENA KOCKA! Uništi je za 5 poteza pre nego što zamrzne tablu!', 3500);
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

  function createPieceFromShapeIndex(shapeIdx){
    pieceCounter++;
    bombCounter++;
    const shape = SHAPES[shapeIdx] || SHAPES[0];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    const rockInterval = GameCore.getRockInterval(score);
    let stoneIndices = [];
    if (pieceCounter % rockInterval === 0) {
      const rockCount = (GameCore.getRockCountForPiece) ? GameCore.getRockCountForPiece(score, shape.length) : 1;
      const available = Array.from({length: shape.length}, (_, i) => i);
      for (let k = 0; k < rockCount && available.length > 0; k++) {
        const pickIdx = Math.floor(Math.random() * available.length);
        stoneIndices.push(available.splice(pickIdx, 1)[0]);
      }
    }
    let stoneIndex = stoneIndices.length > 0 ? stoneIndices[0] : null;
    let stoneMaxHp = stoneIndex !== null ? GameCore.getRockMaxHp(score) : 1;
    let bombIndex = null;
    let bombInitialTimer = GameCore.getBombInitialTimer(score);

    if(bombCounter >= nextBombAt){
      bombIndex = Math.floor(Math.random() * shape.length);
      stoneIndices = stoneIndices.filter(i => i !== bombIndex);
      stoneIndex = stoneIndices.length > 0 ? stoneIndices[0] : null;
      bombInitialTimer = GameCore.getBombInitialTimer(score);
      bombCounter = 0;
      nextBombAt = GameCore.getBombInterval(score);
    }

    const isLockedRotation = (GameCore.getIsPieceRotationLocked)
      ? GameCore.getIsPieceRotationLocked(score)
      : false;

    return {
      shape,
      color,
      stoneIndex,
      stoneIndices,
      stoneMaxHp,
      bombIndex,
      bombInitialTimer,
      isLockedRotation,
      id: Math.random().toString(36).slice(2)
    };
  }

  function randomPiece(){
    const shapeIdx = (GameCore.getWeightedRandomShapeIndex)
      ? GameCore.getWeightedRandomShapeIndex(score)
      : Math.floor(Math.random() * SHAPES.length);
    return createPieceFromShapeIndex(shapeIdx);
  }

  function refillTray(){
    if(!tray || !Array.isArray(tray)) tray = [null, null, null];
    const emptyCount = tray.filter(p => !p).length;

    if (emptyCount === 3 && GameCore.generateSmartTrayShapeIndices) {
      // Potpuno punjenje fioke (3 nova komada): koristi Smart Controlled Random po svetskom standardu
      const shapeIndices = GameCore.generateSmartTrayShapeIndices(grid, SIZE, score);
      for (let i = 0; i < 3; i++) {
        tray[i] = createPieceFromShapeIndex(shapeIndices[i]);
      }
    } else {
      for(let i=0;i<tray.length;i++){
        if(!tray[i]) tray[i] = randomPiece();
      }
    }
  }

  function ensureTrayNotEmpty(){
    if(gameOver) return;
    if(!tray || !Array.isArray(tray) || tray.every(p => !p)){
      if(!tray || !Array.isArray(tray)) tray = [null, null, null];
      refillTray();
      saveGameState();
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
    ensureTrayNotEmpty();
    // Game over only when no tray pieces can be placed in any rotation AND no hammers/rerolls available
    return GameCore.isGameOverOn(grid, SIZE, tray, hammersCount, rerollsCount);
  }

  function checkAndTriggerGameOver(delay = CONFIG.GAME_OVER_DELAY_AFTER_CLEAR){
    if(lineClearInProgress) return false;
    const isStuck = checkGameOver();
    // FIX: bomba ne sme zauvek da blokira kraj igre. Bombe odbrojavaju samo na potez
    // (tickBombsOnMove), pa ako igrač NEMA nijedan moguć potez (nema postavljanje,
    // nema čekić, nema zameru), bomba se više nikada ne može deaktivirati — tada je
    // game over jedina ispravna odluka (inače igra ostaje večno zaglavljena).
    if(hasActiveBombs() && !isStuck) return false;
    if(isStuck){
      gameOver = true;
      if (gameOverTimer) clearTimeout(gameOverTimer);
      gameOverTimer = setTimeout(()=>{ gameOverTimer = null; handleGameOver(); }, delay);
      return true;
    }
    // Nije (još) game over, ali trenutni komadi se nigde ne uklapaju i igrač ima
    // čekić/zameru — daj jasan hint umesto tihog čekanja.
    showStuckHintIfAny();
    return false;
  }

  /**
   * Ako trenutni komadi u fioci nemaju nijedno mesto na tabli, a igrač i dalje ima
   * čekić ili zameru, prikaži poruku (jednom po "zaglavljenoj sesiji").
   */
  function isStuckWithPowerups(){
    if(gameOver || paused) return false;
    if((hammersCount <= 0) && (rerollsCount <= 0)) return false;
    return !GameCore.trayAnyPlacementOn(grid, SIZE, tray);
  }
  function showStuckHintIfAny(){
    if(!isStuckWithPowerups() || stuckHintShown) return;
    stuckHintShown = true;
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    showMsg(t.msgStuckHint || '🧩 Komadi se ne uklapaju — iskoristi čekić ili zameru da nastaviš!', CONFIG.MSG_DURATION_TIP);
    haptic('light');
  }

  async function placePiece(piece, row, col){
    let bombPos = null;
    const placedIndices = [];
    piece.shape.forEach(([r,c], i)=>{
      const isStone = (piece.stoneIndices && piece.stoneIndices.includes(i)) || piece.stoneIndex === i;
      const isBomb = piece.bombIndex === i;
      const sHp = isStone ? (piece.stoneMaxHp || 2) : 1;
      const bTimer = isBomb ? (piece.bombInitialTimer || 4) : undefined;
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
    checkAndUnlockBadges(getCareerStats(), score, best, currentLang);
    let willClear = false;
    for(let r=0; r<SIZE; r++){ if(grid[r].every(v=>v)) { willClear = true; break; } }
    if(!willClear){
      for(let c=0; c<SIZE; c++){ if(grid.every(row=>row[c])) { willClear = true; break; } }
    }
    if(!willClear) sfxPlace();
    render();
    
    requestAnimationFrame(() => {
      placedIndices.forEach(idx => {
        const el = boardEl.children[idx];
        if (el) el.classList.add('pop-in');
      });
      setTimeout(() => {
        requestAnimationFrame(() => {
          placedIndices.forEach(idx => {
            const el = boardEl.children[idx];
            if (el) el.classList.remove('pop-in');
          });
        });
      }, 280);
    });

    // Prvo čistimo linije (i defusujemo bombe u njima pre nego što bilo šta eksplodira).
    await clearLines();

    // 1. Odbrojavamo preostale bombe koje su postojale pre ovog poteza i NISU bile očišćene
    tickBombsOnMove(bombPos);
    tickFrostHazardOnMove();

    // 2. Ako je na tablu u ovom potezu spuštena nova bomba i nije očišćena u istom potezu, pokrećemo njen tajmer
    if(bombPos && grid[bombPos.r] && grid[bombPos.r][bombPos.c] && grid[bombPos.r][bombPos.c].bomb) {
      startBombCountdown(bombPos.r, bombPos.c);
      showBoardActionAlert('BOMB PLACED', 'bomb');
    }

    // 3. Osveži tablu i sačuvaj konačno stanje nakon poteza
    render();
    saveGameState();
  }

  /* ═══════════════════════════════════════════════
   *  PULSE BONUS CUBE (Every 2-3 min, 10s duration, +250 bonus pts)
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
        if(d && !d.bomb && !d.isIceHazard && !d.isFrozen && (!d.maxHp || d.maxHp <= 1)) {
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

  function startPulseCountdownInterval(){
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

  function startPulseBonusAt(r, c){
    const cellData = grid && grid[r] ? grid[r][c] : null;
    if(!cellData) return;
    cellData.isPulseBonus = true;
    cellData.pulseTimer = GameCore.PULSE_BONUS_DURATION_SEC || 10;
    pulseBonusState.r = r;
    pulseBonusState.c = c;
    pulseBonusState.timer = cellData.pulseTimer;

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    const pts = GameCore.PULSE_BONUS_POINTS || 250;
    const msgSpawn = t.msgPulseBonusSpawn || ('✨ Zlatna kocka pulsira! Razbij je za +' + pts + '!');
    showMsg(String(msgSpawn).replace('%s', pts), 3000);
    showBoardActionAlert('GOLDEN CUBE<br>ACTIVE', 'gold');
    haptic('medium');
    sfxBonusGem();
    render();

    startPulseCountdownInterval();
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
    if(grid){
      for(let r=0; r<SIZE; r++){
        for(let c=0; c<SIZE; c++){
          const d = grid[r] ? grid[r][c] : null;
          if(d && d.isPulseBonus){
            delete d.isPulseBonus;
            delete d.pulseTimer;
          }
        }
      }
    }
    pulseBonusState.r = -1;
    pulseBonusState.c = -1;
    pulseBonusState.timer = 0;
    render();
    scheduleNextPulseBonus();
  }

  function checkAndCollectPulseBonus(r, c){
    const d = (grid && grid[r]) ? grid[r][c] : null;
    const isPulseMatch = (pulseBonusState.r === r && pulseBonusState.c === c) || (d && d.isPulseBonus);
    if(isPulseMatch){
      const pts = GameCore.PULSE_BONUS_POINTS || 250;
      score += pts;
      showScoreFloat(pts);
      sfxBonusGem();
      haptic('success');
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      const msgClaimed = t.msgPulseBonusClaimed || ('🌟 +' + pts + ' BONUS OSVOJEN!');
      showMsg(String(msgClaimed).replace('%s', pts), 2500);
      endPulseBonus(true);
      return true;
    }
    return false;
  }

  const bombTickers = new Map(); // key "r_c" -> {r,c}

  function resetBombTickers(){
    bombTickers.clear();
    checkBombCriticalState();
  }

  function checkBombCriticalState(){
    let hasCritical = false;
    if (bombTickers && bombTickers.size > 0 && grid) {
      for (const pos of bombTickers.values()) {
        const d = (grid[pos.r]) ? grid[pos.r][pos.c] : null;
        if (d && d.bomb && d.timer <= 1) {
          hasCritical = true;
          break;
        }
      }
    }
    if (boardEl) {
      boardEl.classList.toggle('board-critical-bomb', hasCritical);
    }
  }

  function tickBombsOnMove(newlyPlacedBombPos){
    if(paused || gameOver || lineClearInProgress) return;

    const toExplode = [];
    for(let r=0; r<SIZE; r++){
      for(let c=0; c<SIZE; c++){
        const d = (grid && grid[r]) ? grid[r][c] : null;
        if(!d || !d.bomb) continue;
        // Ako je bomba tek spuštena u ovom potezu, njen tajmer počinje da kuca od sledećeg poteza
        if(newlyPlacedBombPos && newlyPlacedBombPos.r === r && newlyPlacedBombPos.c === c){
          continue;
        }
        if(typeof d.timer !== 'number') {
          d.timer = d.initialTimer || GameCore.getBombInitialTimer(score) || 3;
        }
        if(d.timer > 1){
          d.timer -= 1;
        } else {
          toExplode.push({r, c});
        }
      }
    }

    // Ažuriraj bombTickers mapu i vizuelni prikaz za sve preostale bombe
    bombTickers.clear();
    for(let r=0; r<SIZE; r++){
      for(let c=0; c<SIZE; c++){
        const d = (grid && grid[r]) ? grid[r][c] : null;
        if(d && d.bomb && !toExplode.some(p => p.r === r && p.c === c)){
          bombTickers.set(r+'_'+c, {r, c});
          updateBombVisual(r, c);
        }
      }
    }

    checkBombCriticalState();

    if(toExplode.length > 0){
      explodeBombs(toExplode);
    }
  }

  function startBombCountdown(r,c){
    const cellData = (grid && grid[r]) ? grid[r][c] : null;
    if(!cellData || !cellData.bomb) return;
    bombTickers.set(r+'_'+c, {r, c});
    updateBombVisual(r,c);
    checkBombCriticalState();
  }

  function updateBombVisual(r,c){
    const idx = r*SIZE+c;
    const el = (cellElements && cellElements[idx]) || (boardEl && boardEl.children[idx]);
    if(!el) return;
    const d = (grid && grid[r]) ? grid[r][c] : null;
    if(!d || !d.bomb) return;
    el.classList.toggle('critical', d.timer <= 1);
    const meta = cellsMeta.get(el);
    let label = (meta && meta.bombLabel) || el.querySelector('.bomb-label');
    if(!label){
      label = document.createElement('div');
      label.className = 'bomb-label';
      el.appendChild(label);
      if(meta) meta.bombLabel = label;
    }
    label.textContent = d.timer;
    label.classList.toggle('critical-num', d.timer <= 1);
    label.classList.remove('pop');
    void label.offsetWidth;
    label.classList.add('pop');
    checkBombCriticalState();
  }

  function explodeBombs(bombPositions){
    if(!bombPositions || bombPositions.length === 0) return;

    lineClearInProgress = true;
    sfxBomb();
    triggerScreenShake('heavy');
    comboStreak = 0; // Prekida se kombo niz
    updatePowerupUI();

    let allAffected = [];
    let totalSpawnedRocks = 0;

    bombPositions.forEach(pos => {
      spawnShockwave(pos.r, pos.c);
      // Opcija A: primena hazarda — stvaranje kamenja i ruševina
      const { affectedCells, spawnedRocksCount } = (GameCore.applyBombExplosionHazard)
        ? GameCore.applyBombExplosionHazard(grid, SIZE, pos.r, pos.c)
        : { affectedCells: [], spawnedRocksCount: 0 };
      allAffected = allAffected.concat(affectedCells);
      totalSpawnedRocks += spawnedRocksCount;
    });

    // Animacija nastanka ruševina/kamenja
    allAffected.forEach((pos, i)=>{
      setTimeout(()=>{
        const idx = pos.r*SIZE + pos.c;
        const el = boardEl.children[idx];
        if(el){
          el.classList.add('pop-in');
          setTimeout(() => el.classList.remove('pop-in'), 280);
        }
        spawnParticles([pos.r+'_'+pos.c], '#64748b');
      }, i * 25);
    });

    const totalAnimTime = Math.max(300, allAffected.length * 25 + 200);
    setTimeout(()=>{
      lineClearInProgress = false;
      render();
      ensureTrayNotEmpty();
      checkAndTriggerGameOver(CONFIG.GAME_OVER_DELAY_AFTER_BOMB);
    }, totalAnimTime);

    const tBomb = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    showMsg(tBomb.msgBombExplodedHazard || '💣 BOMBA JE EKSPLODIRALA! Nastao je kamen i ruševine!', 3500);
    track('bomb_explode_hazard', { spawnedRocks: totalSpawnedRocks });
  }

  function explodeBomb(r,c){
    explodeBombs([{r, c}]);
  }

  /**
   * Zajednička asinhrona animacija za uklanjanje ćelija sa staggerom.
   * Postavlja vizual (clearing klasa, bomb label cleanup, particles),
   * zatim nakon totalDelay čisti grid i vraća Promise.
   *
   * @param {Array<{r:number, c:number, willRemove:boolean}>} cells — ćelije za animaciju
   * @param {number} stagger — kašnjenje po ćeliji (ms)
   * @param {number} animDuration — vreme dodatnog čekanja posle poslednje ćelije (ms)
   * @returns {Promise<void>}
   */
  function animateStaggeredCellRemoval(cells, stagger, animDuration){
    // Odmah prikupi puls bonus sa bilo koje ćelije koja se nalazi u očišćenoj liniji
    cells.forEach(pos => {
      checkAndCollectPulseBonus(pos.r, pos.c);
    });

    return new Promise(resolve => {
      let startTimestamp = null;
      let nextCellIndex = 0;

      function step(timestamp) {
        if (!startTimestamp) startTimestamp = timestamp;
        const elapsed = timestamp - startTimestamp;

        while (nextCellIndex < cells.length && elapsed >= nextCellIndex * stagger) {
          const pos = cells[nextCellIndex];
          const data = grid[pos.r][pos.c];
          if(data){
            const idx = pos.r*SIZE+pos.c;
            const el = boardEl.children[idx];
            if(pos.willRemove){
              if(data.isIceHazard){
                if(frostHazardState.r === pos.r && frostHazardState.c === pos.c) {
                  clearFrostHazard();
                }
                const pts = GameCore.FROST_HAZARD_BONUS_POINTS || 500;
                score += pts;
                showScoreFloat(pts);
                spawnIceShatterParticles(pos.r, pos.c);
                sfxIceBreak();
                showBoardActionAlert('FROST<br>DEFUSED', 'defused');
                const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
                showMsg(t.msgIceDestroyed || '❄️ LED RAZBIJEN! +500', 2000);
              } else if(data.isFrozen){
                spawnIceShatterParticles(pos.r, pos.c);
                sfxIceBreak();
              } else if(data.maxHp >= 2){
                sfxRockBreak();
                spawnParticles([pos.r+'_'+pos.c], '#8690a8');
              }
              if(el){
                el.style.color = el.style.backgroundColor;
                el.classList.remove('bomb-cell', 'ice-hazard', 'frozen-cube', 'pulse-bonus-cell');
                const lbl = el.querySelector('.bomb-label, .frost-label, .pulse-bonus-label');
                if(lbl) lbl.remove();
                clearCellDecorators(el);
                el.classList.remove('pop-in');
                el.classList.add('clearing');
              }
              spawnParticles([pos.r+'_'+pos.c]);
            } else {
              data.hp -= 1;
              if(data.isFrozen){
                data.isFrozen = false; // Odmrzavanje na prvi udarac
                if(el) el.classList.remove('frozen-cube');
                sfxIceCrack();
                spawnIceShatterParticles(pos.r, pos.c);
              }
              if(el){
                el.classList.remove('stone-full', 'stone-granite-3', 'stone-granite-2');
                if(data.maxHp === 3 && data.hp === 2) el.classList.add('stone-granite-2', 'cracking');
                else if(data.maxHp >= 2) el.classList.add('stone-cracked','cracking');
                el.style.backgroundColor = (data.maxHp >= 2) ? '' : (data.color || '');
              }
              if(!data.isFrozen) {
                sfxRockCrack();
                spawnCrackParticles([pos.r+'_'+pos.c]);
              }
            }
          }
          nextCellIndex++;
        }

        if (nextCellIndex < cells.length) {
          requestAnimationFrame(step);
        } else {
          setTimeout(()=>{
            cells.forEach(({r,c,willRemove})=>{
              if(willRemove) {
                grid[r][c] = null;
                const idx = r*SIZE+c;
                const el = boardEl.children[idx];
                if(el){
                  el.className = 'cell';
                  el.style.backgroundColor = '';
                  el.style.color = '';
                  const meta = cellsMeta.get(el);
                  if(meta) meta.lastColor = '';
                  clearCellDecorators(el);
                }
              }
            });

            // ── Provera za "Board Clear" (potpuno čišćenje table do praznog stanja) ──
            const isBoardCleared = (GameCore.hasOccupiedCellsOn) ? !GameCore.hasOccupiedCellsOn(grid, SIZE) : false;
            if(isBoardCleared){
              const clearBonus = GameCore.BOARD_CLEAR_BONUS || 1000;
              score += clearBonus;
              showScoreFloat(clearBonus);
              recordCareerStat('boardClears', 1);
              sfxBonusGem();

              const maxH = GameCore.MAX_HAMMERS || 2;
              const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
              if(hammersCount < maxH){
                hammersCount = Math.min(maxH, hammersCount + 1);
              } else {
                const overflow = GameCore.POWERUP_OVERFLOW_POINTS || 500;
                score += overflow;
                showScoreFloat(overflow);
              }
              updatePowerupUI();
              setTimeout(() => {
                showMsg(t.msgBoardClear || '🌟 ČISTA TABLA! +1000 PTS & 🔨 ČEKIĆ!', 3500);
              }, 150);
            }

            checkBombCriticalState();
            lineClearInProgress = false;
            ensureTrayNotEmpty();
            render();
            resolve();
          }, animDuration);
        }
      }
      requestAnimationFrame(step);
    });
  }

  async function clearLines(){
    if(lineClearInProgress) {
      return;
    }
    lineClearInProgress = true;

    const fullRows = [];
    const fullCols = [];
    for(let r=0;r<SIZE;r++){ if(grid[r].every(v=>v)) fullRows.push(r); }
    for(let c=0;c<SIZE;c++){ if(grid.every(row=>row[c])) fullCols.push(c); }

    if(fullRows.length===0 && fullCols.length===0){
      comboStreak = 0;
      updatePowerupUI();
      lineClearInProgress = false;
      ensureTrayNotEmpty();
      render();
      return;
    }
    track('line_clear', { rows: fullRows.length, cols: fullCols.length });

    const cellsToClear = new Set();
    fullRows.forEach(r=>{ for(let c=0;c<SIZE;c++) cellsToClear.add(r+'_'+c); });
    fullCols.forEach(c=>{ for(let r=0;r<SIZE;r++) cellsToClear.add(r+'_'+c); });

    const cellsArr = [...cellsToClear].map(key=>{
      const [r,c] = key.split('_').map(Number);
      const data = grid[r][c];
      const willRemove = !data || data.hp <= 1;
      return {r,c,key,willRemove};
    }).sort((a,b)=> (a.r-b.r) || (a.c-b.c));

    // Zajednička stagger animacija sa await-om
    await animateStaggeredCellRemoval(cellsArr, CONFIG.LINE_CLEAR_STAGGER, CONFIG.CLEAR_ANIM_DURATION);

    const removedCount = cellsArr.filter(c=>c.willRemove).length;
    const crackedCount = cellsArr.length - removedCount;
    const linesCleared = fullRows.length + fullCols.length;
    const prevCombo = comboStreak;
    comboStreak += linesCleared;

    // Track career statistics
    recordCareerStat('linesCleared', linesCleared);
    if(comboStreak > 1) recordCareerStat('maxCombo', comboStreak);
    for (let c = Math.max(2, prevCombo + 1); c <= comboStreak; c++) {
      if(c === 2) recordCareerStat('combo2xCount', 1);
      if(c === 3) recordCareerStat('combo3xCount', 1);
      if(c === 4) recordCareerStat('combo4xCount', 1);
      if(c === 5) recordCareerStat('combo5xCount', 1);
      if(c === 6) recordCareerStat('combo6xCount', 1);
      if(c >= 7) recordCareerStat('masterCombos', 1);
    }
    const defusedCount = cellsArr.filter(c => { const d = grid[c.r][c.c]; return d && d.bomb && c.willRemove; }).length;
    if(defusedCount > 0){
      recordCareerStat('bombsDefused', defusedCount);
      const defuseBonus = defusedCount * 150;
      score += defuseBonus;
      showScoreFloat(defuseBonus);
      showBoardActionAlert('BOMB DEFUSED', 'defused');
      sfxBonusGem();
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      setTimeout(() => {
        showMsg((t.msgBombDefused || '🛡️ BOMBA DEAKTIVIRANA! +%s').replace('%s', defuseBonus), 2500);
      }, CONFIG.MSG_DURATION_CLEAR);
      cellsArr.forEach(c => {
        if(bombTickers.has(c.r+'_'+c.c)) bombTickers.delete(c.r+'_'+c.c);
      });
    }
    const rockDestroyedCount = cellsArr.filter(c => { const d = grid[c.r][c.c]; return d && d.maxHp >= 2 && c.willRemove; }).length;
    if(rockDestroyedCount > 0) recordCareerStat('rocksCrushed', rockDestroyedCount);

    const prevScoreBeforeLines = score;
    const bonus = GameCore.calculateComboScore(linesCleared, removedCount, crackedCount, comboStreak);
    score += bonus;
    showScoreFloat(bonus);
    if(bonus > 0 && typeof showBigComboBonusCounter === 'function'){
      showBigComboBonusCounter(bonus, comboStreak, linesCleared);
    }
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
    checkAndUnlockBadges(getCareerStats(), score, best, currentLang);

    playComboAudio(comboStreak, linesCleared);
    updatePowerupUI();

    const tClear = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    if(comboStreak > 1) {
      boardEl.classList.add('board-combo');
      setTimeout(() => boardEl.classList.remove('board-combo'), 380);
      showMsg((tClear.msgComboStreak || '🔥 KOMBO NIZ x') + comboStreak + '! +' + bonus, CONFIG.MSG_DURATION_COMBO);
    } else if(linesCleared > 1) {
      boardEl.classList.add('board-combo');
      setTimeout(() => boardEl.classList.remove('board-combo'), 380);
      showMsg((tClear.msgCombo || '🔥 COMBO x') + linesCleared + '! +' + bonus, CONFIG.MSG_DURATION_COMBO);
    } else {
      showMsg((tClear.msgLineClear || '✨ Linija obrisana! +') + bonus, CONFIG.MSG_DURATION_CLEAR);
    }

    // Power-up nagrade za skor (zamene na svakih 5k poena sa limitom)
    grantPowerupRewards(prevScoreBeforeLines, score, CONFIG.MSG_DURATION_CLEAR);


  }

  function handleCellClick(r, c){
    if(!isHammerActive) return;
    if(!grid || !grid[r] || !grid[r][c]) return;
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    const cellData = grid[r][c];
    sfxHammer();
    triggerScreenShake('light');
    spawnCrackParticles([r+'_'+c]);
    spawnParticles([r+'_'+c], '#fbbf24');

    if(cellData.isIceHazard){
      if(frostHazardState.r === r && frostHazardState.c === c) {
        clearFrostHazard();
      }
      const pts = GameCore.FROST_HAZARD_BONUS_POINTS || 500;
      score += pts;
      showScoreFloat(pts);
      spawnIceShatterParticles(r, c);
      sfxIceBreak();
      showBoardActionAlert('FROST<br>DEFUSED', 'defused');
      grid[r][c] = null;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
      showMsg(t.msgIceDestroyed || '❄️ LED RAZBIJEN! +500', 2000);
    } else {
      checkAndCollectPulseBonus(r, c);
      if(cellData.isFrozen){
        spawnIceShatterParticles(r, c);
        sfxIceBreak();
      }
      if(cellData.maxHp >= 2 || cellData.hp > 1){
        recordCareerStat('rocksCrushed', 1);
        sfxRockBreak();
      }
      if(cellData.bomb){
        recordCareerStat('bombsDefused', 1);
        bombTickers.delete(r+'_'+c);
        showBoardActionAlert('BOMB DEFUSED', 'defused');
      }
      // Total Destroyer: uklanja svaku kocku/kamen/granit/bombu u jednom udarcu
      grid[r][c] = null;
    }

    checkBombCriticalState();
    hammersCount = Math.max(0, hammersCount - 1);
    setHammerActive(false);
    updatePowerupUI();
    showMsg(t.puHammerUsed || '💥 Kocka razbijena!', 1500);
    render();
    stuckHintShown = false;
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
        cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null, frostLabel: null });
      }
    }
    boardEl.appendChild(frag);
  }

  /**
   * Briše sve dinamičke dekoratore ćelije (bomb label, pulse bonus label, frost label).
   */
  function clearCellDecorators(div){
    const meta = cellsMeta.get(div);
    if(!meta) return;
    const lbl = meta.bombLabel;
    if(lbl){ lbl.remove(); meta.bombLabel = null; }
    const pb = meta.pulseLabel;
    if(pb){ pb.remove(); meta.pulseLabel = null; }
    const fl = meta.frostLabel;
    if(fl){ fl.remove(); meta.frostLabel = null; }
  }

  /**
   * Održava bomb label element unutar ćelije (stvara/briše).
   */
  function renderBombLabel(div, data){
    const meta = cellsMeta.get(div) || (cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null, frostLabel: null }), cellsMeta.get(div));
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
    const meta = cellsMeta.get(div) || (cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null, frostLabel: null }), cellsMeta.get(div));
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
   * Održava frost hazard label (15s tajmer) unutar ćelije.
   */
  function renderFrostLabel(div, data){
    const meta = cellsMeta.get(div) || (cellsMeta.set(div, { lastColor: null, bombLabel: null, pulseLabel: null, frostLabel: null }), cellsMeta.get(div));
    if(data && data.isIceHazard){
      let label = meta.frostLabel;
      if(!label){
        label = document.createElement('div');
        label.className = 'frost-label';
        div.appendChild(label);
        meta.frostLabel = label;
      }
      const val = String(data.frostTimer != null ? data.frostTimer : 5);
      if(label.textContent !== val) label.textContent = val;
      label.classList.toggle('critical-num', (data.frostTimer != null && data.frostTimer <= 1));
    } else {
      const label = meta.frostLabel;
      if(label){ label.remove(); meta.frostLabel = null; }
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
      if(data.frostTimer != null && data.frostTimer <= 1) cls += ' critical';
      return cls;
    }
    if(data.isFrozen) {
      cls += ' frozen-cube';
    }
    if(data.maxHp === 3){
      if(data.hp >= 3) cls += ' stone-granite-3';
      else if(data.hp === 2) cls += ' stone-granite-2';
      else cls += ' stone-cracked';
    } else if(data.maxHp === 2){
      if(data.hp >= 2) cls += ' stone-full';
      else cls += ' stone-cracked';
    } else if(data.isRock || (data.maxHp && data.maxHp > 1)){
      cls += ' stone-cracked';
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
            const target = (data.isRock || (data.maxHp && data.maxHp >= 2)) ? '' : (data.color || '#5eead4');
            const meta = cellsMeta.get(div);
            if (meta && meta.lastColor !== target) {
              meta.lastColor = target;
              div.style.backgroundColor = target;
            }
            renderBombLabel(div, data);
            renderPulseLabel(div, data);
            renderFrostLabel(div, data);
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
      if(worldRecordScore >= 1000 && score > worldRecordScore){
        if(!hasCelebratedWorldRecord){
          hasCelebratedWorldRecord = true;
          const globalBox = document.getElementById('bottomGlobalCard');
          if(globalBox) globalBox.classList.add('record-breaking');
          const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
          showMsg(t.worldRecordBroken || '🌍 NOVI SVETSKI REKORD! 🎉', CONFIG.MSG_DURATION_COMBO || 2500);
        }
      }

      if(score > best){
        if(bestAtGameStart >= 500 && score > bestAtGameStart && !hasCelebratedNewBest){
          hasCelebratedNewBest = true;
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
      // FIX (#3): NE dopunjavaj fioku ovde. Dopunjavanje se radi eksplicitno TEK
      // posle što se potez završi (nakon clearLines-animacije) — inače se novi komad
      // generiše na osnovu skora/grida PRE nego što se obrišu linije iz poteza.
      // (render() tokom placePiece poziva renderTray; uz ovu promenu traži se radije
      //  prikazivanje praznog slota, a puni se u clearLines callback-u.)
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
        const tA11y = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
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
              const isStone = on && (piece.stoneIndices ? piece.stoneIndices.includes(shapeIdx) : shapeIdx === piece.stoneIndex);
              const isBomb = on && shapeIdx === piece.bombIndex;
              const cell = document.createElement('div');
              cell.className = 'piece-cell ' + (on?'on':'off') + (isStone?' stone':'') + (isBomb?' bomb':'');
              if(on && !isStone && !isBomb) cell.style.background = piece.color || '#5eead4';
              pg.appendChild(cell);
            }
          }
          slot.appendChild(pg);

          if(piece.isLockedRotation){
            const lockBadge = document.createElement('div');
            lockBadge.className = 'slot-lock-badge';
            lockBadge.innerHTML = '🔒';
            lockBadge.title = 'Fiksiran komad (ne može se rotirati)';
            lockBadge.onpointerdown = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
              showMsg(t.msgLockedPiece || '🔒 Ovaj komad je zaključan i ne može se rotirati!', 2000);
              slot.classList.add('shake-piece');
              setTimeout(() => slot.classList.remove('shake-piece'), 300);
            };
            slot.appendChild(lockBadge);
          } else {
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
          }
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
      if(e.target && e.target.closest && (e.target.closest('.slot-rotate') || e.target.closest('.slot-lock-badge'))) return;
      
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
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;

      // Rotacija u fioci, bez podizanja komada
      if ((e.key === 'r' || e.key === 'R') && !dragging) {
        e.preventDefault();
        if (piece.isLockedRotation) {
          showMsg(t.msgLockedPiece || '🔒 Ovaj komad je zaključan i ne može se rotirati!', 2000);
          slot.classList.add('shake-piece');
          setTimeout(() => slot.classList.remove('shake-piece'), 300);
          return;
        }
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
    
    ghostEl.style.display = 'grid';
    ghostEl.style.gridTemplateColumns = `repeat(${cols}, ${cellW}px)`;
    ghostEl.style.gridTemplateRows = `repeat(${rows}, ${cellW}px)`;
    
    let cellIdx = 0;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const shapeIdx = occMap.get(r+','+c);
        const on = shapeIdx !== undefined;
        const isStone = on && shapeIdx === piece.stoneIndex;
        const isBomb = on && shapeIdx === piece.bombIndex;
        
        const cell = ghostCells[cellIdx];
        cell.style.display = 'block';
        cell.className = 'ghost-cell ' + (on?'':'off') + (isStone?' stone-full':'') + (isBomb?' bomb':'');
        if(on && !isStone && !isBomb) {
          cell.style.background = piece.color || '#5eead4';
        } else {
          cell.style.background = '';
        }
        cellIdx++;
      }
    }
    // Hide unused cells
    while(cellIdx < 25) {
      ghostCells[cellIdx].style.display = 'none';
      cellIdx++;
    }
  }

  function getGhostRaise(rows = 1){
    const cellW = (cachedBoardGeometry || getCellGeometry()).cellW;
    return Math.round((rows * 0.5 + userDragOffsetMultiplier) * cellW);
  }

  function moveGhost(x,y){
    const {rows, cols} = shapeSize(dragging.piece.shape);
    const geom = cachedBoardGeometry || getCellGeometry();
    const cellW = geom.cellW;
    const gap = geom.gap || 4;
    const raise = getGhostRaise(rows);
    // Ukupna dimenzija ghost-a MORA da uključi gap između ćelija (grid-gap:4px),
    // inače je ghost pomeren za (cols-1)*gap/2 px udesno i (rows-1)*gap/2 px nadole
    // (pre ~4px za komade širine 3).
    const totalW = cols*cellW + (cols-1)*gap;
    const totalH = rows*cellW + (rows-1)*gap;
    const gx = Math.round(x - totalW/2);
    const gy = Math.round(y - totalH/2 - raise);
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
      // FIX (#3): NE dopunjavaj fioku PRE postavljanja — to se radi u onCleared
      // callback-u (posle clearLines), kako bi novi komad uzeo u obzir i očišćene
      // linije iz ovog poteza.
      (async () => {
        await placePiece(dragging.piece, row, col);
        ensureTrayNotEmpty();
        render();
        checkAndTriggerGameOver(CONFIG.GAME_OVER_DELAY_AFTER_CLEAR);
      })();
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
   *  GAME OVER HANDLER — integrates score submit, history & career stats
   * ═══════════════════════════════════════════════ */
  function handleGameOver(){
    // Zaustavi tajmere koji bi radili u prazno na game-over ekranu
    // (puls bonus odbrojavanje, puls spawn reschedule, bomb ticker).
    if(pulseBonusState.intervalId){ clearInterval(pulseBonusState.intervalId); pulseBonusState.intervalId = null; }
    if(pulseBonusState.nextSpawnTimeoutId){ clearTimeout(pulseBonusState.nextSpawnTimeoutId); pulseBonusState.nextSpawnTimeoutId = null; }
    resetBombTickers();

    const finalScore = score;
    const finalCombo = comboStreak;
    lastGameOverScore = finalScore;
    lastGameOverCombo = finalCombo;
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

    checkAndUnlockBadges(getCareerStats(), finalScore, best, currentLang);
    const highestBadge = getHighestBadge(getCareerStats(), best);
    const gob = document.getElementById('gameOverBadge');
    if (gob) {
      if (highestBadge) {
        const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
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
    recordCareerStat('totalPlayTimeSec', durationSec);

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
    document.body.classList.toggle('app-hidden', document.hidden);
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
