// ─────────────────────────────────────────────────────────────────────────────
// Moteur de chargement : placement des objets dans le véhicule
// Objectif : maximiser la charge utile ET équilibrer le véhicule
//  - gauche/droite  → éviter que le véhicule « penche » d'un côté
//  - avant/arrière  → centre de gravité près du milieu (essieu)
//  - bas/Haut       → objets lourds au fond (centre de gravité bas)
// ─────────────────────────────────────────────────────────────────────────────

// Grille par défaut d'une camionnette de chantier (3x4 = 12 emplacements)
export const DEFAULT_GRID = { cols: 3, rows: 4 }; // cols: G|C|D — rows: avant→arrière

export function makeGrid(cols = DEFAULT_GRID.cols, rows = DEFAULT_GRID.rows) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

// Nom lisible d'une colonne selon le nombre de colonnes
export function colLabel(gridCols, c) {
  if (gridCols === 1) return 'Centre';
  if (gridCols === 2) return c === 0 ? 'Gauche' : 'Droite';
  if (gridCols === 3) return ['Gauche', 'Centre', 'Droite'][c];
  // plus de 3 : on approxime en trois tiers
  const third = gridCols / 3;
  if (c < third) return 'Gauche';
  if (c < 2 * third) return 'Centre';
  return 'Droite';
}

export function rowLabel(gridRows, r) {
  if (r === 0) return 'Avant (cabine)';
  if (r === gridRows - 1) return 'Arrière (hayon)';
  const mid = (gridRows - 1) / 2;
  if (r < mid - 0.5) return 'Avant';
  if (r > mid + 0.5) return 'Arrière';
  return 'Milieu';
}

export function cellLabel(grid, r, c) {
  return `${colLabel(grid[0].length, c)} · ${rowLabel(grid.length, r)}`;
}

// ── Placement d'un objet (mode manuel guidé) ─────────────────────────────────
// Renvoie { ok, reason } — vérifie que les cases RÉELLES de la FORME de l'objet
// (masque, coins vides compris → libres) sont libres à partir de (r,c), et que
// la charge utile restante le permet.
export function canPlace(state, r, c) {
  const g = state.grid;
  const item = state.items.find(i => i.id === state.selectedItemId);
  if (!item) return { ok: false, reason: 'Aucun objet sélectionné' };
  const rows = g.length, cols = g[0].length;
  const mask = shapeMaskFor(item, cols, rows);
  const h = mask.length, w = mask[0].length;
  if (r + h > rows || c + w > cols)
    return { ok: false, reason: `Trop grand ici (${h}×${w}) — placez-le plus au centre/fond` };
  for (let a = 0; a < h; a++)
    for (let b = 0; b < w; b++)
      if (mask[a][b] && g[r + a][c + b] !== null)
        return { ok: false, reason: 'Emplacement occupé' };
  const itemsById = Object.fromEntries(state.items.map(i => [i.id, i]));
  const used = weightOf(g, itemsById);
  const vehicle = currentVehicle(state);
  if (used + item.weight > vehicle.payloadKg) {
    return { ok: false, reason: `Dépasse la charge utile (${vehicle.payloadKg} kg)` };
  }
  return { ok: true };
}

// ── Empreinte rectangulaire (formes des objets) ──────────────────────────────
// Un objet occupe un bloc h×w de cases contiguës. Sans dimensions explicites,
// on déduit le bloc du volume (encombrement en « cases ») : le plus compact
// possible (≈ carré), ex. volume 4 → 2×2 ; volume 3 → 1×3 (allongé, ex. tuyaux).
export function footprintFor(item, cols, rows) {
  if (item.footprint) {
    const [h, w] = item.footprint;
    if (h >= 1 && w >= 1 && h <= rows && w <= cols) return [h, w];
  }
  const v = Math.max(1, Math.round(item.volume ?? 1));
  let best = [1, v], bestDiff = Infinity;
  for (let hh = 1; hh <= v; hh++) {
    if (v % hh !== 0) continue;
    const ww = v / hh;
    if (hh > rows || ww > cols) continue;
    const diff = Math.abs(hh - ww);
    if (diff < bestDiff) { bestDiff = diff; best = [hh, ww]; }
  }
  // si aucune forme ne rentre dans la grille, retomber sur 1 case
  if (best[0] > rows || best[1] > cols) return [1, 1];
  return best;
}

