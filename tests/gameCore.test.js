// Tests for www/gameCore.js — pure game logic (no DOM).
// Run with: npm test  (node --test tests/)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../www/gameCore.js');

test('constants: SIZE=8, 22 shapes, 7 colors', () => {
  assert.equal(G.SIZE, 8);
  assert.equal(G.SHAPES.length, 22);
  assert.equal(G.COLORS.length, 7);
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
  // base = 8*2 + 0 + 100 = 116
  assert.equal(G.calculateComboScore(1, 8, 0, 1), 116);
  // streak 2 -> multiplier 1.4 -> Math.floor(116 * 1.4) = 162
  assert.equal(G.calculateComboScore(1, 8, 0, 2), 162);
  // streak 3 -> multiplier 1.8 -> Math.floor(116 * 1.8) = 208
  assert.equal(G.calculateComboScore(1, 8, 0, 3), 208);
});

test('calculatePowerupRewards triggers rewards on 1000/2000 thresholds', () => {
  assert.deepEqual(G.calculatePowerupRewards(500, 850), { hammersEarned: 0, rerollsEarned: 0 });
  assert.deepEqual(G.calculatePowerupRewards(950, 1150), { hammersEarned: 1, rerollsEarned: 0 });
  assert.deepEqual(G.calculatePowerupRewards(1900, 2100), { hammersEarned: 1, rerollsEarned: 1 });
});

test('rotateShapeCW/CCW map asymmetric shape cells to expected coordinates (order preserved)', () => {
  // L oblik: [[0,0],[0,1],[0,2],[1,0]] — redosled ćelija mora ostati isti
  // (app.js se oslanja na to: stoneIndex/bombIndex prate svoju ćeliju kroz rotaciju)
  const L = [[0, 0], [0, 1], [0, 2], [1, 0]];
  assert.deepEqual(G.rotateShapeCW(L), [[0, 1], [1, 1], [2, 1], [0, 0]]);
  assert.deepEqual(G.rotateShapeCCW(L), [[2, 0], [1, 0], [0, 0], [2, 1]]);
});

test('calculateComboScore caps line bonus at 4+ lines', () => {
  assert.equal(G.calculateComboScore(4, 32, 0, 1), 32 * 2 + 1000);
  assert.equal(G.calculateComboScore(5, 40, 0, 1), 40 * 2 + 1000); // 5+ linija = isti 1000 bonus
  assert.equal(G.calculateComboScore(8, 64, 0, 1), 64 * 2 + 1000);
});

test('calculatePowerupRewards boundary: threshold crossed by placement points counts exactly once', () => {
  // Regresija (app.js): poeni od golog postavljanja komada su ranije "trošili" prag
  // bez dodele nagrade — sada se grantPowerupRewards poziva posle SVAKE promene skora.
  assert.deepEqual(G.calculatePowerupRewards(999, 1002), { hammersEarned: 1, rerollsEarned: 0 });
  assert.deepEqual(G.calculatePowerupRewards(1002, 1150), { hammersEarned: 0, rerollsEarned: 0 });
});