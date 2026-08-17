/*
 * Blocks & Rocks — rang lista (multi-score "leaderboard") + bottom records vidžet.
 * ES modul — faza 3 modularizacije. Zavisnosti: initLeaderboard(deps).
 *   deps = { haptic, debounceAction, CONFIG,
 *            countryFlag, getFullCountryName, guessCountryFromDevice,
 *            getFirebase: () => ({ fb_db, firebaseReady, fb_userId }),
 *            getUsername, getCountryCode, getCurrentLang,
 *            getPersonalBest, savePersonalBest, setBest,
 *            getGameOver, overlayEl }
 */
import { TRANSLATIONS } from '../i18n.js';
import { escapeHtml } from './utils.js';

const PAGE_SIZE = 25;
const COUNTRY_PAGE_SIZE = 100;
const MAX_ENTRIES_PER_USER = 3;

let D = null;
const FB = () => D.getFirebase();
const GameCore = window.GameCore;

/* ── DOM refs (popunjava initLeaderboard) ── */
let lbOverlay, lbPersonalBest, lbMyList, lbContent, lbLoadMoreWrap, lbLoadMoreBtn, lbCountryLabel, tabCountry, tabGlobal;

/* ── stanje ── */
let currentTab = 'country';
let lbItems = [];
let lbLastSnap = null;
let lbAllLoaded = false;
let lbLoadingMore = false;
let lbObserver = null;
let returnToOverlayOnLbClose = false;
let cachedCountryTop = null;
let cachedGlobalTop = null;
try {
  const savedGlobal = localStorage.getItem('blocksrocks_cached_global_top');
  if (savedGlobal) cachedGlobalTop = JSON.parse(savedGlobal);
} catch(_) {}
let isFetchingBottomRecords = false;

export function getCachedGlobalTopScore(){
  if (cachedGlobalTop && typeof cachedGlobalTop.score === 'number') {
    return cachedGlobalTop.score;
  }
  try {
    const saved = localStorage.getItem('blocksrocks_cached_global_top_score');
    if (saved) return Number(saved) || 0;
  } catch(_) {}
  return 0;
}

export function initLeaderboard(deps){
  D = deps;

  lbOverlay = document.getElementById('lb-overlay');
  lbPersonalBest = document.getElementById('lbPersonalBest');
  lbMyList = document.getElementById('lbMyList');
  lbContent = document.getElementById('lbContent');
  lbLoadMoreWrap = document.getElementById('lbLoadMoreWrap');
  lbLoadMoreBtn = document.getElementById('lbLoadMoreBtn');
  lbCountryLabel = document.getElementById('lbCountryLabel');
  tabCountry = document.getElementById('tabCountry');
  tabGlobal = document.getElementById('tabGlobal');

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

  // Leaderboard button on game-over overlay (debounced — jedini listener)
  document.getElementById('showLbBtn').addEventListener('click', ()=>{
    D.debounceAction('showLb', ()=>{
      returnToOverlayOnLbClose = true;
      D.overlayEl.style.display = 'none';
      openLeaderboard();
    }, D.CONFIG.RESTART_DEBOUNCE_MS);
  });

  // Bottom cards click bindings -> open corresponding leaderboard tab
  const bottomCountryCard = document.getElementById('bottomCountryCard');
  if (bottomCountryCard) {
    bottomCountryCard.addEventListener('click', () => {
      openLeaderboard();
      loadLeaderboard('country');
      D.haptic('light');
    });
  }

  const bottomGlobalCard = document.getElementById('bottomGlobalCard');
  if (bottomGlobalCard) {
    bottomGlobalCard.addEventListener('click', () => {
      openLeaderboard();
      loadLeaderboard('global');
      D.haptic('light');
    });
  }
}

// ── fetch batches ──
async function fetchGlobalBatch(afterSnap, limit){
  const { firebaseReady, fb_db } = FB();
  if(!firebaseReady || !fb_db) return { items: [], lastSnap: null };
  try {
    let q = fb_db.collection('leaderboard')
      .orderBy('score', 'desc');
    if(afterSnap) q = q.startAfter(afterSnap);
    q = q.limit(limit || PAGE_SIZE);
    const snap = await q.get();
    return { items: snap.docs.map(d => ({ id: d.id, ...d.data() })), lastSnap: snap.docs.length ? snap.docs[snap.docs.length-1] : null };
  } catch(err){
    console.warn('[B&R] Global fetch failed:', err.message);
    return { items: [], lastSnap: null };
  }
}

