// ─────────────────────────────────────────────────────────────────────────────
// 📷 Reconnaissance visuelle — 100 % HORS LIGNE, sur le téléphone
//
// Comment l'app « voit » les objets d'une photo, sans serveur ni IA cloud :
//
//  1. SEGMENTATION PAR COULEUR (Otsu + connected components)
//     On découpe la photo en petits carrés de ~28×28 px ; pour chacun on
//     décide « objet » ou « sol » par seuillage automatique du contraste
//     (seuil d'Otsu calculé sur toute l'image). Les carrés « objet » voisins
//     sont regroupés en blobs → ce sont les silhouettes au sol.
//
//  2. GÉOMÉTRIE DE CHAQUE BLOB
//     aire (nb de cases), allongement (bbox h/w), remplissage (aire / bbox),
//     centre (x, y) → tout ce qu'il faut pour estimer forme et encombrement.
//
//  3. CLASSIFICATION PAR RÈGLES PHYSIQUES (pas de réseau de neurones !)
//     Un objet long et fin  → pelle / pioche / barre / tuyau
//     Rond, gros, dense     → bétonnière / fût / touret
//     Petit et compact      → sac, caisse à outils…
//     La taille RELATIVE des blobs entre eux donne une échelle : le plus gros
//     blob ≈ 1 m au sol (étalon implicite), les autres sont proportionnels.
//
//  4. POIDS = ESTIMATION, JAMAIS CERTITUDE ⚖️
//     L'app ne peut PAS peser avec une caméra (c'est physiquement impossible).
//     Elle croise donc : catégorie reconnue + volume estimé → fourchette de
//     poids, puis cherche dans le CATALOGUE (poids réels connus) le meilleur
//     match. Résultat affiché : « Bétonnière ≈ 70 kg ? [confiance 82 %] »
//     → l'ouvrier confirme d'un tap, ou corrige le poids en 2 secondes.
//     Après confirmation, l'objet est mémorisé : la prochaine fois, même
//     silhouette → même poids, sans resaisie (mémoire locale).
//
//  5. ÉCHELLE RÉELLE (optionnel, très fiable) 📏
//     Si l'utilisateur place une feuille A4 (29,7 × 21 cm) à côté des objets
//     avant la photo, l'app détecte le rectangle blanc et convertit
//     pixel → cm exactement. Sans elle : estimation approximative signalée.
//
// Tout tourne dans le navigateur (Canvas API), aucune donnée ne quitte
// le téléphone. Pour une vraie détection d'objets (YOLO/TF-Lite embarqué),
// voir README — section « Passer à l'IA ».
// ─────────────────────────────────────────────────────────────────────────────

// ---------- seuil d'Otsu sur un histogramme de luminance 256 niveaux ----------
// Otsu classique + post-traitement : quand le maximum de variance inter-classe
// est atteint dès le premier seuil possible (cas dégénéré des histogrammes à
// deux modes exacts, ex. fond 200 / objets 40), on replace le seuil au MILIEU
// du creux entre les deux modes dominants — sinon le seuillage « < thr » ne
// voit aucun objet.
export function otsuThreshold(hist) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, thr = 128;
  let firstMaxT = null;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar + 1e-9) { maxVar = between; thr = t; if (firstMaxT === null) firstMaxT = t; }
  }
  // Seuil « au milieu du creux » : sur une photo, l'histogramme n'est jamais
  // parfaitement bimodal (bruit, ombres). On cherche donc le PLUS GRAND vide
  // de masse entre deux valeurs non nulles — c'est là que passe la frontière
  // objet/fond. S'il est ambigu (photo uniforme), on garde le thr d'Otsu.
  const nz = [];
  for (let i = 0; i < 256; i++) if (hist[i] > 0) nz.push(i);
  let gapLo = null, gapHi = null, gapBest = 0;
  for (let k = 1; k < nz.length; k++) {
    const a = nz[k - 1], b = nz[k];
    const massBetween = (() => { let s = 0; for (let i = a + 1; i < b; i++) s += hist[i]; return s; })();
    const empty = b - a - 1;           // largeur du creux vide
    const score = empty + (massBetween === 0 ? 0 : -Math.max(0, 8 - empty));
    if (b - a >= 3 && massBetween <= total * 0.02 && score > gapBest) {
      gapBest = score; gapLo = a; gapHi = b;
    }
  }
  if (gapLo !== null && gapHi !== null) {
    // seuil au milieu ; pour un creux clair/sombre renversé, idem
    thr = Math.round((gapLo + gapHi) / 2);
  } else if (nz.length >= 2) {
    const peaks = hist.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const p1 = peaks[0], p2 = peaks[1];
    if (p1 && p2 && p1[0] + p2[0] >= total * 0.98 && p1[1] !== p2[1]) {
      const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
      if (hi - lo > 1 && thr <= lo + 1) thr = Math.round((lo + hi) / 2);
    }
  }
  return thr;
}

