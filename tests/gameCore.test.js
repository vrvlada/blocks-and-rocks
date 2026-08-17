// Tests for www/gameCore.js — pure game logic (no DOM).
// Run with: npm test  (node --test tests/)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../www/gameCore.js');

test('constants: SIZE=8, 35 shapes, 7 colors', () => {
  assert.equal(G.SIZE, 8);
  assert.equal(G.SHAPES.length, 35);
  assert.equal(G.COLORS.length, 7);
  assert.equal(G.MAX_HAMMERS, 2);
  assert.equal(G.MAX_REROLLS, 2);
});

test('all shapes fit inside the board and are non-empty', () => {
  for (const shape of G.SHAPES) {
    assert.ok(shape.length > 0, 'shape is not empty');
    const { rows, cols } = G.shapeSize(shape);
    assert.ok(rows <= G.SIZE && cols <= G.SIZE, `shape ${JSON.stringify(shape)} fits in ${G.SIZE}x${G.SIZE}`);
  }
});

test('shapeSize computes minimal bounding box', () => {
  assert.deepEqual(G.shapeSize([[0, 0]]), { rows: 1, cols: 1 });
  assert.deepEqual(G.shapeSize([[0, 0], [0, 1], [1, 1]]), { rows: 2, cols: 2 });
  assert.deepEqual(G.shapeSize([[0, 2], [1, 0], [1, 1], [1, 2]]), { rows: 2, cols: 3 });
});

test('makeGrid creates an empty board', () => {
  const grid = G.makeGrid();
  assert.equal(grid.length, G.SIZE);
  grid.forEach(row => {
    assert.equal(row.length, G.SIZE);
    row.forEach(cell => assert.equal(cell, null));
  });
  assert.equal(G.makeGrid(4).length, 4);
});

test('canPlaceOn: in bounds + free cells', () => {
  const grid = G.makeGrid(3);
  const domino = [[0, 0], [0, 1]];
  assert.equal(G.canPlaceOn(grid, 3, domino, 0, 0), true);
  assert.equal(G.canPlaceOn(grid, 3, domino, 0, 2), false, 'overflows column');
  assert.equal(G.canPlaceOn(grid, 3, domino, 2, 2), false, 'overflows row');
  // block a cell and try overlapping
  grid[1][1] = { color: '#fff' };
  assert.equal(G.canPlaceOn(grid, 3, domino, 1, 1), false, 'overlaps occupied cell');
  assert.equal(G.canPlaceOn(grid, 3, domino, 0, 1), true);
});

test('anyPlacementOn: empty board yes, full board no', () => {
  const p = [[0, 0]];
  assert.equal(G.anyPlacementOn(G.makeGrid(), G.SIZE, p), true);
  const full = G.makeGrid().map(row => row.map(() => ({ color: '#fff' })));
  assert.equal(G.anyPlacementOn(full, G.SIZE, p), false);
});

test('trayAnyPlacementOn mirrors checkGameOver logic (regression for premature game over)', () => {
  // Fully occupied board except a 2x2 hole in the middle
  const grid = G.makeGrid().map(row => row.map(() => ({ color: '#aaa' })));
  for (let r = 3; r <= 4; r++) for (let c = 3; c <= 4; c++) grid[r][c] = null;

  const tray = [
    { shape: [[0, 0], [0, 1], [1, 0], [1, 1]] }, // 2x2 -> fits the hole
    null,
    { shape: [[0, 0]] },
  ];
  // Any placement exists -> NOT game over
  assert.equal(G.trayAnyPlacementOn(grid, G.SIZE, tray), true);

  // Fill the hole -> game over for these pieces
  for (let r = 3; r <= 4; r++) for (let c = 3; c <= 4; c++) grid[r][c] = { color: '#bbb' };
  assert.equal(G.trayAnyPlacementOn(grid, G.SIZE, tray), false);
});

