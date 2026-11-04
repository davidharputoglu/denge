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
export function otsuThreshold(hist) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thr = t; }
  }
  return thr;
}

// ---------- grille de cases : chaque case = 1 si majoritairement « objet » ----
export function classifyCells(lum, W, H, cell) {
  // histogramme global → seuil Otsu
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  const thr = otsuThreshold(hist);
  // contraste trop faible (photo uniforme) → rien à segmenter
  let spread = 0, n = 0;
  for (let i = 0; i < 256; i++) if (hist[i]) { spread++; n++; }
  const cols = Math.floor(W / cell), rows = Math.floor(H / cell);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let obj = 0, cnt = 0;
      for (let y = r * cell; y < Math.min((r + 1) * cell, H); y += 2)
        for (let x = c * cell; x < Math.min((c + 1) * cell, W); x += 2) {
          cnt++;
          if (Math.abs(lum[y * W + x] - thr) <= 60 && lum[y * W + x] !== thr) {
            // « objet » = écart fort avec le fond : soit plus sombre, soit plus clair
            obj++;
          }
        }
      row.push(cnt && obj / cnt > 0.55 ? 1 : 0);
    }
    grid.push(row);
  }
  return { grid, thr, usable: n > 24 };
}

// ---------- connected components (flood fill 4-voisins) -----------------------
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
  const { grid, usable } = classifyCells(lum, W, H, cellPx);
  if (!usable || !grid.length || !grid[0].length) return { objects: [], note: 'lowcontrast' };

  const blobs = findBlobs(grid).filter(b => b.length >= 2); // ignore le bruit
  if (!blobs.length) return { objects: [], note: 'noblobs' };

  // ÉCHELLE : feuille A4 détectée → exacte ; sinon étalon « plus gros blob ≈ 1 m »
  let scaleCmPerCell = knownScaleCm ?? null;
  let scaleSource = knownScaleCm ? 'A4' : 'estimee';
  if (!scaleCmPerCell) {
    const maxCells = Math.max(...blobs.map(b => Math.max(
      ...[Math.max(...b.map(p => p[0])) - Math.min(...b.map(p => p[0])) + 1,
          Math.max(...b.map(p => p[1])) - Math.min(...b.map(p => p[1])) + 1])));
    scaleCmPerCell = 100 / Math.max(1, maxCells); // plus grand objet ≈ 100 cm
  }

  const objects = blobs.map(cellsList => {
    const st = blobStats(cellsList);
    const cls = classifyBlob(st, scaleCmPerCell);
    const footprintCm = {
      w: Math.round(st.bboxW * scaleCmPerCell),
      h: Math.round(st.bboxH * scaleCmPerCell),
    };
    // encombrement en « cases coffre » (une case ≈ 45×60 cm)
    const volCells = Math.max(1, Math.round((footprintCm.w / 45) * (footprintCm.h / 60)));
    return {
      stats: st, ...cls, footprintCm, volCells,
      cells: cellsList, // positions brutes (cases image) pour dessin overlay
    };
  }).sort((a, b) => b.stats.area - a.stats.area);

  return { objects, scaleCmPerCell: Math.round(scaleCmPerCell * 10) / 10, scaleSource, gridDims: [grid.length, grid[0].length] };
}

// ---------- mémoire locale : silhouettes déjà confirmées ----------------------
// Signature grossière (kind + taille arrondie) → poids confirmé la dernière fois.
export function signatureOf(obj) {
  const s = obj.stats;
  return `${obj.kind}|${s.area}|${Math.round(s.elongation * 2) / 2}`;
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