// ---------- grille de cases : chaque case = 1 si majoritairement « objet » ----
// Le mode « objet » est déterminé par la masse de part et d'autre du seuil :
// sur une photo de chantier, les objets sont généralement PLUS SOMBRES que le
// sol → on compte les pixels < thr. Si l'inverse domine nettement (objets
// clairs sur sol sombre), on compte les pixels > thr. Fini le critère
// « écart ≤ 60 » qui ratait les objets très sombres sur sol clair.
export function classifyCells(lum, W, H, cell) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  const thr = otsuThreshold(hist);
  let n = 0;
  for (let i = 0; i < 256; i++) if (hist[i]) n++;
  // côté majoritaire hors fond ?
  let below = 0, above = 0;
  for (let i = 0; i < 256; i++) {
    if (i < thr) below += hist[i];
    else if (i > thr) above += hist[i];
  }
  const darkMode = below >= above; // objets sombres → pixels < thr
  const cols = Math.floor(W / cell), rows = Math.floor(H / cell);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let obj = 0, cnt = 0;
      for (let y = r * cell; y < Math.min((r + 1) * cell, H); y += 2)
        for (let x = c * cell; x < Math.min((c + 1) * cell, W); x += 2) {
          cnt++;
          const v = lum[y * W + x];
          if (darkMode ? v < thr : v > thr) obj++;
        }
      row.push(cnt && obj / cnt > 0.55 ? 1 : 0);
    }
    grid.push(row);
  }
  return { grid, thr, usable: n > 2 };
}

// ---------- connected components (flood fill 4-voisins) -----------------------
// 4-voisins : deux objets posés côte à côte ne se touchent que par leurs coins
// en diagonale sur la grille — ils doivent rester DEUX silhouettes distinctes.
export function findBlobs(grid) {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const seen = grid.map(r => r.map(() => false));
  const blobs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!grid[r][c] || seen[r][c]) continue;
    const stack = [[r, c]];
    seen[r][c] = true;
    const cellsList = [];
    while (stack.length) {
      const [y, x] = stack.pop();
      cellsList.push([y, x]);
      for (const [dy, dx] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny][nx] && !seen[ny][nx]) {
          seen[ny][nx] = true; stack.push([ny, nx]);
        }
      }
    }
    blobs.push(cellsList);
  }
  return blobs;
}

// Fusionne les fragments d'un MÊME objet : une pelle posée en biais découpe des
// cases qui ne se touchent qu'en diagonale. On regroupe deux blobs si leurs
// boîtes englobantes se chevauchent (à ±1 case près) ET qu'au moins une paire
// de leurs cases est diagonale-adjacente → un seul outil reconnu.
export function mergeDiagonalBlobs(blobs) {
  const info = blobs.map(cells => {
    const ys = cells.map(p => p[0]), xs = cells.map(p => p[1]);
    return {
      cells,
      minR: Math.min(...ys), maxR: Math.max(...ys),
      minC: Math.min(...xs), maxC: Math.max(...xs),
      set: new Set(cells.map(([r, c]) => `${r},${c}`)),
    };
  });
  const parent = info.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const diagTouch = (a, b) => {
    // boîtes englobantes proches (≤ 1 case d'écart)
    if (a.minR > b.maxR + 1 || b.minR > a.maxR + 1) return false;
    if (a.minC > b.maxC + 1 || b.minC > a.maxC + 1) return false;
    for (const [r, c] of a.cells) {
      if (b.set.has(`${r - 1},${c - 1}`) || b.set.has(`${r - 1},${c + 1}`) ||
          b.set.has(`${r + 1},${c - 1}`) || b.set.has(`${r + 1},${c + 1}`)) return true;
    }
    return false;
  };
  for (let i = 0; i < info.length; i++)
    for (let j = i + 1; j < info.length; j++)
      if (diagTouch(info[i], info[j])) parent[find(j)] = find(i);
  const groups = new Map();
  info.forEach((it, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(...it.cells);
  });
  return [...groups.values()];
}

