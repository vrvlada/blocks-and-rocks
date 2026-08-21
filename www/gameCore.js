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
    // Dijagonalni oblici (2 kocke ukoso)
    [[0, 0], [1, 1]],
    [[0, 1], [1, 0]],
    // Dijagonalni oblici (3 kocke ukoso)
    [[0, 0], [1, 1], [2, 2]],
    [[0, 2], [1, 1], [2, 0]],
    // T-oblici (T-shapes)
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[0, 1], [1, 1], [2, 1], [1, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[1, 0], [1, 1], [1, 2], [0, 1]],
    // Glomazni i dugački oblici (Hard tier)
    [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], // 29: 1x5 line
    [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], // 30: 5x1 line
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], // 31: 3x3 big square
    [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], // 32: plus/cross 5
    [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], // 33: L5
    [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], // 34: J5
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
   * Da li se oblik `shape` (u 4 rotacije, ili samo 1 rotaciji ako je isLockedRotation)
   * može postaviti bilo gde na tabli `grid`.
   */
  function pieceAnyPlacementOn(grid, size, shape, isLockedRotation) {
    if (!shape || !shape.length) return false;
    if (isLockedRotation) {
      return anyPlacementOn(grid, size, shape);
    }
    let current = shape;
    for (let rot = 0; rot < 4; rot++) {
      if (anyPlacementOn(grid, size, current)) return true;
      current = rotateShapeCW(current);
    }
    return false;
  }

  /**
   * Da li se makar jedan od oblika u fioci-`tray` (niz oblika, mogu biti i `null`),
   * uzimajući u obzir dozvoljene rotacije, može postaviti na tablu `grid`.
   * Vraća `true` ako POSTOJI placement.
   */
  function trayAnyPlacementOn(grid, size, tray) {
    if (!tray || !Array.isArray(tray)) return false;
    for (const p of tray) {
      if (!p) continue;
      const shape = (p && p.shape) ? p.shape : p;
      const isLocked = !!(p && p.isLockedRotation);
      if (Array.isArray(shape) && pieceAnyPlacementOn(grid, size, shape, isLocked)) return true;
    }
    return false;
  }

  /** Da li na tabli `grid` postoji ijedna popunjena ćelija (blok/stena/bomba). */
  function hasOccupiedCellsOn(grid, size) {
    size = size || SIZE;
    if (!grid) return false;
    for (let r = 0; r < size; r++) {
      if (!grid[r]) continue;
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) return true;
      }
    }
    return false;
  }

  /**
   * Proverava da li igrač ima na raspolaganju bilo koji mogući potez:
   * 1. Makar jedna kocka iz fioke se može postaviti u BILO KOJOJ rotaciji.
   * 2. Korisnik ima preostale čekiće (hammersCount > 0) i na tabli ima popunjenih kocki koje može razbiti.
   * 3. Korisnik ima zamenu (rerollsCount > 0) kojom može zameniti komade u fioci.
   */
  function hasAvailableMovesOn(grid, size, tray, hammersCount, rerollsCount) {
    if (trayAnyPlacementOn(grid, size, tray)) return true;
    if ((Number(hammersCount) || 0) > 0 && hasOccupiedCellsOn(grid, size)) return true;
    if ((Number(rerollsCount) || 0) > 0) return true;
    return false;
  }

  /** Vraća true samo kada igrač nema više nijedan mogući potez. */
  function isGameOverOn(grid, size, tray, hammersCount, rerollsCount) {
    return !hasAvailableMovesOn(grid, size, tray, hammersCount, rerollsCount);
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

  /**
   * Računa statistiku eksplozije bombe na (r, c): broj uklonjenih ćelija, napuklih,
   * i uništenih stena — čista logika (bez DOM-a).
   * Vraća { affected, removedCount, crackedCount, rocksCrushed }.
   * `affected` sadrži i samo polje bombe (da bi se skor za uklanjanje poklapao sa
   * postojećim ponašanjem), ali bombe eksplodirane NISU "defused" i NISU stene,
   * pa se ne računaju u `rocksCrushed`. Elementi niza: {r, c, color, willRemove, isRock, isBomb}.
   */
  function countBombExplosionStats(grid, size, bombR, bombC) {
    if (!grid || !grid[bombR] || !grid[bombR][bombC]) {
      return { affected: [], removedCount: 0, crackedCount: 0, rocksCrushed: 0 };
    }
    const affected = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = bombR + dr, cc = bombC + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const data = grid[rr][cc];
        if (!data) continue;
        const willRemove = data.hp <= 1;
        affected.push({
          r: rr, c: cc,
          color: data.color || '#fb7185',
          willRemove,
          isRock: !!(data.maxHp >= 2), // granit (3 HP) je takođe kamen
          isBomb: !!data.bomb,
        });
      }
    }
    const removedCount = affected.filter(p => p.willRemove).length;
    const crackedCount = affected.length - removedCount;
    const rocksCrushed = affected.filter(p => p.willRemove && p.isRock).length;
    return { affected, removedCount, crackedCount, rocksCrushed };
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
    const LINE_BONUS = [0, 200, 600, 1500, 3000];
    const lineBonus = LINE_BONUS[Math.min(linesCleared, 4)] || 3000;
    const base = (removedCount || 0) * 2 + (crackedCount || 0) * 1 + lineBonus;
    const streak = Math.max(1, comboStreak || 1);
    const multiplier = 1 + (streak - 1) * 0.8;
    return Math.floor(base * multiplier);
  }

  /**
   * Proverava da li je igrač prešao prag za dobijanje powerup-ova (čekić i zamena na svakih 5.000 poena).
   */
  function calculatePowerupRewards(prevScore, newScore) {
    const earned = Math.max(0, Math.floor((newScore || 0) / 5000) - Math.floor((prevScore || 0) / 5000));
    const hammersEarned = earned;
    const rerollsEarned = earned;
    return { hammersEarned, rerollsEarned };
  }

  /**
   * Definicije dostignuća i bedževa (Destroyer serija + tematski bedževi).
   */
  const BADGES = [
    {
      id: 'destroyer_10k',
      tier: 'bronze',
      icon: '🥉',
      target: 10000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 10000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(10000, val), target: 10000, pct: Math.min(100, Math.round((val / 10000) * 100)) };
      }
    },
    {
      id: 'destroyer_20k',
      tier: 'bronze',
      icon: '🥉',
      target: 20000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 20000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(20000, val), target: 20000, pct: Math.min(100, Math.round((val / 20000) * 100)) };
      }
    },
    {
      id: 'destroyer_30k',
      tier: 'bronze',
      icon: '🥉',
      target: 30000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 30000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(30000, val), target: 30000, pct: Math.min(100, Math.round((val / 30000) * 100)) };
      }
    },
    {
      id: 'destroyer_40k',
      tier: 'silver',
      icon: '🥈',
      target: 40000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 40000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(40000, val), target: 40000, pct: Math.min(100, Math.round((val / 40000) * 100)) };
      }
    },
    {
      id: 'destroyer_50k',
      tier: 'silver',
      icon: '🥈',
      target: 50000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 50000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(50000, val), target: 50000, pct: Math.min(100, Math.round((val / 50000) * 100)) };
      }
    },
    {
      id: 'destroyer_60k',
      tier: 'silver',
      icon: '🥈',
      target: 60000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 60000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(60000, val), target: 60000, pct: Math.min(100, Math.round((val / 60000) * 100)) };
      }
    },
    {
      id: 'destroyer_70k',
      tier: 'gold',
      icon: '🥇',
      target: 70000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 70000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(70000, val), target: 70000, pct: Math.min(100, Math.round((val / 70000) * 100)) };
      }
    },
    {
      id: 'destroyer_80k',
      tier: 'gold',
      icon: '🥇',
      target: 80000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 80000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(80000, val), target: 80000, pct: Math.min(100, Math.round((val / 80000) * 100)) };
      }
    },
    {
      id: 'destroyer_90k',
      tier: 'gold',
      icon: '🥇',
      target: 90000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 90000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(90000, val), target: 90000, pct: Math.min(100, Math.round((val / 90000) * 100)) };
      }
    },
    {
      id: 'destroyer_100k',
      tier: 'diamond',
      icon: '💎',
      target: 100000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 100000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(100000, val), target: 100000, pct: Math.min(100, Math.round((val / 100000) * 100)) };
      }
    }
  ];

  /**
   * Proverava koja su nova dostignuća otključana na osnovu trenutnog skora i statistike.
   * Vraća niz novo-otključanih bedževa.
   */
  function checkNewBadges(unlockedMap, stats, currentScore, personalBest) {
    const newlyUnlocked = [];
    const unlocked = unlockedMap || {};
    for (const badge of BADGES) {
      if (!unlocked[badge.id] && badge.check(stats, currentScore, personalBest)) {
        newlyUnlocked.push(badge);
      }
    }
    return newlyUnlocked;
  }

  const PULSE_BONUS_POINTS = 500;
  const PULSE_BONUS_DURATION_SEC = 15;
  const PULSE_BONUS_MIN_INTERVAL_MS = 100000; // 100s
  const PULSE_BONUS_MAX_INTERVAL_MS = 150000; // 150s

  const FIBONACCI_MILESTONES = [1000, 2000, 3000, 5000, 8000, 13000, 21000, 34000, 55000, 89000, 144000];
  const MILESTONE_HAZARDS = [10000, 25000, 50000, 100000];
  const ICE_HAZARD_BONUS_POINTS = 500;
  const FROST_HAZARD_START_SCORE = 10000;
  const FROST_HAZARD_INTERVAL_SCORE = 5000;
  const FROST_HAZARD_MOVES = 5;
  const FROST_HAZARD_BONUS_POINTS = 500;

  /**
   * Izračunava na koliko figura se stvara kamen na osnovu Fibonačijevih zona skora:
   * < 2.000: na svakih 10 figura
   * 2.000 - 2.999: na svakih 9 figura
   * 3.000 - 4.999: na svakih 8 figura
   * 5.000 - 7.999: na svakih 7 figura
   * 8.000 - 12.999: na svakih 6 figura
   * 13.000 - 20.999: na svakih 5 figura
   * 21.000 - 33.999: na svakih 4 figure
   * >= 34.000: na svakih 3 figure
   */
  function getRockInterval(score) {
    const s = Number(score) || 0;
    if (s < 2000) return 10;
    if (s < 3000) return 9;
    if (s < 5000) return 8;
    if (s < 8000) return 7;
    if (s < 13000) return 6;
    if (s < 21000) return 5;
    if (s < 34000) return 4;
    return 3;
  }

  /**
   * Određuje maksimalni HP za kamen po Fibonačijevim zonama:
   * < 5.000: 2 HP (običan kamen)
   * 5.000 - 7.999: 15% šanse za 3 HP Granit
   * 8.000 - 12.999: 30% šanse za 3 HP Granit
   * 13.000 - 20.999: 40% šanse za 3 HP Granit
   * 21.000 - 33.999: 50% šanse za 3 HP Granit
   * >= 34.000: 60% šanse za 3 HP Granit
   */
  function getRockMaxHp(score, rng = Math.random) {
    const s = Number(score) || 0;
    if (s >= 34000) return rng() < 0.60 ? 3 : 2;
    if (s >= 21000) return rng() < 0.50 ? 3 : 2;
    if (s >= 13000) return rng() < 0.40 ? 3 : 2;
    if (s >= 8000) return rng() < 0.30 ? 3 : 2;
    if (s >= 5000) return rng() < 0.15 ? 3 : 2;
    return 2;
  }

  /**
   * Vraća indeks dostignutog Fibonačijevog praga (0 za 1k, 1 za 2k, 2 za 3k, 3 za 5k, 4 za 8k, ...)
   * ili -1 ako je skor manji od 1.000.
   */
  function getFibonacciRockMilestone(score) {
    const s = Number(score) || 0;
    let reached = -1;
    for (let i = 0; i < FIBONACCI_MILESTONES.length; i++) {
      if (s >= FIBONACCI_MILESTONES[i]) reached = i;
    }
    return reached;
  }

  /**
   * Određuje raspored kamenja koji pada na tablu na Fibonačijevom pragu:
   * Vraća niz definicija za kamenje, npr. [{ maxHp: 2 }, { maxHp: 3 }]
   */
  function getFibonacciMilestoneSpawnConfig(milestoneIndex) {
    if (milestoneIndex < 0) return [];
    if (milestoneIndex <= 3) {
      // 1k, 2k, 3k, 5k -> 1 običan kamen (2 HP)
      return [{ maxHp: 2 }];
    }
    if (milestoneIndex <= 5) {
      // 8k, 13k -> 1 granitni kamen (3 HP)
      return [{ maxHp: 3 }];
    }
    if (milestoneIndex === 6) {
      // 21k -> 2 kamena (1 granit 3 HP + 1 običan 2 HP)
      return [{ maxHp: 3 }, { maxHp: 2 }];
    }
    // >= 34k -> Ograničeno na maks 2 granita (3 HP) odjednom 
    // da bi se sprečio instant Game Over na maloj tabli.
    return [{ maxHp: 3 }, { maxHp: 3 }];
  }

  const MAX_HAMMERS = 2;
  const MAX_REROLLS = 2;
  const POWERUP_OVERFLOW_POINTS = 500;
  const BOARD_CLEAR_BONUS = 1000;

  const SHAPE_TIERS = {
    easy: [0, 1, 2, 3, 6, 7, 8, 9, 10, 21, 22],
    medium: [4, 5, 11, 12, 13, 14, 15, 16, 17, 18, 19, 23, 24, 25, 26, 27, 28],
    hard: [20, 29, 30, 31, 32, 33, 34]
  };

  /**
   * Izračunava udeo popunjenih ćelija na tabli (0.0 do 1.0).
   */
  function getGridOccupancy(grid, size) {
    size = size || SIZE;
    if (!grid) return 0;
    let occupied = 0;
    for (let r = 0; r < size; r++) {
      if (!grid[r]) continue;
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) occupied++;
      }
    }
    return occupied / (size * size);
  }

  /**
   * Vraća listu indeksa figura iz `shapesList` (ili SHAPES) koje fizički mogu da se smeste na tablu
   * u bar jednoj od 4 rotacije.
   */
  function getShapesThatFit(grid, size, shapesList) {
    size = size || SIZE;
    const list = shapesList || SHAPES;
    const fitting = [];
    for (let i = 0; i < list.length; i++) {
      if (pieceAnyPlacementOn(grid, size, list[i])) {
        fitting.push(i);
      }
    }
    return fitting;
  }

  /**
   * Generiše 3 indeksa figura za fioku prateći svetski industrijski standard (Controlled Random):
   * 1. Kompozicija fioke: maksimalno 1 Hard komad (nema spama glomaznih 3x3).
   * 2. Svest o popunjenosti table (Board density awareness): na velikoj popunjenosti (> 65%) daje spasonosne komade.
   * 3. Anti-Deadlock garancija: garantuje da najmanje 1 od 3 komada MOŽE da stane na tablu (ako prostor uopšte postoji).
   */
  function generateSmartTrayShapeIndices(grid, size, score, rng = Math.random) {
    size = size || SIZE;
    const s = Number(score) || 0;
    const occupancy = getGridOccupancy(grid, size);

    // 1. Biranje 3 komada uz kontrolisanu kompoziciju
    const pickFromPool = (pool) => {
      const idx = Math.floor(rng() * pool.length);
      return pool[idx] !== undefined ? pool[idx] : 0;
    };

    let s0, s1, s2;

    if (occupancy >= 0.70) {
      // Kritična situacija (> 70% puno): 2 laka (linije/uglovi) + 1 srednji (spasavanje table)
      s0 = pickFromPool(SHAPE_TIERS.easy);
      s1 = pickFromPool(SHAPE_TIERS.easy);
      s2 = pickFromPool(SHAPE_TIERS.medium);
    } else if (occupancy >= 0.50) {
      // Srednja popunjenost: 1 lak + 1 srednji + (1 srednji ili 1 hard)
      s0 = pickFromPool(SHAPE_TIERS.easy);
      s1 = pickFromPool(SHAPE_TIERS.medium);
      const allowHard = (s >= 10000 && rng() < 0.35);
      s2 = allowHard ? pickFromPool(SHAPE_TIERS.hard) : pickFromPool(SHAPE_TIERS.medium);
    } else {
      // Čista tabla (< 50% puno): veći pritisak i izazov
      s0 = (s < 5000) ? pickFromPool(SHAPE_TIERS.easy) : (rng() < 0.5 ? pickFromPool(SHAPE_TIERS.easy) : pickFromPool(SHAPE_TIERS.medium));
      s1 = pickFromPool(SHAPE_TIERS.medium);
      const allowHard = (s >= 5000 && rng() < 0.45);
      s2 = allowHard ? pickFromPool(SHAPE_TIERS.hard) : pickFromPool(SHAPE_TIERS.medium);
    }

    const trayShapes = [s0, s1, s2];

    // 2. Anti-Deadlock pravilo: proveri da li bar 1 od 3 komada može da se smesti na tablu
    const trayPieces = trayShapes.map(idx => SHAPES[idx]);
    if (grid && !trayAnyPlacementOn(grid, size, trayPieces)) {
      const fitting = getShapesThatFit(grid, size, SHAPES);
      if (fitting.length > 0) {
        // Prioritet dajemo lakšim i srednjim figurama koje staju
        const easyFit = fitting.filter(idx => SHAPE_TIERS.easy.includes(idx));
        const medFit = fitting.filter(idx => SHAPE_TIERS.medium.includes(idx));
        const pool = easyFit.length > 0 ? easyFit : (medFit.length > 0 ? medFit : fitting);
        const fitChoice = pool[Math.floor(rng() * pool.length)];
        trayShapes[0] = fitChoice;
      }
    }

    return trayShapes;
  }

  /**
   * Bira indeks figure iz SHAPES niza na osnovu dinamičke raspodele težine po skoru:
   * < 5.000: 50% Easy, 40% Medium, 10% Hard
   * 5.000 - 14.999: 30% Easy, 50% Medium, 20% Hard
   * 15.000 - 29.999: 20% Easy, 50% Medium, 30% Hard
   * >= 30.000: 15% Easy, 45% Medium, 40% Hard
   */
  function getWeightedRandomShapeIndex(score, rng = Math.random) {
    const s = Number(score) || 0;
    let easyW = 0.50, medW = 0.40, hardW = 0.10;
    if (s >= 30000) {
      easyW = 0.15; medW = 0.45; hardW = 0.40;
    } else if (s >= 15000) {
      easyW = 0.20; medW = 0.50; hardW = 0.30;
    } else if (s >= 5000) {
      easyW = 0.30; medW = 0.50; hardW = 0.20;
    }

    const r = rng();
    let pool = SHAPE_TIERS.easy;
    if (r < hardW) {
      pool = SHAPE_TIERS.hard;
    } else if (r < hardW + medW) {
      pool = SHAPE_TIERS.medium;
    }

    const idxInPool = Math.floor(rng() * pool.length);
    return pool[idxInPool] !== undefined ? pool[idxInPool] : 0;
  }

  /**
   * Vraća broj kamenih blokova unutar jedne figure kada je dostignut rock interval:
   * < 15.000: uvek 1 kamen
   * >= 15.000: 40% šanse za 2 kamena (ako figura ima >= 2 kocke)
   */
  function getRockCountForPiece(score, pieceLength, rng = Math.random) {
    const s = Number(score) || 0;
    if (s >= 15000 && (pieceLength || 0) >= 2 && rng() < 0.40) {
      return 2;
    }
    return 1;
  }

  /**
   * Vraća da li je figura fiksna (zaključana za rotaciju):
   * UKINUTO - Mehanika zaključavanja rotacije je izbačena iz igre. Uvek vraća false.
   */
  function getIsPieceRotationLocked(score, rng = Math.random) {
    return false;
  }

  /**
   * Izračunava broj figura do sledeće bombe:
   * < 3.000: 26-34 figura (ređe, za opušten početak i gradnju)
   * 3.000 - 4.999: 18-24 figure (malo češće, umeren izazov)
   * 5.000 - 9.999: 14-18 figura (još češće, dinamična igra)
   * 10.000 - 19.999: 11-15 figura (brzi tempo)
   * >= 20.000: 9-13 figura (endgame majstorski nivo)
   */
  function getBombInterval(score, rng = Math.random) {
    const s = Number(score) || 0;
    if (s < 3000) {
      return 26 + Math.floor(rng() * 9); // 26 - 34
    }
    if (s < 5000) {
      return 18 + Math.floor(rng() * 7); // 18 - 24
    }
    if (s < 10000) {
      return 14 + Math.floor(rng() * 5); // 14 - 18
    }
    if (s < 20000) {
      return 11 + Math.floor(rng() * 5); // 11 - 15
    }
    return 9 + Math.floor(rng() * 5); // 9 - 13
  }

  /**
   * Određuje početni tajmer za bombu (u potezima):
   * < 10.000: 5 poteza
   * 10.000 - 24.999: 4 poteza
   * >= 25.000: 3 poteza
   */
  function getBombInitialTimer(score, rng = Math.random) {
    const s = Number(score) || 0;
    if (s >= 25000) return 3;
    if (s >= 10000) return 4;
    return 5;
  }

  /**
   * Opcija A: Eksplozija bombe pretvara pogođenu zonu 3x3 u ruševine / kamenje
   * umesto da je obriše.
   * Vraća { affectedCells: Array<{r, c, hp, maxHp, wasCenter}>, spawnedRocksCount: number }
   */
  function applyBombExplosionHazard(grid, size, bombR, bombC, rng = Math.random) {
    size = size || SIZE;
    if (!grid || !grid[bombR] || !grid[bombR][bombC]) {
      return { affectedCells: [], spawnedRocksCount: 0 };
    }
    const affectedCells = [];
    let spawnedRocksCount = 0;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = bombR + dr, cc = bombC + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const isCenter = (dr === 0 && dc === 0);
        const current = grid[rr][cc];

        if (isCenter) {
          // Centar gde je bila bomba postaje kamen 2 HP
          grid[rr][cc] = { hp: 2, maxHp: 2, color: '#64748b', isRock: true };
          affectedCells.push({ r: rr, c: cc, hp: 2, maxHp: 2, wasCenter: true });
          spawnedRocksCount++;
        } else if (current) {
          // Postojeći običan blok se pretvara u kamen 2 HP
          if (!current.maxHp || current.maxHp < 2) {
            grid[rr][cc] = { hp: 2, maxHp: 2, color: '#64748b', isRock: true };
            affectedCells.push({ r: rr, c: cc, hp: 2, maxHp: 2, wasCenter: false });
            spawnedRocksCount++;
          }
        } else {
          // Prazno polje u radijusu ima 50% šanse da dobije kamen 2 HP
          if (rng() < 0.50) {
            grid[rr][cc] = { hp: 2, maxHp: 2, color: '#64748b', isRock: true };
            affectedCells.push({ r: rr, c: cc, hp: 2, maxHp: 2, wasCenter: false });
            spawnedRocksCount++;
          }
        }
      }
    }
    return { affectedCells, spawnedRocksCount };
  }

  /**
   * Vraća najveći indeks dostignute prekretnice (0 za 10k, 1 za 25k, 2 za 50k, 3 za 100k, ili -1 ako nije dostignuta).
   */
  function getMilestoneHazardLevel(score) {
    const s = Number(score) || 0;
    let reached = -1;
    for (let i = 0; i < MILESTONE_HAZARDS.length; i++) {
      if (s >= MILESTONE_HAZARDS[i]) reached = i;
    }
    return reached;
  }

  /**
   * Vraća indeks dostignutog Frost Cube praga (0 za 10k, 1 za 15k, 2 za 20k, 3 za 25k, ...)
   * ili -1 ako je skor manji od 10.000.
   */
  function getFrostHazardMilestone(score) {
    const s = Number(score) || 0;
    if (s < FROST_HAZARD_START_SCORE) return -1;
    return Math.floor((s - FROST_HAZARD_START_SCORE) / FROST_HAZARD_INTERVAL_SCORE);
  }

  /**
   * Pronalazi sve popunjene ćelije duž 4 dijagonale (NW, NE, SW, SE) polazeći od (r, c).
   * Vraća niz { r: number, c: number, cell: object }.
   */
  function getDiagonalOccupiedCells(grid, size, r, c) {
    size = size || SIZE;
    if (!grid || r == null || c == null) return [];
    const occupied = [];
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    dirs.forEach(([dr, dc]) => {
      let step = 1;
      while (true) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) break;
        if (grid[nr] && grid[nr][nc]) {
          occupied.push({ r: nr, c: nc, cell: grid[nr][nc] });
        }
        step++;
      }
    });
    return occupied;
  }

  /**
   * Primenjuje Frost Freeze na sve popunjene kocke duž dijagonala od (frostR, frostC):
   * Svaka pronađena kocka dobija isFrozen: true, i povećava joj se hp i maxHp za +1.
   * Vraća niz zamrznutih koordinata [{r, c}].
   */
  function applyFrostFreeze(grid, size, frostR, frostC) {
    size = size || SIZE;
    const occupied = getDiagonalOccupiedCells(grid, size, frostR, frostC);
    const frozenCells = [];
    occupied.forEach(({ r, c, cell }) => {
      if (cell) {
        cell.isFrozen = true;
        cell.hp = (Number(cell.hp) || 1) + 1;
        cell.maxHp = Math.max(Number(cell.maxHp) || 1, cell.hp);
        frozenCells.push({ r, c });
      }
    });
    return frozenCells;
  }

  /**
   * Pronalazi nasumičnu slobodnu ćeliju na tabli za postavljanje hazard/ice bloka.
   * Vraća { r, c } ili null ako je tabla puna.
   */
  function findRandomFreeCell(grid, size = SIZE, rng = Math.random) {
    if (!grid) return null;
    const free = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c]) free.push({ r, c });
      }
    }
    if (free.length === 0) return null;
    const idx = Math.floor(rng() * free.length);
    return free[idx];
  }

  /**
   * Proverava koje linije (redovi i kolone) bi bile kompletirane ako se
   * `shape` postavi na (row, col).
   * Vraća { rows: number[], cols: number[], cells: Array<{r: number, c: number}> }.
   */
  function getCompletedLinesForPlacement(grid, size, shape, row, col) {
    size = size || SIZE;
    if (!grid || !shape || !canPlaceOn(grid, size, shape, row, col)) {
      return { rows: [], cols: [], cells: [] };
    }
    const placedSet = new Set();
    shape.forEach(([r, c]) => {
      placedSet.add((row + r) + '_' + (col + c));
    });

    const fullRows = [];
    const fullCols = [];

    for (let r = 0; r < size; r++) {
      let rowFull = true;
      for (let c = 0; c < size; c++) {
        if (!grid[r][c] && !placedSet.has(r + '_' + c)) {
          rowFull = false;
          break;
        }
      }
      if (rowFull) fullRows.push(r);
    }

    for (let c = 0; c < size; c++) {
      let colFull = true;
      for (let r = 0; r < size; r++) {
        if (!grid[r][c] && !placedSet.has(r + '_' + c)) {
          colFull = false;
          break;
        }
      }
      if (colFull) fullCols.push(c);
    }

    const affectedKeys = new Set();
    fullRows.forEach(r => {
      for (let c = 0; c < size; c++) affectedKeys.add(r + '_' + c);
    });
    fullCols.forEach(c => {
      for (let r = 0; r < size; r++) affectedKeys.add(r + '_' + c);
    });

    const cells = Array.from(affectedKeys).map(key => {
      const [r, c] = key.split('_').map(Number);
      return { r, c };
    });

    return { rows: fullRows, cols: fullCols, cells };
  }

  function formatShareScoreText(options) {
    const opts = options || {};
    const score = opts.score || 0;
    const combo = opts.comboStreak || 0;
    const sub = opts.sub || '';
    const shareScored = opts.shareScored || 'Osvojio sam';
    const sharePoints = opts.sharePoints || 'poena';
    const shareBestCombo = opts.shareBestCombo || 'Najveći kombo: x';
    const shareChallenge = opts.shareChallenge || 'Možeš li me stići? 🚀';
    const url = opts.url || 'https://blocks-and-rocks.web.app';

    let text = '🧱💥 Blocks and Rocks' + (sub ? (' — ' + sub) : '') + '\n'
      + '🏆 ' + shareScored + ' ' + Number(score).toLocaleString() + ' ' + sharePoints + '!\n';
    if (combo > 1) {
      text += '🔥 ' + shareBestCombo + combo + '\n';
    }
    text += shareChallenge + '\n'
      + '🎮 ' + url;
    return text;
  }

  return {
    SIZE,
    COLORS,
    SHAPES,
    BADGES,
    PULSE_BONUS_POINTS,
    PULSE_BONUS_DURATION_SEC,
    PULSE_BONUS_MIN_INTERVAL_MS,
    PULSE_BONUS_MAX_INTERVAL_MS,
    MILESTONE_HAZARDS,
    ICE_HAZARD_BONUS_POINTS,
    FROST_HAZARD_START_SCORE,
    FROST_HAZARD_INTERVAL_SCORE,
    FROST_HAZARD_MOVES,
    FROST_HAZARD_BONUS_POINTS,
    FIBONACCI_MILESTONES,
    makeGrid,
    shapeSize,
    canPlaceOn,
    anyPlacementOn,
    pieceAnyPlacementOn,
    trayAnyPlacementOn,
    hasOccupiedCellsOn,
    hasAvailableMovesOn,
    isGameOverOn,
    hasActiveBombsOn,
    countBombExplosionStats,
    sortScoresByTop,
    mergePages,
    rotateShapeCW,
    rotateShapeCCW,
    validateUsernameFormat,
    calculateComboScore,
    calculatePowerupRewards,
    checkNewBadges,
    getRockInterval,
    getRockMaxHp,
    getBombInterval,
    getBombInitialTimer,
    getMilestoneHazardLevel,
    getFrostHazardMilestone,
    getDiagonalOccupiedCells,
    applyFrostFreeze,
    getFibonacciRockMilestone,
    getFibonacciMilestoneSpawnConfig,
    MAX_HAMMERS,
    MAX_REROLLS,
    POWERUP_OVERFLOW_POINTS,
    BOARD_CLEAR_BONUS,
    SHAPE_TIERS,
    getWeightedRandomShapeIndex,
    getRockCountForPiece,
    getIsPieceRotationLocked,
    applyBombExplosionHazard,
    findRandomFreeCell,
    getGridOccupancy,
    getShapesThatFit,
    generateSmartTrayShapeIndices,
    getCompletedLinesForPlacement,
    formatShareScoreText,
  };
});