// ── Masques de forme : comment l'app « comprend » les formes non rectangulaires ─
// Chaque objet peut définir un masque de cases (grille de 0 et 1, 1 = matière).
// Ex. bouteille (col vert étroit) : [[1],[1],[1]] ; bétonnière / gaz butane (rond) :
//   0 1 0     le coffre reste un plan au sol : la grille sert à vérifier que deux
//   1 1 1     objets ne se CHEVAUCHENT PAS — les coins vides d'un objet rond sont
//   0 1 0     libres et peuvent accueillir une pelle, une pioche ou une barre d'acier !
// Sans masque : rectangle plein h×w (empreinte), ou bloc déduit du volume.
export function shapeMaskFor(item, cols, rows) {
  if (item.shape) {
    const m = item.shape;
    if (m.length && m.every(r => Array.isArray(r) && r.length === m[0].length)) {
      if (m.length <= rows && m[0].length <= cols) return m;
    }
  }
  const [h, w] = footprintFor(item, cols, rows);
  return Array.from({ length: h }, () => Array.from({ length: w }, () => 1));
}

// Toutes les positions (r,c = coin haut-gauche du MASK) où l'objet est libre.
// Seules les cases « 1 » du masque doivent être libres.
export function freePositions(grid, item, cols, rows) {
  const mask = shapeMaskFor(item, cols, rows);
  const h = mask.length, w = mask[0].length;
  const out = [];
  for (let r = 0; r + h <= rows; r++)
    for (let c = 0; c + w <= cols; c++) {
      let ok = true;
      outer: for (let a = 0; a < h; a++)
        for (let b = 0; b < w; b++)
          if (mask[a][b] && grid[r + a][c + b] != null) { ok = false; break outer; }
      if (ok) out.push({ r, c, h, w });
    }
  return out;
}

export function placeItem(grid, itemId, r, c, item = null, cols = null, rows = null) {
  const g = grid.map(row => row.slice());
  // avec un objet connu → on pose son MASQUE complet (forme réelle, pas un bloc)
  if (item && cols && rows) {
    const mask = shapeMaskFor(item, cols, rows);
    const pos = freePositions(grid, item, cols, rows)
      .find(p => p.r === r && p.c === c);
    if (!pos) return g;
    for (let a = 0; a < mask.length; a++)
      for (let b = 0; b < mask[0].length; b++)
        if (mask[a][b]) g[r + a][c + b] = itemId;
    return g;
  }
  g[r][c] = itemId;
  return g;
}

export function removeItem(grid, itemId) {
  return grid.map(row => row.map(cell => (cell === itemId ? null : cell)));
}

// Poids total présent dans la grille — chaque objet compté UNE fois
// (il peut occuper plusieurs cases via son empreinte)
export function weightOf(grid, itemsById) {
  const seen = new Set();
  let w = 0;
  for (const id of grid.flat())
    if (id != null && itemsById[id] && !seen.has(id)) {
      seen.add(id);
      w += itemsById[id].weight;
    }
  return w;
}

// ── Analyse d'équilibre ───────────────────────────────────────────────────────
export function analyze(grid, items, vehicle) {
  const itemsById = Object.fromEntries(items.map(i => [i.id, i]));
  const rows = grid.length, cols = grid[0].length;

  let W = 0;                 // poids total chargé
  let sumX = 0, sumY = 0;    // barycentre (en indices de cases)
  let perCol = new Array(cols).fill(0);
  let perRow = new Array(rows).fill(0);

  // Chaque objet est compté UNE fois, à son barycentre RÉEL : moyenne des
  // centres des cases que sa FORME occupe (masque → un objet rond a son poids
  // bien au centre de sa couronne, une barre d'acier sur toute sa longueur).
  const done = new Set();    // "id" déjà comptés
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = grid[r][c];
      if (id == null || done.has(id)) continue;
      const it = itemsById[id];
      if (!it) continue;
      done.add(id);
      // toutes les cases contiguës de cet objet (flood fill) — l'objet est
      // marqué « traité » dans `seenCells` pour ne pas recompter ses cases
      const seenCells = new Set();
      const cellsOf = [];
      const stack = [[r, c]];
      while (stack.length) {
        const [a, b] = stack.pop();
        if (a < 0 || b < 0 || a >= rows || b >= cols) continue;
        if (grid[a][b] !== id || seenCells.has(`${a},${b}`)) continue;
        seenCells.add(`${a},${b}`);
        cellsOf.push([a, b]);
        stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
      }
      const n = cellsOf.length;
      const bx = cellsOf.reduce((s, [, b]) => s + b, 0) / n;
      const by = cellsOf.reduce((s, [a]) => s + a, 0) / n;
      W += it.weight;
      sumX += it.weight * bx;
      sumY += it.weight * by;
      // répartition de la masse sur les colonnes/lignes réellement couvertes
      const colSet = new Set(cellsOf.map(([, b]) => b));
      const rowSet = new Set(cellsOf.map(([a]) => a));
      for (const b of colSet) perCol[b] += it.weight / colSet.size;
      for (const a of rowSet) perRow[a] += it.weight / rowSet.size;
    }
  }

  const cx = W > 0 ? sumX / W : (cols - 1) / 2;   // barycentre latéral
  const cy = W > 0 ? sumY / W : (rows - 1) / 2;   // barycentre longitudinal
  const midX = (cols - 1) / 2;
  const midY = (rows - 1) / 2;

  // Déséquilibre gauche/droite en % du poids chargé
  const leftRightPct = W > 0 ? Math.abs(cx - midX) / ((cols - 1) / 2 || 1) * 100 : 0;
  // Décalage avant/arrière en % (positif = vers l'arrière)
  const frontBackPct = W > 0 ? (cy - midY) / ((rows - 1) / 2 || 1) * 100 : 0;

  const payload = vehicle.payloadKg;
  const loadPct = payload > 0 ? (W / payload) * 100 : 0;

  // Score d'équilibre 0-100 (100 = parfait)
  const lrScore = Math.max(0, 100 - leftRightPct * 1.6);   // latéral : pénalité forte (penchaison)
  const fbScore = Math.max(0, 100 - Math.abs(frontBackPct) * 0.9);
  const balanceScore = Math.round(Math.min(lrScore, fbScore * 1.05));

  let status, color;
  if (W === 0) { status = 'Vide'; color = 'neutral'; }
  else if (loadPct > 100) { status = 'SURCHARGE !'; color = 'danger'; }
  else if (leftRightPct > 35) { status = 'Penche d’un côté ⚠️'; color = 'danger'; }
  else if (leftRightPct > 20) { status = 'Déséquilibré (gauche/droite)'; color = 'warn'; }
  else if (Math.abs(frontBackPct) > 40) { status = 'Trop vers l’arrière'; color = 'warn'; }
  else if (loadPct >= 85) { status = 'Bien chargé ✓'; color = 'good'; }
  else { status = 'Équilibré ✓'; color = 'good'; }

  return {
    weightTotal: W, payload, loadPct: Math.min(loadPct, 999),
    leftRightPct, frontBackPct, perCol, perRow,
    balanceScore, status, color,
    overPayload: W > payload,
  };
}

