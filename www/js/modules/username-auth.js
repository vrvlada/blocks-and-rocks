/*
 * Blocks & Rocks — Username & Auth Module
 * Handles: username management, Google Sign-In (native + web), Firestore user profile sync, first-run & settings modals.
 */
import { TRANSLATIONS } from '../../i18n.js';
import { escapeHtml } from '../utils.js';

let ctx = null;
let isOnboarding = false;
let isUsernameAvailable = false;
let isCheckingAvailability = false;
let checkAvailabilityTimeout = null;
let usernameCallback = null;

// DOM refs (set during initUserAuth)
let usernameModal = null;
let usernameInput = null;
let usernameCount = null;
let usernameSaveBtn = null;
let usernameCloseBtn = null;
let usernameAvailability = null;
let usernameWelcomeDesc = null;

export function initUserAuth(deps) {
  ctx = deps;
  usernameModal = document.getElementById('usernameModal');
  usernameInput = document.getElementById('usernameInput');
  usernameCount = document.getElementById('usernameCount');
  usernameSaveBtn = document.getElementById('usernameSaveBtn');
  usernameCloseBtn = document.getElementById('usernameCloseBtn');
  usernameAvailability = document.getElementById('usernameAvailability');
  usernameWelcomeDesc = document.getElementById('usernameWelcomeDesc');
}

/* ── Username Save & Personal Best ── */
export function saveUsername(name) {
  if (!ctx) return;
  ctx.username = name;
  localStorage.setItem('blocksrocks_username', name);
  if (typeof ctx.track === 'function') {
    ctx.track('username_set', { name: name });
  }
}

let pbWidgetThrottleTs = 0;
export function savePersonalBest(val) {
  if (!ctx) return;
  ctx.personalBest = val;
  localStorage.setItem('blocksrocks_personalBest', val.toString());
  const now = Date.now();
  if (typeof ctx.updateBottomRecords === 'function' && (now - pbWidgetThrottleTs) > 5000) {
    pbWidgetThrottleTs = now;
    ctx.updateBottomRecords(false);
  }
}

/* ── Google Link Status ── */
export function updateGoogleLinkStatus() {
  const btnLinkGoogle = document.getElementById('btnLinkGoogle');
  const googleStatus = document.getElementById('googleStatus');
  if (!btnLinkGoogle || !googleStatus || !ctx) return;

  const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
  const fb_auth = fb.fb_auth;
  const isLinked = localStorage.getItem('blocksrocks_googleLinked') === '1'
    || (fb_auth && fb_auth.currentUser && !fb_auth.currentUser.isAnonymous
    && fb_auth.currentUser.providerData.some(p => p.providerId === 'google.com'));

  const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
  if (isLinked) {
    btnLinkGoogle.style.display = 'none';
    const email = localStorage.getItem('blocksrocks_googleEmail') || '';
    googleStatus.textContent = (t.googleLinked || '✅ Povezano') + (email ? ': ' + email : '');
    if (email) googleStatus.title = email;
    googleStatus.style.color = 'var(--accent)';
  } else {
    btnLinkGoogle.style.display = 'flex';
    googleStatus.textContent = t.googleUnlinked || 'Povežite Google nalog da trajno sačuvate nadimak i rezultate!';
    googleStatus.style.color = 'var(--dim)';
  }
}