async function fetchCountryBatch(code, afterSnap, limit){
  const fetchLimit = limit || COUNTRY_PAGE_SIZE;
  const { firebaseReady, fb_db } = FB();
  if(!firebaseReady || !code || code === 'XX' || !fb_db) return { items: [], lastSnap: null };
  try {
    let q = fb_db.collection('leaderboard')
      .where('countryCode', '==', code)
      .orderBy('score', 'desc');
    if(afterSnap) q = q.startAfter(afterSnap);
    q = q.limit(fetchLimit);
    const snap = await q.get();
    return { items: snap.docs.map(d => ({ id: d.id, ...d.data() })), lastSnap: snap.docs.length ? snap.docs[snap.docs.length-1] : null };
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


/**
 * Uklanja duplikate iz liste rezultata na osnovu dokument-id (ili fallback
 * userId+score+createdAt ako id nedostaje). Sprecava duplikate pri "Učitaj još".
 */
function dedupeLbItems(items){
  const seen = new Set();
  return (items || []).filter(it => {
    if(!it) return false;
    const k = it.id
      ? it.id
      : ((it.userId || '') + '|' + (it.score || 0) + '|' + (it.createdAt || ''));
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function fetchMyTop3(){
  let localTop = [];
  try {
    localTop = JSON.parse(localStorage.getItem('blocksrocks_myScores') || '[]');
  } catch(e){}

  const { firebaseReady, fb_db, fb_userId } = FB();
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
    if(top3.length && top3[0].score > D.getPersonalBest()){
      D.savePersonalBest(top3[0].score);
      D.setBest(top3[0].score);
    }
    return top3;
  } catch(err){
    console.warn('[B&R] My scores fetch failed, using local:', err.message);
    return GameCore.sortScoresByTop(localTop, MAX_ENTRIES_PER_USER);
  }
}

function cleanupLbObserver(){
  if(lbObserver){
    lbObserver.disconnect();
    lbObserver = null;
  }
}

function drawLb(){
  cleanupLbObserver();
  const t = TRANSLATIONS[D.getCurrentLang()] || TRANSLATIONS.sr;
  const { fb_userId } = FB();
  const username = D.getUsername();
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

    const flag = D.countryFlag(d.countryCode);
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
  const t = TRANSLATIONS[D.getCurrentLang()] || TRANSLATIONS.sr;
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

export async function loadLeaderboard(tab){
  cleanupLbObserver();
  const t = TRANSLATIONS[D.getCurrentLang()] || TRANSLATIONS.sr;
  const countryCode = D.getCountryCode();
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
      lbCountryLabel.textContent = t.lbLocationUnavailable || '🌐 Lokacija nedostupna — World TOP 25';
      lbCountryLabel.style.display = '';
      res = await fetchGlobalBatch(null, PAGE_SIZE);
    } else {
      lbCountryLabel.textContent = D.countryFlag(countryCode) + ' ' + D.getFullCountryName(countryCode, D.getCurrentLang()) + ' (TOP 100)';
      lbCountryLabel.style.display = '';
      res = await fetchCountryBatch(countryCode, null, PAGE_SIZE);
    }
    lbItems = dedupeLbItems(res.items);
    lbLastSnap = res.lastSnap;
    lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE || lbItems.length >= 100;
  } else {
    lbCountryLabel.style.display = 'none';
    res = await fetchGlobalBatch(null, PAGE_SIZE);
    lbItems = dedupeLbItems(res.items);
    lbLastSnap = res.lastSnap;
    lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE;
  }
  drawLb();
}

async function loadMore(){
  if(!lbLastSnap || lbAllLoaded || lbLoadingMore) return;
  lbLoadingMore = true;
  const countryCode = D.getCountryCode();
  try {
    let res;
    if(currentTab === 'country'){
      if(countryCode === 'XX') res = await fetchGlobalBatch(lbLastSnap, PAGE_SIZE);
      else res = await fetchCountryBatch(countryCode, lbLastSnap, PAGE_SIZE);
      lbItems = dedupeLbItems(GameCore.mergePages(lbItems, res.items));
      lbLastSnap = res.lastSnap;
      lbAllLoaded = !res.lastSnap || res.items.length < PAGE_SIZE || lbItems.length >= 100;
    } else {
      res = await fetchGlobalBatch(lbLastSnap, PAGE_SIZE);
      lbItems = dedupeLbItems(GameCore.mergePages(lbItems, res.items));
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

export function openLeaderboard(){
  lbOverlay.style.display = 'flex';
  loadLeaderboard(currentTab);
}

export function closeLeaderboard(){
  cleanupLbObserver();
  lbOverlay.style.display = 'none';
  // If we opened the leaderboard from the game-over screen, bring the overlay back
  if(returnToOverlayOnLbClose){
    returnToOverlayOnLbClose = false;
    if(D.getGameOver()) D.overlayEl.style.display = 'flex';
  }
}

/* ═══ BOTTOM RECORDS WIDGET (Country & Global Tops) ═══ */
export async function updateBottomRecords(forceFetch = false) {
  const elCountryFlag = document.getElementById('bottomCountryFlag');
  const elCountryName = document.getElementById('bottomCountryName');
  const elCountryPlayer = document.getElementById('bottomCountryPlayer');
  const elCountryPoints = document.getElementById('bottomCountryPoints');

  const elGlobalFlag = document.getElementById('bottomGlobalFlag');
  const elGlobalName = document.getElementById('bottomGlobalName');
  const elGlobalPlayer = document.getElementById('bottomGlobalPlayer');
  const elGlobalPoints = document.getElementById('bottomGlobalPoints');

  const t = TRANSLATIONS[D.getCurrentLang()] || TRANSLATIONS.sr;
  const countryCode = D.getCountryCode();
  const effectiveCode = (countryCode && countryCode !== 'XX') ? countryCode : D.guessCountryFromDevice();

  // Immediate UI text update with localized country name and current tab
  if (elCountryFlag) elCountryFlag.textContent = D.countryFlag(effectiveCode);
  if (elCountryName) elCountryName.textContent = D.getFullCountryName(effectiveCode, D.getCurrentLang());
  if (elGlobalFlag) elGlobalFlag.textContent = '🌍';
  if (elGlobalName) elGlobalName.textContent = t.tabGlobal || 'Svet';

  const currentUsername = (D.getUsername ? D.getUsername() : '') || '';
  const currentPB = (D.getPersonalBest ? D.getPersonalBest() : 0) || 0;

  // Optimističko osvežavanje: ako trenutni igrač ima veći ili jednak PB od keširanog rekorda
  if (currentUsername && currentPB > 0) {
    if (!cachedGlobalTop || currentPB >= (cachedGlobalTop.score || 0) || (cachedGlobalTop.username === currentUsername && currentPB > (cachedGlobalTop.score || 0))) {
      cachedGlobalTop = { username: currentUsername, score: currentPB, countryCode: effectiveCode };
      try {
        localStorage.setItem('blocksrocks_cached_global_top', JSON.stringify(cachedGlobalTop));
        localStorage.setItem('blocksrocks_cached_global_top_score', String(currentPB));
      } catch(_) {}
    }
    if (!cachedCountryTop || currentPB >= (cachedCountryTop.score || 0) || (cachedCountryTop.username === currentUsername && currentPB > (cachedCountryTop.score || 0))) {
      cachedCountryTop = { username: currentUsername, score: currentPB, countryCode: effectiveCode };
    }
  }

  if (cachedCountryTop) {
    if (elCountryPlayer) elCountryPlayer.textContent = cachedCountryTop.username || '—';
    if (elCountryPoints) elCountryPoints.textContent = Number(cachedCountryTop.score || 0).toLocaleString();
  }
  if (cachedGlobalTop) {
    const gFlag = cachedGlobalTop.countryCode ? D.countryFlag(cachedGlobalTop.countryCode) + ' ' : '';
    if (elGlobalPlayer) elGlobalPlayer.textContent = gFlag + (cachedGlobalTop.username || '—');
    if (elGlobalPoints) elGlobalPoints.textContent = Number(cachedGlobalTop.score || 0).toLocaleString();
  }

  const { firebaseReady, fb_db } = FB();
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
      if (currentUsername && currentPB > (globalDoc.score || 0)) {
        cachedGlobalTop = { username: currentUsername, score: currentPB, countryCode: effectiveCode };
      } else {
        cachedGlobalTop = globalDoc;
      }
      try {
        localStorage.setItem('blocksrocks_cached_global_top', JSON.stringify(cachedGlobalTop));
        if (typeof cachedGlobalTop.score === 'number') {
          localStorage.setItem('blocksrocks_cached_global_top_score', String(cachedGlobalTop.score));
        }
      } catch(_) {}
      const gFlag = cachedGlobalTop.countryCode ? D.countryFlag(cachedGlobalTop.countryCode) + ' ' : '';
      if (elGlobalPlayer) elGlobalPlayer.textContent = gFlag + (cachedGlobalTop.username || '—');
      if (elGlobalPoints) elGlobalPoints.textContent = Number(cachedGlobalTop.score || 0).toLocaleString();
    } else if (!cachedGlobalTop) {
      if (elGlobalPlayer) elGlobalPlayer.textContent = '—';
      if (elGlobalPoints) elGlobalPoints.textContent = '0';
    }

    if (countryDoc) {
      if (currentUsername && currentPB > (countryDoc.score || 0)) {
        cachedCountryTop = { username: currentUsername, score: currentPB, countryCode: effectiveCode };
      } else {
        cachedCountryTop = countryDoc;
      }
      if (elCountryPlayer) elCountryPlayer.textContent = cachedCountryTop.username || '—';
      if (elCountryPoints) elCountryPoints.textContent = Number(cachedCountryTop.score || 0).toLocaleString();
    } else if (!cachedCountryTop) {
      if (elCountryPlayer) elCountryPlayer.textContent = '—';
      if (elCountryPoints) elCountryPoints.textContent = '0';
    }
  } finally {
    isFetchingBottomRecords = false;
  }
}