// ── Optimisation automatique ─────────────────────────────────────────────────
// Heuristique : tri par poids décroissant (LPT), puis pour chaque objet on choisit
// la case libre qui minimise un coût d'équilibre :
//  - barycentre latéral au centre → le véhicule ne penche pas
//  - objets lourds vers l'AVANT de la grille (= rangées du bas/fond) → CG bas
//  - barycentre longitudinal proche du milieu (essieu)
// On s'arrête quand la charge utile est atteinte ou qu'il ne reste pas de place.
export function autoLoad(items, vehicle, gridDims = null) {
  const dims = gridDims ?? vehicle.grid ?? DEFAULT_GRID;
  const rows = dims.rows, cols = dims.cols;
  const grid = makeGrid(cols, rows);

  // ── 1) Répartition idéale « pondérée » : on découpe la surface en cases
  // d'encombrement égal (volume), chaque case a un centre (x, y).
  // Chaque objet occupe `volume` cases ; il pèse weight/volume par case.
  const cellVol = 1; // volume d'une case
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ r, c, x: c + 0.5, y: r + 0.5, taken: false });
    }
  }
  const totalCellVol = cells.length * cellVol;

  // Poids par case pour chaque objet + tri par poids total décroissant (LPT)
  const sorted = [...items].sort((a, b) => b.weight - a.weight || b.volume - a.volume);

  // ── 2) Barycentre cible : au centre géométrique de la zone de chargement
  const targetX = cols / 2, targetY = rows / 2;

  // ── 3) Placement glouton avec look-ahead latéral :
  // Pour chaque bloc de `volume` cases consécutives du plus lourd au plus léger,
  // on choisit le placement qui garde le barycentre des masses LATÉRALES au plus
  // près du centre — en tenant compte du fait que les objets suivants devront
  // aussi se loger (on équilibre donc côté gauche/droit à chaque étape).
  let W = 0, sumX = 0, sumY = 0;
  const placedIds = [];
  const skipped = [];
  let usedVol = 0;
  const payload = vehicle.payloadKg;

  // ── Sous-ensemble optimal « maximiser + équilibrer (au POIDS) » ───────────
  // On ne charge pas gloutonnement : on cherche d'abord le SOUS-ENSEMBLE d'objets
  // qui remplit le mieux la charge utile tout en pouvant être réparti
  // gauche/droite de façon quasi égale (partition binaire par volume).
  // C'est ce qui évite le piège « 280 kg d'un côté, 20 kg de l'autre ».
  const nItems = sorted.length;
  const fitsVol = (mask) => {
    let v = 0;
    for (let i = 0; i < nItems; i++) if (mask & (1 << i)) v += Math.max(1, Math.round(sorted[i].volume));
    return v <= totalCellVol;
  };
  // Meilleur partage gauche/droite PAR POIDS (partition binaire, bitset BigInt
  // en dixièmes de kg → gère les poids décimaux comme 2,5 kg).
  function weightGap(itemsSel) {
    const H = 10; // résolution 0,1 kg
    const tot = Math.round(itemsSel.reduce((a, x) => a + x.weight, 0) * H);
    const half = Math.floor(tot / 2);
    let dp = 1n;
    for (const x of itemsSel) {
      const wv = BigInt(Math.max(1, Math.round(x.weight * H)));
      dp |= dp << wv;
    }
    for (let j = half; j >= 0; j--) if ((dp >> BigInt(j)) & 1n) return tot - 2 * j; // écart min en dixièmes
    return tot;
  }

  function bestSubset() {
    if (nItems === 0) return 0;
    // glouton LPT = borne basse (résultat toujours valide).
    // ⚠️ cases consommées = celles RÉELLES de la forme (masque), bornées par la
    // taille de l'empreinte dans la grille : un objet dont l'empreinte ne RENTRE
    // PAS (ex. bloc 1×3 dans une grille 1×2) est physiquement non chargeable —
    // le dire ici évite au placement final de le marquer « placé » à tort.
    // Un objet ne consomme que les cases où il y a de la matière : un rond 3×3
    // (bétonnière, gaz) ne prend que 5 cases, pas 9 !
    const cellsOf = (x) => x.shape
      ? Math.max(1, x.shape.flat().reduce((a, v) => a + (v ? 1 : 0), 0))
      : Math.max(1, Math.round(x.volume ?? 1));
    const cellsOfPlaced = (x) => {
      const [h, w] = footprintFor(x, cols, rows);
      if (h > rows || w > cols) return Infinity;
      return Math.min(cellsOf(x), h * w);
    };
    let greedy = 0, wG = 0, vG = 0;
    for (let i = 0; i < nItems; i++) {
      const vw = cellsOfPlaced(sorted[i]);
      if (wG + sorted[i].weight <= payload && vG + vw <= totalCellVol) {
        greedy |= (1 << i); wG += sorted[i].weight; vG += vw;
      }
    }
    const selOf = (m) => sorted.filter((_, i) => m & (1 << i));
    const quality = (m) => {
      if (!m || !fitsVol(m)) return -Infinity;
      const s = selOf(m);
      const Wt = s.reduce((a, x) => a + x.weight, 0);
      return Wt * 10000 - weightGap(s);   // maximiser le poids, puis minimiser l'écart G/D
    };
    let bestMask = greedy, bestQ = quality(greedy);

    if (nItems <= 20) {
      // énumération complète (≤ 2^20) : optimum exact « max charge + équilibrable »
      for (let m = 1; m < (1 << nItems); m++) {
        let w = 0, ok = true;
        for (let i = 0; i < nItems; i++) if (m & (1 << i)) {
          w += sorted[i].weight;
          if (w > payload) { ok = false; break; }
        }
        if (!ok) continue;
        const q = quality(m);
        if (q > bestQ) { bestQ = q; bestMask = m; }
      }
    } else {
      // gros inventaires : DP poids + améliorations locales (add/del/swap)
      const cand = [];
      for (let i = 0; i < nItems; i++) cand.push(bestMask | (1 << i), bestMask & ~(1 << i));
      for (let i = 0; i < nItems; i++) if (bestMask & (1 << i))
        for (let j = 0; j < nItems; j++) if (!(bestMask & (1 << j))) cand.push((bestMask & ~(1 << i)) | (1 << j));
      for (const m of cand) {
        let w = 0, ok = true;
        for (let i = 0; i < nItems; i++) if (m & (1 << i)) { w += sorted[i].weight; if (w > payload) { ok = false; break; } }
        if (!ok) continue;
        const q = quality(m);
        if (q > bestQ) { bestQ = q; bestMask = m; }
      }
    }
    return bestMask;
  }

  const chosenMask = bestSubset();
  let toPlace = sorted.filter((_, i) => chosenMask & (1 << i));

  // ── Équilibrage gauche/droite AU POIDS, garanti ───────────────────────────
  // Si aucun sous-ensemble ne permet un partage G/D quasi égal (ex. un seul
  // objet de 280 kg + deux de 10 kg dans un coffre à 2 colonnes), on RETIRE
  // les objets jusqu'à obtenir un écart de partition ≤ ~12 % de la charge :
  // mieux vaut 290 kg bien équilibrés que 300 kg qui font pencher le véhicule.
  {
    const gapOf = (list) => {
      if (list.length === 0) return 0;
      const tot = Math.round(list.reduce((a, x) => a + x.weight, 0) * 10);
      let dp = 1n;
      for (const x of list) dp |= dp << BigInt(Math.max(1, Math.round(x.weight * 10)));
      const half = Math.floor(tot / 2);
      for (let j = half; j >= 0; j--) if ((dp >> BigInt(j)) & 1n) return tot - 2 * j;
      return tot;
    };
    const maxGap = Math.max(50, Math.round(payload * 10 * 0.12)); // en dixièmes de kg
    let guard = 0;
    while (gapOf(toPlace) > maxGap && toPlace.length > 1 && guard++ < 40) {
      const tot = toPlace.reduce((a, x) => a + x.weight, 0);
      let worstIdx = 0, worstDist = -1;
      for (let i = 0; i < toPlace.length; i++) {
        const d = Math.abs(toPlace[i].weight - tot / 2); // l'objet « cassant » la partition
        if (d > worstDist) { worstDist = d; worstIdx = i; }
      }
      skipped.push(toPlace[worstIdx]);
      toPlace.splice(worstIdx, 1);
    }
  }

  for (let i = 0; i < nItems; i++) if (!(chosenMask & (1 << i))) skipped.push(sorted[i]);
  // évite les doublons dans skipped (retirés par équilibrage déjà poussés)
  const seenSkip = new Set();
  for (let k = skipped.length - 1; k >= 0; k--) {
    if (seenSkip.has(skipped[k].id)) skipped.splice(k, 1);
    else seenSkip.add(skipped[k].id);
  }

  let pendingW = toPlace.reduce((a, x) => a + x.weight, 0);
  for (const it of toPlace) {
    if (W + it.weight > payload) { skipped.push(it); pendingW -= it.weight; continue; }
    // cases consommées : celles de la FORME si masque, sinon le volume (bloc)
    const shapeCells = it.shape
      ? it.shape.flat().reduce((a, v) => a + (v ? 1 : 0), 0)
      : null;
    const need = Math.max(1, shapeCells ?? Math.round(it.volume ?? 1));
    if (usedVol + need > totalCellVol) { skipped.push(it); continue; }

    // candidates : positions du MASQUE de l'objet (forme réelle). Un objet rond
    // (bétonnière, gaz butane) a un masque en croix/diamant → ses coins sont
    // LIBRES et peuvent être occupés par une pelle ou un tuyau. Sans masque :
    // rectangle h×w (empreinte), ou toutes les factorisations du volume.
    // La rotation 90° est autorisée pour toute forme non carrée.
    const freeAt = (r, c) => r < rows && c < cols && !cells[r * cols + c].taken;
    const maskOf = (m) => {
      if (it.shape) return m ? it.shape.map(r => [...r].reverse()) : it.shape; // miroir
      const [h, w] = footprintFor(it, cols, rows);
      const base = Array.from({ length: h }, () => Array.from({ length: w }, () => 1));
      if (!m) return base;
      // transposition = rotation 90°
      return base[0].map((_, i) => base.map(row => row[i]));
    };
    const combos = [];
    for (const mirrored of [false, true]) {
      const mask = maskOf(mirrored);
      if (mirrored && it.shape && JSON.stringify(mask) === JSON.stringify(it.shape)) break;
      const hh = mask.length, ww = mask[0].length;
      for (let r = 0; r + hh <= rows; r++) {
        for (let c = 0; c + ww <= cols; c++) {
          let ok = true; const combo = [];
          for (let a = 0; a < hh && ok; a++) for (let b = 0; b < ww; b++) {
            if (!mask[a][b]) continue;             // coin vide de la forme → libre
            if (!freeAt(r + a, c + b)) { ok = false; break; }
            combo.push(cells[(r + a) * cols + (c + b)]);
          }
          if (ok) combos.push(combo);
        }
      }
      if (it.shape) break; // miroir déjà traité ci-dessus si asymétrique
    }
    if (combos.length === 0) { skipped.push(it); continue; }

    const nCells = Math.max(1, combos[0].length);   // cases réellement occupées
    const wPerCell = it.weight / nCells;
    // masse restante à placer : on suppose qu'elle remplira le coffre de façon
    // homogène (½ gauche, ½ droite ; répartition AV/AR uniforme). Ce « lest
    // théorique » évite de sur-corriger l'équilibre avec le seul objet courant.
    const futureW = Math.max(0, pendingW - it.weight);
    const futLeft = futureW / 2, futRight = futureW / 2;
    const xL = targetX / 2, xR = targetX + (cols - targetX) / 2; // centres des moitiés G/D
    const yF = targetY / 2, yB = targetY + (rows - targetY) / 2;

    let best = null, bestCost = Infinity, bestN = nCells;
    for (const combo of combos) {
      const nn = combo.length || 1;                 // cases du masque à cette rotation
      const cyCell = combo.reduce((a, cl) => a + cl.y, 0) / nn;
      const sumCx = combo.reduce((a, cl) => a + cl.x, 0);
      const wp = it.weight / nn;                    // poids par case OCCUPÉE

      const nW = W + it.weight + futureW;
      const bx = (sumX + wp * sumCx + futLeft * xL + futRight * xR) / nW;
      const by = (sumY + wp * combo.reduce((a, cl) => a + cl.y, 0)
                  + futureW * ((yF + yB) / 2)) / nW;

      const lateral = Math.abs(bx - targetX) / (targetX || 1);   // penchaison G/D
      const longi   = Math.abs(by - targetY) / (targetY || 1);   // essieu AV/AR
      // lourds vers le fond (y grand) : pénalité si un gros objet est trop devant
      const heavyBack = (it.weight / payload) * Math.max(0, targetY - cyCell) / (targetY || 1) * 0.25;
      // préférence de stabilité : assiette large au fond (colonnes centrales d'abord)
      const minC = Math.min(...combo.map(cl => cl.c)), maxC = Math.max(...combo.map(cl => cl.c));
      const edgePenalty = (minC === 0 || maxC === cols - 1) ? 0.02 : 0;

      const cost = lateral * 2.0 + lateral * lateral * 3.0 + longi * 0.6 + heavyBack + edgePenalty;
      if (cost < bestCost - 1e-9) { bestCost = cost; best = combo; bestN = nn; }
    }

    if (!best) { skipped.push(it); continue; }
    const wpc = it.weight / bestN;
    for (const cl of best) {
      cl.taken = true;
      grid[cl.r][cl.c] = cl.takenId = it.id;
      sumX += wpc * cl.x; sumY += wpc * cl.y;
    }
    // note : sumX/sumY additionnent (poids/case occupée) × centre de chaque case
    // → exactement weight × barycentre RÉEL de la forme. Cohérent avec analyze().
    W += it.weight;
    pendingW -= it.weight;
    usedVol += bestN;   // l'objet ne consomme que les cases de sa FORME
    placedIds.push(it.id);
  }

  return { grid, placed: placedIds, skipped };
}