/* ── Google Sign-In Flow ── */
export async function performGoogleSignIn() {
  if (!ctx) return false;
  const googleStatus = document.getElementById('googleStatus');
  const btnLinkGoogle = document.getElementById('btnLinkGoogle');
  const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;

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
    const GoogleAuth = window.Capacitor && window.Capacitor.Plugins && (window.Capacitor.Plugins.GoogleAuth || window.Capacitor.Plugins.GoogleAuthPlugin);
    const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
    const fb_auth = fb.fb_auth;

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

        if (idToken && fb_auth && typeof firebase !== 'undefined') {
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
        } else if (googleUser && googleUser.email) {
          console.log('[B&R] Google user signed in locally without idToken fallback:', googleUser.email);
          localStorage.setItem('blocksrocks_googleLinked', '1');
          localStorage.setItem('blocksrocks_googleEmail', googleUser.email);
          if (googleUser.displayName && (!ctx.username || ctx.username.startsWith('Igrač') || ctx.username.startsWith('Player'))) {
            await registerAndSaveUsername(googleUser.displayName.slice(0, 15));
          }
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
    if (fb_auth && typeof firebase !== 'undefined') {
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
      if (err && err.code === 'auth/credential-already-in-use') {
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

export async function handleGoogleSignInSuccess(activeUser, nativeGoogleUser) {
  if (!activeUser || !ctx) return;
  const gUid = activeUser.uid;
  ctx.fb_userId = gUid;
  ctx.firebaseReady = true;
  localStorage.setItem('blocksrocks_userId', gUid);
  localStorage.setItem('blocksrocks_googleLinked', '1');
  const email = activeUser.email || (nativeGoogleUser && nativeGoogleUser.email) || '';
  if (email) localStorage.setItem('blocksrocks_googleEmail', email);

  const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
  const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
  const fb_db = fb.fb_db;

  if (fb_db) {
    try {
      const userDoc = await fb_db.collection('users').doc(gUid).get();
      if (userDoc.exists && userDoc.data()) {
        const udata = userDoc.data();
        if (udata.username) {
          const cloudName = udata.username;
          saveUsername(cloudName);
          ctx.username = cloudName;
          if (usernameInput) usernameInput.value = cloudName;

          const cloudBest = Number(udata.personalBest || udata.score || 0);
          if (cloudBest > ctx.personalBest) {
            savePersonalBest(cloudBest);
            ctx.best = ctx.personalBest;
            if (ctx.bestEl) ctx.bestEl.textContent = ctx.best;
          }

          if (isOnboarding) {
            isOnboarding = false;
            if (usernameModal) {
              usernameModal.classList.remove('is-onboarding');
              usernameModal.style.display = 'none';
            }
            if (typeof ctx.setPaused === 'function') ctx.setPaused(false);
          }

          if (typeof ctx.showMsg === 'function') {
            ctx.showMsg((t.googleWelcomeBack || '✅ Dobrodošao nazad, ') + cloudName + '!', 3500);
          }
          if (typeof ctx.haptic === 'function') ctx.haptic('success');
          if (typeof ctx.fetchMyTop3 === 'function') ctx.fetchMyTop3();
          if (typeof ctx.updateBottomRecords === 'function') ctx.updateBottomRecords(false);
          return;
        }
      }

      let finalUsername = ctx.username;
      if (!finalUsername || finalUsername.length < 3) {
        const rawDisp = (nativeGoogleUser && (nativeGoogleUser.displayName || nativeGoogleUser.name)) || activeUser.displayName || 'Igrač';
        finalUsername = rawDisp.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u0400-\u04FF]/g, '').substring(0, 12);
        if (finalUsername.length < 3) finalUsername = 'Igrač_' + Math.floor(1000 + Math.random() * 9000);
      }

      await registerAndSaveUsername(finalUsername);
      if (typeof ctx.showMsg === 'function') {
        ctx.showMsg(t.googleLinkedSuccess || '✅ Google nalog uspešno povezan!', 3500);
      }
      if (typeof ctx.haptic === 'function') ctx.haptic('success');
      if (typeof ctx.fetchMyTop3 === 'function') ctx.fetchMyTop3();
      if (typeof ctx.updateBottomRecords === 'function') ctx.updateBottomRecords(false);
    } catch (e) {
      console.warn('[B&R] Error handling Google sign-in sync:', e);
    }
  }
}

/* ── Username Validation & Availability ── */
export function validateUsernameFormat(name) {
  if (ctx && ctx.GameCore && typeof ctx.GameCore.validateUsernameFormat === 'function') {
    return ctx.GameCore.validateUsernameFormat(name);
  }
  const clean = (name || '').trim();
  const valid = clean.length >= 3 && clean.length <= 12 && /^[a-zA-Z0-9_\-\u00C0-\u024F\u0400-\u04FF]+$/.test(clean);
  return { valid, reason: valid ? null : (clean.length < 3 ? 'length' : 'chars') };
}

export async function checkAvailability(rawName, availEl = null, saveBtnEl = null, inputEl = null) {
  if (!ctx) return;
  const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
  availEl = availEl || usernameAvailability || document.getElementById('usernameAvailability');
  saveBtnEl = saveBtnEl || usernameSaveBtn;
  inputEl = inputEl || usernameInput;
  const clean = (rawName || '').trim();
  const format = validateUsernameFormat(clean);

  if (!format.valid) {
    isUsernameAvailable = false;
    if (saveBtnEl) saveBtnEl.disabled = true;
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

  if (ctx.username && clean.toLowerCase() === ctx.username.toLowerCase()) {
    isUsernameAvailable = true;
    if (saveBtnEl) saveBtnEl.disabled = false;
    if (availEl) {
      availEl.className = 'uavail available';
      availEl.textContent = t.statusCurrent || '✅ Vaše trenutno ime';
    }
    return;
  }

  const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
  const fb_db = fb.fb_db;
  const fb_auth = fb.fb_auth;
  const firebaseReady = fb.firebaseReady;
  const fb_userId = fb.fb_userId;

  if (!fb_db || !firebaseReady) {
    isUsernameAvailable = true;
    if (saveBtnEl) saveBtnEl.disabled = false;
    if (availEl) {
      availEl.className = 'uavail available';
      availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
    }
    return;
  }

  const lower = clean.toLowerCase();
  isCheckingAvailability = true;
  if (saveBtnEl) saveBtnEl.disabled = true;
  if (availEl) {
    availEl.className = 'uavail checking';
    availEl.textContent = t.statusChecking || '⏳ Proveravam...';
  }

  try {
    if (!fb_auth || !fb_auth.currentUser) {
      if (fb_auth && typeof fb_auth.signInAnonymously === 'function') {
        fb_auth.signInAnonymously().catch(() => {});
      }
    }

    const docRef = fb_db.collection('usernames').doc(lower);
    const docSnap = await docRef.get();

    if (inputEl && inputEl.value.trim().toLowerCase() !== lower) return;

    if (docSnap.exists) {
      const data = docSnap.data();
      if (data && data.uid === fb_userId) {
        isUsernameAvailable = true;
        if (saveBtnEl) saveBtnEl.disabled = false;
        if (availEl) {
          availEl.className = 'uavail available';
          availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
        }
      } else {
        isUsernameAvailable = false;
        if (saveBtnEl) saveBtnEl.disabled = true;
        if (availEl) {
          availEl.className = 'uavail taken';
          availEl.textContent = t.statusTaken || '❌ Nadimak je već zauzet';
        }
      }
    } else {
      isUsernameAvailable = true;
      if (saveBtnEl) saveBtnEl.disabled = false;
      if (availEl) {
        availEl.className = 'uavail available';
        availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
      }
    }
  } catch (err) {
    console.warn('[B&R] Availability check notice:', err);
    isUsernameAvailable = true;
    if (saveBtnEl) saveBtnEl.disabled = false;
    if (availEl) {
      availEl.className = 'uavail available';
      availEl.textContent = t.statusAvailable || '✅ Nadimak je slobodan';
    }
  } finally {
    isCheckingAvailability = false;
  }
}

export async function registerAndSaveUsername(rawName) {
  if (!ctx) return false;
  const cleanName = (rawName || '').trim();
  const lowerName = cleanName.toLowerCase();
  const format = validateUsernameFormat(cleanName);
  if (!format.valid) return false;

  const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
  const availEl = usernameAvailability || document.getElementById('usernameAvailability');

  if (usernameSaveBtn) usernameSaveBtn.disabled = true;
  if (availEl) {
    availEl.className = 'uavail checking';
    availEl.textContent = t.statusSaving || 'Čuvam...';
  }

  const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
  const fb_db = fb.fb_db;
  const fb_auth = fb.fb_auth;
  let fb_userId = fb.fb_userId;

  try {
    if (fb_db && fb_auth) {
      if (!fb_auth.currentUser) {
        try {
          await fb_auth.signInAnonymously();
          if (fb_auth.currentUser) {
            fb_userId = fb_auth.currentUser.uid;
            ctx.fb_userId = fb_userId;
            localStorage.setItem('blocksrocks_userId', fb_userId);
          }
        } catch (authErr) {
          console.warn('[B&R] Anonymous auth sign-in warning:', authErr);
        }
      }

      if (fb_userId) {
        const oldLower = ctx.username ? ctx.username.toLowerCase() : null;
        const newDocRef = fb_db.collection('usernames').doc(lowerName);

        try {
          const checkSnap = await newDocRef.get();
          if (checkSnap.exists) {
            const data = checkSnap.data() || {};
            if (data.uid && data.uid !== fb_userId) {
              if (usernameSaveBtn) usernameSaveBtn.disabled = false;
              if (availEl) {
                availEl.className = 'uavail taken';
                availEl.textContent = t.statusTaken || '❌ Nadimak je već zauzet';
              }
              return false;
            }
          }
        } catch (checkErr) {
          console.warn('[B&R] Name existence check notice:', checkErr);
        }

        const serverTs = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
          ? firebase.firestore.FieldValue.serverTimestamp() : new Date();

        await newDocRef.set({
          uid: fb_userId,
          originalName: cleanName,
          createdAt: serverTs
        });

        const userRef = fb_db.collection('users').doc(fb_userId);
        await userRef.set({
          username: cleanName,
          countryCode: ctx.countryCode || 'XX',
          updatedAt: serverTs
        }, { merge: true });

        if (oldLower && oldLower !== lowerName) {
          try {
            const oldDocRef = fb_db.collection('usernames').doc(oldLower);
            const oldSnap = await oldDocRef.get();
            if (oldSnap.exists && oldSnap.data() && oldSnap.data().uid === fb_userId) {
              await oldDocRef.delete();
            }
          } catch (delErr) {
            console.warn('[B&R] Old username cleanup notice:', delErr);
          }
        }
      }
    }

    const wasOnboarding = isOnboarding;
    saveUsername(cleanName);
    isOnboarding = false;
    if (usernameModal) {
      usernameModal.classList.remove('is-onboarding');
      usernameModal.style.display = 'none';
    }
    if (wasOnboarding && typeof ctx.setPaused === 'function') {
      ctx.setPaused(false);
    }

    if (usernameCallback) usernameCallback(cleanName);
    usernameCallback = null;
    console.log('[B&R] Nickname registered & saved:', cleanName);
    return true;
  } catch (err) {
    console.error('[B&R] Nickname registration fallback:', err);
    if (err && (err.code === 'permission-denied' || err.code === 'already-exists')) {
      let takenByOther = false;
      try {
        if (fb_db) {
          const verifySnap = await fb_db.collection('usernames').doc(lowerName).get();
          takenByOther = !!(verifySnap.exists && verifySnap.data() && verifySnap.data().uid && verifySnap.data().uid !== fb_userId);
        }
      } catch (verifyErr) {}
      if (takenByOther) {
        if (usernameSaveBtn) usernameSaveBtn.disabled = false;
        if (availEl) {
          availEl.className = 'uavail taken';
          availEl.textContent = t.statusTaken || '❌ Nadimak je već zauzet';
        }
        return false;
      }
    }

    const wasOnboarding = isOnboarding;
    saveUsername(cleanName);
    isOnboarding = false;
    if (usernameModal) {
      usernameModal.classList.remove('is-onboarding');
      usernameModal.style.display = 'none';
    }
    if (wasOnboarding && typeof ctx.setPaused === 'function') {
      ctx.setPaused(false);
    }

    if (usernameCallback) usernameCallback(cleanName);
    usernameCallback = null;
    return true;
  }
}

export function showUsernameModal(callback, onboarding = false) {
  if (!ctx) return;
  isOnboarding = !!onboarding;
  if (isOnboarding && typeof ctx.setPaused === 'function') {
    ctx.setPaused(true, true);
  }
  if (usernameInput) usernameInput.value = ctx.username || '';
  const len = (ctx.username || '').length;
  if (usernameCount) usernameCount.textContent = len + ' / 12';
  if (usernameInput) usernameInput.classList.remove('invalid');
  usernameCallback = callback || null;

  if (usernameModal) usernameModal.classList.toggle('is-onboarding', isOnboarding);

  const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
  const settingsHeading = document.getElementById('settingsHeading');
  const welcomeDesc = document.getElementById('usernameWelcomeDesc');
  const availEl = usernameAvailability || document.getElementById('usernameAvailability');
  if (availEl) { availEl.textContent = ''; availEl.className = 'uavail'; }

  if (isOnboarding) {
    if (settingsHeading) settingsHeading.textContent = t.onboardingTitle || '👋 DOBRODOŠLI!';
    if (welcomeDesc) {
      welcomeDesc.textContent = t.onboardingDesc || 'Unesite jedinstveni nadimak za rang listu i profil.';
      welcomeDesc.style.display = 'block';
    }
    if (usernameSaveBtn) usernameSaveBtn.textContent = t.onboardingBtn || 'ZAPOČNI IGRU';
  } else {
    if (settingsHeading) settingsHeading.textContent = t.settingsTitle || '⚙️ PODEŠAVANJA & PROFIL';
    if (welcomeDesc) welcomeDesc.style.display = 'none';
    if (usernameSaveBtn) usernameSaveBtn.textContent = t.usernameSaveBtn || 'SAČUVAJ';
  }

  if (typeof ctx.initSettingsUI === 'function') ctx.initSettingsUI();
  if (usernameModal) usernameModal.style.display = 'flex';

  if (ctx.username && ctx.username.length >= 3) {
    checkAvailability(ctx.username);
  } else {
    if (usernameSaveBtn) usernameSaveBtn.disabled = true;
    setTimeout(() => { try { if (usernameInput) usernameInput.focus(); } catch (e) {} }, 150);
  }
}

export async function initUserIdentity() {
  if (!ctx) return;
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const GoogleAuth = window.Capacitor && window.Capacitor.Plugins && (window.Capacitor.Plugins.GoogleAuth || window.Capacitor.Plugins.GoogleAuthPlugin);
  const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
  const fb_auth = fb.fb_auth;
  const fb_db = fb.fb_db;
  const firebaseReady = fb.firebaseReady;
  const fb_userId = fb.fb_userId;

  // 1. Silent Google Account check in the background
  if (isNative && GoogleAuth) {
    try {
      await GoogleAuth.initialize({
        clientId: '556570853814-42pn5174etkj86srceviqai3l701aofr.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
        grantOfflineAccess: true
      }).catch(() => {});

      const silent = await GoogleAuth.refresh().catch(() => null);
      if (silent && (silent.idToken || (silent.authentication && silent.authentication.idToken)) && fb_auth && typeof firebase !== 'undefined') {
        const idToken = (silent.authentication && silent.authentication.idToken) || silent.idToken;
        const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
        const res = await fb_auth.signInWithCredential(credential);
        if (res && res.user) {
          console.log('[B&R] Silent Google Account restored:', res.user.uid);
          await handleGoogleSignInSuccess(res.user, silent);
          if (ctx.username) return;
        }
      }
    } catch (silentErr) {
      console.warn('[B&R] Silent Google login note:', silentErr);
    }
  }

  // 2. Existing local username check & sync
  if (ctx.username && ctx.username.trim().length >= 3) {
    if (fb_db && firebaseReady && fb_userId) {
      try {
        const userRef = fb_db.collection('users').doc(fb_userId);
        const snap = await userRef.get();
        if (!snap.exists) {
          registerAndSaveUsername(ctx.username).catch(e => console.warn('[B&R] Auto-sync local username failed:', e));
        } else {
          const data = snap.data() || {};
          if (data.username && data.username !== ctx.username) {
            ctx.username = data.username;
            localStorage.setItem('blocksrocks_username', ctx.username);
          }
          if (data.personalBest && Number(data.personalBest) > ctx.personalBest) {
            savePersonalBest(Number(data.personalBest));
            ctx.best = ctx.personalBest;
            if (ctx.bestEl) ctx.bestEl.textContent = ctx.best;
          } else if (ctx.personalBest > (Number(data.personalBest) || 0)) {
            userRef.set({
              username: ctx.username.trim(),
              countryCode: (ctx.countryCode && ctx.countryCode !== 'XX') ? ctx.countryCode : (typeof ctx.guessCountryFromDevice === 'function' ? ctx.guessCountryFromDevice() : 'XX'),
              personalBest: ctx.personalBest,
              updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
            }, { merge: true }).catch(() => {});
            if (typeof ctx.submitScore === 'function') ctx.submitScore(ctx.personalBest).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[B&R] User profile check notice:', e);
      }
    }
    if (typeof ctx.fetchMyTop3 === 'function') ctx.fetchMyTop3();
    if (typeof ctx.updateBottomRecords === 'function') ctx.updateBottomRecords(false);
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
          ctx.username = data.username;
          localStorage.setItem('blocksrocks_username', ctx.username);
          console.log('[B&R] Restored username from cloud profile:', ctx.username);
        }
        if (data.personalBest && Number(data.personalBest) > ctx.personalBest) {
          savePersonalBest(Number(data.personalBest));
          ctx.best = ctx.personalBest;
          if (ctx.bestEl) ctx.bestEl.textContent = ctx.best;
        }
        if (typeof ctx.fetchMyTop3 === 'function') ctx.fetchMyTop3();
        if (ctx.username) return;
      }
    } catch (e) {
      console.warn('[B&R] Cloud profile check failed:', e);
    }
  }

  // 4. Native Android auto-assignment
  if (isNative) {
    const pgsName = localStorage.getItem('blocksrocks_pgsDisplayName');
    let finalName = '';
    if (pgsName && pgsName.trim().length >= 3) {
      finalName = pgsName.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u0400-\u04FF ]/g, '').substring(0, 12).trim();
    }
    if (finalName.length < 3) {
      const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
      const prefix = t.guestPrefix || 'Igrač';
      const guestNum = Math.floor(1000 + Math.random() * 9000);
      finalName = `${prefix}_${guestNum}`;
    }

    console.log('[B&R] Auto-assigning native username:', finalName);
    return new Promise((resolve) => {
      registerAndSaveUsername(finalName).then(() => {
        if (typeof ctx.fetchMyTop3 === 'function') ctx.fetchMyTop3();
        if (typeof ctx.updateBottomRecords === 'function') ctx.updateBottomRecords(false);
        resolve(true);
      }).catch(err => {
        console.warn('[B&R] Native auto-register failed:', err);
        resolve(false);
      });
    });
  }

  // 5. First-run modal for web
  return showFirstRunModal();
}

