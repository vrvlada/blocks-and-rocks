
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
  let pendingScore = null; // best score awaiting Firebase auth before submit
  let muted = localStorage.getItem('blocksrocks_muted') === '1';

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

      // Catch redirect results for native WebView OAuth flow
      fb_auth.getRedirectResult().then(result => {
        if (result && result.user) {
          console.log('[B&R] Redirect Auth / Link OK:', result.user.uid);
          if (typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
        }
      }).catch(err => {
        if (err.code === 'auth/credential-already-in-use' && err.credential) {
          console.warn('[B&R] Google account already linked to another profile, signing into Google profile...');
          fb_auth.signInWithCredential(err.credential).then(res => {
            console.log('[B&R] Signed into existing Google account:', res.user.uid);
            if (typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
          });
        } else {
          console.warn('[B&R] Redirect Auth error:', err.code, err.message);
        }
      }).finally(() => {
        // Anonymous sign-in tek NAKON što se redirect rezultat razreši —
        // sprečava trku u kojoj se napravi novi anonimni nalog usred Google redirect-a.
        if (fb_auth.currentUser) return;
        fb_auth.signInAnonymously().catch(err => {
          console.warn('[B&R] Firebase Auth failed:', err.message);
          if(!fb_userId){
            fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
          }
          if(!username && typeof showUsernameModal === 'function'){
            showUsernameModal(null, true);
          }
        });
      });

      fb_auth.onAuthStateChanged(async user => {
        if(user) {
          fb_userId = user.uid;
          localStorage.setItem('blocksrocks_userId', fb_userId);
          firebaseReady = true;
          console.log('[B&R] Firebase Auth OK:', fb_userId);
          if(typeof updateGoogleLinkStatus === 'function') updateGoogleLinkStatus();
          if(typeof initUserIdentity === 'function') await initUserIdentity();
          if(typeof syncOfflineScores === 'function') await syncOfflineScores();
          if(typeof updateBottomRecords === 'function') updateBottomRecords(true);
          if(typeof migrateLegacyScore === 'function') migrateLegacyScore();
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
  let username = localStorage.getItem('blocksrocks_username') || '';
  let personalBest = parseInt(localStorage.getItem('blocksrocks_personalBest') || '0');
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
  const TRANSLATIONS = {
    sr: {
      sub: "STATIČKA SLAGALICA",
      scoreLabel: "SKOR",
      bestLabel: "NAJBOLJI",
      btnRestart: "Nova Igra",
      btnMute: "Zvuk",
      btnPause: "Pauza",
      btnTrophy: "Rang Lista",
      btnSettings: "Podešavanja",
      msgDefault: "Prevuci komad na mrežu · svaki 10. komad ima kamenu kockicu koja puca dvaput",
      msgExplosion: "💥 EKSPLOZIJA! +",
      msgLineClear: "✨ Linija obrisana! +",
      msgCombo: "🔥 COMBO x",
      tips: [
        "Prevuci komad na mrežu",
        "Popuni ceo red ili kolonu da obrišeš",
        "Kamene kockice zahtevaju dva pogotka",
        "Bombe eksplodiraju posle 3 tika!",
        "Pokušaj da čistiš više linija odjednom"
      ],
      gameOverTitle: "KRAJ IGRE",
      newBestLabel: "⭐ NOVI REKORD! ⭐",
      noSpaceMsg: "Nema mesta za preostale komade",
      restartBtn: "IGRAJ PONOVO",
      showLbBtn: "🏆 RANG LISTA",
      pauseTitle: "⏸ PAUZA",
      pauseDesc: "Igra je pauzirana — bombe su zaustavljene.",
      resumeBtn: "▶ NASTAVI",
      pauseMutePrefix: "Zvuk: ",
      soundOn: "UKLJ.",
      soundOff: "ISKLJ.",
      pauseRestartBtn: "🔄 NOVA IGRA",
      settingsTitle: "⚙️ PODEŠAVANJA & PROFIL",
      onboardingTitle: "👋 DOBRODOŠLI!",
      onboardingDesc: "Unesite jedinstveni nadimak za rang listu i profil.",
      onboardingBtn: "ZAPOČNI IGRU",
      statusChecking: "⏳ Proveravam...",
      statusAvailable: "✅ Nadimak je slobodan",
      statusCurrent: "✅ Vaše trenutno ime",
      statusTaken: "❌ Nadimak je već zauzet",
      statusTooShort: "⚠️ Min. 3 karaktera",
      statusInvalidChars: "⚠️ Dozvoljena su slova, brojevi i _",
      statusSaving: "Čuvam...",
      statusSaveError: "❌ Greška pri čuvanju",
      usernameLabel: "👤 KORISNIČKO IME (3-12 karaktera)",
      usernamePlaceholder: "VašeIme",
      usernameSaveBtn: "SAČUVAJ",
      btnLinkGoogle: "Poveži Google nalog",
      googleLinked: "✅ Povezano sa Google nalogom",
      googleUnlinked: "Sačuvajte rezultat trajno",
      googleConnecting: "Povezivanje...",
      googleAlreadyLinked: "⚠️ Google nalog je već povezan",
      googleError: "❌ Greška pri povezivanju",
      langLabel: "🌐 JEZIK / LANGUAGE",
      themeLabel: "🎨 VIZUELNA TEMA",
      dragOffsetLabel: "🎚️ ODIZANJE PRI PREVLAČENJU",
      blocksBadge: "Kockice",
      hapticLabel: "📳 VIBRACIJA (HAPTICS)",
      hapticStrong: "Jako",
      hapticMedium: "Srednje",
      hapticLight: "Blago",
      hapticOff: "Isključeno",
      particleTitle: "✨ TRAG ISKRICAMA",
      particleDesc: "Čestice prate komad pri prevlačenju",
      lbTitle: "🏆 RANG LISTA",
      lbPersonalBestLabel: "TVOJI NAJBOLJI REZULTATI (TOP 3)",
      lbEmpty: "Još nema rezultata.<br>Budi prvi! 🚀",
      lbMyEmpty: "Nema još rezultata — odigraj partiju!",
      lbLocationUnavailable: "🌐 Lokacija nedostupna — World TOP 10",
      tabCountry: "🏠 DRŽAVA",
      tabGlobal: "🌍 SVET",
      lbLoadMoreBtn: "UČITAJ JOŠ",
      countryRecordTitle: "Državni rekord",
      worldRecordTitle: "Svetski rekord",
      puHammerText: "ČEKIĆ",
      puRerollText: "ZAMENI",
      puHammerActive: "🔨 Dodirni bilo koju kocku na tabli da je razbiješ!",
      puHammerUsed: "💥 Kocka razbijena!",
      puNoHammers: "Nemate više čekića! Novi dobijate na svakih 1.000 poena.",
      puNoRerolls: "Nemate više zamena! Novu dobijate na svakih 2.000 poena.",
      puRewardHammer: "🔨 Novi čekić osvojen! (+1)",
      puRewardReroll: "🎲 Nova zamena osvojena! (+1)",
      msgComboStreak: "🔥 KOMBO NIZ x",
      btnShareScore: "📤 PODELI REZULTAT",
      shareScored: "Osvojio sam",
      sharePoints: "poena",
      shareBestCombo: "Najveći kombo: x",
      shareChallenge: "Možeš li me stići? 🚀",
      badgeMe: "TI",
      historyLabel: "📜 POSLEDNJE PARTIJE",
      noHistoryMsg: "Nema odigranih partija.",
      scoreCopiedMsg: "📋 Rezultat kopiran u privremenu memoriju!",
      scoreCopyFailed: "❌ Nije moguće podeliti rezultat",
      statsLabel: "📊 STATISTIKA KARIJERE",
      statGames: "Partija",
      statLines: "Linija",
      statCombo: "Maks Kombo",
      statBombs: "Bombi",
      statRocks: "Kamenja",
      statAvg: "Prosek",
      highContrastTitle: "👁️ VISOKI KONTRAST",
      highContrastDesc: "Izražene ivice i konture blokova",
      closeModal: "Zatvori"
    },
    en: {
      sub: "TACTICAL BLOCK PUZZLE",
      scoreLabel: "SCORE",
      bestLabel: "BEST",
      btnRestart: "New Game",
      btnMute: "Sound",
      btnPause: "Pause",
      btnTrophy: "Leaderboard",
      btnSettings: "Settings",
      msgDefault: "Drag a piece onto the grid · every 10th piece has a stone block that breaks twice",
      msgExplosion: "💥 EXPLOSION! +",
      msgLineClear: "✨ Line cleared! +",
      msgCombo: "🔥 COMBO x",
      tips: [
        "Drag a piece onto the grid",
        "Fill an entire row or column to clear",
        "Stone blocks take two hits to destroy",
        "Bombs explode after 3 ticks!",
        "Try to clear multiple lines at once"
      ],
      gameOverTitle: "GAME OVER",
      newBestLabel: "⭐ NEW BEST! ⭐",
      noSpaceMsg: "No space left for remaining pieces",
      restartBtn: "PLAY AGAIN",
      showLbBtn: "🏆 LEADERBOARD",
      pauseTitle: "⏸ PAUSED",
      pauseDesc: "Game paused — bomb timers frozen.",
      resumeBtn: "▶ RESUME",
      pauseMutePrefix: "Sound: ",
      soundOn: "ON",
      soundOff: "OFF",
      pauseRestartBtn: "🔄 NEW GAME",
      settingsTitle: "⚙️ SETTINGS & PROFILE",
      onboardingTitle: "👋 WELCOME!",
      onboardingDesc: "Choose a unique nickname for the leaderboard and profile.",
      onboardingBtn: "START GAME",
      statusChecking: "⏳ Checking...",
      statusAvailable: "✅ Nickname is available",
      statusCurrent: "✅ Your current name",
      statusTaken: "❌ Nickname already taken",
      statusTooShort: "⚠️ Min. 3 characters",
      statusInvalidChars: "⚠️ Only letters, numbers and _",
      statusSaving: "Saving...",
      statusSaveError: "❌ Failed to save",
      usernameLabel: "👤 USERNAME (3-12 characters)",
      usernamePlaceholder: "YourName",
      usernameSaveBtn: "SAVE",
      btnLinkGoogle: "Link Google Account",
      googleLinked: "✅ Linked with Google Account",
      googleUnlinked: "Save score permanently",
      googleConnecting: "Connecting...",
      googleAlreadyLinked: "⚠️ Google account already linked",
      googleError: "❌ Connection error",
      langLabel: "🌐 LANGUAGE / JEZIK",
      themeLabel: "🎨 VISUAL THEME",
      dragOffsetLabel: "🎚️ DRAG HEIGHT OFFSET",
      blocksBadge: "Blocks",
      hapticLabel: "📳 HAPTIC FEEDBACK",
      hapticStrong: "Strong",
      hapticMedium: "Medium",
      hapticLight: "Light",
      hapticOff: "Off",
      particleTitle: "✨ SPARK TRAIL",
      particleDesc: "Particles follow piece while dragging",
      lbTitle: "🏆 LEADERBOARD",
      lbPersonalBestLabel: "YOUR BEST SCORES (TOP 3)",
      lbEmpty: "No results yet.<br>Be the first! 🚀",
      lbMyEmpty: "No scores yet — play a game!",
      lbLocationUnavailable: "🌐 Location unavailable — World TOP 10",
      tabCountry: "🏠 COUNTRY",
      tabGlobal: "🌍 GLOBAL",
      lbLoadMoreBtn: "LOAD MORE",
      countryRecordTitle: "National Record",
      worldRecordTitle: "World Record",
      puHammerText: "HAMMER",
      puRerollText: "REROLL",
      puHammerActive: "🔨 Tap any block on the board to smash it!",
      puHammerUsed: "💥 Block smashed!",
      puNoHammers: "No hammers left! Earn +1 every 1,000 points.",
      puNoRerolls: "No rerolls left! Earn +1 every 2,000 points.",
      puRewardHammer: "🔨 New Hammer earned! (+1)",
      puRewardReroll: "🎲 New Reroll earned! (+1)",
      msgComboStreak: "🔥 COMBO STREAK x",
      btnShareScore: "📤 SHARE SCORE",
      shareScored: "I scored",
      sharePoints: "points",
      shareBestCombo: "Best combo: x",
      shareChallenge: "Can you beat me? 🚀",
      badgeMe: "YOU",
      historyLabel: "📜 RECENT MATCHES",
      noHistoryMsg: "No matches played yet.",
      scoreCopiedMsg: "📋 Score copied to clipboard!",
      scoreCopyFailed: "❌ Unable to share score",
      statsLabel: "📊 CAREER STATISTICS",
      statGames: "Games",
      statLines: "Lines",
      statCombo: "Max Combo",
      statBombs: "Bombs",
      statRocks: "Rocks",
      statAvg: "Average",
      highContrastTitle: "👁️ HIGH CONTRAST",
      highContrastDesc: "Enhanced edges and defined block borders",
      closeModal: "Close"
    },
    de: {
      sub: "TAKTIK-BLOCK-PUZZLE",
      scoreLabel: "PUNKTE",
      bestLabel: "BESTE",
      btnRestart: "Neues Spiel",
      btnMute: "Ton",
      btnPause: "Pause",
      btnTrophy: "Bestenliste",
      btnSettings: "Einstellungen",
      msgDefault: "Ziehe ein Teil auf das Gitter · jedes 10. Teil hat einen Steinblock",
      msgExplosion: "💥 EXPLOSION! +",
      msgLineClear: "✨ Reihe gelöscht! +",
      msgCombo: "🔥 COMBO x",
      tips: [
        "Ziehe ein Teil auf das Gitter",
        "Fülle eine ganze Reihe oder Spalte",
        "Steinblöcke benötigen zwei Treffer",
        "Bomben explodieren nach 3 Ticks!",
        "Versuche mehrere Reihen auf einmal zu löschen"
      ],
      gameOverTitle: "SPIEL ENDE",
      newBestLabel: "⭐ NEUER REKORD! ⭐",
      noSpaceMsg: "Kein Platz mehr für verbleibende Teile",
      restartBtn: "NOCHMAL SPIELEN",
      showLbBtn: "🏆 BESTENLISTE",
      pauseTitle: "⏸ PAUSE",
      pauseDesc: "Spiel pausiert — Bomben eingefroren.",
      resumeBtn: "▶ WEITER",
      pauseMutePrefix: "Ton: ",
      soundOn: "AN",
      soundOff: "AUS",
      pauseRestartBtn: "🔄 NEUES SPIEL",
      settingsTitle: "⚙️ EINSTELLUNGEN & PROFIL",
      onboardingTitle: "👋 WILLKOMMEN!",
      onboardingDesc: "Wähle einen eindeutigen Benutzernamen für die Bestenliste.",
      onboardingBtn: "SPIEL STARTEN",
      statusChecking: "⏳ Überprüfe...",
      statusAvailable: "✅ Name ist verfügbar",
      statusCurrent: "✅ Dein aktueller Name",
      statusTaken: "❌ Name bereits vergeben",
      statusTooShort: "⚠️ Min. 3 Zeichen",
      statusInvalidChars: "⚠️ Nur Buchstaben, Zahlen und _",
      statusSaving: "Speichere...",
      statusSaveError: "❌ Fehler beim Speichern",
      usernameLabel: "👤 BENUTZERNAME (3-12 Zeichen)",
      usernamePlaceholder: "DeinName",
      usernameSaveBtn: "SPEICHERN",
      btnLinkGoogle: "Google-Konto verknüpfen",
      googleLinked: "✅ Mit Google-Konto verknüpft",
      googleUnlinked: "Ergebnis dauerhaft speichern",
      googleConnecting: "Verbinden...",
      googleAlreadyLinked: "⚠️ Google-Konto bereits verknüpft",
      googleError: "❌ Verbindungsfehler",
      langLabel: "🌐 SPRACHE / LANGUAGE",
      themeLabel: "🎨 VISUELLES THEMA",
      dragOffsetLabel: "🎚️ ANHEBE-HÖHE BEIM ZIEHEN",
      blocksBadge: "Blöcke",
      hapticLabel: "📳 HAPTIKER FEEDBACK",
      hapticStrong: "Stark",
      hapticMedium: "Mittel",
      hapticLight: "Leicht",
      hapticOff: "Aus",
      particleTitle: "✨ FUNKEN-SPUR",
      particleDesc: "Partikel folgen dem Teil beim Ziehen",
      lbTitle: "🏆 BESTENLISTE",
      lbPersonalBestLabel: "DEINE BESTEN ERGEBNISSE (TOP 3)",
      lbEmpty: "Noch keine Ergebnisse.<br>Sei der Erste! 🚀",
      lbMyEmpty: "Noch keine Ergebnisse — spiel eine Runde!",
      lbLocationUnavailable: "🌐 Standort nicht verfügbar — Welt TOP 10",
      tabCountry: "🏠 LAND",
      tabGlobal: "🌍 WELT",
      lbLoadMoreBtn: "MEHR LADEN",
      countryRecordTitle: "Landesrekord",
      worldRecordTitle: "Weltrekord",
      puHammerText: "HAMMER",
      puRerollText: "NEU",
      puHammerActive: "🔨 Tippe auf einen Block, um ihn zu zerschlagen!",
      puHammerUsed: "💥 Block zerschlagen!",
      puNoHammers: "Keine Hämmer mehr! +1 alle 1.000 Punkte.",
      puNoRerolls: "Keine Rerolls mehr! +1 alle 2.000 Punkte.",
      puRewardHammer: "🔨 Neuer Hammer erhalten! (+1)",
      puRewardReroll: "🎲 Neuer Reroll erhalten! (+1)",
      msgComboStreak: "🔥 KOMBO-SERIE x",
      btnShareScore: "📤 ERGEBNIS TEILEN",
      shareScored: "Ich habe",
      sharePoints: "Punkte erreicht",
      shareBestCombo: "Beste Combo-Serie: x",
      shareChallenge: "Schaffst du mehr? 🚀",
      badgeMe: "DU",
      historyLabel: "📜 LETZTE SPIELE",
      noHistoryMsg: "Noch keine Spiele gespielt.",
      scoreCopiedMsg: "📋 Ergebnis in die Zwischenablage kopiert!",
      scoreCopyFailed: "❌ Teilen fehlgeschlagen",
      statsLabel: "📊 KARRIERE-STATISTIK",
      statGames: "Spiele",
      statLines: "Reihen",
      statCombo: "Max Kombo",
      statBombs: "Bomben",
      statRocks: "Steine",
      statAvg: "Schnitt",
      highContrastTitle: "👁️ HOHER KONTRAST",
      highContrastDesc: "Verstärkte Kanten und klare Blockkonturen",
      closeModal: "Schließen"
    },
    es: {
      sub: "PUZZLE DE BLOQUES TÁCTICO",
      scoreLabel: "PUNTOS",
      bestLabel: "RÉCORD",
      btnRestart: "Nuevo Juego",
      btnMute: "Sonido",
      btnPause: "Pausa",
      btnTrophy: "Clasificación",
      btnSettings: "Ajustes",
      msgDefault: "Arrastra una pieza a la cuadrícula · cada 10ª pieza tiene un bloque de piedra",
      msgExplosion: "💥 ¡EXPLOSIÓN! +",
      msgLineClear: "✨ ¡Línea eliminada! +",
      msgCombo: "🔥 COMBO x",
      tips: [
        "Arrastra una pieza a la cuadrícula",
        "Llena una fila o columna para despejar",
        "Los bloques de piedra necesitan dos golpes",
        "¡Las bombas explotan tras 3 tics!",
        "Intenta despejar varias líneas a la vez"
      ],
      gameOverTitle: "JUEGO TERMINADO",
      newBestLabel: "⭐ ¡NUEVO RÉCORD! ⭐",
      noSpaceMsg: "No hay espacio para las piezas restantes",
      restartBtn: "JUGAR DE NUEVO",
      showLbBtn: "🏆 CLASIFICACIÓN",
      pauseTitle: "⏸ PAUSA",
      pauseDesc: "Juego pausado — bombas congeladas.",
      resumeBtn: "▶ REANUDAR",
      pauseMutePrefix: "Sonido: ",
      soundOn: "ON",
      soundOff: "OFF",
      pauseRestartBtn: "🔄 NUEVO JUEGO",
      settingsTitle: "⚙️ AJUSTES Y PERFIL",
      onboardingTitle: "👋 ¡BIENVENIDO!",
      onboardingDesc: "Elige un apodo único para la clasificación y perfil.",
      onboardingBtn: "COMENZAR JUEGO",
      statusChecking: "⏳ Comprobando...",
      statusAvailable: "✅ Apodo disponible",
      statusCurrent: "✅ Tu nombre actual",
      statusTaken: "❌ Apodo ya ocupado",
      statusTooShort: "⚠️ Mín. 3 caracteres",
      statusInvalidChars: "⚠️ Solo letras, números y _",
      statusSaving: "Guardando...",
      statusSaveError: "❌ Error al guardar",
      usernameLabel: "👤 NOMBRE (3-12 caracteres)",
      usernamePlaceholder: "TuNombre",
      usernameSaveBtn: "GUARDAR",
      btnLinkGoogle: "Vincular cuenta de Google",
      googleLinked: "✅ Vinculado con cuenta de Google",
      googleUnlinked: "Guarda tu puntuación para siempre",
      googleConnecting: "Conectando...",
      googleAlreadyLinked: "⚠️ La cuenta de Google ya está vinculada",
      googleError: "❌ Error de conexión",
      langLabel: "🌐 IDIOMA / LANGUAGE",
      themeLabel: "🎨 TEMA VISUAL",
      dragOffsetLabel: "🎚️ ELEVACIÓN AL ARRASTRAR",
      blocksBadge: "Bloques",
      hapticLabel: "📳 VIBRACIÓN HÁPTICA",
      hapticStrong: "Fuerte",
      hapticMedium: "Medio",
      hapticLight: "Suave",
      hapticOff: "Desactivado",
      particleTitle: "✨ RASTRO DE CHISPAS",
      particleDesc: "Las partículas siguen la pieza al arrastrar",
      lbTitle: "🏆 CLASIFICACIÓN",
      lbPersonalBestLabel: "TUS MEJORES PUNTUACIONES (TOP 3)",
      lbEmpty: "Aún no hay resultados.<br>¡Sé el primero! 🚀",
      lbMyEmpty: "Sin puntuaciones todavía — ¡juega una partida!",
      lbLocationUnavailable: "🌐 Ubicación no disponible — TOP 10 Mundial",
      tabCountry: "🏠 PAÍS",
      tabGlobal: "🌍 MUNDIAL",
      lbLoadMoreBtn: "CARGAR MÁS",
      countryRecordTitle: "Récord Nacional",
      worldRecordTitle: "Récord Mundial",
      puHammerText: "MARTILLO",
      puRerollText: "CAMBIAR",
      puHammerActive: "🔨 ¡Toca cualquier bloque para romperlo!",
      puHammerUsed: "💥 ¡Bloque destruido!",
      puNoHammers: "¡Sin martillos! Gana +1 cada 1.000 puntos.",
      puNoRerolls: "¡Sin cambios! Gana +1 cada 2.000 puntos.",
      puRewardHammer: "🔨 ¡Nuevo martillo ganado! (+1)",
      puRewardReroll: "🎲 ¡Nuevo cambio ganado! (+1)",
      msgComboStreak: "🔥 RACHA COMBO x",
      btnShareScore: "📤 COMPARTIR PUNTOS",
      shareScored: "Conseguí",
      sharePoints: "puntos",
      shareBestCombo: "Mejor combo: x",
      shareChallenge: "¿Puedes superarme? 🚀",
      badgeMe: "TÚ",
      historyLabel: "📜 PARTIDAS RECIENTES",
      noHistoryMsg: "Aún no hay partidas jugadas.",
      scoreCopiedMsg: "📋 ¡Puntuación copiada al portapapeles!",
      scoreCopyFailed: "❌ No se pudo compartir",
      statsLabel: "📊 ESTADÍSTICAS DE CARRERA",
      statGames: "Partidas",
      statLines: "Líneas",
      statCombo: "Máx Combo",
      statBombs: "Bombas",
      statRocks: "Rocas",
      statAvg: "Promedio",
      highContrastTitle: "👁️ ALTO CONTRASTE",
      highContrastDesc: "Bordes realzados y contornos claros",
      closeModal: "Cerrar"
    },
    fr: {
      sub: "PUZZLE DE BLOCS TACTIQUE",
      scoreLabel: "SCORE",
      bestLabel: "RECORD",
      btnRestart: "Nouvelle Partie",
      btnMute: "Son",
      btnPause: "Pause",
      btnTrophy: "Classement",
      btnSettings: "Paramètres",
      msgDefault: "Faites glisser une pièce sur la grille · chaque 10ème pièce a un bloc de pierre",
      msgExplosion: "💥 EXPLOSION ! +",
      msgLineClear: "✨ Ligne effacée ! +",
      msgCombo: "🔥 COMBO x",
      tips: [
        "Faites glisser une pièce sur la grille",
        "Remplissez une ligne ou une colonne",
        "Les blocs de pierre nécessitent deux coups",
        "Les bombes explosent après 3 tics !",
        "Essayez d'effacer plusieurs lignes à la fois"
      ],
      gameOverTitle: "FIN DE PARTIE",
      newBestLabel: "⭐ NOUVEAU RECORD ! ⭐",
      noSpaceMsg: "Plus d'espace pour les pièces restantes",
      restartBtn: "REJOUER",
      showLbBtn: "🏆 CLASSEMENT",
      pauseTitle: "⏸ PAUSE",
      pauseDesc: "Jeu en pause — bombes congelées.",
      resumeBtn: "▶ REPRENDRE",
      pauseMutePrefix: "Son : ",
      soundOn: "ON",
      soundOff: "OFF",
      pauseRestartBtn: "🔄 NOUVELLE PARTIE",
      settingsTitle: "⚙️ PARAMÈTRES ET PROFIL",
      onboardingTitle: "👋 BIENVENUE !",
      onboardingDesc: "Choisissez un pseudo unique pour le classement et le profil.",
      onboardingBtn: "COMMENCER",
      statusChecking: "⏳ Vérification...",
      statusAvailable: "✅ Pseudo disponible",
      statusCurrent: "✅ Votre nom actuel",
      statusTaken: "❌ Pseudo déjà pris",
      statusTooShort: "⚠️ Min. 3 caractères",
      statusInvalidChars: "⚠️ Lettres, chiffres et _ uniquement",
      statusSaving: "Enregistrement...",
      statusSaveError: "❌ Erreur d'enregistrement",
      usernameLabel: "👤 NOM D'UTILISATEUR (3-12 car.)",
      usernamePlaceholder: "VotreNom",
      usernameSaveBtn: "ENREGISTRER",
      btnLinkGoogle: "Lier le compte Google",
      googleLinked: "✅ Lié avec le compte Google",
      googleUnlinked: "Sauvegardez le score définitivement",
      googleConnecting: "Connexion...",
      googleAlreadyLinked: "⚠️ Compte Google déjà associé",
      googleError: "❌ Erreur de connexion",
      langLabel: "🌐 LANGUE / LANGUAGE",
      themeLabel: "🎨 THÈME VISUEL",
      dragOffsetLabel: "🎚️ HAUTEUR DE GLISSEMENT",
      blocksBadge: "Blocs",
      hapticLabel: "📳 RETOUR HAPTIQUE",
      hapticStrong: "Fort",
      hapticMedium: "Moyen",
      hapticLight: "Léger",
      hapticOff: "Désactivé",
      particleTitle: "✨ TRAÎNÉE D'ÉTINCELLES",
      particleDesc: "Les particules suivent la pièce en glissant",
      lbTitle: "🏆 CLASSEMENT",
      lbPersonalBestLabel: "VOS MEILLEURS SCORES (TOP 3)",
      lbEmpty: "Aucun résultat pour le moment.<br>Soyez le premier ! 🚀",
      lbMyEmpty: "Pas encore de scores — jouez une partie !",
      lbLocationUnavailable: "🌐 Emplacement indisponible — TOP 10 Mondial",
      tabCountry: "🏠 PAYS",
      tabGlobal: "🌍 MONDE",
      lbLoadMoreBtn: "CHARGER PLUS",
      countryRecordTitle: "Record National",
      worldRecordTitle: "Record du Monde",
      puHammerText: "MARTEAU",
      puRerollText: "RELANCER",
      puHammerActive: "🔨 Touchez un bloc pour le briser!",
      puHammerUsed: "💥 Bloc détruit!",
      puNoHammers: "Plus de marteaux! +1 tous les 1 000 points.",
      puNoRerolls: "Plus de relances! +1 tous les 2 000 points.",
      puRewardHammer: "🔨 Nouveau marteau gagné! (+1)",
      puRewardReroll: "🎲 Nouvelle relance gagnée! (+1)",
      msgComboStreak: "🔥 SÉRIE COMBO x",
      btnShareScore: "📤 PARTAGER SCORE",
      shareScored: "J'ai marqué",
      sharePoints: "points",
      shareBestCombo: "Meilleur combo : x",
      shareChallenge: "Tu peux me battre ? 🚀",
      badgeMe: "VOUS",
      historyLabel: "📜 DERNIÈRES PARTIES",
      noHistoryMsg: "Aucune partie jouée pour le moment.",
      scoreCopiedMsg: "📋 Score copié dans le presse-papiers !",
      scoreCopyFailed: "❌ Impossible de partager",
      statsLabel: "📊 STATISTIQUES DE CARRIÈRE",
      statGames: "Parties",
      statLines: "Lignes",
      statCombo: "Max Combo",
      statBombs: "Bombes",
      statRocks: "Roches",
      statAvg: "Moyenne",
      highContrastTitle: "👁️ HAUT CONTRASTE",
      highContrastDesc: "Bords renforcés et contours de blocs nets",
      closeModal: "Fermer"
    },
    ru: {
      sub: "ТАКТИЧЕСКАЯ ГОЛОВОЛОМКА",
      scoreLabel: "СЧЕТ",
      bestLabel: "РЕКОРД",
      btnRestart: "Новая Игра",
      btnMute: "Звук",
      btnPause: "Пауза",
      btnTrophy: "Таблица",
      btnSettings: "Настройки",
      msgDefault: "Перетащите фигуру на сетку · каждая 10-я фигура содержит каменный блок",
      msgExplosion: "💥 ВЗРЫВ! +",
      msgLineClear: "✨ Линия очищена! +",
      msgCombo: "🔥 КОМБО x",
      tips: [
        "Перетащите фигуру на сетку",
        "Заполните ряд или столбец для очистки",
        "Каменные блоки ломаются за два удара",
        "Бомбы взрываются через 3 тика!",
        "Старайтесь очищать несколько линий сразу"
      ],
      gameOverTitle: "ИГРА ОКОНЧАНА",
      newBestLabel: "⭐ НОВЫЙ РЕКОРД! ⭐",
      noSpaceMsg: "Нет места для оставшихся фигур",
      restartBtn: "ИГРАТЬ СНОВА",
      showLbBtn: "🏆 ТАБЛИЦА РЕКОРДОВ",
      pauseTitle: "⏸ ПАУЗА",
      pauseDesc: "Игра на паузе — таймеры бомб остановлены.",
      resumeBtn: "▶ ПРОДОЛЖИТЬ",
      pauseMutePrefix: "Звук: ",
      soundOn: "ВКЛ.",
      soundOff: "ВЫКЛ.",
      pauseRestartBtn: "🔄 НОВАЯ ИГРА",
      settingsTitle: "⚙️ НАСТРОЙКИ И ПРОФИЛЬ",
      onboardingTitle: "👋 ДОБРО ПОЖАЛОВАТЬ!",
      onboardingDesc: "Выберите уникальное имя для таблицы рекордов.",
      onboardingBtn: "НАЧАТЬ ИГРУ",
      statusChecking: "⏳ Проверка...",
      statusAvailable: "✅ Имя свободно",
      statusCurrent: "✅ Ваше текущее имя",
      statusTaken: "❌ Имя уже занято",
      statusTooShort: "⚠️ Мин. 3 символа",
      statusInvalidChars: "⚠️ Только буквы, цифры и _",
      statusSaving: "Сохранение...",
      statusSaveError: "❌ Ошибка сохранения",
      usernameLabel: "👤 ИМЯ ПОЛЬЗОВАТЕЛЯ (3-12 символов)",
      usernamePlaceholder: "ВашеИмя",
      usernameSaveBtn: "СОХРАНИТЬ",
      btnLinkGoogle: "Связать с аккаунтом Google",
      googleLinked: "✅ Связано с аккаунтом Google",
      googleUnlinked: "Сохраняйте счет навсегда",
      googleConnecting: "Подключение...",
      googleAlreadyLinked: "⚠️ Аккаунт Google уже привязан",
      googleError: "❌ Ошибка подключения",
      langLabel: "🌐 ЯЗЫК / LANGUAGE",
      themeLabel: "🎨 ВИЗУАЛЬНАЯ ТЕМА",
      dragOffsetLabel: "🎚️ ВЫСОТА ПОДЪЕМА",
      blocksBadge: "Блоки",
      hapticLabel: "📳 ВИБРАЦИЯ",
      hapticStrong: "Сильно",
      hapticMedium: "Средне",
      hapticLight: "Слабо",
      hapticOff: "Выкл.",
      particleTitle: "✨ СЛЕД ИСКР",
      particleDesc: "Частицы следуют за фигурой при перетаскивании",
      lbTitle: "🏆 ТАБЛИЦА РЕКОРДОВ",
      lbPersonalBestLabel: "ВАШИ ЛУЧШИЕ РЕЗУЛЬТАТЫ (ТОП-3)",
      lbEmpty: "Пока нет результатов.<br>Будьте первыми! 🚀",
      lbMyEmpty: "Пока нет очков — сыграйте партию!",
      lbLocationUnavailable: "🌐 Локация недоступна — ТОП-10 Мира",
      tabCountry: "🏠 СТРАНА",
      tabGlobal: "🌍 МИР",
      lbLoadMoreBtn: "ЗАГРУЗИТЬ ЕЩЕ",
      countryRecordTitle: "Национальный рекорд",
      worldRecordTitle: "Мировой рекорд",
      puHammerText: "МОЛОТ",
      puRerollText: "ЗАМЕНА",
      puHammerActive: "🔨 Нажмите на любой блок, чтобы разбить его!",
      puHammerUsed: "💥 Блок разбит!",
      puNoHammers: "Нет молотов! Получайте +1 за каждые 1 000 очков.",
      puNoRerolls: "Нет замен! Получайте +1 за каждые 2 000 очков.",
      puRewardHammer: "🔨 Получен новый молот! (+1)",
      puRewardReroll: "🎲 Получена новая замена! (+1)",
      msgComboStreak: "🔥 КОМБО СЕРИЯ x",
      btnShareScore: "📤 ПОДЕЛИТЬСЯ",
      shareScored: "Я набрал",
      sharePoints: "очков",
      shareBestCombo: "Лучшее комбо: x",
      shareChallenge: "Сможешь обойти меня? 🚀",
      badgeMe: "ВЫ",
      historyLabel: "📜 ПОСЛЕДНИЕ ИГРЫ",
      noHistoryMsg: "Пока нет сыгранных партий.",
      scoreCopiedMsg: "📋 Результат скопирован в буфер обмена!",
      scoreCopyFailed: "❌ Не удалось поделиться",
      statsLabel: "📊 СТАТИСТИКА КАРЬЕРЫ",
      statGames: "Игр",
      statLines: "Линий",
      statCombo: "Макс Комбо",
      statBombs: "Бомб",
      statRocks: "Камней",
      statAvg: "Средний",
      highContrastTitle: "👁️ ВЫСОКИЙ КОНТРАСТ",
      highContrastDesc: "Четкие края и контуры блоков",
      closeModal: "Закрыть"
    }
  };

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
    if (pmBtn) pmBtn.textContent = (muted ? '🔇 ' : '🔊 ') + t.pauseMutePrefix + (muted ? t.soundOff : t.soundOn);
    setText('pauseRestartBtn', t.pauseRestartBtn);

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
    setText('i18n_statGames', t.statGames || 'Partija');
    setText('i18n_statLines', t.statLines || 'Linija');
    setText('i18n_statCombo', t.statCombo || 'Maks Kombo');
    setText('i18n_statBombs', t.statBombs || 'Bombi');
    setText('i18n_statRocks', t.statRocks || 'Kamenja');
    setText('i18n_statAvg', t.statAvg || 'Prosek');
    setText('i18n_highContrastTitle', t.highContrastTitle || '👁️ VISOKI KONTRAST');
    setText('i18n_highContrastDesc', t.highContrastDesc || 'Izražene ivice i konture blokova');

    updateDragOffsetSetting(userDragOffsetMultiplier);
    updateHapticSetting(hapticMode);
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
  let hapticMode = localStorage.getItem('blocksrocks_haptic') || 'medium';
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
    hapticMode = val;
    localStorage.setItem('blocksrocks_haptic', val);
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const container = document.getElementById('hapticOptions') || document.getElementById('hapticGroup');
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
    const toggle = document.getElementById('particleToggle') || document.getElementById('particleTrailToggle');
    if (toggle) toggle.checked = particleTrailEnabled;
  }

  function initSettingsUI() {
    applyLanguage(currentLang);
    updateDragOffsetSetting(userDragOffsetMultiplier);
    updateHapticSetting(hapticMode);
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
  const hapticContainer = document.getElementById('hapticOptions') || document.getElementById('hapticGroup');
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

  // Particle toggle
  const pToggle = document.getElementById('particleToggle') || document.getElementById('particleTrailToggle');
  if (pToggle) {
    pToggle.addEventListener('change', (e) => {
      updateParticleSetting(e.target.checked);
      haptic('light');
    });
  }

  /* ═══════════════════════════════════════════════
   *  GOOGLE ACCOUNT LINKING
   * ═══════════════════════════════════════════════ */
  function updateGoogleLinkStatus() {
    const btnLinkGoogle = document.getElementById('btnLinkGoogle');
    const googleStatus = document.getElementById('googleStatus');
    if (!btnLinkGoogle || !googleStatus) return;
    if (!fb_auth || !fb_auth.currentUser) return;
    const isLinked = fb_auth.currentUser.providerData.some(p => p.providerId === 'google.com');
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    if (isLinked) {
      btnLinkGoogle.style.display = 'none';
      googleStatus.textContent = t.googleLinked || '✅ Povezano sa Google nalogom';
      googleStatus.style.color = 'var(--accent)';
    } else {
      btnLinkGoogle.style.display = 'flex';
      googleStatus.textContent = t.googleUnlinked || 'Sačuvajte rezultat trajno';
      googleStatus.style.color = 'var(--dim)';
    }
  }

  const btnLinkGoogleBtn = document.getElementById('btnLinkGoogle');
  if (btnLinkGoogleBtn) {
    btnLinkGoogleBtn.addEventListener('click', async () => {
      const googleStatus = document.getElementById('googleStatus');
      if (!fb_auth || !fb_auth.currentUser) return;
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      const provider = new firebase.auth.GoogleAuthProvider();
      try {
        btnLinkGoogleBtn.disabled = true;
        btnLinkGoogleBtn.style.opacity = '0.5';
        if (googleStatus) {
          googleStatus.textContent = t.googleConnecting || 'Povezivanje...';
          googleStatus.style.color = 'var(--dim)';
        }

        try {
          const result = await fb_auth.currentUser.linkWithPopup(provider);
          console.log('[B&R] Successfully linked with Google (popup)', result.user);
          if (result && result.user) {
            await handleGoogleSignInSuccess(result.user);
          }
          updateGoogleLinkStatus();
        } catch (popupErr) {
          console.warn('[B&R] Popup link failed, switching to redirect:', popupErr.code, popupErr.message);
          if (popupErr.code === 'auth/credential-already-in-use' && popupErr.credential) {
            const res = await fb_auth.signInWithCredential(popupErr.credential);
            console.log('[B&R] Signed into existing Google account:', res.user.uid);
            if (res && res.user) {
              await handleGoogleSignInSuccess(res.user);
            }
            updateGoogleLinkStatus();
          } else {
            // Fallback to redirect for native mobile WebView
            await fb_auth.currentUser.linkWithRedirect(provider);
          }
        }
      } catch (error) {
        console.error('[B&R] Google link error', error);
        if (googleStatus) {
          if (error.code === 'auth/credential-already-in-use') {
            googleStatus.textContent = t.googleAlreadyLinked || '⚠️ Google nalog je već povezan';
          } else {
            googleStatus.textContent = (t.googleError || '❌ Greška') + ' (' + (error.code || 'problem') + ')';
          }
          googleStatus.style.color = 'var(--danger)';
        }
      } finally {
        btnLinkGoogleBtn.disabled = false;
        btnLinkGoogleBtn.style.opacity = '1';
      }
    });
  }

  async function handleGoogleSignInSuccess(googleUser) {
    if (!googleUser) return;
    fb_userId = googleUser.uid;
    localStorage.setItem('blocksrocks_userId', fb_userId);
    
    // Check if this Google account already has a registered username
    if (fb_db) {
      try {
        const userDoc = await fb_db.collection('users').doc(fb_userId).get();
        if (userDoc.exists && userDoc.data().username) {
          const cloudName = userDoc.data().username;
          saveUsername(cloudName);
          username = cloudName;
          if (usernameInput) usernameInput.value = cloudName;
          if (isOnboarding) {
            isOnboarding = false;
            usernameModal.classList.remove('is-onboarding');
            usernameModal.style.display = 'none';
          }
          console.log('[B&R] Google profile username restored:', cloudName);
        } else if (username && username.length >= 3) {
          // Sync current username to Google account profile
          await registerAndSaveUsername(username);
        } else if (googleUser.displayName) {
          const cleanDisplay = googleUser.displayName.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u0400-\u04FF]/g, '').substring(0,12);
          if (cleanDisplay.length >= 3 && usernameInput) {
            usernameInput.value = cleanDisplay;
            usernameInput.dispatchEvent(new Event('input'));
          }
        }
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

    // No local username: check Firestore users/{uid}
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

    // Still no username found -> show onboarding modal!
    showUsernameModal(null, true);
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

      // Update cloud profile with personal best and country
      const validCc = (countryCode && countryCode !== 'XX') ? countryCode : guessCountryFromDevice();
      fb_db.collection('users').doc(fb_userId).set({
        username: username.trim(),
        countryCode: validCc && validCc.length === 2 ? validCc : 'XX',
        personalBest: personalBest,
        updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
      }, { merge: true }).catch(err => console.warn('[B&R] Profile sync warning:', err));

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
      if(fb_db){
        fb_db.collection('users').doc(fb_userId).set({
          username: username.trim(),
          countryCode: validCc,
          personalBest: personalBest,
          updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
        }, { merge: true }).catch(err => console.warn('[B&R] User profile update notice:', err));
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

      const uname = (typeof data.username === 'string' && data.username.length >= 3 && data.username.length <= 12)
        ? data.username : (username && username.length >= 3 ? username : 'Igrač');
      const cc = (typeof data.countryCode === 'string' && data.countryCode.length === 2 && data.countryCode !== 'XX')
        ? data.countryCode : (countryCode && countryCode !== 'XX' ? countryCode : guessCountryFromDevice());

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
   *  LEADERBOARD — multi-score ("leaderboard" kolekcija)
   *  Svaka partija = jedan dokument; prikaz: TOP 3 po
   *  korisniku + paginacija (dugme "UČITAJ JOŠ").
   * ═══════════════════════════════════════════════ */
  const PAGE_SIZE = 25;
  const COUNTRY_PAGE_SIZE = 100;
  const MAX_ENTRIES_PER_USER = 3;

  // ── fetch batches ──
  async function fetchGlobalBatch(afterSnap, limit){
    if(!firebaseReady || !fb_db) return { items: [], lastSnap: null };
    try {
      let q = fb_db.collection('leaderboard')
        .orderBy('score', 'desc');
      if(afterSnap) q = q.startAfter(afterSnap);
      q = q.limit(limit || PAGE_SIZE);
      const snap = await q.get();
      return { items: snap.docs.map(d => d.data()), lastSnap: snap.docs.length ? snap.docs[snap.docs.length-1] : null };
    } catch(err){
      console.warn('[B&R] Global fetch failed:', err.message);
      return { items: [], lastSnap: null };
    }
  }

  async function fetchCountryBatch(code, afterSnap, limit){
    const fetchLimit = limit || COUNTRY_PAGE_SIZE;
    if(!firebaseReady || !code || code === 'XX' || !fb_db) return { items: [], lastSnap: null };
    try {
      let q = fb_db.collection('leaderboard')
        .where('countryCode', '==', code)
        .orderBy('score', 'desc');
      if(afterSnap) q = q.startAfter(afterSnap);
      q = q.limit(fetchLimit);
      const snap = await q.get();
      return { items: snap.docs.map(d => d.data()), lastSnap: snap.docs.length ? snap.docs[snap.docs.length-1] : null };
    } catch(err){
      console.warn('[B&R] Country fetch failed, using global filter fallback:', err.message);
      try {
        const globalRes = await fetchGlobalBatch(null, 150);
        const filtered = globalRes.items.filter(item => item.countryCode === code);
        return { items: filtered.slice(0, fetchLimit), lastSnap: null };
      } catch(e2) {
        return { items: [], lastSnap: null };
      }
    }
  }

  async function fetchMyTop3(){
    let localTop = [];
    try {
      localTop = JSON.parse(localStorage.getItem('blocksrocks_myScores') || '[]');
    } catch(e){}

    if(!firebaseReady || !fb_userId || !fb_db) {
      return GameCore.sortScoresByTop(localTop, MAX_ENTRIES_PER_USER);
    }

    try {
      const snap = await fb_db.collection('leaderboard')
        .where('userId', '==', fb_userId)
        .get();
      const cloudItems = snap.docs.map(d => d.data());
      const combined = GameCore.mergePages(cloudItems, localTop);
      const top3 = GameCore.sortScoresByTop(combined, MAX_ENTRIES_PER_USER);
      localStorage.setItem('blocksrocks_myScores', JSON.stringify(top3));
      if(top3.length && top3[0].score > personalBest){
        savePersonalBest(top3[0].score);
        best = top3[0].score;
        if(bestEl) bestEl.textContent = best;
      }
      return top3;
    } catch(err){
      console.warn('[B&R] My scores fetch failed, using local:', err.message);
      return GameCore.sortScoresByTop(localTop, MAX_ENTRIES_PER_USER);
    }
  }

  /* ── DOM refs ── */
  const lbOverlay = document.getElementById('lb-overlay');
  const lbPersonalBest = document.getElementById('lbPersonalBest');
  const lbMyList = document.getElementById('lbMyList');
  const lbContent = document.getElementById('lbContent');
  const lbLoadMoreWrap = document.getElementById('lbLoadMoreWrap');
  const lbLoadMoreBtn = document.getElementById('lbLoadMoreBtn');
  const lbCountryLabel = document.getElementById('lbCountryLabel');
  const tabCountry = document.getElementById('tabCountry');
  const tabGlobal = document.getElementById('tabGlobal');

  let currentTab = 'country';
  let lbItems = [];
  let lbLastSnap = null;
  let lbAllLoaded = false;
  let lbLoadingMore = false;
  let lbObserver = null;
  let returnToOverlayOnLbClose = false;

  function cleanupLbObserver(){
    if(lbObserver){
      lbObserver.disconnect();
      lbObserver = null;
    }
  }

  function drawLb(){
    cleanupLbObserver();
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    if(!lbItems.length){
      lbContent.innerHTML = '<div class="lb-empty">' + (t.lbEmpty || 'Još nema rezultata.<br>Budi prvi! 🚀') + '</div>';
      lbLoadMoreWrap.style.display = 'none';
      return;
    }
    const medals = ['gold','silver','bronze'];
    let html = '<ul class="lb-list">';
    lbItems.forEach((d, idx)=>{
      const rank = idx + 1;
      const isMe = (d.userId && d.userId === fb_userId) || (d.username && d.username === username);
      const medalClass = rank <= 3 ? medals[rank-1] : (rank <= 10 ? 'top10' : '');
      const rankRowClass = rank <= 3 ? ('rank-' + rank) : '';
      let rankBadge = '#' + rank;
      if (rank === 1) rankBadge = '👑 1';
      else if (rank === 2) rankBadge = '🥈 2';
      else if (rank === 3) rankBadge = '🥉 3';
      else if (rank <= 10) rankBadge = '🎖️ ' + rank;

      const flag = countryFlag(d.countryCode);
      const meBadgeHtml = isMe ? ('<span class="lb-badge-me">' + (t.badgeMe || 'TI') + '</span>') : '';
      html += '<li class="lb-row ' + (isMe ? 'me ' : '') + rankRowClass + '">'
        + '<span class="lb-rank ' + medalClass + '">' + rankBadge + '</span>'
        + '<span class="lb-flag">' + flag + '</span>'
        + '<span class="lb-name">' + escapeHtml(d.username || 'Anon') + meBadgeHtml + '</span>'
        + '<span class="lb-score">' + (Number(d.score)||0).toLocaleString() + '</span>'
        + '</li>';
    });
    html += '</ul>';

    if(!lbAllLoaded){
      html += '<div id="lbScrollSentinel" class="lb-scroll-sentinel"><div class="lb-mini-spinner"></div></div>';
    }

    lbContent.innerHTML = html;
    // Dugme "UČITAJ JOŠ" = fallback za okruženja bez IntersectionObserver-a
    lbLoadMoreWrap.style.display = (!lbAllLoaded && !window.IntersectionObserver) ? 'block' : 'none';

    if(!lbAllLoaded && window.IntersectionObserver){
      const sentinel = document.getElementById('lbScrollSentinel');
      const rootScroll = document.querySelector('.lb-card');
      if(sentinel){
        lbObserver = new IntersectionObserver((entries)=>{
          if(entries[0] && entries[0].isIntersecting && !lbLoadingMore && !lbAllLoaded){
            loadMore();
          }
        }, { root: rootScroll, rootMargin: '100px' });
        lbObserver.observe(sentinel);
      }
    }
  }

  function renderMyTop3(list){
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const top = GameCore.sortScoresByTop(list, MAX_ENTRIES_PER_USER);
    if(!top.length){
      lbMyList.innerHTML = '<div class="my-empty">' + (t.lbMyEmpty || 'Nema još rezultata — odigraj partiju!') + '</div>';
      lbPersonalBest.innerHTML = '0<span>pts</span>';
      return;
    }
    lbPersonalBest.innerHTML = (Number(top[0].score)||0).toLocaleString() + '<span>pts</span>';
    const medals = ['🥇','🥈','🥉'];
    let html = '';
    top.forEach((e, i)=>{
      html += '<div class="my-row"><span class="my-rank">' + (medals[i] || ('#'+(i+1))) + '</span><span>' + escapeHtml(e.username || 'Anon') + '</span><span class="my-score">' + ((Number(e.score)||0).toLocaleString()) + '</span></div>';
    });
    lbMyList.innerHTML = html;
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function loadLeaderboard(tab){
    cleanupLbObserver();
    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    currentTab = tab;
    lbItems = [];
    lbLastSnap = null;
    lbAllLoaded = false;
    lbLoadingMore = false;
    lbContent.innerHTML = '<div class="lb-loading"><div class="lb-spinner"></div></div>';

    // Personal top-3 (nezavisno od taba)
    renderMyTop3(await fetchMyTop3());

    tabCountry.classList.toggle('active', tab === 'country');
    tabGlobal.classList.toggle('active', tab === 'global');

    let res;
    if(tab === 'country'){
      if(countryCode === 'XX'){
        lbCountryLabel.textContent = t.lbLocationUnavailable || '🌐 Lokacija nedostupna — World TOP 100';
        lbCountryLabel.style.display = '';
        res = await fetchGlobalBatch(null, PAGE_SIZE);
      } else {
        lbCountryLabel.textContent = countryFlag(countryCode) + ' ' + getFullCountryName(countryCode, currentLang) + ' (TOP 100)';
        lbCountryLabel.style.display = '';
        res = await fetchCountryBatch(countryCode, null, PAGE_SIZE);
      }
      lbItems = res.items;
      lbLastSnap = res.lastSnap;
      lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE || lbItems.length >= 100;
    } else {
      lbCountryLabel.style.display = 'none';
      res = await fetchGlobalBatch(null, PAGE_SIZE);
      lbItems = res.items;
      lbLastSnap = res.lastSnap;
      lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE;
    }
    drawLb();
  }

  async function loadMore(){
    if(!lbLastSnap || lbAllLoaded || lbLoadingMore) return;
    lbLoadingMore = true;
    try {
      let res;
      if(currentTab === 'country'){
        if(countryCode === 'XX') res = await fetchGlobalBatch(lbLastSnap, PAGE_SIZE);
        else res = await fetchCountryBatch(countryCode, lbLastSnap, PAGE_SIZE);
        lbItems = GameCore.mergePages(lbItems, res.items);
        lbLastSnap = res.lastSnap;
        lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE || lbItems.length >= 100;
      } else {
        res = await fetchGlobalBatch(lbLastSnap, PAGE_SIZE);
        lbItems = GameCore.mergePages(lbItems, res.items);
        lbLastSnap = res.lastSnap;
        lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE;
      }
      drawLb();
    } catch(err){
      console.warn('[B&R] loadMore error:', err);
    } finally {
      lbLoadingMore = false;
    }
  }

  function openLeaderboard(){
    lbOverlay.style.display = 'flex';
    loadLeaderboard(currentTab);
  }

  function closeLeaderboard(){
    cleanupLbObserver();
    lbOverlay.style.display = 'none';
    // If we opened the leaderboard from the game-over screen, bring the overlay back
    if(returnToOverlayOnLbClose){
      returnToOverlayOnLbClose = false;
      if(gameOver) overlayEl.style.display = 'flex';
    }
  }

  // Load more
  lbLoadMoreBtn.addEventListener('click', loadMore);

  // Tab clicks
  tabCountry.addEventListener('click', ()=> loadLeaderboard('country'));
  tabGlobal.addEventListener('click', ()=> loadLeaderboard('global'));

  // Close button
  document.getElementById('lbCloseBtn').addEventListener('click', closeLeaderboard);

  // Close on backdrop click
  lbOverlay.addEventListener('click', (e)=>{
    if(e.target === lbOverlay) closeLeaderboard();
  });

  // Trophy button in header
  document.getElementById('btnTrophy').addEventListener('click', openLeaderboard);

  // NAPOMENA: listener za #showLbBtn (game-over overlay) registruje se samo JEDNOM —
  // debounced verzija pri dnu fajla (ranije dupliran → dvostruko učitavanje rang liste).

  /* ═══════════════════════════════════════════════
   *  BOTTOM RECORDS WIDGET (Country & Global Tops)
   * ═══════════════════════════════════════════════ */
  let cachedCountryTop = null;
  let cachedGlobalTop = null;
  let isFetchingBottomRecords = false;

  async function updateBottomRecords(forceFetch = false) {
    const elCountryFlag = document.getElementById('bottomCountryFlag');
    const elCountryName = document.getElementById('bottomCountryName');
    const elCountryPlayer = document.getElementById('bottomCountryPlayer');
    const elCountryPoints = document.getElementById('bottomCountryPoints');

    const elGlobalFlag = document.getElementById('bottomGlobalFlag');
    const elGlobalName = document.getElementById('bottomGlobalName');
    const elGlobalPlayer = document.getElementById('bottomGlobalPlayer');
    const elGlobalPoints = document.getElementById('bottomGlobalPoints');

    const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    const effectiveCode = (countryCode && countryCode !== 'XX') ? countryCode : guessCountryFromDevice();

    // Immediate UI text update with localized country name and current tab
    if (elCountryFlag) elCountryFlag.textContent = countryFlag(effectiveCode);
    if (elCountryName) elCountryName.textContent = getFullCountryName(effectiveCode, currentLang);
    if (elGlobalFlag) elGlobalFlag.textContent = '🌍';
    if (elGlobalName) elGlobalName.textContent = t.tabGlobal || 'Svet';

    if (cachedCountryTop && !forceFetch) {
      if (elCountryPlayer) elCountryPlayer.textContent = cachedCountryTop.username || '—';
      if (elCountryPoints) elCountryPoints.textContent = Number(cachedCountryTop.score || 0).toLocaleString();
    }
    if (cachedGlobalTop && !forceFetch) {
      const gFlag = cachedGlobalTop.countryCode ? countryFlag(cachedGlobalTop.countryCode) + ' ' : '';
      if (elGlobalPlayer) elGlobalPlayer.textContent = gFlag + (cachedGlobalTop.username || '—');
      if (elGlobalPoints) elGlobalPoints.textContent = Number(cachedGlobalTop.score || 0).toLocaleString();
    }

    if (!firebaseReady || !fb_db || isFetchingBottomRecords) return;

    isFetchingBottomRecords = true;
    try {
      // 1. Fetch Top 1 Global
      const globalPromise = fb_db.collection('leaderboard')
        .orderBy('score', 'desc')
        .limit(1)
        .get()
        .then(snap => (snap.docs && snap.docs.length) ? snap.docs[0].data() : null)
        .catch(err => { console.warn('[B&R] Global record fetch failed:', err.message); return null; });

      // 2. Fetch Top 1 Country with scan fallback
      const countryPromise = (effectiveCode && effectiveCode !== 'XX')
        ? fb_db.collection('leaderboard')
            .where('countryCode', '==', effectiveCode)
            .orderBy('score', 'desc')
            .limit(1)
            .get()
            .then(snap => (snap.docs && snap.docs.length) ? snap.docs[0].data() : null)
            .catch(async err => {
              console.warn('[B&R] Country query failed, scanning global top 100:', err.message);
              try {
                const scanSnap = await fb_db.collection('leaderboard')
                  .orderBy('score', 'desc')
                  .limit(100)
                  .get();
                const match = scanSnap.docs.map(d => d.data()).find(d => d.countryCode === effectiveCode);
                return match || null;
              } catch(e2) {
                return null;
              }
            })
        : Promise.resolve(null);

      const [globalDoc, countryDoc] = await Promise.all([globalPromise, countryPromise]);

      if (globalDoc) {
        cachedGlobalTop = globalDoc;
        const gFlag = globalDoc.countryCode ? countryFlag(globalDoc.countryCode) + ' ' : '';
        if (elGlobalPlayer) elGlobalPlayer.textContent = gFlag + (globalDoc.username || '—');
        if (elGlobalPoints) elGlobalPoints.textContent = Number(globalDoc.score || 0).toLocaleString();
      } else if (!cachedGlobalTop) {
        if (elGlobalPlayer) elGlobalPlayer.textContent = '—';
        if (elGlobalPoints) elGlobalPoints.textContent = '0';
      }

      if (countryDoc) {
        cachedCountryTop = countryDoc;
        if (elCountryPlayer) elCountryPlayer.textContent = countryDoc.username || '—';
        if (elCountryPoints) elCountryPoints.textContent = Number(countryDoc.score || 0).toLocaleString();
      } else if (!cachedCountryTop) {
        if (elCountryPlayer) elCountryPlayer.textContent = '—';
        if (elCountryPoints) elCountryPoints.textContent = '0';
      }
    } finally {
      isFetchingBottomRecords = false;
    }
  }

  // Bottom cards click bindings -> open corresponding leaderboard tab
  const bottomCountryCard = document.getElementById('bottomCountryCard');
  if (bottomCountryCard) {
    bottomCountryCard.addEventListener('click', () => {
      openLeaderboard();
      loadLeaderboard('country');
      haptic('light');
    });
  }

  const bottomGlobalCard = document.getElementById('bottomGlobalCard');
  if (bottomGlobalCard) {
    bottomGlobalCard.addEventListener('click', () => {
      openLeaderboard();
      loadLeaderboard('global');
      haptic('light');
    });
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
   *  SOUND EFFECTS (Web Audio API)
   * ═══════════════════════════════════════════════ */
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  function getAudioCtx(){
    if(!audioCtx) audioCtx = new AudioCtx();
    if(audioCtx.state === 'suspended') {
      audioCtx.resume().catch(()=>{});
    }
    return audioCtx;
  }
  // Unlock audio on first user gesture for mobile / WebView
  function unlockAudio(){
    if(audioCtx && audioCtx.state === 'suspended'){
      audioCtx.resume().catch(()=>{});
    }
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  function playTone(freq, duration, type, vol){
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
  function haptic(type){
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
  function setMuted(v){
    muted = !!v;
    localStorage.setItem('blocksrocks_muted', muted ? '1' : '0');
    const icon = document.getElementById('btnMute');
    if(icon) icon.textContent = muted ? '🔇' : '🔊';
    const pm = document.getElementById('pauseMuteBtn');
    if(pm){
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
      pm.textContent = (muted ? '🔇 ' : '🔊 ') + t.pauseMutePrefix + (muted ? t.soundOff : t.soundOn);
    }
  }
  function toggleMute(){ setMuted(!muted); }

  function sfxPlace(){ playTone(520, 0.10, 'sine', 0.13); playTone(680, 0.08, 'triangle', 0.08); haptic('light'); }
  function sfxClear(){
    playTone(600, 0.12, 'sine', 0.1);
    setTimeout(()=> playTone(800, 0.14, 'sine', 0.1), 60);
    setTimeout(()=> playTone(1100, 0.18, 'triangle', 0.08), 120);
    haptic('success');
  }
  function sfxBomb(){
    playTone(120, 0.35, 'sawtooth', 0.15);
    playTone(80, 0.5, 'sine', 0.12);
    haptic('heavy');
  }
  function sfxHammer(){
    playTone(160, 0.15, 'sawtooth', 0.2);
    playTone(90, 0.22, 'triangle', 0.18);
    haptic('heavy');
  }
  function sfxReroll(){
    playTone(440, 0.07, 'sine', 0.1);
    setTimeout(()=> playTone(554, 0.08, 'sine', 0.1), 50);
    setTimeout(()=> playTone(659, 0.09, 'sine', 0.1), 100);
    setTimeout(()=> playTone(880, 0.12, 'sine', 0.12), 150);
    haptic('medium');
  }
  function sfxRotate(){
    playTone(720, 0.06, 'triangle', 0.1);
    haptic('light');
  }
  function sfxNewBest(){
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 triumph fanfare
    notes.forEach((freq, i) => {
      setTimeout(() => {
        playTone(freq, 0.18 + i * 0.04, 'sine', 0.14);
        if (i === notes.length - 1) playTone(freq, 0.35, 'triangle', 0.12);
      }, i * 90);
    });
    haptic('success');
  }
  function playComboAudio(streak, lines){
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
  function sfxGameOver(){
    playTone(440, 0.2, 'sine', 0.1);
    setTimeout(()=> playTone(370, 0.2, 'sine', 0.1), 150);
    setTimeout(()=> playTone(300, 0.4, 'sine', 0.12), 300);
    haptic('warning');
  }

  /* ═══════════════════════════════════════════════
   *  SCREEN SHAKE EFFECT
   * ═══════════════════════════════════════════════ */
  function triggerScreenShake(intensity = 'light'){
    const target = document.getElementById('wrap') || boardEl;
    if(!target) return;
    const cls = intensity === 'heavy' ? 'screen-shake-heavy' : 'screen-shake-light';
    target.classList.remove('screen-shake-light', 'screen-shake-heavy');
    void target.offsetWidth;
    target.classList.add(cls);
    setTimeout(() => target.classList.remove(cls), intensity === 'heavy' ? 400 : 280);
  }

  /* ═══════════════════════════════════════════════
   *  CONFETTI SYSTEM (Canvas Particle Burst)
   * ═══════════════════════════════════════════════ */
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

  function triggerConfetti(count = 60){
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
      if (confettiCtx && confettiCanvas) confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      confettiRAF = null;
      return;
    }

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

      confettiCtx.save();
      confettiCtx.globalAlpha = p.alpha;
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate((p.rotation * Math.PI) / 180);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      confettiCtx.restore();
    }

    confettiRAF = requestAnimationFrame(animateConfetti);
  }

  /* ═══════════════════════════════════════════════
   *  SCORE FLOAT ANIMATION
   * ═══════════════════════════════════════════════ */
  function showScoreFloat(points){
    if(points <= 0) return;
    const el = document.createElement('div');
    el.className = 'score-float';
    el.textContent = '+' + points;
    const scorebox = scoreEl.closest('.scorebox');
    scorebox.style.position = 'relative';
    scorebox.appendChild(el);
    el.style.right = '4px';
    el.style.bottom = '100%';
    setTimeout(()=> el.remove(), CONFIG.SCORE_FLOAT_DURATION);
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
      render();
    }
  }

  function randomPiece(){
    pieceCounter++;
    bombCounter++;
    const shape = SHAPES[Math.floor(Math.random()*SHAPES.length)];
    const color = COLORS[Math.floor(Math.random()*COLORS.length)];

    let stoneIndex = (pieceCounter % 10 === 0) ? Math.floor(Math.random()*shape.length) : null;
    let bombIndex = null;

    if(bombCounter >= nextBombAt){
      bombIndex = Math.floor(Math.random()*shape.length);
      if(bombIndex === stoneIndex){
        if(shape.length > 1) stoneIndex = (bombIndex+1) % shape.length;
        else stoneIndex = null;
      }
      bombCounter = 0;
      nextBombAt = 15 + Math.floor(Math.random()*6);
    }

    return {shape, color, stoneIndex, bombIndex, id: Math.random().toString(36).slice(2)};
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
    // Game over only when none of the tray pieces can be placed anywhere
    return !GameCore.trayAnyPlacementOn(grid, SIZE, tray);
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
      grid[row+r][col+c] = {
        color: piece.color,
        hp: isStone?2:1,
        maxHp: isStone?2:1,
        bomb: isBomb,
        timer: isBomb?3:undefined
      };
      placedIndices.push((row+r)*SIZE + (col+c));
      if(isBomb) bombPos = {r:row+r, c:col+c};
    });
    const prevScore = score;
    score += piece.shape.length;
    showScoreFloat(score - prevScore);
    grantPowerupRewards(prevScore, score);
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

  function spawnParticles(cellsToClear, colorOverride){
    const rect = boardEl.getBoundingClientRect();
    const padding = 8, gap = 4;
    const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
    const total = cellsToClear.length || 1;
    const count = total > 12 ? 2 : (total > 6 ? 3 : CONFIG.PARTICLE_COUNT);

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

  function spawnCrackParticles(cellsToClear){
    const rect = boardEl.getBoundingClientRect();
    const padding = 8, gap = 4;
    const cellW = (rect.width - padding*2 - gap*(SIZE-1)) / SIZE;
    const total = cellsToClear.length || 1;
    const count = total > 12 ? 2 : (total > 6 ? 3 : CONFIG.CRACK_PARTICLE_COUNT);

    const existing = document.querySelectorAll('.particle');
    if (existing.length > 36) {
      for (let k = 0; k < existing.length - 20; k++) existing[k].remove();
    }

    cellsToClear.forEach(key=>{
      const [r,c] = key.split('_').map(Number);
      const cx = rect.left + padding + c*(cellW+gap) + cellW/2;
      const cy = rect.top + padding + r*(cellW+gap) + cellW/2;

      const grays = ['#8b90a3','#6b7185','#a9adbd'];
      for(let i=0;i<count;i++){
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.width = '4px'; p.style.height = '4px';
        p.style.background = grays[i % grays.length];
        p.style.left = cx+'px';
        p.style.top = cy+'px';
        document.body.appendChild(p);

        const angle = (Math.PI*2*i/count) + Math.random()*0.6;
        const dist = 12 + Math.random()*16;
        const dx = Math.cos(angle)*dist;
        const dy = Math.sin(angle)*dist;

        p.animate([
          { transform:'translate3d(0,0,0) scale(1)', opacity:1 },
          { transform:`translate3d(${dx}px, ${dy}px, 0) scale(0.4)`, opacity:0 }
        ], { duration: 260 + Math.random()*100, easing:'cubic-bezier(.2,.7,.3,1)' });

        setTimeout(()=>p.remove(), 400);
      }
    });
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

  function spawnShockwave(r,c){
    const rect = boardEl.getBoundingClientRect();
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

  function explodeBomb(r,c){
    const cellData = grid[r][c];
    if(!cellData) return;

    lineClearInProgress = true;
    spawnShockwave(r,c);
    sfxBomb();
    triggerScreenShake('heavy');

    const affected = [];
    for(let dr=-1;dr<=1;dr++){
      for(let dc=-1;dc<=1;dc++){
        const rr=r+dr, cc=c+dc;
        if(rr>=0&&rr<SIZE&&cc>=0&&cc<SIZE){
          const data = grid[rr][cc];
          if(data) affected.push({r:rr, c:cc, willRemove: data.hp <= 1});
        }
      }
    }
    affected.sort((a,b)=> Math.hypot(a.r-r,a.c-c) - Math.hypot(b.r-r,b.c-c));

    const affectedSnapshot = affected.map(pos => {
      const data = grid[pos.r][pos.c];
      return {
        ...pos,
        color: data ? data.color : '#fb7185',
        willRemove: data ? data.hp <= 1 : true,
      };
    });

    const stagger = CONFIG.BOMB_STAGGER;

    affectedSnapshot.forEach((pos,i)=>{
      setTimeout(()=>{
        const data = grid[pos.r][pos.c];
        if(!data) return;
        const idx = pos.r*SIZE+pos.c;
        const el = boardEl.children[idx];
        if(pos.willRemove){
          if(el){
            el.style.color = el.style.backgroundColor;
            el.classList.remove('bomb-cell');
            const lbl = el.querySelector('.bomb-label');
            if(lbl) lbl.remove();
            el.classList.add('clearing');
          }
          spawnParticles([pos.r+'_'+pos.c]);
        } else {
          data.hp -= 1;
          if(el){
            el.classList.remove('stone-full');
            el.classList.add('stone-cracked','cracking');
            el.style.backgroundColor = data.color;
          }
          spawnCrackParticles([pos.r+'_'+pos.c]);
        }
      }, i*stagger);
    });

    const removedCount = affectedSnapshot.filter(p=>p.willRemove).length;
    const crackedCount = affectedSnapshot.length - removedCount;
    const bombBonus = removedCount*2 + crackedCount*1 + 10;
    const prevBombScore = score;
    score += bombBonus;
    showScoreFloat(bombBonus);
    grantPowerupRewards(prevBombScore, score, CONFIG.MSG_DURATION_BOMB);
    const tBomb = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
    showMsg((tBomb.msgExplosion || '💥 EKSPLOZIJA! +') + bombBonus, CONFIG.MSG_DURATION_BOMB);
    track('bomb_explode', { bonus: bombBonus });

    const totalDelay = affectedSnapshot.length*stagger + CONFIG.CLEAR_ANIM_DURATION;
    setTimeout(()=>{
      affectedSnapshot.forEach(pos=>{
        if(pos.willRemove) {
          grid[pos.r][pos.c] = null;
          const idx = pos.r*SIZE+pos.c;
          const el = boardEl.children[idx];
          if(el) el.classList.remove('clearing');
        }
      });
      lineClearInProgress = false;
      render();
      clearLines(()=>{
        checkAndTriggerGameOver(CONFIG.GAME_OVER_DELAY_AFTER_BOMB);
      });
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

    const stagger = CONFIG.LINE_CLEAR_STAGGER;

    cellsArr.forEach(({r,c,key,willRemove}, i)=>{
      setTimeout(()=>{
        const idx = r*SIZE+c;
        const el = boardEl.children[idx];
        if(willRemove){
          if(el){
            el.style.color = el.style.backgroundColor;
            el.classList.remove('bomb-cell');
            const lbl = el.querySelector('.bomb-label');
            if(lbl) lbl.remove();
            el.classList.remove('pop-in');
            el.classList.add('clearing');
          }
          spawnParticles([key]);
        } else {
          const cellData = grid[r][c];
          if(cellData) cellData.hp -= 1;
          if(el){
            el.classList.remove('stone-full');
            el.classList.add('stone-cracked','cracking');
            if(cellData) el.style.backgroundColor = cellData.color;
          }
          spawnCrackParticles([key]);
        }
      }, i*stagger);
    });

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

    const totalDelay = cellsArr.length*stagger + CONFIG.CLEAR_ANIM_DURATION;
    setTimeout(()=>{
      cellsArr.forEach(({r,c,willRemove})=>{
        if(willRemove) {
          grid[r][c] = null;
          const idx = r*SIZE+c;
          const el = boardEl.children[idx];
          if(el) el.classList.remove('clearing');
        }
      });
      lineClearInProgress = false;
      render();
      if(onCleared) onCleared();
    }, totalDelay);
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

    if(cellData.hp > 1){
      cellData.hp -= 1;
    } else {
      if(cellData.maxHp === 2) recordCareerStat('rocksCrushed', 1);
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
  function initBoardDOM(){
    boardEl.innerHTML = '';
    cellElements = [];
    for(let r=0; r<SIZE; r++){
      for(let c=0; c<SIZE; c++){
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.r = r;
        div.dataset.c = c;
        div.addEventListener('click', () => handleCellClick(r, c));
        boardEl.appendChild(div);
        cellElements.push(div);
      }
    }
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
          let cls = 'cell';
          if(data){
            cls += ' filled';
            if(data.maxHp === 2 && data.hp >= 2) cls += ' stone-full';
            else if(data.maxHp === 2 && data.hp === 1) cls += ' stone-cracked';
            if(data.bomb) cls += ' bomb-cell';
          }
          if (div.className !== cls) {
            div.className = cls;
          }
          if(data){
            if(!(data.maxHp === 2 && data.hp >= 2)){
              div.style.backgroundColor = data.color || '#5eead4';
            } else {
              div.style.backgroundColor = '';
            }
            if(data.bomb){
              let label = div.querySelector('.bomb-label');
              if(!label){
                label = document.createElement('div');
                label.className = 'bomb-label';
                div.appendChild(label);
              }
              label.textContent = data.timer || 3;
            } else {
              const label = div.querySelector('.bomb-label');
              if(label) label.remove();
            }
          } else {
            div.style.backgroundColor = '';
            const label = div.querySelector('.bomb-label');
            if(label) label.remove();
          }
        }
      }
      renderTray();
      if(scoreEl) scoreEl.textContent = score;
      if(score > best){
        if(best > 0 && !hasCelebratedNewBest){
          hasCelebratedNewBest = true;
          triggerConfetti(70);
          sfxNewBest();
          const bestBox = document.querySelector('.scorebox.best');
          if(bestBox) bestBox.classList.add('record-breaking');
        }
        best = score;
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
          const pg = document.createElement('div');
          pg.className = 'piece-grid';
          pg.style.gridTemplateColumns = `repeat(${cols}, 16px)`;
          pg.style.gridTemplateRows = `repeat(${rows}, 16px)`;
          for(let r=0;r<rows;r++){
            for(let c=0;c<cols;c++){
              const shapeIdx = piece.shape.findIndex(([sr,sc])=>sr===r&&sc===c);
              const on = shapeIdx !== -1;
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
      if(gameOver || paused || lineClearInProgress || !slot._piece) return;
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
  }

  let cachedBoardGeometry = null;
  let lastPreviewRow = null;
  let lastPreviewCol = null;

  function buildGhost(piece){
    const {rows, cols} = shapeSize(piece.shape);
    const {cellW} = cachedBoardGeometry || getCellGeometry();
    ghostEl.innerHTML = '';
    ghostEl.style.display = 'grid';
    ghostEl.style.gridTemplateColumns = `repeat(${cols}, ${cellW}px)`;
    ghostEl.style.gridTemplateRows = `repeat(${rows}, ${cellW}px)`;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const shapeIdx = piece.shape.findIndex(([sr,sc])=>sr===r&&sc===c);
        const on = shapeIdx !== -1;
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

  let sparkThrottle = 0;
  function spawnSpark(x, y) {
    if (!particleTrailEnabled) return;
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

  function moveGhost(x,y){
    const {rows, cols} = shapeSize(dragging.piece.shape);
    const cellW = (cachedBoardGeometry || getCellGeometry()).cellW;
    const raise = getGhostRaise(rows);
    ghostEl.style.left = (x - cols*cellW/2) + 'px';
    ghostEl.style.top = (y - rows*cellW/2 - raise) + 'px';
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

  function clearPreview(){
    previewCells.forEach(el=>{
      el.classList.remove('preview-ok','preview-bad');
    });
    previewCells.clear();
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
        const { rows } = shapeSize(dragging.piece.shape);
        spawnSpark(dragging.x, dragging.y - getGhostRaise(rows));
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

  function saveCareerStats(){
    try {
      localStorage.setItem('blocksrocks_careerStats', JSON.stringify(careerStats));
    } catch(e){}
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
      localStorage.setItem('blocksrocks_matchHistory', JSON.stringify(history));
    } catch(e){}
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
    const isNewBest = finalScore > 0 && finalScore > best;
    if(isNewBest){
      best = finalScore;
      savePersonalBest(best);
      if(bestEl) bestEl.textContent = best;
      triggerConfetti(80);
      sfxNewBest();
    }
    document.getElementById('newbestLabel').style.display = isNewBest ? '' : 'none';
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

  document.getElementById('showLbBtn').addEventListener('click', ()=>{
    debounceAction('showLb', ()=>{
      returnToOverlayOnLbClose = true;
      overlayEl.style.display = 'none';
      openLeaderboard();
    }, CONFIG.RESTART_DEBOUNCE_MS);
  });

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
  setMuted(muted);
  loadAnalytics();
  trackRetention();

  // Tek sada su TRANSLATIONS / currentLang i ostali resursi sigurno inicijalizovani
  detectCountry();

  newGame();
})();