// ── Modèle de données & persistance ──────────────────────────────────────────
// Le poids des objets ne peut PAS être deviné par l'application :
// il vient soit du catalogue ci-dessous (correspondance par NOM), soit de la
// balance (pèse-personne) pour les objets personnalisés.
// Charge utile : d'abord celle que l'utilisateur renseigne (plaque grise,
// carte grise), sinon une valeur type par gabarit ci-dessous.

export const VEHICLE_TYPES = [
  // id, nom, charge utile type (kg), grille G/C/D × avant→arrière
  { id: 'moto',      name: 'Moto / scooter',            payloadKg: 180,   grid: { cols: 1, rows: 2 }, note: 'Top-case + porte-bagages. Très sensible au déséquilibre.' },
  { id: 'scooter3',  name: 'Triporteur / scooter util.',payloadKg: 250,   grid: { cols: 2, rows: 2 } },
  { id: 'remorque',  name: 'Remorque légère',           payloadKg: 400,   grid: { cols: 2, rows: 3 }, note: 'PTAC 500 kg − poids à vide ≈ 400 kg.' },
  { id: 'l1h1',      name: 'Utilitaire L1H1',           payloadKg: 800,   grid: { cols: 3, rows: 3 } },
  { id: 'fourgon',   name: 'Fourgon de chantier',       payloadKg: 1000,  grid: { cols: 3, rows: 4 } },
  { id: 'pickup',    name: 'Pick-up',                   payloadKg: 1000,  grid: { cols: 2, rows: 3 } },
  { id: 'l4h3',      name: 'Grand fourgon L4H3',        payloadKg: 1400,  grid: { cols: 3, rows: 5 } },
  { id: 'plateau',   name: 'Plateau / benne',           payloadKg: 2000,  grid: { cols: 3, rows: 5 } },
  { id: 'vl',        name: 'Voiture / break',           payloadKg: 450,   grid: { cols: 2, rows: 2 } },
  { id: 'custom',    name: 'Autre… (je saisis tout)',   payloadKg: null,  grid: null },
];

