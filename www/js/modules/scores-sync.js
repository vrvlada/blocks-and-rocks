/*
 * Blocks & Rocks - Score Submission & Sync Module
 * Handles offline queue, Firestore submit, user entry capping, legacy migration.
 */
import { TRANSLATIONS } from '../../i18n.js';
import { MAX_ENTRIES_PER_USER } from '../leaderboard.js';

let ctx = null;

export function initScoresSync(deps) {
  ctx = deps;
}

function getContextData() {
  if (!ctx) return {};
  const fb = typeof ctx.getFirebase === 'function' ? ctx.getFirebase() : ctx;
  const username = (typeof ctx.getUsername === 'function' ? ctx.getUsername() : ctx.username) || '';
  const countryCode = (typeof ctx.getCountryCode === 'function' ? ctx.getCountryCode() : ctx.countryCode) || 'XX';
  const personalBest = (typeof ctx.getPersonalBest === 'function' ? ctx.getPersonalBest() : ctx.personalBest) || 0;
  const currentLang = (typeof ctx.getCurrentLang === 'function' ? ctx.getCurrentLang() : ctx.currentLang) || 'sr';
  return {
    fb_app: fb.fb_app,
    fb_auth: fb.fb_auth,
    fb_db: fb.fb_db,
    fb_userId: fb.fb_userId,
    firebaseReady: fb.firebaseReady,
    username,
    countryCode,
    personalBest,
    currentLang
  };
}

/* -- Firebase Timestamp Helper -- */
function fbTs() {
  const fb = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue);
  return fb ? fb.serverTimestamp() : new Date();
}

/* -- Offline Queue -- */
export function queueOfflineScore(scoreVal, userVal, countryVal) {
  try {
    const queue = JSON.parse(localStorage.getItem('blocksrocks_pendingScores') || '[]');
    queue.push({ score: scoreVal, username: userVal, countryCode: countryVal, createdAt: Date.now() });
    localStorage.setItem('blocksrocks_pendingScores', JSON.stringify(queue));
  } catch(e) {}
}

/* -- Sync Offline Scores -- */
export async function syncOfflineScores() {
  if (!ctx) return;
  const { firebaseReady, fb_userId, fb_db, username, countryCode, personalBest } = getContextData();
  if (!firebaseReady || !fb_userId || !fb_db || !username || username.trim().length < 3) return;

  try {
    const raw = localStorage.getItem('blocksrocks_pendingScores');
    const queue = raw ? JSON.parse(raw) : [];
    const profileCc = (countryCode && countryCode !== 'XX') ? countryCode : (typeof ctx.guessCountryFromDevice === 'function' ? ctx.guessCountryFromDevice() : 'XX');
    const validProfileCc = (profileCc && profileCc.length === 2 && profileCc !== 'XX') ? profileCc : 'XX';

    const userRef = fb_db.collection('users').doc(fb_userId);
    const userSnap = await userRef.get().catch(() => null);
    const cloudPb = (userSnap && userSnap.exists) ? Number(userSnap.data().personalBest || 0) : 0;

    const needsProfileUpdate = !userSnap || !userSnap.exists
      || (userSnap.data() && userSnap.data().username !== username.trim())
      || personalBest > cloudPb;

    if (needsProfileUpdate) {
      await userRef.set({
        username: username.trim(),
        countryCode: validProfileCc,
        personalBest: Math.max(personalBest, cloudPb),
        updatedAt: fbTs()
      }, { merge: true });
    }

    if (personalBest > cloudPb && !queue.some(item => Number(item.score) === personalBest)) {
      queue.push({ score: personalBest, username: username.trim(), countryCode: validProfileCc, createdAt: Date.now() });
    }

    if (!Array.isArray(queue) || !queue.length) {
      if (typeof ctx.updateBottomRecords === 'function') await ctx.updateBottomRecords(true);
      return;
    }

    console.log('[B&R] Syncing ' + queue.length + ' score(s)...');
    for (const item of queue) {
      if (!item || !item.score || isNaN(item.score)) continue;
      const cc = (item.countryCode && item.countryCode !== 'XX') ? item.countryCode : validProfileCc;
      const validCc = (cc && cc.length === 2 && cc !== 'XX') ? cc : 'XX';
      await fb_db.collection('leaderboard').add({
        userId: fb_userId,
        username: username.trim(),
        score: parseInt(item.score, 10),
        countryCode: validCc,
        createdAt: fbTs()
      });
    }
    localStorage.removeItem('blocksrocks_pendingScores');
    await capUserEntries();
    if (typeof ctx.updateBottomRecords === 'function') await ctx.updateBottomRecords(true);
    console.log('[B&R] Offline scores sync completed successfully.');
  } catch(e) {
    console.warn('[B&R] Offline scores sync notice:', e.message);
  }
}

