/*
 * Blocks & Rocks — čista (pure) logika igre.
 *
 * Ovaj modul ne zavisi od DOM-a i može se koristiti i u browser-u
 * (globalni `GameCore`) i u Node.js okruženju za testiranje (`require`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js / tests
    module.exports = factory();
  } else {
    // Browser global
    root.GameCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 8;
  const COLORS = ['#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#a3e635', '#60a5fa', '#fb923c'];

  const SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0]],
    [[0, 0], [0, 1], [1, 1]],
    [[0, 1], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 1], [1, 1], [2, 0], [2, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
  ];

  /** Prazna tabla size×size (svaka ćelija je `null`). */
  function makeGrid(size) {
    size = size || SIZE;
    return Array.from({ length: size }, () => Array(size).fill(null));
  }

  /** Broj redova/kolona potrebnih da se obuhvati oblik (minimalni bounding box). */
  function shapeSize(shape) {
    let maxR = 0, maxC = 0;
    shape.forEach(([r, c]) => { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); });
    return { rows: maxR + 1, cols: maxC + 1 };
  }

  /**
   * Da li se `shape` može postaviti na tabli `grid` tako da njegov gornji-levi ugao
   * bude na (row, col), a da ne izlazi van table niti preklapa zauzete ćelije.
   */
  function canPlaceOn(grid, size, shape, row, col) {
    for (const [r, c] of shape) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) return false;
      if (grid[rr][cc]) return false;
    }
    return true;
  }

  /** Da li se `shape` može postaviti bilo gde na tabli `grid`. */
  function anyPlacementOn(grid, size, shape) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (canPlaceOn(grid, size, shape, r, c)) return true;
      }
    }
    return false;
  }

  /**
   * Da li se makar jedan od oblika u traj-`tray` (niz oblika, mogu biti i `null`)
   * može postaviti na tablu `grid`. Vraća `true` ako POSTOJI placement.
   */
  function trayAnyPlacementOn(grid, size, tray) {
    for (const p of tray) {
      if (p && p.shape && anyPlacementOn(grid, size, p.shape)) return true;
    }
    return false;
  }

  /** Sortira listu rezultata ({score:number}) opadajuće i vraća top `n`. */
  function sortScoresByTop(list, n) {
    return (list || [])
      .filter(x => x != null)
      .slice()
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, n);
  }

  /** Spaja dve stranice rezultata (paginacija rang liste). */
  function mergePages(existing, incoming) {
    return (existing || []).concat(incoming || []);
  }

  /**
   * Rotira oblik za 90° u smeru kazaljke (clockwise).
   * Redosled ćelija u nizu se NE menja — zato stoneIndex/bombIndex
   * ostaju tačni (prate svoju ćeliju). Rezultat se normira na (0,0).
   */
  function rotateShapeCW(shape) {
    if (!shape || !shape.length) return shape;
    let maxR = 0, maxC = 0;
    shape.forEach(([r, c]) => { if (r > maxR) maxR = r; if (c > maxC) maxC = c; });
    const rotated = shape.map(([r, c]) => [c, maxR - r]);
    let minR = Infinity, minC = Infinity;
    rotated.forEach(([r, c]) => { if (r < minR) minR = r; if (c < minC) minC = c; });
    return rotated.map(([r, c]) => [r - minR, c - minC]);
  }

  /** Rotira oblik za 90° suprotno od kazaljke (counter-clockwise). */
  function rotateShapeCCW(shape) {
    if (!shape || !shape.length) return shape;
    let maxR = 0, maxC = 0;
    shape.forEach(([r, c]) => { if (r > maxR) maxR = r; if (c > maxC) maxC = c; });
    const rotated = shape.map(([r, c]) => [maxC - c, r]);
    let minR = Infinity, minC = Infinity;
    rotated.forEach(([r, c]) => { if (r < minR) minR = r; if (c < minC) minC = c; });
    return rotated.map(([r, c]) => [r - minR, c - minC]);
  }

  /** Da li na tabli `grid` postoji ijedna aktivna bomba. */
  function hasActiveBombsOn(grid, size) {
    size = size || SIZE;
    if (!grid) return false;
    for (let r = 0; r < size; r++) {
      if (!grid[r]) continue;
      for (let c = 0; c < size; c++) {
        if (grid[r][c] && grid[r][c].bomb) return true;
      }
    }
    return false;
  }

  /**
   * Validira format korisničkog imena (3-12 karaktera, dozvoljena slova, cifre, _, -).
   */
  function validateUsernameFormat(name) {
    if (!name || typeof name !== 'string') return { valid: false, reason: 'empty' };
    const clean = name.trim();
    if (clean.length < 3 || clean.length > 12) return { valid: false, reason: 'length' };
    const regex = /^[a-zA-Z0-9_\-\u00C0-\u024F\u0400-\u04FF]+$/;
    if (!regex.test(clean)) return { valid: false, reason: 'chars' };
    return { valid: true, clean, lower: clean.toLowerCase() };
  }

  /**
   * Računa poene za brisanje linija uzimajući u obzir broj linija i kombo niz.
   */
  function calculateComboScore(linesCleared, removedCount, crackedCount, comboStreak) {
    if (!linesCleared || linesCleared <= 0) return 0;
    const LINE_BONUS = [0, 100, 300, 600, 1000];
    const lineBonus = LINE_BONUS[Math.min(linesCleared, 4)] || 1000;
    const base = (removedCount || 0) * 2 + (crackedCount || 0) * 1 + lineBonus;
    const streak = Math.max(1, comboStreak || 1);
    const multiplier = 1 + (streak - 1) * 0.4;
    return Math.floor(base * multiplier);
  }

  /**
   * Proverava da li je igrač prešao prag za dobijanje novih čekića ili zamena fioke.
   */
  function calculatePowerupRewards(prevScore, newScore) {
    const hammersEarned = Math.max(0, Math.floor((newScore || 0) / 1000) - Math.floor((prevScore || 0) / 1000));
    const rerollsEarned = Math.max(0, Math.floor((newScore || 0) / 2000) - Math.floor((prevScore || 0) / 2000));
    return { hammersEarned, rerollsEarned };
  }

  return {
    SIZE,
    COLORS,
    SHAPES,
    makeGrid,
    shapeSize,
    canPlaceOn,
    anyPlacementOn,
    trayAnyPlacementOn,
    hasActiveBombsOn,
    sortScoresByTop,
    mergePages,
    rotateShapeCW,
    rotateShapeCCW,
    validateUsernameFormat,
    calculateComboScore,
    calculatePowerupRewards,
  };
});