// Catalogue d'objets de chantier : l'app « connaît » le poids ET la FORME de ces
// objets. shape = masque de cases au sol (1 = matière, 0 = coin libre où l'on
// peut glisser une pelle/une barre). volume = nombre de cases consommées si pas
// de masque. C'est ce qui permet de placer des objets longs DANS les coins vides
// d'une bétonnière ou d'une bouteille de gaz, comme dans la vraie vie.
export const SHAPES = {
  // objet rond inscrit dans un carré 3×3 → 4 coins libres
  rond3: [[0,1,0],[1,1,1],[0,1,0]],
  // objet rond/ovale dans un carré 4×4 → 4 coins libres + rebords
  rond4: [
    [0,1,1,0],
    [1,1,1,1],
    [1,1,1,1],
    [0,1,1,0],
  ],
  // long & fin en diagonal (pelle, pied-de-biche posé en biais)
  long: [[1,0],[1,0],[1,1]],
};

export const ITEM_CATALOG = [
  { name: 'Sac de ciment 25 kg',               weight: 25, volume: 1, icon: '🧱' },
  { name: 'Palette de parpaings',              weight: 900, volume: 4, footprint: [2, 2], icon: '🧱' },
  { name: 'Perforateur + coffret',             weight: 8,  volume: 1, icon: '🔨' },
  { name: 'Scie circulaire',                   weight: 12, volume: 1, icon: '🪚' },
  { name: 'Panneaux OSB (gerbe)',              weight: 90, volume: 2, footprint: [1, 2], icon: '🟫' },
  { name: 'Échelle aluminium',                 weight: 15, volume: 3, footprint: [1, 3], icon: '🪜' },
  { name: 'Tuyaux PVC (faisceau)',             weight: 30, volume: 2, footprint: [1, 2], icon: '🟦' },
  { name: 'Barre d’acier / fer à béton',       weight: 25, volume: 3, footprint: [1, 3], icon: '📏' },
  { name: 'Pelle',                             weight: 2,  icon: '⛏️', shape: SHAPES.long },
  { name: 'Pioche',                            weight: 3,  icon: '🪓', shape: SHAPES.long },
  { name: 'Pied-de-biche',                     weight: 6,  icon: '🦴', shape: SHAPES.long },
  { name: 'Outillage électrique',              weight: 20, volume: 1, icon: '⚡' },
  { name: 'Brouette',                          weight: 25, volume: 2, footprint: [2, 1], icon: '🛒' },
  { name: 'Groupe électrogène',                weight: 60, volume: 1, icon: '🔌' },
  { name: 'Big-bag de sable',                  weight: 300, volume: 2, footprint: [1, 2], icon: '⛰️' },
  { name: 'Sacs d’enduit / plâtre (lot)',      weight: 30, volume: 1, icon: '🪣' },
  { name: 'Caisse à outils',                   weight: 15, volume: 1, icon: '🧰' },
  { name: 'Bétonnière',                        weight: 70, icon: '🌀', shape: SHAPES.rond3 },
  { name: 'Bouteille de gaz butane',           weight: 16, icon: '🔥', shape: [[0,1,0],[1,1,1],[0,1,0]] },
  { name: 'Fût mécano / tonneau',              weight: 120, icon: '🛢️', shape: SHAPES.rond3 },
  { name: 'Bac à mortier / auge',              weight: 18, volume: 1, icon: '🥣' },
  { name: 'Pieds biques / étai (lot)',         weight: 40, volume: 2, footprint: [1, 2], icon: '📐' },
  { name: 'Radiateur fonte',                   weight: 45, volume: 1, icon: '♨️' },
  { name: 'Sac de gravier 15 kg',              weight: 15, volume: 1, icon: '🪨' },
  { name: 'Fût / bidon 200 L (plein)',         weight: 220, volume: 1, icon: '🛢️' },
  { name: 'Pack eau / bouteilles',             weight: 12, volume: 1, icon: '🍾' },
  // — extensions utiles au scan photo —
  { name: 'Brouette pliante',                  weight: 18, volume: 2, footprint: [2, 1], icon: '🛒' },
  { name: 'Escabeau',                          weight: 9,  volume: 1, icon: '🪜' },
  { name: 'Meuleuse / disqueuse',              weight: 4,  volume: 1, icon: '⚙️' },
  { name: 'Marteau-piqueur',                   weight: 30, volume: 1, icon: '🔨' },
  { name: 'Treuil / palan',                    weight: 25, volume: 1, icon: '🪝' },
  { name: 'Rouleau de câble électrique',       weight: 20, volume: 1, icon: '🧵' },
  { name: 'Touret de câble',                   weight: 150, icon: '🎡', shape: SHAPES.rond3 },
  { name: 'Bâche de couverture',               weight: 8,  volume: 1, icon: '🟩' },
  { name: 'Bidon de carburant 20 L',           weight: 16, volume: 1, icon: '⛽' },
  { name: 'Piquets / piquets de balisage (lot)', weight: 12, volume: 2, footprint: [1, 2], icon: '🚧' },
  { name: 'Plaque de coffrage (gerbe)',        weight: 60, volume: 2, footprint: [1, 2], icon: '🟧' },
  { name: 'Sac de terre végétale',             weight: 20, volume: 1, icon: '🌱' },
  { name: 'Cric hydraulique / chandelles',     weight: 35, volume: 1, icon: '🛠️' },
];