test('pieceAnyPlacementOn and trayAnyPlacementOn test all 4 rotations', () => {
  // Board with only 1 horizontal 1x3 slot free, rest is filled
  const grid = G.makeGrid().map(row => row.map(() => ({ color: '#aaa' })));
  grid[2][0] = null;
  grid[2][1] = null;
  grid[2][2] = null;

  // A 3x1 vertical piece [[0,0], [1,0], [2,0]] does not fit directly (rows 2,3,4 on col 0 blocked)
  const verticalPiece = [[0, 0], [1, 0], [2, 0]];
  assert.equal(G.anyPlacementOn(grid, G.SIZE, verticalPiece), false, 'does not fit in 0 deg rotation');

  // But pieceAnyPlacementOn rotates it to horizontal [[0,0], [0,1], [0,2]] which fits at (2,0)!
  assert.equal(G.pieceAnyPlacementOn(grid, G.SIZE, verticalPiece), true, 'fits after 90 deg rotation');

  // trayAnyPlacementOn should return true for this piece
  const tray = [{ shape: verticalPiece }, null, null];
  assert.equal(G.trayAnyPlacementOn(grid, G.SIZE, tray), true);
});

test('hasOccupiedCellsOn detects filled cells', () => {
  const emptyGrid = G.makeGrid();
  assert.equal(G.hasOccupiedCellsOn(emptyGrid, G.SIZE), false);

  const gridWithCell = G.makeGrid();
  gridWithCell[4][4] = { color: '#fbbf24', hp: 1 };
  assert.equal(G.hasOccupiedCellsOn(gridWithCell, G.SIZE), true);
});

test('hasAvailableMovesOn and isGameOverOn consider piece rotations, hammers, and rerolls', () => {
  // Completely full board - no piece in any rotation can be placed
  const fullGrid = G.makeGrid().map(row => row.map(() => ({ color: '#333' })));
  const tray = [{ shape: [[0, 0]] }]; // 1x1 block

  // 1. Full board, no hammers, no rerolls -> Game Over!
  assert.equal(G.hasAvailableMovesOn(fullGrid, G.SIZE, tray, 0, 0), false);
  assert.equal(G.isGameOverOn(fullGrid, G.SIZE, tray, 0, 0), true);

  // 2. Full board, but player has a hammer -> NOT Game Over (can smash a block to make space)
  assert.equal(G.hasAvailableMovesOn(fullGrid, G.SIZE, tray, 1, 0), true);
  assert.equal(G.isGameOverOn(fullGrid, G.SIZE, tray, 1, 0), false);

  // 3. Full board, no hammers, but player has a reroll/swap -> NOT Game Over
  assert.equal(G.hasAvailableMovesOn(fullGrid, G.SIZE, tray, 0, 1), true);
  assert.equal(G.isGameOverOn(fullGrid, G.SIZE, tray, 0, 1), false);

  // 4. Empty board, no hammers, no rerolls -> NOT Game Over (piece fits)
  assert.equal(G.hasAvailableMovesOn(G.makeGrid(), G.SIZE, tray, 0, 0), true);
  assert.equal(G.isGameOverOn(G.makeGrid(), G.SIZE, tray, 0, 0), false);
});

test('tray with only null pieces has no placement', () => {
  assert.equal(G.trayAnyPlacementOn(G.makeGrid(), G.SIZE, [null, null, null]), false);
});

test('sortScoresByTop returns top n, sorted descending, without mutating input', () => {
  const rows = [
    { score: 5 }, { score: 120 }, { score: 42 }, { score: 120 }, { score: 0 },
  ];
  const top = G.sortScoresByTop(rows, 3);
  assert.deepEqual(top.map(r => r.score), [120, 120, 42]);
  assert.equal(top.length, 3);
  assert.deepEqual(rows.map(r => r.score), [5, 120, 42, 120, 0], 'input not mutated');
});

test('sortScoresByTop tolerates missing/invalid scores and null entries', () => {
  const rows = [{ nope: 1 }, { score: '57' }, { score: undefined }, null];
  const top = G.sortScoresByTop(rows, 2);
  assert.ok(Array.isArray(top));
  assert.equal(top.length, 2);
  assert.equal(Number(top[0].score) || 0, 57);
  assert.deepEqual(G.sortScoresByTop(null, 3), []);
});

test('mergePages combines two pages (pagination accumulator)', () => {
  const page1 = [{ score: 90 }, { score: 80 }];
  const page2 = [{ score: 70 }, { score: 60 }];
  assert.deepEqual(G.mergePages(page1, page2).map(r => r.score), [90, 80, 70, 60]);
  assert.deepEqual(G.mergePages(null, page2).map(r => r.score), [70, 60]);
  assert.deepEqual(G.mergePages(page1, null).map(r => r.score), [90, 80]);
  assert.deepEqual(G.mergePages(null, null), []);
});