/* -- Submit Score -- */
export async function submitScore(finalScore) {
  if (!ctx) return;
  const { firebaseReady, fb_userId, fb_db, username, countryCode, personalBest, currentLang } = getContextData();
  const s = parseInt(finalScore, 10);
  if (isNaN(s) || s <= 0) return;

  if (s > personalBest) {
    if (typeof ctx.savePersonalBest === 'function') ctx.savePersonalBest(s);
    if ('best' in ctx) ctx.best = s;
    if (ctx.bestEl) ctx.bestEl.textContent = s;
  }

  const cc = (countryCode && countryCode !== 'XX') ? countryCode : (typeof ctx.guessCountryFromDevice === 'function' ? ctx.guessCountryFromDevice() : 'XX');
  const validCc = (cc && cc.length === 2 && cc !== 'XX') ? cc : 'XX';
  const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr || TRANSLATIONS.en;

  // Local score history (offline resilience)
  try {
    let localHistory = JSON.parse(localStorage.getItem('blocksrocks_myScores') || '[]');
    localHistory.push({
      score: s,
      username: username || 'Igrač',
      countryCode: validCc,
      createdAt: Date.now()
    });
    const GameCore = (ctx && ctx.GameCore) || (typeof window !== 'undefined' && window.GameCore);
    if (GameCore && typeof GameCore.sortScoresByTop === 'function') {
      localHistory = GameCore.sortScoresByTop(localHistory, MAX_ENTRIES_PER_USER);
    }
    localStorage.setItem('blocksrocks_myScores', JSON.stringify(localHistory));
  } catch(e) {}

  if (!username || username.trim().length < 3) return;

  if (!firebaseReady || !fb_userId || !fb_db) {
    queueOfflineScore(s, username, validCc);
    if (typeof ctx.showMsg === 'function') {
      ctx.showMsg('⚠️ ' + (t.msgOfflineQueued || 'Rezultat će biti poslat kad se povežete na internet'), 3000);
    }
    return;
  }

  try {
    await fb_db.collection('users').doc(fb_userId).set({
      username: username.trim(),
      countryCode: validCc,
      personalBest: Math.max(personalBest, s),
      updatedAt: fbTs()
    }, { merge: true });

    await fb_db.collection('leaderboard').add({
      userId: fb_userId,
      username: username.trim(),
      score: s,
      countryCode: validCc,
      createdAt: fbTs()
    });
    console.log('[B&R] Leaderboard entry added:', s, validCc);
    if (typeof ctx.track === 'function') {
      ctx.track('leaderboard_submit', { score: s });
    }
    await syncOfflineScores();
    await capUserEntries();
    if (typeof ctx.updateBottomRecords === 'function') await ctx.updateBottomRecords(true);
  } catch(err) {
    console.warn('[B&R] Score submit network failed, queueing offline:', err.message);
    queueOfflineScore(s, username, validCc);
  }
}

/* -- Cap User Entries -- */
export async function capUserEntries() {
  if (!ctx) return;
  const { firebaseReady, fb_userId, fb_db } = getContextData();
  if (!firebaseReady || !fb_userId || !fb_db) return;

  try {
    const snap = await fb_db.collection('leaderboard').where('userId', '==', fb_userId).get();
    if (snap.docs.length <= MAX_ENTRIES_PER_USER) return;
    const docs = snap.docs.slice().sort((a, b) => (Number(b.data().score) || 0) - (Number(a.data().score) || 0));
    const extras = docs.slice(MAX_ENTRIES_PER_USER);
    for (const doc of extras) await doc.ref.delete();
    if (extras.length) console.log('[B&R] Capped user entries:', extras.length);
  } catch(err) {
    console.warn('[B&R] capUserEntries failed:', err.message);
  }
}

/* -- Legacy Score Migration -- */
export async function migrateLegacyScore() {
  if (!ctx) return;
  const { firebaseReady, fb_userId, fb_db, username, countryCode } = getContextData();
  if (!firebaseReady || !fb_userId || !fb_db) return;

  try {
    const legacy = await fb_db.collection('scores').doc(fb_userId).get();
    if (!legacy.exists) return;
    const data = legacy.data();
    const legacyScore = Number(data && data.score) || 0;
    if (legacyScore <= 0) return;

    const mine = await fb_db.collection('leaderboard').where('userId', '==', fb_userId).get();
    if (mine.docs.some(d => (Number(d.data().score) || 0) >= legacyScore)) return;

    const uname = (username && username.trim().length >= 3) ? username.trim() : null;
    if (!uname) {
      console.warn('[B&R] Legacy migration skipped: no registered username.');
      return;
    }
    const cc = (typeof data.countryCode === 'string' && data.countryCode.length === 2 && data.countryCode !== 'XX')
      ? data.countryCode
      : (countryCode && countryCode !== 'XX' ? countryCode : (typeof ctx.guessCountryFromDevice === 'function' ? ctx.guessCountryFromDevice() : 'XX'));

    await fb_db.collection('users').doc(fb_userId).set({
      username: uname,
      updatedAt: fbTs()
    }, { merge: true });

    await fb_db.collection('leaderboard').add({
      userId: fb_userId,
      username: uname,
      score: legacyScore,
      countryCode: (cc && cc !== 'XX') ? cc : 'XX',
      createdAt: fbTs()
    });
    console.log('[B&R] Legacy score migrated:', legacyScore);
  } catch(err) {
    console.warn('[B&R] Legacy migration failed:', err.message);
  }
}