// Recherche floue simple par nom (accents/casse ignorés) → pré-remplit le poids
// aliases : mots courants du chantier → nom du catalogue (pour la reconnaissance
// photo et la saisie). ex. « pioche » peut être nommé « bêche », « pelle »…
export const CATALOG_ALIASES = {
  'betonniere': 'Bétonnière', 'bétonnière': 'Bétonnière', 'gacheuse': 'Bétonnière', 'malaxeur': 'Bétonnière',
  'gaz': 'Bouteille de gaz butane', 'butane': 'Bouteille de gaz butane', 'propane': 'Bouteille de gaz butane',
  'bouteille de gaz': 'Bouteille de gaz butane', 'bombonne': 'Bouteille de gaz butane',
  'bache': 'Bâche de couverture', 'bâche': 'Bâche de couverture',
  'parpaing': 'Palette de parpaings', 'agglo': 'Palette de parpaings', 'carreau': 'Palette de parpaings',
  'ciment': 'Sac de ciment 25 kg', 'mortier': 'Sacs d’enduit / plâtre (lot)', 'platre': 'Sacs d’enduit / plâtre (lot)',
  'gravier': 'Sac de gravier 15 kg', 'sable': 'Big-bag de sable',
  'echelle': 'Échelle aluminium', 'escabeau': 'Escabeau',
  'touret': 'Touret de câble', 'cable': 'Touret de câble', 'treuil': 'Treuil / palan',
  'verin': 'Cric hydraulique / chandelles', 'chandelle': 'Cric hydraulique / chandelles',
  'etai': 'Pieds biques / étai (lot)', 'etais': 'Pieds biques / étai (lot)', 'pieds biques': 'Pieds biques / étai (lot)',
  'pieu': 'Piquets / piquets de balisage', 'piquet': 'Piquets / piquets de balisage',
  'bidon': 'Fût / bidon 200 L (plein)', 'fut': 'Fût mécano / tonneau', 'baril': 'Fût mécano / tonneau',
  'tonneau': 'Fût mécano / tonneau', 'radiateur': 'Radiateur fonte',
  'pioche': 'Pelle', 'beche': 'Pelle', 'bêche': 'Pelle', 'pelle': 'Pelle',
  'pied de biche': 'Pied-de-biche', 'pied-de-chevre': 'Pied-de-biche',
  'meuleuse': 'Meuleuse / disqueuse', 'disqueuse': 'Meuleuse / disqueuse', 'grinder': 'Meuleuse / disqueuse',
  'marteau piqueur': 'Marteau-piqueur', 'brise beton': 'Marteau-piqueur', 'bobine': 'Touret de câble',
};