test('rotateShapeCW and rotateShapeCCW rotate 90 deg and normalize to (0,0)', () => {
  // L shape: [[0,0], [0,1], [0,2], [1,0]]
  const L = [[0, 0], [0, 1], [0, 2], [1, 0]];
  const cw = G.rotateShapeCW(L);
  const ccw = G.rotateShapeCCW(L);
  assert.ok(Array.isArray(cw));
  assert.ok(Array.isArray(ccw));
  assert.equal(cw.length, L.length);
  assert.equal(ccw.length, L.length);
  // Rotating CW 4 times should return original shape coordinates
  let r = L;
  for (let i = 0; i < 4; i++) r = G.rotateShapeCW(r);
  assert.deepEqual(r, L);
});

test('hasActiveBombsOn detects presence of bomb cell on grid', () => {
  const grid = G.makeGrid();
  assert.equal(G.hasActiveBombsOn(grid, G.SIZE), false);
  grid[2][3] = { color: '#f00', bomb: true, timer: 3 };
  assert.equal(G.hasActiveBombsOn(grid, G.SIZE), true);
  grid[2][3] = null;
  assert.equal(G.hasActiveBombsOn(grid, G.SIZE), false);
});

test('validateUsernameFormat checks length, characters and normalizes', () => {
  assert.equal(G.validateUsernameFormat('').valid, false);
  assert.equal(G.validateUsernameFormat('ab').valid, false);
  assert.equal(G.validateUsernameFormat('toolongusername123').valid, false);
  assert.equal(G.validateUsernameFormat('user name!').valid, false);
  
  const ok1 = G.validateUsernameFormat('Player_1');
  assert.equal(ok1.valid, true);
  assert.equal(ok1.clean, 'Player_1');
  assert.equal(ok1.lower, 'player_1');

  const ok2 = G.validateUsernameFormat('  Nikola99  ');
  assert.equal(ok2.valid, true);
  assert.equal(ok2.clean, 'Nikola99');
  assert.equal(ok2.lower, 'nikola99');

  const ok3 = G.validateUsernameFormat('Igrač-123');
  assert.equal(ok3.valid, true);
  assert.equal(ok3.lower, 'igrač-123');
});

test('calculateComboScore scales line score with combo streak multiplier', () => {
  assert.equal(G.calculateComboScore(0, 0, 0, 1), 0);
  // 1 line cleared with 8 removed cells, streak 1 (base multiplier 1.0)
  // base = 8*2 + 0 + 200 = 216
  assert.equal(G.calculateComboScore(1, 8, 0, 1), 216);
  // streak 2 -> multiplier 1.8 -> Math.floor(216 * 1.8) = 388
  assert.equal(G.calculateComboScore(1, 8, 0, 2), 388);
  // streak 3 -> multiplier 2.6 -> Math.floor(216 * 2.6) = 561
  assert.equal(G.calculateComboScore(1, 8, 0, 3), 561);
});

test('calculatePowerupRewards triggers reroll rewards on 5000 score thresholds', () => {
  assert.deepEqual(G.calculatePowerupRewards(500, 4850), { hammersEarned: 0, rerollsEarned: 0 });
  assert.deepEqual(G.calculatePowerupRewards(4950, 5150), { hammersEarned: 0, rerollsEarned: 1 });
  assert.deepEqual(G.calculatePowerupRewards(4900, 10100), { hammersEarned: 0, rerollsEarned: 2 });
});

test('calculateComboHammerReward grants hammer on 5x combo streak multiples', () => {
  assert.equal(G.calculateComboHammerReward(0), 0);
  assert.equal(G.calculateComboHammerReward(1), 0);
  assert.equal(G.calculateComboHammerReward(4), 0);
  assert.equal(G.calculateComboHammerReward(5), 1);
  assert.equal(G.calculateComboHammerReward(6), 0);
  assert.equal(G.calculateComboHammerReward(10), 1);
});

test('rotateShapeCW/CCW map asymmetric shape cells to expected coordinates (order preserved)', () => {
  // L oblik: [[0,0],[0,1],[0,2],[1,0]] — redosled ćelija mora ostati isti
  // (app.js se oslanja na to: stoneIndex/bombIndex prate svoju ćeliju kroz rotaciju)
  const L = [[0, 0], [0, 1], [0, 2], [1, 0]];
  assert.deepEqual(G.rotateShapeCW(L), [[0, 1], [1, 1], [2, 1], [0, 0]]);
  assert.deepEqual(G.rotateShapeCCW(L), [[2, 0], [1, 0], [0, 0], [2, 1]]);
});