// ---------- géométrie d'un blob ----------------------------------------------
export function blobStats(cellsList) {
  const ys = cellsList.map(p => p[0]), xs = cellsList.map(p => p[1]);
  const minR = Math.min(...ys), maxR = Math.max(...ys);
  const minC = Math.min(...xs), maxC = Math.max(...xs);
  const bh = maxR - minR + 1, bw = maxC - minC + 1;
  const area = cellsList.length;
  const cx = (xs.reduce((a, b) => a + b, 0) / area);
  const cy = (ys.reduce((a, b) => a + b, 0) / area);
  return {
    area, bboxH: bh, bboxW: bw,
    elongation: Math.max(bh, bw) / Math.max(1, Math.min(bh, bw)),
    fill: area / (bh * bw),           // 1 = rectangle plein ; ~0.5 = rond inscrit
    cx, cy,                            // centre en cases
    aspect: bw / bh,                   // >1 : large ; <1 : haut/long vertical
  };
}

// ---------- classification par règles physiques -------------------------------
// Retourne { kind, label, icon, shapeHint, weightRange:[min,max], confidence }
// kind sert aussi à déduire la FORME au sol (rond → coins libres, etc.)
export function classifyBlob(st, scaleCmPerCell) {
  // dimensions réelles estimées (cm)
  const dimMax = Math.max(st.bboxH, st.bboxW) * scaleCmPerCell;
  const dimMin = Math.min(st.bboxH, st.bboxW) * scaleCmPerCell;

  // 1) LONG & FIN : allongé (>2.2) et étroit (<30 cm de petit côté)
  //    → pelle, pioche, pied-de-biche, barre d'acier, tuyau PVC, échelle
  if (st.elongation >= 2.2 && dimMin <= 30) {
    if (dimMax >= 180) return { kind: 'long', label: 'Échelle / perche longue', icon: '🪜',
      shapeHint: 'long', weightRange: [10, 20], confidence: 0.6 };
    if (dimMax >= 90) return { kind: 'long', label: 'Barre / tuyau / profilé', icon: '📏',
      shapeHint: 'long', weightRange: [8, 40], confidence: 0.65 };
    return { kind: 'long', label: 'Pelle / pioche / pied-de-biche', icon: '⛏️',
      shapeHint: 'long', weightRange: [2, 8], confidence: 0.7 };
  }

  // 2) ROND / OVALE : fill ≈ 0.5–0.85 et peu allongé → bétonnière, fût, gaz, touret
  const roundish = st.fill >= 0.45 && st.fill <= 0.88 && st.elongation <= 1.6;
  if (roundish) {
    if (dimMax >= 90) return { kind: 'rond', label: 'Touret / enrouleur / grande roue', icon: '🎡',
      shapeHint: 'rond', weightRange: [80, 220], confidence: 0.55 };
    if (dimMax >= 55) {
      // dense et lourd vs léger : un gaz butane fait ~35 cm, une bétonnière ~60 cm
      if (dimMax >= 65) return { kind: 'rond', label: 'Bétonnière / fût', icon: '🌀',
        shapeHint: 'rond', weightRange: [60, 130], confidence: 0.72 };
      return { kind: 'rond', label: 'Bouteille de gaz / bidon', icon: '🔥',
        shapeHint: 'rond', weightRange: [10, 30], confidence: 0.7 };
    }
    return { kind: 'rond', label: 'Seau / bac à mortier', icon: '🥣',
      shapeHint: 'auto', weightRange: [5, 25], confidence: 0.6 };
  }

  // 3) RECTANGLE PLEIN (fill > 0.85) : sac, caisse, panneau, palette
  if (st.fill > 0.85) {
    if (dimMax >= 90) return { kind: 'bloc', label: 'Palette / panneau / gerbe', icon: '🧱',
      shapeHint: 'bloc', weightRange: [80, 900], confidence: 0.55 };
    if (st.area >= 3) return { kind: 'bloc', label: 'Panneau OSB / plaque', icon: '🟫',
      shapeHint: 'bloc', weightRange: [20, 120], confidence: 0.6 };
    return { kind: 'bloc', label: 'Sac / caisse à outils', icon: '🧰',
      shapeHint: 'auto', weightRange: [5, 40], confidence: 0.65 };
  }

  // 4) forme irrégulière → objet divers, à confirmer manuellement
  return { kind: 'divers', label: 'Objet à identifier', icon: '📦',
    shapeHint: 'auto', weightRange: [5, 60], confidence: 0.35 };
}