export function findCatalogMatch(name) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const raw = String(name || '').toLowerCase().trim();
  const q = norm(name);
  if (!q) return null;
  // alias direct prioritaire (« bétonnière », « butane », « bâche »…)
  const aliasTarget = CATALOG_ALIASES[raw] || CATALOG_ALIASES[q];
  if (aliasTarget) {
    const hit = ITEM_CATALOG.find(i => i.name === aliasTarget);
    if (hit) return hit;
  }
  let best = null, bestScore = 0;
  for (const it of ITEM_CATALOG) {
    const t = norm(it.name);
    let score = 0;
    if (t === q) score = 100;
    else if (t.includes(q) || q.includes(t)) score = 60 + Math.min(q.length, t.length);
    else { // recouvrement de mots
      const wq = new Set(q.split(/\s+/)), wt = t.split(/\s+/);
      for (const w of wt) if (wq.has(w)) score += 15;
    }
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return bestScore >= 55 ? best : null;
}

const LS_KEY = 'chargepro-state-v2';

// ── Véhicules personnalisés (chaque véhicule réel a SA charge utile) ─────────
// L'utilisateur crée ses véhicules : nom, marque/modèle, charge utile (kg)
// reprise de la carte grise (PTAC − poids à vide), et dimensions du coffre/râble
// → l'app en déduit une grille d'emplacements.

