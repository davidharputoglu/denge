import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGrid, analyze, autoLoad, placeItem, removeItem, weightOf, VEHICLES, DEFAULT_GRID,
} from '../src/engine.js';

const veh = VEHICLES[0]; // fourgon 1000 kg, grille 3x4

function mkItems(list) {
  return list.map((w, i) => ({ id: i + 1, name: `Objet ${i + 1}`, weight: w, volume: 1 }));
}

test('grille vide → statut Vide, score neutre', () => {
  const g = makeGrid(3, 4);
  const rep = analyze(g, [], veh);
  assert.equal(rep.weightTotal, 0);
  assert.equal(rep.color, 'neutral');
  assert.equal(rep.status, 'Vide');
});

test('autoLoad : tous les objets lourds placés, véhicule ne penche pas', () => {
  const items = mkItems([300, 250, 200, 100, 80, 50, 20]); // total 1000 = charge utile exacte
  const res = autoLoad(items, veh);
  assert.equal(res.skipped.length, 0, 'tout doit être chargé (1000 kg ≤ 1000, 7 cases sur 12)');
  const rep = analyze(res.grid, items, veh);
  assert.equal(rep.weightTotal, 1000);
  assert.ok(rep.leftRightPct <= 15, `gauche/droite trop déséquilibré : ${rep.leftRightPct}%`);
  assert.ok(Math.abs(rep.frontBackPct) <= 45, `avant/arrière trop déséquilibré : ${rep.frontBackPct}%`);
  assert.ok(rep.balanceScore >= 60, `score trop faible : ${rep.balanceScore}`);
});

test('autoLoad : ne dépasse jamais la charge utile', () => {
  const items = mkItems([400, 400, 400]); // 1200 > 1000
  const res = autoLoad(items, veh);
  const W = weightOf(res.grid, Object.fromEntries(items.map(i => [i.id, i])));
  assert.ok(W <= veh.payloadKg);
  assert.equal(res.skipped.length, 1);
});

test('autoLoad : deux poids égaux finissent équilibrés latéralement', () => {
  const items = mkItems([300, 300]);
  const res = autoLoad(items, veh);
  const rep = analyze(res.grid, items, veh);
  assert.ok(rep.leftRightPct < 20, `déséquilibre latéral : ${rep.leftRightPct}`);
});

test('analyze détecte la surcharge et la penchaison', () => {
  const items = mkItems([600, 500]); // 1100 > 1000
  let g = makeGrid(3, 4);
  g = placeItem(g, 1, 3, 0); // lourd à gauche-fond
  g = placeItem(g, 2, 0, 0); // à gauche-avant
  const rep = analyze(g, items, veh);
  assert.equal(rep.overPayload, true);
  assert.equal(rep.color, 'danger');
  assert.ok(rep.leftRightPct > 30);
});

test('removeItem retire toutes les cases de l’objet', () => {
  const items = mkItems([50]);
  let g = makeGrid(3, 4);
  g = placeItem(g, 1, 2, 1);
  assert.equal(weightOf(g, { 1: items[0] }), 50);
  g = removeItem(g, 1);
  assert.equal(weightOf(g, { 1: items[0] }), 0);
});

test('cases pleines → objets en surplus reportés, pas de crash', () => {
  const items = mkItems(Array(15).fill(10)); // 15 objets pour 12 cases, 150 kg < 1000
  const res = autoLoad(items, veh);
  assert.equal(res.placed.length, 12);
  assert.equal(res.skipped.length, 3);
});

test('pick-up 2 colonnes fonctionne aussi', () => {
  const pickup = VEHICLES.find(v => v.id === 'pick-up');
  const items = mkItems([200, 200, 100]);
  const res = autoLoad(items, pickup);
  const rep = analyze(res.grid, items, pickup);
  assert.equal(rep.weightTotal, 500);
  assert.ok(rep.leftRightPct <= 20);
});
