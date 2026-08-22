/*
 * Blocks & Rocks — Firebase Initialization Module
 * Handles: Firebase App, App Check, Auth, anonymous sign-in, auth state listener.
 */
let fb_app = null, fb_appCheck = null, fb_auth = null, fb_db = null, fb_userId = null;
let firebaseReady = false;

const firebaseConfig = {
  apiKey: "AIzaSyAKJ-j1nkalaTm5S2QrkLZofVYfae2ekJM",
  authDomain: "blocks-and-rocks.firebaseapp.com",
  projectId: "blocks-and-rocks",
  storageBucket: "blocks-and-rocks.firebasestorage.app",
  messagingSenderId: "556570853814",
  appId: "1:556570853814:web:9a6c66cc922c4da4870117"
};

const appCheckSiteKey = '6LeFh4UtAAAAAHyBkW5vpD_iWNa1-uOFrCUe_T7D';
const APP_CHECK_DEBUG = (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'))
  || (typeof localStorage !== 'undefined' && localStorage.getItem('blocksrocks_appcheck_debug') === '1');

export function getFirebase() {
  return { fb_app, fb_appCheck, fb_auth, fb_db, fb_userId, firebaseReady };
}

export function initFirebase(onReady) {
  let username = localStorage.getItem('blocksrocks_username') || '';
  let personalBest = parseInt(localStorage.getItem('blocksrocks_personalBest') || '0');

  try {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      console.warn('[B&R] Firebase SDK not present, starting in offline local mode.');
      fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
      if (!username) onReady && onReady({ needsOnboarding: true });
      return;
    }

    fb_app = firebase.initializeApp(firebaseConfig);

    if (typeof firebase.appCheck === 'function') {
      try {
        const isNativeAppCheck = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (!isNativeAppCheck && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        fb_appCheck = firebase.appCheck();

        if (isNativeAppCheck) {
          const NativeAppCheck = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAppCheck;
          if (NativeAppCheck && typeof NativeAppCheck.getToken === 'function' && typeof firebase.appCheck.CustomProvider === 'function') {
            if (typeof NativeAppCheck.initialize === 'function') {
              NativeAppCheck.initialize({ debug: APP_CHECK_DEBUG, isTokenAutoRefreshEnabled: true }).catch(()=>{});
            }
            const nativeProvider = new firebase.appCheck.CustomProvider({
              getToken: () => NativeAppCheck.getToken().then(r => ({ token: r.token, expireTimeMillis: Date.now() + 3600000 })).catch(() => { throw new Error('AppCheck token unavailable'); })
            });
            fb_appCheck.initializeAppCheck({ provider: nativeProvider, isTokenAutoRefreshEnabled: true });
            console.log('[B&R] App Check aktivan (Play Integrity / native)');
          }
        } else if (appCheckSiteKey) {
          fb_appCheck.activate(appCheckSiteKey, true);
          console.log('[B&R] App Check aktivan (reCAPTCHA v3) — Debug token:', APP_CHECK_DEBUG);
        }
      } catch(e) { console.warn('[B&R] App Check init notice:', e.message); }
    }

    fb_auth = firebase.auth();
    fb_db = firebase.firestore();

    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative) {
      fb_auth.signInAnonymously().catch(err => {
        console.warn('[B&R] Firebase Auth failed:', err.message);
        if (!fb_userId) fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
      });
    } else {
      const redirectTimeoutMs = 2500;
      let redirectTimerId = null;
      const redirectTimeout = new Promise((_, reject) => {
        redirectTimerId = setTimeout(() => reject(new Error('redirect_timeout')), redirectTimeoutMs);
      });
      Promise.race([fb_auth.getRedirectResult(), redirectTimeout]).catch(err => {
        if (err && err.message !== 'redirect_timeout') console.warn('[B&R] Redirect Auth error:', err.code, err.message);
      }).finally(() => {
        if (redirectTimerId) { clearTimeout(redirectTimerId); redirectTimerId = null; }
        if (fb_auth.currentUser) return;
        fb_auth.signInAnonymously().catch(err => {
          console.warn('[B&R] Firebase Auth failed:', err.message);
          if (!fb_userId) fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
        });
      });
    }

    fb_auth.onAuthStateChanged(user => {
      if (user) {
        fb_userId = user.uid;
        localStorage.setItem('blocksrocks_userId', fb_userId);
        firebaseReady = true;
        console.log('[B&R] Firebase Auth OK:', fb_userId);
        onReady && onReady({ user, username, personalBest });
      }
    });

    window.addEventListener('online', async () => {
      console.log('[B&R] Network connection online, syncing data...');
      onReady && onReady({ online: true });
    });

  } catch(e) {
    console.warn('[B&R] Firebase init error:', e);
    fb_userId = localStorage.getItem('blocksrocks_userId') || 'local_' + Math.random().toString(36).slice(2);
  }
}

export { fb_app, fb_appCheck, fb_auth, fb_db, fb_userId, firebaseReady, firebaseConfig };