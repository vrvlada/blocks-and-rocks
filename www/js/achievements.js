/*
 * Blocks & Rocks — Achievements & Badges Module (Destroyer & Thematic Badges)
 */

import { TRANSLATIONS } from '../i18n.js';
import { sfxBadgeUnlock } from './audio.js';
import { triggerConfetti } from './effects.js';
import { escapeHtml } from './utils.js';

const STORAGE_KEY = 'blocksrocks_badges';

let unlockedBadges = null;

/** Učitava otključane bedževe iz localStorage (keširano u memoriji) */
export function loadBadges(force = false) {
  if (unlockedBadges !== null && !force) return unlockedBadges;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    unlockedBadges = raw ? JSON.parse(raw) : {};
  } catch (e) {
    unlockedBadges = {};
  }
  return unlockedBadges;
}
loadBadges();

/** Čuva otključane bedževe u localStorage */
export function saveBadges() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unlockedBadges));
  } catch (e) {}
}

export function getUnlockedBadges() {
  return unlockedBadges;
}

/** Prikazuje plutajući baner o otključanom bedžu */
export function showBadgeUnlockToast(badge, currentLang) {
  const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
  const title = t[`badge_${badge.id}_title`] || badge.id;
  const toastText = t.badgeUnlockedToast || 'NOVO DOSTIGNUĆE!';

  let toast = document.getElementById('badgeUnlockToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'badgeUnlockToast';
    toast.className = 'badge-unlock-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div class="badge-toast-content ${badge.tier || 'bronze'}">
      <div class="badge-toast-icon">${badge.icon}</div>
      <div class="badge-toast-details">
        <div class="badge-toast-heading">${escapeHtml(toastText)}</div>
        <div class="badge-toast-name">${escapeHtml(title)}</div>
      </div>
    </div>
  `;

  toast.classList.remove('show');
  void toast.offsetWidth; // trigger reflow
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

/**
 * Proverava i otključava nova dostignuća.
 * Vraća niz novootključanih bedževa.
 */
export function checkAndUnlockBadges(stats, currentScore, personalBest, currentLang = 'sr') {
  if (typeof window.GameCore === 'undefined' || !window.GameCore.BADGES) return [];
  
  loadBadges();
  const newlyUnlocked = window.GameCore.checkNewBadges(unlockedBadges, stats, currentScore, personalBest);
  
  if (newlyUnlocked.length > 0) {
    newlyUnlocked.forEach((badge, idx) => {
      unlockedBadges[badge.id] = Date.now();
      setTimeout(() => {
        showBadgeUnlockToast(badge, currentLang);
        sfxBadgeUnlock();
      }, (idx + 1) * 1200);
    });
    saveBadges();
  }
  
  return newlyUnlocked;
}

/** Vraća najviši Destroyer bedž koji je igrač osvojio */
export function getHighestBadge(stats, pb) {
  loadBadges();
  const rankOrder = [
    'destroyer_100k',
    'destroyer_90k',
    'destroyer_80k',
    'destroyer_70k',
    'destroyer_60k',
    'destroyer_50k',
    'destroyer_40k',
    'destroyer_30k',
    'destroyer_20k',
    'destroyer_10k'
  ];
  for (const id of rankOrder) {
    if (unlockedBadges[id]) {
      const b = (window.GameCore && window.GameCore.BADGES) ? window.GameCore.BADGES.find(x => x.id === id) : null;
      if (b) return b;
    }
  }
  return null;
}

/** Renderuje bedževe u HTML grid unutar modala profila/podešavanja */
export function renderBadgesGrid(containerEl, stats, score, pb, currentLang = 'sr') {
  if (!containerEl || typeof window.GameCore === 'undefined' || !window.GameCore.BADGES) return;
  loadBadges();
  
  const t = TRANSLATIONS[currentLang] || TRANSLATIONS.sr;
  const badges = window.GameCore.BADGES;
  
  const destroyerBadges = badges.filter(b => b.id.startsWith('destroyer_'));
  const otherBadges = badges.filter(b => !b.id.startsWith('destroyer_'));
  
  let html = '';
  
  // 1. Render Destroyer Grid
  if (destroyerBadges.length > 0) {
    html += '<div class="destroyer-badges-grid">';
    destroyerBadges.forEach(badge => {
      const isUnlocked = !!unlockedBadges[badge.id];
      const label = badge.id.replace('destroyer_', '');
      const activeClass = isUnlocked ? 'active ' + (badge.tier || 'bronze') : '';
      const title = t[`badge_${badge.id}_title`] || badge.id;
      html += `
        <div class="destroyer-badge ${activeClass}" title="${escapeHtml(title)}">
          <div class="d-icon">${badge.icon}</div>
          <div class="d-label">${label.toUpperCase()}</div>
        </div>
      `;
    });
    html += '</div>';
  }
  
  // 2. Render Other Badges
  otherBadges.forEach(badge => {
    const isUnlocked = !!unlockedBadges[badge.id];
    const progress = badge.getProgress ? badge.getProgress(stats, score, pb) : { current: 0, target: 1, pct: 0 };
    const title = t[`badge_${badge.id}_title`] || badge.id;
    const desc = t[`badge_${badge.id}_desc`] || '';
    const statusText = isUnlocked ? (t.badgeStatusUnlocked || 'Otključano') : (t.badgeStatusLocked || 'Zaključano');
    
    html += `
      <div class="badge-card ${badge.tier} ${isUnlocked ? 'unlocked' : 'locked'}">
        <div class="badge-card-top">
          <div class="badge-card-icon-wrap ${badge.tier}">
            <span class="badge-card-icon">${badge.icon}</span>
          </div>
          <div class="badge-card-info">
            <div class="badge-card-title">${escapeHtml(title)}</div>
            <div class="badge-card-desc">${escapeHtml(desc)}</div>
          </div>
        </div>
        <div class="badge-card-bottom">
          <div class="badge-progress-bar">
            <div class="badge-progress-fill ${badge.tier}" style="width: ${progress.pct}%"></div>
          </div>
          <div class="badge-progress-row">
            <span class="badge-progress-txt">${progress.current.toLocaleString()} / ${progress.target.toLocaleString()}</span>
            <span class="badge-status-tag ${isUnlocked ? 'tag-unlocked' : 'tag-locked'}">
              ${isUnlocked ? '✓ ' + escapeHtml(statusText) : '🔒 ' + progress.pct + '%'}
            </span>
          </div>
        </div>
      </div>
    `;
  });
  
  containerEl.innerHTML = html;
}