test('calculateComboScore calculates accurate bonus for 1, 2, 3, and 4+ lines', () => {
  // 1 linija: 8*2 + 200 = 216
  assert.equal(G.calculateComboScore(1, 8, 0, 1), 216);
  // 2 linije: 16*2 + 600 = 632
  assert.equal(G.calculateComboScore(2, 16, 0, 1), 632);
  // 3 linije: 24*2 + 1500 = 1548
  assert.equal(G.calculateComboScore(3, 24, 0, 1), 1548);
  // 4 linije: 32*2 + 3000 = 3064
  assert.equal(G.calculateComboScore(4, 32, 0, 1), 3064);
  // 5+ linija: 40*2 + 3000 = 3080 (isti 3000 bonus)
  assert.equal(G.calculateComboScore(5, 40, 0, 1), 3080);
});

test('calculatePowerupRewards boundary: threshold crossed by placement points counts exactly once', () => {
  // Regresija (app.js): poeni od golog postavljanja komada su ranije "trošili" prag
  // bez dodele nagrade — sada se grantPowerupRewards poziva posle SVAKE promene skora.
  assert.deepEqual(G.calculatePowerupRewards(4999, 5002), { hammersEarned: 0, rerollsEarned: 1 });
  assert.deepEqual(G.calculatePowerupRewards(5002, 5150), { hammersEarned: 0, rerollsEarned: 0 });
});

test('BADGES definition includes Destroyer series (10k-100k) and thematic badges', () => {
  assert.ok(Array.isArray(G.BADGES));
  assert.equal(G.BADGES.length, 14); // 10 destroyer + 4 thematic
  const ids = G.BADGES.map(b => b.id);
  for (let k = 10; k <= 100; k += 10) {
    assert.ok(ids.includes(`destroyer_${k}k`), `includes destroyer_${k}k`);
  }
  assert.ok(ids.includes('rock_crusher'));
  assert.ok(ids.includes('bomb_defuser'));
  assert.ok(ids.includes('combo_master'));
  assert.ok(ids.includes('line_master'));
});

test('checkNewBadges unlocks Destroyer badges based on score and personal best', () => {
  const emptyUnlocked = {};
  
  // Score 4,500 -> no unlock
  assert.equal(G.checkNewBadges(emptyUnlocked, {}, 4500, 4500).length, 0);

  // Score 10,000 -> unlocks 10k Destroyer
  const un10k = G.checkNewBadges(emptyUnlocked, {}, 10000, 8000);
  assert.equal(un10k.length, 1);
  assert.equal(un10k[0].id, 'destroyer_10k');

  // Once 10k is marked unlocked, score 25,000 unlocks 20k Destroyer (not 10k)
  const with10k = { destroyer_10k: Date.now() };
  const un20k = G.checkNewBadges(with10k, {}, 25000, 25000);
  assert.equal(un20k.length, 1);
  assert.equal(un20k[0].id, 'destroyer_20k');

  // Score 50,000 -> unlocks 50k Destroyer
  const with40k = { ...with10k, destroyer_20k: Date.now(), destroyer_30k: Date.now(), destroyer_40k: Date.now() };
  const un50k = G.checkNewBadges(with40k, {}, 50000, 50000);
  assert.equal(un50k.length, 1);
  assert.equal(un50k[0].id, 'destroyer_50k');

  // Score 100,000 -> unlocks 100k Grandmaster
  const with90k = { ...with40k, destroyer_50k: Date.now(), destroyer_60k: Date.now(), destroyer_70k: Date.now(), destroyer_80k: Date.now(), destroyer_90k: Date.now() };
  const un100k = G.checkNewBadges(with90k, {}, 100000, 100000);
  assert.equal(un100k.length, 1);
  assert.equal(un100k[0].id, 'destroyer_100k');
});

test('checkNewBadges unlocks thematic stats badges', () => {
  const empty = {};
  const stats = { rocksCrushed: 25, bombsDefused: 15, maxCombo: 5, linesCleared: 200 };
  const unlocked = G.checkNewBadges(empty, stats, 500, 500);
  const ids = unlocked.map(b => b.id);
  assert.ok(ids.includes('rock_crusher'));
  assert.ok(ids.includes('bomb_defuser'));
  assert.ok(ids.includes('combo_master'));
  assert.ok(ids.includes('line_master'));
});

