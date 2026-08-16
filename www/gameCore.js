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
   * Da li se oblik `shape` u BILO KOJOJ od svojih 4 rotacije (0°, 90°, 180°, 270°)
   * može postaviti bilo gde na tabli `grid`.
   */
  function pieceAnyPlacementOn(grid, size, shape) {
    if (!shape || !shape.length) return false;
    let current = shape;
    for (let rot = 0; rot < 4; rot++) {
      if (anyPlacementOn(grid, size, current)) return true;
      current = rotateShapeCW(current);
    }
    return false;
  }

  /**
   * Da li se makar jedan od oblika u fioci-`tray` (niz oblika, mogu biti i `null`),
   * uzimajući u obzir sve moguće rotacije (0°, 90°, 180°, 270°), može postaviti na tablu `grid`.
   * Vraća `true` ako POSTOJI placement.
   */
  function trayAnyPlacementOn(grid, size, tray) {
    if (!tray || !Array.isArray(tray)) return false;
    for (const p of tray) {
      if (p && p.shape && pieceAnyPlacementOn(grid, size, p.shape)) return true;
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
          isRock: !!(data.maxHp === 2),
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
    const LINE_BONUS = [0, 100, 300, 750, 1500];
    const lineBonus = LINE_BONUS[Math.min(linesCleared, 4)] || 1500;
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
      id: 'destroyer_100k',
      tier: 'gold',
      icon: '🥇',
      target: 100000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 100000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(100000, val), target: 100000, pct: Math.min(100, Math.round((val / 100000) * 100)) };
      }
    },
    {
      id: 'destroyer_250k',
      tier: 'diamond',
      icon: '💎',
      target: 250000,
      check: (stats, score, pb) => Math.max(score || 0, pb || 0) >= 250000,
      getProgress: (stats, score, pb) => {
        const val = Math.max(score || 0, pb || 0);
        return { current: Math.min(250000, val), target: 250000, pct: Math.min(100, Math.round((val / 250000) * 100)) };
      }
    },
    {
      id: 'rock_crusher',
      tier: 'bronze',
      icon: '🪨',
      target: 25,
      check: (stats) => ((stats && stats.rocksCrushed) || 0) >= 25,
      getProgress: (stats) => {
        const val = (stats && stats.rocksCrushed) || 0;
        return { current: Math.min(25, val), target: 25, pct: Math.min(100, Math.round((val / 25) * 100)) };
      }
    },
    {
      id: 'bomb_defuser',
      tier: 'silver',
      icon: '💣',
      target: 15,
      check: (stats) => ((stats && stats.bombsDefused) || 0) >= 15,
      getProgress: (stats) => {
        const val = (stats && stats.bombsDefused) || 0;
        return { current: Math.min(15, val), target: 15, pct: Math.min(100, Math.round((val / 15) * 100)) };
      }
    },
    {
      id: 'combo_master',
      tier: 'gold',
      icon: '🔥',
      target: 5,
      check: (stats) => ((stats && stats.maxCombo) || 1) >= 5,
      getProgress: (stats) => {
        const val = (stats && stats.maxCombo) || 1;
        return { current: Math.min(5, val), target: 5, pct: Math.min(100, Math.round((val / 5) * 100)) };
      }
    },
    {
      id: 'line_master',
      tier: 'gold',
      icon: '✨',
      target: 200,
      check: (stats) => ((stats && stats.linesCleared) || 0) >= 200,
      getProgress: (stats) => {
        const val = (stats && stats.linesCleared) || 0;
        return { current: Math.min(200, val), target: 200, pct: Math.min(100, Math.round((val / 200) * 100)) };
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

  const PULSE_BONUS_POINTS = 250;
  const PULSE_BONUS_DURATION_SEC = 10;
  const PULSE_BONUS_MIN_INTERVAL_MS = 100000; // 100s
  const PULSE_BONUS_MAX_INTERVAL_MS = 150000; // 150s

  const FIBONACCI_MILESTONES = [1000, 2000, 3000, 5000, 8000, 13000, 21000, 34000, 55000, 89000, 144000];
  const MILESTONE_HAZARDS = [10000, 25000, 50000, 100000];
  const ICE_HAZARD_BONUS_POINTS = 500;

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
    if (milestoneIndex === 7) {
      // 34k -> 2 granita (3 HP)
      return [{ maxHp: 3 }, { maxHp: 3 }];
    }
    if (milestoneIndex === 8) {
      // 55k -> 3 kamena (2 granita + 1 običan)
      return [{ maxHp: 3 }, { maxHp: 3 }, { maxHp: 2 }];
    }
    if (milestoneIndex === 9) {
      // 89k -> 3 granita (3 HP)
      return [{ maxHp: 3 }, { maxHp: 3 }, { maxHp: 3 }];
    }
    // 144k+ -> 4 granita (3 HP)
    return [{ maxHp: 3 }, { maxHp: 3 }, { maxHp: 3 }, { maxHp: 3 }];
  }

  /**
   * Izračunava broj figura do sledeće bombe:
   * < 7.000: 15-20 figura
   * 7.000 - 19.999: 12-16 figura
   * >= 20.000: 10-13 figura
   */
  function getBombInterval(score, rng = Math.random) {
    const s = Number(score) || 0;
    if (s < 7000) {
      return 15 + Math.floor(rng() * 6); // 15 - 20
    }
    if (s < 20000) {
      return 12 + Math.floor(rng() * 5); // 12 - 16
    }
    return 10 + Math.floor(rng() * 4); // 10 - 13
  }

  /**
   * Određuje početni tajmer za bombu (broj poteza):
   * < 7.000: 3 poteza
   * 7.000 - 19.999: 30% šanse za brzu bombu (2 poteza), inače 3
   * >= 20.000: 50% šanse za brzu bombu (2 poteza), inače 3
   */
  function getBombInitialTimer(score, rng = Math.random) {
    const s = Number(score) || 0;
    if (s >= 20000 && rng() < 0.50) return 2;
    if (s >= 7000 && rng() < 0.30) return 2;
    return 3;
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
    getFibonacciRockMilestone,
    getFibonacciMilestoneSpawnConfig,
    findRandomFreeCell,
    getCompletedLinesForPlacement,
  };
});