export function gridFromDims(dims) {
  // dims en cm ; un « casier » fait ~45 cm de large × 60 cm de long minimum
  const cols = Math.max(1, Math.min(3, Math.round((dims.widthCm || 120) / 45)));
  const rows = Math.max(1, Math.min(8, Math.round((dims.lengthCm || 180) / 60)));
  return { cols, rows };
}

export function resolveVehicle(state) {
  const custom = (state.customVehicles || []).find(v => v.id === state.vehicleId);
  if (custom) {
    const base = VEHICLE_TYPES.find(t => t.id === custom.typeId);
    return {
      id: custom.id,
      name: custom.name,
      payloadKg: custom.payloadKg ?? base?.payloadKg ?? 500,
      grid: custom.dims ? gridFromDims(custom.dims) : (custom.grid ?? base?.grid ?? DEFAULT_GRID),
      note: custom.note ?? base?.note,
      custom: true,
    };
  }
  const preset = VEHICLE_TYPES.find(v => v.id === state.vehicleId) ?? VEHICLE_TYPES[4];
  return { ...preset, custom: false };
}

export function initialState() {
  const veh = VEHICLE_TYPES.find(v => v.id === 'fourgon');
  return {
    vehicleId: veh.id,
    customVehicles: [],  // véhicules réels créés par l'utilisateur
    grid: makeGrid(veh.grid.cols, veh.grid.rows),
    items: [],           // objets en attente (inventaire à charger)
    selectedItemId: null,
    nextId: 1,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.grid || !Array.isArray(s.items)) return null;
    s.customVehicles ??= [];
    return s;
  } catch { return null; }
}

export function saveState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

// Alias conservé pour le reste du code
export function currentVehicle(state) {
  return resolveVehicle(state);
}