test('badge getProgress computes exact progress and capped percentage', () => {
  const b10k = G.BADGES.find(b => b.id === 'destroyer_10k');
  assert.deepEqual(b10k.getProgress({}, 5000, 0), { current: 5000, target: 10000, pct: 50 });
  assert.deepEqual(b10k.getProgress({}, 15000, 0), { current: 10000, target: 10000, pct: 100 });
});

test('PULSE_BONUS constants are defined with correct 100-150s intervals, 10s duration and 250 points', () => {
  assert.equal(G.PULSE_BONUS_POINTS, 250);
  assert.equal(G.PULSE_BONUS_DURATION_SEC, 10);
  assert.equal(G.PULSE_BONUS_MIN_INTERVAL_MS, 100000); // 100s
  assert.equal(G.PULSE_BONUS_MAX_INTERVAL_MS, 150000); // 150s
});

test('countBombExplosionStats: no-op when bomb cell is missing', () => {
  const grid = G.makeGrid(5);
  const res = G.countBombExplosionStats(grid, 5, 2, 2);
  assert.deepEqual(res, { affected: [], removedCount: 0, crackedCount: 0, rocksCrushed: 0 });
  assert.deepEqual(G.countBombExplosionStats(null, 5, 0, 0), { affected: [], removedCount: 0, crackedCount: 0, rocksCrushed: 0 });
});

test('countBombExplosionStats: includes bomb centre for removal scoring but not as rock', () => {
  const grid = G.makeGrid(5);
  // Popuni ceo 3x3 blok da affected bude 9
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 3; c++) {
      grid[r][c] = { color: '#bbb', hp: 1, maxHp: 1 };
    }
  }
  grid[2][2] = { color: '#000', hp: 1, maxHp: 1, bomb: true, timer: 3 }; // centralna bomba
  const res = G.countBombExplosionStats(grid, 5, 2, 2);
  assert.equal(res.affected.length, 9);
  const centre = res.affected.find(p => p.r === 2 && p.c === 2);
  assert.ok(centre, 'bomb centre is in affected list');
  assert.equal(centre.willRemove, true);
  assert.equal(centre.isRock, false, 'bomb is not a rock');
  assert.equal(centre.isBomb, true);
  // Sve ćelije se uklanjaju (hp:1) → removedCount 9, rocksCrushed 0
  assert.equal(res.removedCount, 9);
  assert.equal(res.crackedCount, 0);
  assert.equal(res.rocksCrushed, 0);
});

test('countBombExplosionStats: counts rocks destroyed by explosion (rock_crusher regresija)', () => {
  const grid = G.makeGrid(5);
  grid[2][2] = { color: '#000', hp: 1, maxHp: 1, bomb: true, timer: 3 };   // centralna bomba
  grid[1][1] = { color: '#aaa', hp: 2, maxHp: 2 };                          // cela stena (biće napukla, hp:2>1)
  grid[1][2] = { color: '#aaa', hp: 1, maxHp: 2 };                          // napukla stena (biće uništena)
  grid[2][1] = { color: '#bbb', hp: 1, maxHp: 1 };                          // obična kocka (biće uklonjena)
  const res = G.countBombExplosionStats(grid, 5, 2, 2);
  // affected: bomba + 1 cela stena + 1 napukla stena + 1 kocka = 4 zauzete ćelije u 3x3
  assert.equal(res.affected.length, 4);
  // removedCount = bomba + napukla stena + kocka = 3; crackedCount = cela stena = 1
  assert.equal(res.removedCount, 3);
  assert.equal(res.crackedCount, 1);
  // rocksCrushed = samo napukla stena koja je uklonjena = 1 (cela stena samo napukla, nije uništena)
  assert.equal(res.rocksCrushed, 1);
});

test('countBombExplosionStats: granit (3 HP) se takođe računa kao kamen kada je uništen', () => {
  const grid = G.makeGrid(5);
  grid[2][2] = { color: '#000', hp: 1, maxHp: 1, bomb: true, timer: 3 }; // centralna bomba
  grid[1][1] = { color: '#555', hp: 1, maxHp: 3 };                        // granit na 1 HP → uništen
  grid[1][2] = { color: '#555', hp: 2, maxHp: 3 };                        // granit na 2 HP → samo napukla
  const res = G.countBombExplosionStats(grid, 5, 2, 2);
  // affected: bomba + 2 granita
  assert.equal(res.affected.length, 3);
  // rocksCrushed = granit na 1 HP (uklonjen) = 1; granit na 2 HP samo napukla
  assert.equal(res.rocksCrushed, 1, 'granit na 1 HP treba da se računa kao kamen');
  const crackedGranite = res.affected.find(p => p.r === 1 && p.c === 2);
  assert.ok(crackedGranite && crackedGranite.isRock, 'napukla granita je označena kao rock');
});

