/*
 * Blocks & Rocks — Share Score & Game Toast Module
 */
import { TRANSLATIONS } from '../../i18n.js';
import { escapeHtml } from '../utils.js';

let ctx = null;

export function initShareUI(deps) { ctx = deps; }

/* ── Game Toast Banner ── */
let gameToastTimer = null;
export function showGameToast(msg, type = 'info', duration = 3000) {
  let toast = document.getElementById('gameToastBanner');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'gameToastBanner';
    toast.className = 'game-toast';
    document.body.appendChild(toast);
  }
  const typeClass = type === 'success' ? 'success' : (type === 'error' ? 'error' : '');
  toast.innerHTML = '<div class="game-toast-content ' + typeClass + '">' + escapeHtml(msg) + '</div>';
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(gameToastTimer);
  gameToastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ── Share Button Feedback ── */
let shareBtnTimer = null;
export function showShareFeedback(mode) {
  const t = (ctx && TRANSLATIONS[ctx.currentLang]) || TRANSLATIONS.sr || TRANSLATIONS.en;
  const btnShare = document.getElementById('btnShareScore');
  let msg = '';
  if (mode === 'copied') {
    msg = t.scoreCopiedMsg || '📋 Rezultat kopiran u privremenu memoriju!';
    showGameToast(msg, 'success', 3000);
    if (ctx && typeof ctx.showMsg === 'function') ctx.showMsg(msg, 3000);
    if (ctx && typeof ctx.haptic === 'function') ctx.haptic('light');
    if (btnShare) {
      btnShare.textContent = t.btnShareCopied || '📋 KOPIRANO! ✓';
      btnShare.classList.remove('failed');
      btnShare.classList.add('copied');
    }
  } else if (mode === 'shared') {
    msg = t.scoreSharedMsg || '📤 Rezultat uspešno podeljen!';
    showGameToast(msg, 'success', 3000);
    if (ctx && typeof ctx.showMsg === 'function') ctx.showMsg(msg, 3000);
    if (ctx && typeof ctx.haptic === 'function') ctx.haptic('success');
    if (btnShare) {
      btnShare.textContent = t.btnShareSuccess || '📤 PODELJENO! ✓';
      btnShare.classList.remove('failed');
      btnShare.classList.add('copied');
    }
  } else if (mode === 'failed') {
    msg = t.scoreCopyFailed || '❌ Nije moguće podeliti rezultat';
    showGameToast(msg, 'error', 3000);
    if (ctx && typeof ctx.showMsg === 'function') ctx.showMsg(msg, 3000);
    if (ctx && typeof ctx.haptic === 'function') ctx.haptic('warning');
    if (btnShare) {
      btnShare.textContent = t.btnShareFailed || '❌ NEUSPELO';
      btnShare.classList.remove('copied');
      btnShare.classList.add('failed');
    }
  }
  if (btnShare) {
    clearTimeout(shareBtnTimer);
    shareBtnTimer = setTimeout(() => {
      btnShare.classList.remove('copied', 'failed');
      const curT = (ctx && TRANSLATIONS[ctx.currentLang]) || TRANSLATIONS.sr || TRANSLATIONS.en;
      btnShare.textContent = curT.btnShareScore || '📤 PODELI REZULTAT';
    }, 2500);
  }
}

/* ── Copy Score to Clipboard ── */
export async function copyScoreToClipboard(text) {
  let copied = false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (e) {
      console.warn('[B&R] navigator.clipboard.writeText failed, using textarea fallback:', e);
    }
  }
  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, 99999);
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      console.warn('[B&R] execCommand copy failed:', e);
    }
  }
  return copied;
}

/* ── Share Score Flow ── */
export async function shareScore() {
  const t = (ctx && TRANSLATIONS[ctx.currentLang]) || TRANSLATIONS.sr || TRANSLATIONS.en;
  const currentScore = (ctx && typeof ctx.lastGameOverScore === 'number' && ctx.lastGameOverScore > 0)
    ? ctx.lastGameOverScore
    : (ctx && ctx.score ? ctx.score : parseInt(document.getElementById('finalscore')?.textContent || '0', 10));
  const currentCombo = (ctx && typeof ctx.lastGameOverCombo === 'number' && ctx.lastGameOverCombo > 0)
    ? ctx.lastGameOverCombo
    : (ctx && ctx.comboStreak ? ctx.comboStreak : 1);

  const gameUrl = (typeof window !== 'undefined' && window.location && window.location.protocol && window.location.protocol.startsWith('http'))
    ? (window.location.origin + window.location.pathname)
    : 'https://blocks-and-rocks.web.app';

  const shareTitle = 'Blocks and Rocks';
  const GameCore = (ctx && ctx.GameCore) || (typeof window !== 'undefined' && window.GameCore);

  const shareText = (GameCore && typeof GameCore.formatShareScoreText === 'function')
    ? GameCore.formatShareScoreText({
        score: currentScore,
        comboStreak: currentCombo,
        sub: t.sub || 'Taktička slagalica',
        shareScored: t.shareScored || 'Osvojio sam',
        sharePoints: t.sharePoints || 'poena',
        shareBestCombo: t.shareBestCombo || 'Najveći kombo: x',
        shareChallenge: t.shareChallenge || 'Možeš li me stići? 🚀',
        url: gameUrl
      })
    : '🧱💥 Blocks and Rocks\n🏆 Osvojio sam ' + currentScore.toLocaleString() + ' poena!\n🎮 ' + gameUrl;

  // 1. Capacitor native Share plugin if native
  if (typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
    try {
      await window.Capacitor.Plugins.Share.share({
        title: shareTitle,
        text: shareText,
        url: gameUrl,
        dialogTitle: shareTitle
      });
      showShareFeedback('shared');
      return;
    } catch (err) {
      if (err && (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('cancel')))) {
        return;
      }
    }
  }

  // 2. Web Share API
  if (navigator.share && typeof navigator.canShare === 'function' && navigator.canShare({ text: shareText })) {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: gameUrl });
      showShareFeedback('shared');
      return;
    } catch (err) {
      if (err && (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('cancel')))) {
        return;
      }
    }
  }

  // 3. Clipboard fallback
  const copied = await copyScoreToClipboard(shareText);
  showShareFeedback(copied ? 'copied' : 'failed');
}