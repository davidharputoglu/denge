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
// Renvoie { ok, reason } — vérifie case libre et charge utile restante.
export function canPlace(state, r, c) {
  const g = state.grid;
  if (g[r][c] !== null) return { ok: false, reason: 'Emplacement occupé' };
  const item = state.items.find(i => i.id === state.selectedItemId);
  if (!item) return { ok: false, reason: 'Aucun objet sélectionné' };
  const itemsById = Object.fromEntries(state.items.map(i => [i.id, i]));
  const used = weightOf(g, itemsById);
  const vehicle = currentVehicle(state);
  if (used + item.weight > vehicle.payloadKg) {
    return { ok: false, reason: `Dépasse la charge utile (${vehicle.payloadKg} kg)` };
  }
  return { ok: true };
}

export function placeItem(grid, itemId, r, c) {
  const g = grid.map(row => row.slice());
  g[r][c] = itemId;
  return g;
}

export function removeItem(grid, itemId) {
  return grid.map(row => row.map(cell => (cell === itemId ? null : cell)));
}

// Poids total présent dans la grille (les ids référencent les items)
export function weightOf(grid, itemsById) {
  let w = 0;
  for (const id of grid.flat()) if (id != null && itemsById[id]) w += itemsById[id].weight;
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

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = grid[r][c];
      if (id == null) continue;
      const it = itemsById[id];
      if (!it) continue;
      W += it.weight;
      sumX += it.weight * c;
      sumY += it.weight * r;
      perCol[c] += it.weight;
      perRow[r] += it.weight;
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

  // Sens des rangées : r=0 = cabine (avant), r=rows-1 = hayon (arrière).
  // Les objets lourds vont au FOND = rangées arrière ; les légers près de la cabine.
  const sorted = [...items].sort((a, b) => b.weight - a.weight || b.volume - a.volume);

  let W = 0, sumX = 0, sumY = 0;
  const placedIds = [];
  const skipped = [];
  const midX = (cols - 1) / 2, midY = (rows - 1) / 2;

  for (const it of sorted) {
    if (W + it.weight > vehicle.payloadKg) { skipped.push(it); continue; }

    let best = null, bestCost = Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) continue;
        const nW = W + it.weight;
        const ncx = (sumX + it.weight * c) / nW;
        const ncy = (sumY + it.weight * r) / nW;

        const lateral = Math.abs(ncx - midX) / (midX || 1);   // pénalité penchaison
        const longi   = Math.abs(ncy - midY) / (midY || 1);   // équilibre essieu
        // les objets lourds doivent aller loin (r grand = fond) : pénalité si trop avant
        const heavyLow = (it.weight / vehicle.payloadKg) * Math.abs(midY - r) / (midY || 1) * 0.3;
        // incitation légère à rester dans l'allée centrale
        const proximity = Math.abs(c - midX) / (midX || 1) * 0.08;

        const cost = lateral * 1.0 + longi * 0.5 + heavyLow + proximity;
        if (cost < bestCost - 1e-9) { bestCost = cost; best = { r, c }; }
      }
    }

    if (!best) { skipped.push(it); continue; }
    grid[best.r][best.c] = it.id;
    W += it.weight;
    sumX += it.weight * best.c;
    sumY += it.weight * best.r;
    placedIds.push(it.id);
  }

  return { grid, placed: placedIds, skipped };
}

// ── Modèle de données & persistance ──────────────────────────────────────────
export const VEHICLES = [
  { id: 'fourgon', name: 'Fourgon de chantier', payloadKg: 1000, grid: { cols: 3, rows: 4 } },
  { id: 'utilitaire', name: 'Utilitaire L1H1', payloadKg: 800, grid: { cols: 3, rows: 3 } },
  { id: 'pick-up', name: 'Pick-up', payloadKg: 600, grid: { cols: 2, rows: 3 } },
  { id: 'plateau', name: 'Plateau / Benne', payloadKg: 1500, grid: { cols: 3, rows: 5 } },
];

export const ITEM_TEMPLATES = [
  { name: 'Sac de ciment (25 kg)', weight: 25, volume: 1, icon: '🧱' },
  { name: 'Perforateur + coffret', weight: 8, volume: 1, icon: '🔨' },
  { name: 'Scie circulaire', weight: 12, volume: 1, icon: '🪚' },
  { name: 'Panneaux OSB (gerbe)', weight: 90, volume: 2, icon: '🟫' },
  { name: 'Échelle aluminium', weight: 15, volume: 2, icon: '🪜' },
  { name: 'Tuyaux PVC (faisceau)', weight: 30, volume: 2, icon: '🟦' },
  { name: 'Compteur / outillage élec.', weight: 20, volume: 1, icon: '⚡' },
  { name: 'Brouette', weight: 25, volume: 2, icon: '🛒' },
  { name: 'Groupe électrogène', weight: 60, volume: 1, icon: '🔌' },
  { name: 'Sable (big-bag)', weight: 300, volume: 2, icon: '⛰️' },
];

const LS_KEY = 'chargepro-state-v1';

export function initialState() {
  const veh = VEHICLES[0];
  return {
    vehicleId: veh.id,
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
    return s;
  } catch { return null; }
}

export function saveState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

export function currentVehicle(state) {
  return VEHICLES.find(v => v.id === state.vehicleId) ?? VEHICLES[0];
}