test('countBombExplosionStats: out-of-bounds neighbours are skipped', () => {
  const grid = G.makeGrid(3);
  grid[0][0] = { color: '#000', hp: 1, maxHp: 1, bomb: true, timer: 3 }; // bomba u uglu
  grid[0][1] = { color: '#aaa', hp: 1, maxHp: 2 };                       // napukla stena (ubištena)
  const res = G.countBombExplosionStats(grid, 3, 0, 0);
  assert.equal(res.affected.length, 2); // samo ćelije unutar table
  assert.equal(res.rocksCrushed, 1);
  assert.equal(res.removedCount, 2);
});

test('getRockInterval scales rock frequency based on Fibonacci score tiers', () => {
  assert.equal(G.getRockInterval(0), 10);
  assert.equal(G.getRockInterval(1999), 10);
  assert.equal(G.getRockInterval(2000), 9);
  assert.equal(G.getRockInterval(3000), 8);
  assert.equal(G.getRockInterval(5000), 7);
  assert.equal(G.getRockInterval(8000), 6);
  assert.equal(G.getRockInterval(13000), 5);
  assert.equal(G.getRockInterval(20999), 5);
  assert.equal(G.getRockInterval(21000), 4);
  assert.equal(G.getRockInterval(33999), 4);
  assert.equal(G.getRockInterval(34000), 3);
});

test('getRockMaxHp spawns 3 HP granite scaling with Fibonacci tiers', () => {
  // under 5k -> always 2 HP
  assert.equal(G.getRockMaxHp(4000, () => 0.05), 2);

  // 5k-8k -> 15% chance
  assert.equal(G.getRockMaxHp(5000, () => 0.10), 3);
  assert.equal(G.getRockMaxHp(5000, () => 0.20), 2);

  // 8k-13k -> 30% chance
  assert.equal(G.getRockMaxHp(8000, () => 0.25), 3);
  assert.equal(G.getRockMaxHp(8000, () => 0.35), 2);

  // 13k-21k -> 40% chance
  assert.equal(G.getRockMaxHp(13000, () => 0.35), 3);
  assert.equal(G.getRockMaxHp(13000, () => 0.45), 2);

  // 34k+ -> 60% chance
  assert.equal(G.getRockMaxHp(34000, () => 0.55), 3);
  assert.equal(G.getRockMaxHp(34000, () => 0.65), 2);
});

test('getFibonacciRockMilestone and spawn config calculate correct milestones', () => {
  assert.equal(G.getFibonacciRockMilestone(500), -1);
  assert.equal(G.getFibonacciRockMilestone(1000), 0);
  assert.equal(G.getFibonacciRockMilestone(8000), 4);
  assert.equal(G.getFibonacciRockMilestone(21000), 6);

  // 1k -> 1 rock (2 HP)
  assert.deepEqual(G.getFibonacciMilestoneSpawnConfig(0), [{ maxHp: 2 }]);
  // 8k -> 1 granite (3 HP)
  assert.deepEqual(G.getFibonacciMilestoneSpawnConfig(4), [{ maxHp: 3 }]);
  // 21k -> 1 granite + 1 rock
  assert.deepEqual(G.getFibonacciMilestoneSpawnConfig(6), [{ maxHp: 3 }, { maxHp: 2 }]);
  // 34k -> 2 granites
  assert.deepEqual(G.getFibonacciMilestoneSpawnConfig(7), [{ maxHp: 3 }, { maxHp: 3 }]);
});

test('getBombInterval scales countdown interval between bombs', () => {
  // < 3k: 15..20
  assert.equal(G.getBombInterval(0, () => 0), 15);
  assert.equal(G.getBombInterval(2999, () => 0.99), 20);

  // 3k..7k: 20..25
  assert.equal(G.getBombInterval(3000, () => 0), 20);
  assert.equal(G.getBombInterval(6999, () => 0.99), 25);

  // 7k..20k: 16..22
  assert.equal(G.getBombInterval(7000, () => 0), 16);
  assert.equal(G.getBombInterval(19999, () => 0.99), 22);

  // 20k+: 12..18
  assert.equal(G.getBombInterval(20000, () => 0), 12);
  assert.equal(G.getBombInterval(50000, () => 0.99), 18);
});