export function showFirstRunModal() {
  return new Promise((resolve) => {
    if (!ctx) return resolve();
    const t = TRANSLATIONS[ctx.currentLang] || TRANSLATIONS.en;
    const prefix = t.guestPrefix || 'Igrač';
    const guestNum = Math.floor(1000 + Math.random() * 9000);
    const guestName = `${prefix}_${guestNum}`;

    const modal = document.getElementById('firstRunModal');
    const input = document.getElementById('firstRunNickname');
    const btn = document.getElementById('firstRunStartBtn');
    const availEl = document.getElementById('firstRunAvailability');

    if (modal && input && btn) {
      input.value = guestName;
      modal.style.display = 'flex';

      setTimeout(() => input.focus(), 50);

      let chkTimeout = null;
      input.addEventListener('input', () => {
        const raw = input.value;
        const len = raw.trim().length;
        input.classList.toggle('invalid', len > 0 && (len < 3 || len > 12));
        clearTimeout(chkTimeout);
        chkTimeout = setTimeout(() => { checkAvailability(raw, availEl, btn, input); }, 500);
      });

      checkAvailability(guestName, availEl, btn, input);

      btn.onclick = () => {
        const raw = input.value.trim();
        const finalName = raw.length >= 3 ? raw : guestName;

        ctx.username = finalName;
        localStorage.setItem('blocksrocks_username', finalName);
        if (usernameInput) usernameInput.value = finalName;
        console.log('[B&R] Assigned first-run nickname:', finalName);

        const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
        if (fb.fb_db && fb.firebaseReady) {
          registerAndSaveUsername(finalName).catch(e => console.warn('[B&R] Auto-register notice:', e));
        }

        modal.style.display = 'none';
        resolve();
      };
    } else {
      ctx.username = guestName;
      localStorage.setItem('blocksrocks_username', guestName);
      if (usernameInput) usernameInput.value = guestName;
      resolve();
    }
  });
}