// ---------- détection d'objets-ÉTALONS familiers (remplace la feuille A4) ----
// Personne ne promène une feuille A4 sur un chantier. Mais il y a presque
// TOUJOURS dans le champ de la photo un objet dont la taille réelle est connue
// de tous : un sac de ciment (~35 cm posé à plat), un seau de chantier
// (~28 cm), une bêche (~47 cm), une bouteille d'eau (~23 cm), une brique.
// Astuce : les SURFACES RELATIVES des silhouettes ne dépendent ni de la
// distance ni de l'échelle. Avec l'échelle grossière (« plus gros blob ≈ 1 m »),
// on cherche une silhouette compacte dont la taille estimée tombe dans la
// fenêtre d'un étalon connu (±30 %) ; si oui, on corrige l'échelle avec sa
// taille réelle exacte. Résultat : pas besoin de rien poser par terre.
export const NATURAL_SCALES = [
  { name: 'brique',              icon: '🧱', cm: 10 }, // parpaing standard, bord de chantier
  { name: 'sac de ciment',       icon: '🧱', cm: 35 }, // posé à plat, ~35 cm de large
  { name: 'pelle / bêche',       icon: '⛏️', cm: 47 }, // fer + manche court posé
  { name: 'seau de 10 litres',   icon: '🪣', cm: 28 }, // diamètre universel du chantier
  { name: 'bouteille d’eau 1 L', icon: '🍾', cm: 23 }, // hauteur debout ≈ 23 cm
];

export function detectNaturalScale(statsList, scaleCmPerCell) {
  if (!statsList.length || !scaleCmPerCell) return null;
  let best = null;
  for (const st of statsList) {
    if (st.elongation > 1.45) continue;                 // uniquement les silhouettes compactes
    const dimMaxCells = Math.max(st.bboxH, st.bboxW);
    const dimMinCells = Math.min(st.bboxH, st.bboxW);
    if (dimMaxCells < 2 || dimMinCells / dimMaxCells < 0.55) continue; // trop petit / pas carré
    const realDimMax = dimMaxCells * scaleCmPerCell;    // taille estimée avec l'échelle grossière
    for (const ref of NATURAL_SCALES) {
      const err = Math.abs(Math.log(realDimMax / ref.cm)); // écart relatif (tolère ±35 %)
      if (err > 0.35) continue;
      const cand = { scale: ref.cm / dimMaxCells, ref, err };
      if (!best || cand.err < best.err) best = cand;
    }
  }
  if (!best) return null;
  return { scaleCmPerCell: Math.round(best.scale * 10) / 10, ref: best.ref };
}

// ---------- pipeline complet : ImageData → objets candidats -------------------
export function detectFromImageData(imgData, opts = {}) {
  const { cellPx = 28, knownScaleCm = null } = opts;
  const { data, width: W, height: H } = imgData;
  // luminance (sous-échantillonnage ×1 : tableau 1 octet/pixel)
  const lum = new Uint8Array(W * H);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    lum[p] = y; hist[y]++;
  }
  const { grid, thr, usable } = classifyCells(lum, W, H, cellPx);
  // « usable » : photo uniforme (1 seul niveau de gris) → rien à segmenter.
  if (!usable || !grid.length || !grid[0].length) return { objects: [], note: 'lowcontrast' };

  // Filet de sécurité : si le seuillage par luminance ne trouve RIEN (contre-
  // jour, sol clair et objets clairs…), on retente avec la SATURATION couleur.
  let workGrid = grid;
  if (!findBlobs(grid).some(b => b.length >= 2)) {
    const sat = new Uint8Array(W * H);
    const histS = new Array(256).fill(0);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      const s = mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 255);
      sat[p] = s; histS[s]++;
    }
    const alt = classifyCells(sat, W, H, cellPx);
    if (alt.usable && findBlobs(alt.grid).some(b => b.length >= 2)) workGrid = alt.grid;
  }

  // Blobs 4-voisins → fusion des fragments diagonaux (outil posé en biais)
  // → filtrage du bruit (silhouette d'1 case ignorée).
  const blobs = mergeDiagonalBlobs(findBlobs(workGrid)).filter(b => b.length >= 2);
  if (!blobs.length) return { objects: [], note: 'noblobs' };

  // ÉCHELLE : 1) objet-étalon familier détecté (sac, seau, pelle…) → précise ;
  //          2) sinon étalon implicite « plus gros blob ≈ 1 m » → estimée.
  let scaleCmPerCell = knownScaleCm ?? null;
  let scaleSource = knownScaleCm ? 'etalon-manuel' : 'estimee';
  let scaleRef = null;
  const statsList = blobs.map(blobStats);
  if (!scaleCmPerCell) {
    const maxCells = Math.max(...statsList.map(st => Math.max(st.bboxH, st.bboxW)));
    const guess = 100 / Math.max(1, maxCells); // plus grand objet ≈ 100 cm
    const nat = detectNaturalScale(statsList, guess);
    if (nat) {
      scaleCmPerCell = nat.scaleCmPerCell;
      scaleSource = 'etalon';
      scaleRef = nat.ref;
    } else {
      scaleCmPerCell = guess;
    }
  }

  const objects = statsList.map((st, i) => {
    const cls = classifyBlob(st, scaleCmPerCell);
    const footprintCm = {
      w: Math.round(st.bboxW * scaleCmPerCell),
      h: Math.round(st.bboxH * scaleCmPerCell),
    };
    // encombrement en « cases coffre » (une case ≈ 45×60 cm)
    const volCells = Math.max(1, Math.round((footprintCm.w / 45) * (footprintCm.h / 60)));
    return {
      stats: st, ...cls, footprintCm, volCells,
      cells: blobs[i], // positions brutes (cases image) pour dessin overlay
    };
  }).sort((a, b) => b.stats.area - a.stats.area);

  return { objects, scaleCmPerCell: Math.round(scaleCmPerCell * 10) / 10, scaleSource, scaleRef, gridDims: [grid.length, grid[0].length] };
}