test('getBombInitialTimer provides turn-based countdown for bombs', () => {
  // < 10k -> 5 turns
  assert.equal(G.getBombInitialTimer(0, () => 0.1), 5);
  assert.equal(G.getBombInitialTimer(9999, () => 0.1), 5);

  // 10k..25k -> 4 turns
  assert.equal(G.getBombInitialTimer(10000, () => 0.1), 4);
  assert.equal(G.getBombInitialTimer(24999, () => 0.1), 4);

  // 25k..40k -> 3 turns
  assert.equal(G.getBombInitialTimer(25000, () => 0.1), 3);
  assert.equal(G.getBombInitialTimer(39999, () => 0.1), 3);

  // >= 40k -> 30% chance for 2 turns, else 3
  assert.equal(G.getBombInitialTimer(40000, () => 0.25), 2);
  assert.equal(G.getBombInitialTimer(40000, () => 0.35), 3);
});

test('getWeightedRandomShapeIndex shifts probability to heavier shapes on higher scores', () => {
  // Low score (< 5k): 50% easy, 40% med, 10% hard
  const hardIdx = G.getWeightedRandomShapeIndex(0, () => 0.05); // < 0.10 -> hard
  assert.ok(G.SHAPE_TIERS.hard.includes(hardIdx));

  const medIdx = G.getWeightedRandomShapeIndex(0, () => 0.30); // 0.10..0.50 -> medium
  assert.ok(G.SHAPE_TIERS.medium.includes(medIdx));

  const easyIdx = G.getWeightedRandomShapeIndex(0, () => 0.80); // >= 0.50 -> easy
  assert.ok(G.SHAPE_TIERS.easy.includes(easyIdx));

  // High score (>= 30k): 40% hard
  const highHardIdx = G.getWeightedRandomShapeIndex(35000, () => 0.35); // < 0.40 -> hard
  assert.ok(G.SHAPE_TIERS.hard.includes(highHardIdx));
});

test('getRockCountForPiece spawns 2 rocks on piece at high scores (>= 15k)', () => {
  assert.equal(G.getRockCountForPiece(5000, 4, () => 0.1), 1);
  assert.equal(G.getRockCountForPiece(15000, 1, () => 0.1), 1); // piece length 1 -> only 1 rock
  assert.equal(G.getRockCountForPiece(15000, 3, () => 0.2), 2); // 40% chance (< 0.4) -> 2 rocks
  assert.equal(G.getRockCountForPiece(15000, 3, () => 0.6), 1); // >= 0.4 -> 1 rock
});

test('applyBombExplosionHazard (Option A) creates rocks and rubble in 3x3 blast', () => {
  const grid = G.makeGrid(4);
  grid[1][1] = { bomb: true, timer: 1, hp: 1, maxHp: 1 };
  grid[1][2] = { color: '#ff0', hp: 1, maxHp: 1 }; // regular block

  const result = G.applyBombExplosionHazard(grid, 4, 1, 1, () => 0.2); // rng < 0.5 creates rubble on empty cells
  assert.ok(result.affectedCells.length > 0);
  // Bomb center becomes 2 HP rock
  assert.equal(grid[1][1].isRock, true);
  assert.equal(grid[1][1].hp, 2);
  // Neighbouring block became 1 HP rock
  assert.equal(grid[1][2].isRock, true);
  assert.equal(grid[1][2].hp, 1);
});

test('getMilestoneHazardLevel detects reached milestone index', () => {
  assert.equal(G.getMilestoneHazardLevel(0), -1);
  assert.equal(G.getMilestoneHazardLevel(9999), -1);
  assert.equal(G.getMilestoneHazardLevel(10000), 0);
  assert.equal(G.getMilestoneHazardLevel(24999), 0);
  assert.equal(G.getMilestoneHazardLevel(25000), 1);
  assert.equal(G.getMilestoneHazardLevel(50000), 2);
  assert.equal(G.getMilestoneHazardLevel(100000), 3);
});