export function bindUserAuthEvents() {
  if (usernameInput) {
    usernameInput.addEventListener('input', () => {
      const raw = usernameInput.value;
      const len = raw.trim().length;
      if (usernameCount) usernameCount.textContent = len + ' / 12';
      usernameInput.classList.toggle('invalid', len > 0 && (len < 3 || len > 12));
      if (usernameCount) usernameCount.classList.toggle('warn', len > 12);
      clearTimeout(checkAvailabilityTimeout);
      checkAvailabilityTimeout = setTimeout(() => { checkAvailability(raw); }, 280);
    });

    usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && usernameSaveBtn && !usernameSaveBtn.disabled) {
        usernameSaveBtn.click();
      }
    });
  }

  if (usernameSaveBtn) {
    usernameSaveBtn.addEventListener('click', () => {
      if (usernameInput) registerAndSaveUsername(usernameInput.value);
    });
  }

  if (usernameCloseBtn) {
    usernameCloseBtn.addEventListener('click', () => {
      if (isOnboarding) return;
      if (usernameModal) usernameModal.style.display = 'none';
      usernameCallback = null;
    });
  }

  if (usernameModal) {
    usernameModal.addEventListener('click', (e) => {
      if (isOnboarding) return;
      if (e.target === usernameModal) {
        usernameModal.style.display = 'none';
        usernameCallback = null;
      }
    });
  }

  const btnSettings = document.getElementById('btnSettings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      showUsernameModal(null, false);
      updateGoogleLinkStatus();
    });
  }

  const btnLinkGoogle = document.getElementById('btnLinkGoogle');
  if (btnLinkGoogle) {
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative) {
      const uSection = document.getElementById('usernameSectionContainer');
      if (uSection) uSection.style.display = 'none';
      const welcomeDesc = document.getElementById('usernameWelcomeDesc');
      if (welcomeDesc) welcomeDesc.style.display = 'none';
    } else {
      btnLinkGoogle.addEventListener('click', performGoogleSignIn);
    }
  }
}