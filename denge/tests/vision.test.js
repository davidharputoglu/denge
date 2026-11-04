import test from 'node:test';
import assert from 'node:assert/strict';
import { otsuThreshold, classifyCells, findBlobs, blobStats, classifyBlob, detectFromImageData } from '../src/vision.js';
import { findCatalogMatch } from '../src/engine.js';

// fabrique une ImageData synthétique : fond gris clair, objets sombres dessinés
function makeImage(W, H, draw) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i*4] = 200; data[i*4+1] = 200; data[i*4+2] = 200; data[i*4+3] = 255; }
  const setPx = (x, y, v) => { const i = (y * W + x) * 4; data[i]=v; data[i+1]=v; data[i+2]=v; };
  draw(setPx);
  return { data, width: W, height: H };
}

test('otsu sépare un bimodal sombre/clair', () => {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < 1000; i++) hist[60]++;
  for (let i = 0; i < 1000; i++) hist[200]++;
  const t = otsuThreshold(hist);
  assert.ok(t > 60 && t < 200, `seuil ${t} entre les deux pics`);
});

test('detecte une bétonnière RONDE, une PELLE longue et un SAC carré', () => {
  const W = 560, H = 560;
  const img = makeImage(W, H, (set) => {
    // bétonnière : disque ~ Ø 120 px à gauche
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - 120, dy = y - 200;
      if (dx*dx + dy*dy < 60*60) set(x, y, 40);
      // pelle : barre longue fine verticale (10×220) à droite
      if (x >= 420 && x <= 432 && y >= 80 && y <= 300) set(x, y, 45);
      // sac : rectangle plein 70×70 en bas au centre
      if (x >= 240 && x <= 310 && y >= 420 && y <= 490) set(x, y, 50);
    }
  });
  const res = detectFromImageData(img, { cellPx: 28 });
  assert.equal(res.note, undefined, 'segmentation utilisable');
  assert.equal(res.objects.length, 3, `3 silhouettes trouvées (${res.objects.length})`);
  const kinds = res.objects.map(o => o.kind).sort();
  assert.deepEqual(kinds, ['bloc', 'long', 'rond'], `formes classées : ${kinds}`);
  // le rond doit avoir une bbox quasi carrée et un fill < 0.9 (coins libres)
  const rond = res.objects.find(o => o.kind === 'rond');
  assert.ok(rond.stats.fill < 0.85 && rond.stats.fill > 0.4, `fill rond ≈ ${rond.stats.fill.toFixed(2)}`);
  // le long doit être allongé
  const long = res.objects.find(o => o.kind === 'long');
  assert.ok(long.stats.elongation >= 2.2, `elongation ${long.stats.elongation.toFixed(1)}`);
  // chaque objet a une fourchette de poids et un encombrement en cases
  for (const o of res.objects) {
    assert.ok(o.weightRange[1] > o.weightRange[0], 'fourchette de poids cohérente');
    assert.ok(o.volCells >= 1, 'encombrement ≥ 1 case');
  }
});

test('photo uniforme → rien détecté proprement (pas de crash)', () => {
  const img = makeImage(300, 300, () => {});
  const res = detectFromImageData(img, { cellPx: 20 });
  assert.equal(res.objects.length, 0);
});

test('findBlobs / blobStats sur grille connue', () => {
  const grid = [
    [1,1,0,0],
    [1,0,0,1],
    [0,0,1,1],
  ];
  const blobs = findBlobs(grid);
  assert.equal(blobs.length, 3); // L-tromino, isolé, domino
  const st = blobStats(blobs[0]);
  assert.equal(st.area, 3);
});

test('alias catalogue : bétonnière/butane/pioche/bâche → poids connus', () => {
  assert.equal(findCatalogMatch('bétonnière')?.weight, 70);
  assert.equal(findCatalogMatch('butane')?.name, 'Bouteille de gaz butane');
  assert.equal(findCatalogMatch('pioche')?.name, 'Pelle');
  assert.equal(findCatalogMatch('bâche')?.weight, 8);
  assert.equal(findCatalogMatch('touret')?.weight, 150);
});