test('findRandomFreeCell finds available coordinate or returns null if grid is full', () => {
  const grid = G.makeGrid(2);
  // Full grid except [1][0]
  grid[0][0] = { color: '#fff', hp: 1, maxHp: 1 };
  grid[0][1] = { color: '#fff', hp: 1, maxHp: 1 };
  grid[1][1] = { color: '#fff', hp: 1, maxHp: 1 };

  const freeCell = G.findRandomFreeCell(grid, 2, () => 0);
  assert.deepEqual(freeCell, { r: 1, c: 0 });

  grid[1][0] = { color: '#fff', hp: 1, maxHp: 1 };
  assert.equal(G.findRandomFreeCell(grid, 2), null);
});

test('getCompletedLinesForPlacement identifies rows and columns that will be cleared', () => {
  const grid = G.makeGrid(4);
  // Row 1 has 3 filled cells (cols 0, 1, 2)
  grid[1][0] = { color: '#fff', hp: 1, maxHp: 1 };
  grid[1][1] = { color: '#fff', hp: 1, maxHp: 1 };
  grid[1][2] = { color: '#fff', hp: 1, maxHp: 1 };

  // Placing 1x1 block at (1, 3) completes row 1
  const dot = [[0, 0]];
  const res1 = G.getCompletedLinesForPlacement(grid, 4, dot, 1, 3);
  assert.deepEqual(res1.rows, [1]);
  assert.deepEqual(res1.cols, []);
  assert.equal(res1.cells.length, 4); // all 4 cells in row 1

  // Placing 1x1 block at (0, 0) completes nothing
  const res2 = G.getCompletedLinesForPlacement(grid, 4, dot, 0, 0);
  assert.deepEqual(res2.rows, []);
  assert.deepEqual(res2.cols, []);
  assert.equal(res2.cells.length, 0);

  // Invalid placement returns empty
  const res3 = G.getCompletedLinesForPlacement(grid, 4, dot, 1, 0); // occupied
  assert.deepEqual(res3.rows, []);
  assert.deepEqual(res3.cols, []);
  assert.equal(res3.cells.length, 0);
});

test('getGridOccupancy computes accurate ratio of filled cells', () => {
  const empty = G.makeGrid(4);
  assert.equal(G.getGridOccupancy(empty, 4), 0);

  const half = G.makeGrid(4);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) half[r][c] = { color: '#fff' };
  }
  assert.equal(G.getGridOccupancy(half, 4), 0.5);

  const full = G.makeGrid(4);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) full[r][c] = { color: '#fff' };
  }
  assert.equal(G.getGridOccupancy(full, 4), 1.0);
});

test('getShapesThatFit finds all shapes that can be placed on grid', () => {
  // 4x4 grid full except a 1x2 slot at (0,0)-(0,1)
  const grid = G.makeGrid(4).map(row => row.map(() => ({ color: '#fff' })));
  grid[0][0] = null;
  grid[0][1] = null;

  const fitting = G.getShapesThatFit(grid, 4);
  assert.ok(fitting.length > 0);
  // 1x2 (index 0) and 2x1 (index 1 via rotation) can fit
  assert.ok(fitting.includes(0));
  // 3x3 big square (index 31) cannot fit
  assert.ok(!fitting.includes(31));
});

test('generateSmartTrayShapeIndices enforces max 1 hard piece and Anti-Deadlock rule', () => {
  // 1. Max 1 hard piece in tray
  for (let s = 0; s <= 50000; s += 10000) {
    const tray = G.generateSmartTrayShapeIndices(G.makeGrid(8), 8, s);
    const hardCount = tray.filter(idx => G.SHAPE_TIERS.hard.includes(idx)).length;
    assert.ok(hardCount <= 1, `Tray ${JSON.stringify(tray)} must contain at most 1 hard piece`);
  }

  // 2. Anti-Deadlock guarantee:
  // Board full except 1x2 hole at (0,0)
  const crowdedGrid = G.makeGrid(8).map(row => row.map(() => ({ color: '#fff' })));
  crowdedGrid[0][0] = null;
  crowdedGrid[0][1] = null;

  // Even if rng attempts to give impossible shapes, smart tray guarantees at least 1 fitting shape
  const smartTray = G.generateSmartTrayShapeIndices(crowdedGrid, 8, 30000);
  assert.ok(
    G.trayAnyPlacementOn(crowdedGrid, 8, smartTray.map(idx => G.SHAPES[idx])),
    'Smart tray must guarantee at least one valid move on non-full grid (Anti-Deadlock)'
  );
});