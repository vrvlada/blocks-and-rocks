/*
 * Blocks & Rocks — Career Stats & Match History Module
 */
import { TRANSLATIONS } from '../../i18n.js';
import { escapeHtml } from '../utils.js';

let ctx = null;

export function initStatsHistory(deps) { ctx = deps; }

function safeStore(k, v) {
  if (ctx && typeof ctx.safeSetItem === 'function') {
    ctx.safeSetItem(k, v);
  } else {
    try { localStorage.setItem(k, v); } catch(e){}
  }
}

/* ── Career Statistics ── */
let careerStats = { gamesPlayed: 0, linesCleared: 0, bombsDefused: 0, rocksCrushed: 0, maxCombo: 1, totalScore: 0 };

export function getCareerStats() { return careerStats; }

function loadCareerStats() {
  try {
    const saved = JSON.parse(localStorage.getItem('blocksrocks_careerStats'));
    if (saved && typeof saved === 'object') careerStats = { ...careerStats, ...saved };
  } catch(e){}
}

function saveCareerStats() {
  safeStore('blocksrocks_careerStats', JSON.stringify(careerStats));
}

export function recordCareerStat(key, increment = 1) {
  loadCareerStats();
  if (key === 'maxCombo') {
    careerStats.maxCombo = Math.max(careerStats.maxCombo || 1, increment);
  } else {
    careerStats[key] = (careerStats[key] || 0) + increment;
  }
  saveCareerStats();
}

export function renderCareerStats() {
  const lang = (ctx && ctx.currentLang) || 'sr';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.sr || TRANSLATIONS.en;
  loadCareerStats();

  const gEl = document.getElementById('statGames');
  const aEl = document.getElementById('statAvgScore');
  const mcEl = document.getElementById('statMasterCombos');
  const c2 = document.getElementById('statCombo2x');
  const c3 = document.getElementById('statCombo3x');
  const c4 = document.getElementById('statCombo4x');
  const c5 = document.getElementById('statCombo5x');
  const c6 = document.getElementById('statCombo6x');

  if (gEl) gEl.textContent = (careerStats.gamesPlayed || 0).toLocaleString();
  const avg = careerStats.gamesPlayed > 0 ? Math.round((careerStats.totalScore || 0) / careerStats.gamesPlayed) : 0;
  if (aEl) aEl.textContent = avg.toLocaleString();

  const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = (val || 0).toLocaleString(); };
  setStat('statLines', careerStats.linesCleared);
  setStat('statBombs', careerStats.bombsDefused);
  setStat('statRocks', careerStats.rocksCrushed);
  setStat('statCombo', careerStats.maxCombo);

  if (mcEl) mcEl.textContent = (careerStats.masterCombos || 0).toLocaleString();
  if (c2) c2.textContent = (careerStats.combo2xCount || 0).toLocaleString();
  if (c3) c3.textContent = (careerStats.combo3xCount || 0).toLocaleString();
  if (c4) c4.textContent = (careerStats.combo4xCount || 0).toLocaleString();
  if (c5) c5.textContent = (careerStats.combo5xCount || 0).toLocaleString();
  if (c6) c6.textContent = (careerStats.combo6xCount || 0).toLocaleString();

  const avgTimeEl = document.getElementById('statAvgTime');
  const totalSec = careerStats.totalPlayTimeSec || 0;
  const avgSec = careerStats.gamesPlayed > 0 ? Math.floor(totalSec / careerStats.gamesPlayed) : 0;
  const m = Math.floor(avgSec / 60);
  const s = avgSec % 60;
  if (avgTimeEl) avgTimeEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;

  const bgEl = document.getElementById('badgesGrid');
  if (bgEl && ctx && typeof ctx.renderBadgesGrid === 'function') {
    const curScore = (ctx && typeof ctx.score === 'number') ? ctx.score : 0;
    const curBest = (ctx && typeof ctx.best === 'number') ? ctx.best : 0;
    ctx.renderBadgesGrid(bgEl, careerStats, curScore, curBest, lang);
  }
}

/* ── Match History ── */
export function saveMatchToHistory(scoreVal, maxComboVal, durationSec = 0) {
  try {
    let history = JSON.parse(localStorage.getItem('blocksrocks_matchHistory') || '[]');
    const lang = (ctx && ctx.currentLang) || 'sr';
    const dateStr = new Date().toLocaleDateString(lang === 'sr' ? 'sr-RS' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    history.unshift({
      score: scoreVal || 0,
      maxCombo: maxComboVal || 1,
      durationSec: durationSec || 0,
      date: dateStr,
      timestamp: Date.now()
    });
    if (history.length > 10) history = history.slice(0, 10);
    safeStore('blocksrocks_matchHistory', JSON.stringify(history));
  } catch (e) {
    console.warn('[B&R] saveMatchToHistory failed:', e && e.message);
  }
}

export function renderMatchHistory() {
  const listEl = document.getElementById('matchHistoryList');
  if (!listEl) return;
  const lang = (ctx && ctx.currentLang) || 'sr';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.sr || TRANSLATIONS.en;
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('blocksrocks_matchHistory') || '[]');
  } catch(e){}
  if (!history.length) {
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