// ---------- mémoire locale : silhouettes déjà confirmées ----------------------
// LA SIGNATURE EST BASÉE SUR L'ENCOMBREMENT RÉEL EN CENTIMÈTRES, PAS SUR LES
// PIXELS. Les paliers combinent DEUX mesures indépendantes en cm réels :
// la plus grande dimension (D) ET la racine carrée de la surface (S ≈
// « diamètre équivalent »), plus l'allongement et la famille de forme (kind).
// Conséquence directe du problème « 1,5 L vs 0,5 L » :
//   • bouteille de 1,5 L ≈ 30 cm / ~70 cm²  → D3|S2 ;
//   • bouteille de 0,5 L ≈ 20 cm / ~30 cm²  → D2|S1 ;
// tailles réelles différentes ⇒ signatures différentes ⇒ le poids mémorisé
// du 1,5 L N'EST PAS appliqué au 0,5 L : l'app redemande (une seule fois).
// Inversement, la MÊME bétonnière photographiée de plus loin garde le même
// encombrement réel en cm ⇒ mêmes paliers ⇒ poids repris automatiquement.
const TIERS_D = [12, 20, 30, 45, 70, 110];      // grandes dimensions (cm)
const TIERS_S = [Math.sqrt(80), Math.sqrt(300), Math.sqrt(900),
                 Math.sqrt(2200), Math.sqrt(5000)]; // √surface (cm)

function tierOf(v, tiers) {
  let t = 0;
  while (t < tiers.length && v >= tiers[t]) t++;
  return t;
}

export function sizeTier(cm) { return tierOf(cm, TIERS_D); }
export function sqrtAreaTier(sqrtAreaCm) { return tierOf(sqrtAreaCm, TIERS_S); }

export function signatureOf(obj) {
  const s = obj.stats;
  // dimensions RÉELLES en cm si l'échelle est connue dans le résultat de scan
  const real = obj.footprintCm
    ? { w: obj.footprintCm.w, h: obj.footprintCm.h }
    : { w: Math.round(s.bboxW * 10), h: Math.round(s.bboxH * 10) }; // secours
  const dimMaxCm = Math.max(real.w, real.h);
  const sqrtAreaCm = Math.sqrt(Math.max(1, s.areaCells)) *
    (obj.scaleCmPerCell ?? 10); // surface réelle ≈ cells × (cm/cell)²
  return `${obj.kind}|D${tierOf(dimMaxCm, TIERS_D)}|S${tierOf(sqrtAreaCm, TIERS_S)}|` +
    `${Math.round(s.elongation * 2) / 2}`;
}

export function matchMemory(objects, memory) {
  return objects.map(o => {
    const sig = signatureOf(o);
    const known = memory?.[sig];
    return known ? { ...o, remembered: known } : o;
  });
}

// ---------- point d'entrée depuis un <img> (décodé par le navigateur) ---------
// Réduit l'image à ~560 px de large max : assez pour la géométrie, rapide.
export function scanImageEl(img) {
  const scale = Math.min(1, 560 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const W = Math.max(8, Math.round((img.naturalWidth || img.width) * scale));
  const H = Math.max(8, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const imgData = ctx.getImageData(0, 0, W, H);
  // cases d'analyse ≈ 4 % de la largeur → ~20×20 cases sur une photo type
  const cellPx = Math.max(10, Math.round(Math.min(W, H) * 0.045));
  const res = detectFromImageData(imgData, { cellPx });
  res.previewUrl = canvas.toDataURL('image/jpeg', 0.5);
  return res;
}
