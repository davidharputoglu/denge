import './style.css';
import {
  VEHICLE_TYPES, ITEM_CATALOG, SHAPES, findCatalogMatch,
  initialState, loadState, saveState, currentVehicle, resolveVehicle, gridFromDims,
  makeGrid, analyze, autoLoad, canPlace, placeItem, removeItem, footprintFor,
  shapeMaskFor, colLabel, rowLabel, weightOf, DEFAULT_GRID,
} from './engine.js';
import { scanImageEl, matchMemory, signatureOf } from './vision.js';

let state = loadState() ?? initialState();
state.scanMemory ??= {};   // silhouettes déjà confirmées → poids connu
state.lastScan ??= null;   // dernier résultat de scan photo (candidates)
state.scanWeights ??= {};  // poids en cours d'édition sur le scan affiché
// 📚 pré-remplissage intelligent : dès la première photo, si la silhouette
// correspond à un objet du catalogue (bétonnière, butane, pelle…), l'app
// propose SON poids réel — et le mémorise pour ce type de forme.
if (!state.catalogPrimed) {
  for (const [sig, w] of Object.entries(state.scanMemory)) {
    if (w?.name) state.catalogPrimed = true; // mémoire déjà utilisée → inutile
  }
}
let tab = 'charger'; // charger | scan | objets | véhicule
let pendingCatalogPick = null; // suggestion catalogue acceptée → forme exacte reprise

const app = document.getElementById('app');
const $ = sel => app.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, color = 'var(--green)') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.background = color;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function persist() { saveState(state); }

function pendingItems() {
  return state.items.filter(i => !state.grid.flat().includes(i.id));
}

function itemsById() {
  return Object.fromEntries(state.items.map(i => [i.id, i]));
}

// ── Rendu ────────────────────────────────────────────────────────────────────
function render() {
  const veh = currentVehicle(state);
  const report = analyze(state.grid, state.items, veh);

  app.innerHTML = `
    <header>
      <h1>🧺 Tepsi</h1>
      <p>Charger au maximum — sans faire pencher le véhicule</p>
    </header>

    ${renderBalanceBar(report)}

    <main>${tab === 'charger' ? renderCharger(veh, report)
        : tab === 'scan' ? renderScan()
        : tab === 'objets' ? renderObjets(veh, report)
        : renderVehicule(veh)}</main>

    <nav class="tabbar">
      <button data-tab="charger" class="${tab === 'charger' ? 'active' : ''}">📦<span>Charger</span></button>
      <button data-tab="scan" class="${tab === 'scan' ? 'active' : ''}">📷<span>Scanner</span></button>
      <button data-tab="objets" class="${tab === 'objets' ? 'active' : ''}">🧰<span>Objets</span></button>
      <button data-tab="vehicule" class="${tab === 'vehicule' ? 'active' : ''}">🚐<span>Véhicule</span></button>
    </nav>`;

  bindEvents(veh, report);
}

// Bandeau d'équilibre toujours visible
function renderBalanceBar(rep) {
  const cls = rep.color;
  const lrSide = rep.frontBackPct >= 0 ? 'arrière' : 'avant';
  const lrDir = rep.leftRightPct > 5 ? (rep.perCol.reduce((a,b)=>a+b,0) && rep.loadPct > 0 ? '' : '') : '';
  return `
  <section class="balance ${cls}">
    <div class="balance-top">
      <div class="score">${rep.balanceScore}<small>/100</small></div>
      <div class="balance-info">
        <strong>${esc(rep.status)}</strong>
        <span>${rep.weightTotal} / ${rep.payload} kg — charge ${Math.round(rep.loadPct)} %</span>
      </div>
    </div>
    <div class="bars">
      <div class="bar-row">
        <label>⚖️ Gauche/Droite</label>
        <div class="meter"><div class="fill ${cls}" style="width:${Math.min(100, Math.max(4, 100 - rep.leftRightPct)).toFixed(0)}%"></div></div>
        <b>${rep.leftRightPct.toFixed(0)} %</b>
      </div>
      <div class="bar-row">
        <label>↔️ Avant/Arrière</label>
        <div class="meter"><div class="fill ${cls}" style="width:${Math.min(100, Math.max(4, 100 - Math.abs(rep.frontBackPct))).toFixed(0)}%"></div></div>
        <b>${rep.frontBackPct >= 0 ? '+' : ''}${rep.frontBackPct.toFixed(0)} % ${rep.frontBackPct >= 0 ? '↗' : '↘'}</b>
      </div>
    </div>
  </section>`;
}

// Vue « Charger » : grille vue du dessus + sélection d'objet + conseil
function renderCharger(veh, rep) {
  const grid = state.grid;
  const rows = grid.length, cols = grid[0].length;
  const byId = itemsById();
  const selected = state.items.find(i => i.id === state.selectedItemId && !grid.flat().includes(i.id));

  // Conseil : meilleure case simulée pour l'objet sélectionné
  let adviceCell = null;
  if (selected) {
    // repositionner les objets déjà en place : ils ne sont plus dans la liste
    // « pending » → on rejoue leur placement sur une copie pour localiser
    // l'objet sélectionné dans le plan complet.
    const placedNow = state.grid.flat().filter(x => x != null);
    const full = autoLoad(
      [...pendingItems(), ...state.items.filter(i => placedNow.includes(i.id))],
      veh, { cols, rows });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (full.grid[r][c] === selected.id) adviceCell = { r, c };
    }
  }

  let cellsHtml = '';
  // empreinte du bloc de chaque objet posé (pour affichage fusionné + libellés)
  const blockInfo = {}; // "r,c" coin haut-gauche → { h, w }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const id = grid[r][c];
    if (id == null) continue;
    let r0 = r, c0 = c;
    while (r0 > 0 && grid[r0 - 1][c] === id) r0--;
    while (c0 > 0 && grid[r0][c0 - 1] === id) c0--;
    if (!blockInfo[`${r0},${c0},${id}`]) {
      let h = 1; while (r0 + h < rows && grid[r0 + h][c0] === id) h++;
      let w = 1; while (c0 + w < cols && grid[r0][c0 + w] === id) w++;
      blockInfo[`${r0},${c0},${id}`] = { h, w };
    }
  }
  // prévisualisation de la FORME : cases que le masque couvrirait si posé ici
  const selMask = selected ? shapeMaskFor(selected, cols, rows) : null;
  for (let r = 0; r < rows; r++) {
    cellsHtml += `<div class="grid-row">`;
    for (let c = 0; c < cols; c++) {
      const id = grid[r][c];
      const it = id != null ? byId[id] : null;
      const isAdvice = adviceCell && adviceCell.r === r && adviceCell.c === c;
      const inPreview = !it && selMask && adviceCell &&
        r >= adviceCell.r && r < adviceCell.r + selMask.length &&
        c >= adviceCell.c && c < adviceCell.c + selMask[0].length &&
        selMask[r - adviceCell.r][c - adviceCell.c] === 1;
      const previewHole = !it && selMask && adviceCell &&
        r >= adviceCell.r && r < adviceCell.r + selMask.length &&
        c >= adviceCell.c && c < adviceCell.c + selMask[0].length &&
        selMask[r - adviceCell.r][c - adviceCell.c] !== 1;
      const key = it ? `${r},${c},${id}` : null;
      const blk = key ? blockInfo[key] : null;
      const spanLabel = blk && blk.h * blk.w > 1 ? `${blk.h}×${blk.w}` : '';
      cellsHtml += `
        <button class="cell ${it ? 'occupied' : 'free'} ${isAdvice ? 'advice' : ''} ${inPreview ? 'preview' : ''} ${previewHole ? 'hole' : ''}"
                data-r="${r}" data-c="${c}" title="${esc(colLabel(cols, c))} · ${esc(rowLabel(rows, r))}${spanLabel ? ' — occupe ' + spanLabel : ''}">
          ${it ? `<span class="cell-icon">${it.icon || '📦'}</span><span class="cell-kg">${it.weight}kg${spanLabel ? ` <small>${spanLabel}</small>` : ''}</span>`
               : isAdvice ? `<span class="advice-tag">ICI ✅</span>`
               : inPreview ? '<span class="advice-tag">▣</span>' : '<span class="dot"></span>'}
        </button>`;
    }
    cellsHtml += `</div>`;
  }

  const pend = pendingItems();
  const listHtml = pend.length === 0
    ? `<p class="empty">Aucun objet en attente. Ajoutez des objets dans l’onglet 🧰 Objets.</p>`
    : pend.map(i => `
        <button class="chip ${i.id === state.selectedItemId ? 'sel' : ''}" data-item="${i.id}">
          ${i.icon || '📦'} ${esc(i.name)} <b>${i.weight} kg</b>
        </button>`).join('');

  return `
  <section class="card">
    <h2>Vue du coffre — ${esc(veh.name)}</h2>
    <div class="orientation"><span>⬆ Avant (cabine)</span><span>Arrière (hayon) ⬇</span></div>
    <div class="truck">
      <div class="cab">🚐</div>
      <div class="cargo">${cellsHtml}</div>
    </div>
    <div class="col-labels"><span>Gauche</span><span>Centre</span><span>Droite</span></div>
    <p class="hint">${selected
        ? (adviceCell
            ? `💡 Placez <b>${esc(selected.name)}</b> en <b>${esc(colLabel(cols, adviceCell.r >= 0 ? adviceCell.c : 0))} · ${esc(rowLabel(rows, adviceCell.r))}</b> (case surlignée).`
            : `⚠️ Plus de place libre pour cet objet.`)
        : 'Sélectionnez un objet ci-dessous puis touchez une case libre.'}</p>
  </section>

  <section class="card">
    <h2>Objets à charger (${pend.length})</h2>
    <div class="chips">${listHtml}</div>
    <div class="actions">
      <button id="btn-auto" class="primary">⚡ Chargement optimal auto</button>
      <button id="btn-clear" class="ghost">🗑 Vider le coffre</button>
    </div>
  </section>`;
}

// Vue « Objets » : ajouter/retrait des articles du chantier
function renderObjets(veh, rep) {
  const loadedIds = state.grid.flat().filter(x => x != null);

  // Catalogue : l'app « connaît » le poids ET la forme de ces objets
  const catalogHtml = ITEM_CATALOG.map((t, idx) => {
    const fp = t.footprint ? `${t.footprint[0]}×${t.footprint[1]}` : (t.volume > 1 ? `${t.volume} cases` : '');
    return `
    <button class="tpl" data-tpl="${idx}">
      ${t.icon} ${esc(t.name)} <b>${t.weight} kg</b>${fp ? ` <small>▢ ${fp}</small>` : ''}<span class="plus">＋</span>
    </button>`;
  }).join('');

  const allHtml = state.items.length === 0
    ? `<p class="empty">Aucun objet. Ajoutez-en depuis le catalogue ci-dessous ou en haut.</p>`
    : state.items.map(i => {
        const loaded = loadedIds.includes(i.id);
        return `
        <div class="row ${loaded ? 'loaded' : ''}">
          <span class="row-icon">${i.icon || '📦'}</span>
          <span class="row-name">${esc(i.name)} <b>${i.weight} kg</b> ${loaded ? '· ✅ chargé' : ''}</span>
          <button class="del" data-del="${i.id}" title="Retirer">✕</button>
        </div>`;
      }).join('');

  return `
  <section class="card">
    <h2>Ajouter un objet perso (pesé)</h2>
    <form id="custom-form" class="custom">
      <input id="f-name" placeholder="Nom (ex.: Rouleau de câble)" required />
      <input id="f-weight" type="number" min="0.5" step="0.5" placeholder="Poids (kg)" required />
      <select id="f-volume" title="Encombrement au sol">
        <option value="1">Occupe 1 case</option>
        <option value="2">Occupe 2 cases</option>
        <option value="3">Occupe 3 cases</option>
        <option value="4">Occupe 4 cases</option>
      </select>
      <select id="f-shape" title="Forme de l'objet">
        <option value="auto">Forme auto (bloc)</option>
        <option value="rond">Rond / ovale (bétonnière, gaz…)</option>
        <option value="long">Long &amp; fin (barre, tuyau, pelle…)</option>
      </select>
      <button class="primary" type="submit">Ajouter</button>
    </form>
    <p class="hint">⚖️ Astuce : pesez l'objet (balance de chantier, ou pèse-personne
    en portant l'objet puis sans). L'encombrement indique combien de « cases » au sol
    il occupe (une case ≈ 45×60 cm). Choisissez la FORME : un objet rond (bétonnière,
    bouteille de gaz) laisse des coins libres où l'app glisse une pelle, une pioche
    ou une barre d'acier — tout comme dans le coffre réel !</p>
    <div id="catalog-suggest"></div>
  </section>

  <section class="card">
    <h2>Catalogue — poids connus 📖</h2>
    <div class="templates">${catalogHtml}</div>
  </section>

  <section class="card">
    <h2>Liste des objets (${state.items.length})</h2>
    ${allHtml}
  </section>`;
}

// Vue « Véhicule » : mes véhicules réels + gabarits types
function renderVehicule(veh) {
  const customCards = (state.customVehicles || []).map(v => {
    const t = VEHICLE_TYPES.find(x => x.id === v.typeId);
    return `
    <div class="veh mine ${v.id === veh.id ? 'sel' : ''}">
      <button class="veh-main" data-veh="${v.id}">
        <strong>🔑 ${esc(v.name)}</strong>
        <span>${esc(t?.name ?? 'Gabarit perso')} · Charge utile : <b>${v.payloadKg} kg</b>${v.tareKg ? ` · PV ${v.tareKg} kg / PTAC ${v.ptacKg ?? '?'} kg` : ''}</span>
      </button>
      <button class="del" data-delveh="${v.id}" title="Supprimer">✕</button>
    </div>`;
  }).join('');

  const presetCards = VEHICLE_TYPES.filter(t => t.payloadKg != null).map(t => {
    const g = t.grid;
    return `
    <button class="veh ${t.id === veh.id ? 'sel' : ''}" data-veh="${t.id}">
      <strong>${esc(t.name)}</strong>
      <span>Charge utile type : ${t.payloadKg} kg · Grille ${g.cols}×${g.rows}</span>
      ${t.note ? `<em>${esc(t.note)}</em>` : ''}
    </button>`;
  }).join('');

  return `
  <section class="card">
    <h2>Mes véhicules 🔑</h2>
    <div class="veh-list">${customCards || '<p class="empty">Aucun véhicule enregistré. Créez-le ci-dessous avec SA charge utile réelle (carte grise).</p>'}</div>
    <form id="veh-form" class="veh-form">
      <input id="v-name" placeholder="Nom (ex.: Master de l'atelier)" required />
      <select id="v-type">${VEHICLE_TYPES.map(t => `<option value="${t.id}">${esc(t.name)}${t.payloadKg ? ` (${t.payloadKg} kg)` : ''}</option>`).join('')}</select>
      <div class="field-row">
        <input id="v-ptac" type="number" min="100" step="10" placeholder="PTAC kg (case F2)" />
        <input id="v-tare" type="number" min="0" step="10" placeholder="Poids à vide kg (GHL)" />
        <input id="v-payload" type="number" min="1" step="1" placeholder="Charge utile kg (ou calc.)" />
      </div>
      <div class="field-row">
        <input id="v-w" type="number" min="40" step="5" placeholder="Largeur coffre cm" />
        <input id="v-l" type="number" min="40" step="5" placeholder="Longueur au sol cm" />
      </div>
      <button class="primary" type="submit">💾 Enregistrer ce véhicule</button>
    </form>
    <p class="hint">📄 Sur la carte grise : <b>F2</b> = PTAC, <b>GHL</b> = poids à vide.
    Charge utile = F2 − GHL. Ex. Master : 3500 − 2100 = <b>1400 kg</b>. Laissez vide
    pour garder la valeur type du gabarit.</p>
  </section>

  <section class="card">
    <h2>Gabarits types 🚐</h2>
    <div class="veh-list">${presetCards}</div>
    <p class="hint">Changer de véhicule vide le coffre (les objets restent dans la liste).</p>
  </section>

  <section class="card">
    <h2>Comment l'app sait quoi faire 💡</h2>
    <ul class="rules">
      <li>📄 <b>Charge utile</b> : c'est VOUS qui la renseignez (carte grise : PTAC − poids à vide), sinon une valeur type par gabarit.</li>
      <li>📖 <b>Poids des objets</b> : connu via le catalogue (sac de ciment = 25 kg…), ou pesé par vos soins et mémorisé dans la liste.</li>
      <li>🧱 <b>Lourd au fond</b> : les objets lourds sont placés vers le fond → centre de gravité bas et reculé raisonnablement.</li>
      <li>⚖️ <b>Gauche = Droite</b> : l'algo répartit le poids de chaque côté pour que le véhicule ne penche pas.</li>
      <li>🎯 <b>Milieu d'essieu</b> : le barycentre est maintenu proche du centre pour ne pas surcharger un essieu.</li>
      <li>🛵 <b>Moto ?</b> : grille 1 colonne → l'équilibre gauche/droite dépend du conducteur ; l'app gère avant/arrière et coupe au-delà de la charge utile.</li>
      <li>📦 <b>Maximiser</b> : on charge jusqu'à la limite ; les objets restants sont reportés sur un second trajet.</li>
    </ul>
  </section>`;
}

// Vue « Scanner 📷 » : photo → reconnaissance des formes → poids estimés
// Le scan n'est PAS obligatoire : il accélère la saisie. Chaque proposition
// reste modifiable (poids, forme, nom) avant d'aller dans l'inventaire.
function renderScan() {
  const scan = state.lastScan;
  const memCount = Object.keys(state.scanMemory || {}).length;

  const candidatesHtml = scan?.objects?.length
    ? scan.objects.map((o, idx) => {
        const sig = signatureOf(o);
        const known = state.scanMemory[sig];
        const catHit = findCatalogMatch(o.label); // ex. « Bétonnière / fût » → 70 kg
        const defW = known ? known.weight
          : catHit ? catHit.weight
          : Math.round(((o.weightRange[0] + o.weightRange[1]) / 2) * 10) / 10;
        const estW = state.scanWeights?.[idx] ?? defW;
        const conf = known ? '✅ connu'
          : catHit ? `📚 catalogue (${catHit.name})`
          : `${Math.round(o.confidence * 100)} %`;
        return `
        <div class="row cand">
          <span class="row-icon">${o.icon}</span>
          <span class="row-name">
            ${esc(o.label)} · ~${o.footprintCm.w}×${o.footprintCm.h} cm
            <b>${estW} kg</b><small> (${conf})</small>
            ${known ? '' : `<br><input class="w-adj" data-widx="${idx}" type="number" min="0.5" step="0.5"
               value="${estW}" style="width:90px" /> kg`}
          </span>
          <span class="cand-btns">
            <button class="ghost small" data-savew="${idx}" title="Mémoriser ce poids pour toutes les futures photos de ce type">💾 Poids</button>
            <button class="primary small" data-accept="${idx}">➕ Inventaire</button>
          </span>
        </div>`;
      }).join('')
    : '';

  return `
  <section class="card">
    <h2>📷 Photographier le matos au sol</h2>
    <p class="hint">Posez les objets par terre, prenez-les en photo <b>de dessus</b>
    (vue verticale). L'app découpe l'image, repère chaque silhouette, estime sa
    taille et sa forme — puis propose un poids grâce au catalogue.</p>
    <p class="hint">📏 <b>Pas besoin de règle ni de feuille A4</b> : s'il y a au
    sol un objet dont la taille est connue (sac de ciment, seau, bêche,
    bouteille d'eau…), l'app s'en sert d'étalon pour caler l'échelle en cm.</p>
    <label class="primary bigbtn">📷 Prendre une photo / choisir une image
      <input type="file" id="scan-file" accept="image/*" capture="environment" hidden />
    </label>
    <div id="scan-status"></div>
  </section>

  ${scan ? `
  <section class="card">
    <h2>Résultat du scan (${scan.objects.length} objet(s) vu(s))</h2>
    <img class="scan-preview" src="${scan.previewUrl}" alt="photo analysée" />
    <p class="hint">Échelle : ${scan.scaleSource === 'etalon'
      ? `<b>${scan.scaleRef?.icon ?? '📏'} étalon « ${scan.scaleRef?.name ?? 'objet familier'} » détecté</b> (~${scan.scaleCmPerCell} cm/case)`
      : scan.scaleSource === 'etalon-manuel' ? 'référence saisie manuellement'
      : `grossière (~${scan.scaleCmPerCell} cm/case, aucun étalon vu)`}.
      Vérifiez/corrigez les poids puis ajoutez à l'inventaire.</p>
    ${candidatesHtml || '<p class="empty">Rien reconnu — éclairage trop uniforme ?</p>'}
  </section>` : ''}

  <section class="card">
    <h2>Comment ça marche (et ses limites)</h2>
    <ul class="howto">
      <li>🔍 <b>Formes</b> : segmentation par contraste (Otsu) → silhouettes ;
          long/fin = pelle·pioche·barre·tuyau ; rond = bétonnière·gaz·fût
          (coins libres réutilisables) ; plein = sac·caisse·palette.</li>
      <li>⚖️ <b>Poids</b> : une caméra ne peut pas peser ! L'app croise la forme
          reconnue avec le <b>catalogue de poids réels</b> → estimation affichée
          avec son niveau de confiance. Vous confirmez ou corrigez une fois.</li>
      <li>🧠 <b>Mémoire par TAILLE RÉELLE</b> (${memCount} type(s) connu(s)) : la signature
          d'un objet combine sa forme ET son encombrement en cm — pas les pixels.
          Une bétonnière revue sous la pluie reprend son poids ; mais des bouteilles
          de 0,5 L après avoir scanné du 1,5 L ont une taille différente ⇒ l'app
          redemande le poids (une fois), elle ne réutilise jamais l'ancien.</li>
      <li>💾 <b>Bouton « Poids »</b> : mémorise le poids sans charger l'objet — utile
          pour enregistrer vos contenances habituelles (1,5 L, 0,5 L…) d'avance.</li>
      <li>📴 100 % local : aucune photo ne quitte le téléphone.</li>
    </ul>
  </section>`;
}

// ── Événements ───────────────────────────────────────────────────────────────
function bindEvents(veh, rep) {
  app.querySelectorAll('[data-tab]').forEach(b =>
    b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

  // Sélection d'un objet en attente
  app.querySelectorAll('[data-item]').forEach(b =>
    b.addEventListener('click', () => {
      state.selectedItemId = Number(b.dataset.item);
      render();
    }));

  // Toucher une case de la grille
  app.querySelectorAll('.cell').forEach(cell =>
    cell.addEventListener('click', () => {
      const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
      const id = state.grid[r][c];
      if (id != null) {
        // déposer l'objet ailleurs : on le retire puis on replace si un objet sélectionné
        if (state.selectedItemId && state.selectedItemId !== id) {
          state.grid = removeItem(state.grid, id);
        } else {
          state.grid = removeItem(state.grid, id);
          persist();
          toast('Objet retiré du coffre', 'var(--orange)');
          render();
          return;
        }
      }
      const check = canPlace(state, r, c);
      if (!check.ok) { toast(check.reason, 'var(--red)'); return; }
      const selIt = state.items.find(i => i.id === state.selectedItemId);
      state.grid = placeItem(state.grid, state.selectedItemId, r, c,
        selIt, state.grid[0].length, state.grid.length);
      const it = selIt;
      state.selectedItemId = null;
      persist();
      afterChange(`✅ ${it?.name ?? 'Objet'} placé : ${colLabel(state.grid[0].length, c)} · ${rowLabel(state.grid.length, r)}`);
    }));

  const btnAuto = $('#btn-auto');
  if (btnAuto) btnAuto.addEventListener('click', () => {
    const pend = pendingItems();
    if (pend.length === 0) { toast('Aucun objet en attente', 'var(--orange)'); return; }
    const res = autoLoad(pend, veh, { cols: state.grid[0].length, rows: state.grid.length });
    // fusionne avec ce qui est déjà en place
    const merged = state.grid.map(row => row.slice());
    for (let r = 0; r < merged.length; r++) for (let c = 0; c < merged[r].length; c++) {
      if (merged[r][c] == null && res.grid[r][c] != null) merged[r][c] = res.grid[r][c];
    }
    state.grid = merged;
    state.selectedItemId = null;
    persist();
    afterChange(res.skipped.length
      ? `⚡ ${res.placed.length} objet(s) placé(s) — ${res.skipped.length} non chargable(s) (poids/place)`
      : `⚡ ${res.placed.length} objet(s) placé(s) — coffre équilibré !`,
      res.skipped.length ? 'var(--orange)' : 'var(--green)');
  });

  const btnClear = $('#btn-clear');
  if (btnClear) btnClear.addEventListener('click', () => {
    state.grid = makeGrid(state.grid[0].length, state.grid.length);
    persist();
    toast('Coffre vidé', 'var(--orange)');
    render();
  });

  // Catalogue — poids ET formes connus
  app.querySelectorAll('[data-tpl]').forEach(b =>
    b.addEventListener('click', () => {
      const t = ITEM_CATALOG[Number(b.dataset.tpl)];
      addItem(t.name, t.weight, t.icon, t.volume ?? 1, t.footprint ?? null, t.shape ?? null);
    }));

  const form = $('#custom-form');
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const w = parseFloat($('#f-weight').value);
    const vol = parseInt($('#f-volume')?.value, 10) || 1;
    const shapeSel = $('#f-shape')?.value || 'auto';
    if (!name || !(w > 0)) { toast('Nom et poids valides requis', 'var(--red)'); return; }
    // si l'utilisateur a accepté une suggestion du catalogue → forme exacte du catalogue
    if (pendingCatalogPick && Math.abs((pendingCatalogPick.weight ?? -1) - w) < 0.01) {
      const p = pendingCatalogPick;
      pendingCatalogPick = null;
      addItem(name, w, '📦', p.volume ?? 1, p.footprint, p.shape);
      return;
    }
    pendingCatalogPick = null;
    // forme choisie par l'utilisateur → masque de cases (coins libres inclus)
    let shape = null;
    if (shapeSel === 'rond') shape = vol >= 4 ? SHAPES.rond4 : SHAPES.rond3;
    else if (shapeSel === 'long') shape = SHAPES.long;
    addItem(name, w, '📦', shape ? null : vol, null, shape);
  });

  // Suggestions de poids/forme depuis le catalogue pendant la saisie du nom
  const fName = $('#f-name');
  if (fName) fName.addEventListener('input', () => {
    const box = $('#catalog-suggest');
    const m = findCatalogMatch(fName.value);
    if (m && !$('#f-weight').value) {
      const fp = m.shape ? ' · forme spéciale (coins exploitables)'
               : m.footprint ? ` · occupe ${m.footprint[0]}×${m.footprint[1]} cases` : '';
      box.innerHTML = `<button class="suggest" id="btn-suggest">
        📖 « ${esc(m.name)} » est au catalogue : <b>${m.weight} kg</b>${fp} — reprendre ces valeurs ?</button>`;
      $('#btn-suggest').addEventListener('click', () => {
        // reprendre poids + encombrement + FORME réels du catalogue
        pendingCatalogPick = { weight: m.weight, volume: m.volume ?? null,
                               footprint: m.footprint ?? null, shape: m.shape ?? null };
        $('#f-weight').value = m.weight;
        if ($('#f-volume') && m.volume != null) $('#f-volume').value = m.volume;
        box.innerHTML = '';
      });
    } else box.innerHTML = '';
  });

  app.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => {
      const id = Number(b.dataset.del);
      state.grid = removeItem(state.grid, id);
      state.items = state.items.filter(i => i.id !== id);
      if (state.selectedItemId === id) state.selectedItemId = null;
      persist();
      render();
    }));

  // Choix d'un véhicule (mes véhicules ou gabarit type)
  app.querySelectorAll('[data-veh]').forEach(b =>
    b.addEventListener('click', () => {
      state.vehicleId = b.dataset.veh;
      const v = resolveVehicle(state);
      state.grid = makeGrid(v.grid.cols, v.grid.rows);
      state.selectedItemId = null;
      persist();

      toast(`Véhicule : ${v.name} (${v.payloadKg} kg max)`, 'var(--blue)');
      render();
    }));

  // Créer un véhicule réel
  const vehForm = $('#veh-form');
  if (vehForm) vehForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#v-name').value.trim();
    if (!name) { toast('Donnez un nom au véhicule', 'var(--red)'); return; }
    const typeId = $('#v-type').value;
    const base = VEHICLE_TYPES.find(t => t.id === typeId);
    const ptac = parseFloat($('#v-ptac').value) || null;
    const tare = parseFloat($('#v-tare').value) || null;
    let payload = parseFloat($('#v-payload').value) || null;
    if (payload == null && ptac != null && tare != null) payload = Math.max(1, ptac - tare);
    if (payload == null) payload = base?.payloadKg ?? null;
    if (!(payload > 0)) { toast('Renseignez PTAC − poids à vide, ou la charge utile', 'var(--red)'); return; }

    const w = parseFloat($('#v-w').value) || null;
    const l = parseFloat($('#v-l').value) || null;
    const dims = (w && l) ? { widthCm: w, lengthCm: l } : null;

    const veh = {
      id: 'veh-' + Date.now(),
      name, typeId, payloadKg: payload, ptacKg: ptac, tareKg: tare,
      dims, grid: dims ? gridFromDims(dims) : (base?.grid ?? DEFAULT_GRID),
    };
    state.customVehicles.push(veh);
    state.vehicleId = veh.id;
    state.grid = makeGrid(veh.grid.cols, veh.grid.rows);
    state.selectedItemId = null;
    persist();
    toast(`🔑 ${name} enregistré — charge utile ${payload} kg`, 'var(--green)');
    tab = 'charger';
    render();
  });

  // Supprimer un de mes véhicules
  app.querySelectorAll('[data-delveh]').forEach(b =>
    b.addEventListener('click', () => {
      const id = b.dataset.delveh;
      state.customVehicles = state.customVehicles.filter(v => v.id !== id);
      if (state.vehicleId === id) {
        const fallback = VEHICLE_TYPES.find(t => t.id === 'fourgon');
        state.vehicleId = fallback.id;
        state.grid = makeGrid(fallback.grid.cols, fallback.grid.rows);
      }
      persist();
      toast('Véhicule supprimé', 'var(--orange)');
      render();
    }));

  // ── 📷 Scan photo ──────────────────────────────────────────────────────────
  const scanFile = $('#scan-file');
  if (scanFile) scanFile.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = $('#scan-status');
    status.innerHTML = '<p class="hint">⏳ Analyse de l’image…</p>';
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const res = scanImageEl(img);
        // mémoire locale : silhouettes déjà validées → poids repris direct
        res.objects = matchMemory(res.objects, state.scanMemory);
        state.lastScan = {
          objects: res.objects, previewUrl: res.previewUrl,
          scaleCmPerCell: res.scaleCmPerCell, scaleSource: res.scaleSource,
          scaleRef: res.scaleRef ?? null,
        };
        state.scanWeights = {};   // nouvelles photos → nouvelles saisies
        persist();
        render();
        if (!res.objects.length) toast('Aucune silhouette nette — éclairage/angle ?', 'var(--orange)');
        else toast(`👁️ ${res.objects.length} objet(s) reconnu(s) — vérifiez les poids`, 'var(--blue)');
      } catch {
        status.innerHTML = '<p class="hint" style="color:var(--red)">❌ Impossible d’analyser cette image.</p>';
      } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { status.innerHTML = '<p class="hint" style="color:var(--red)">❌ Image illisible.</p>'; URL.revokeObjectURL(url); };
    img.src = url;
    scanFile.value = '';
  });

  // Édition des poids proposés : conservée entre les re-rendus
  app.querySelectorAll('[data-widx]').forEach(inp =>
    inp.addEventListener('input', () => {
      state.scanWeights[inp.dataset.widx] = parseFloat(inp.value) || 0;
    }));

  // 💾 Mémoriser le poids d'un type de silhouette SANS l'ajouter à l'inventaire
  app.querySelectorAll('[data-savew]').forEach(b =>
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.savew);
      const o = state.lastScan?.objects?.[idx];
      if (!o) return;
      const wInput = app.querySelector(`[data-widx="${idx}"]`);
      const weight = wInput ? (parseFloat(wInput.value) || 0) : 0;
      if (weight <= 0) { toast('Indiquez d\'abord un poids', 'var(--orange)'); return; }
      const cat = findCatalogMatch(o.label);
      state.scanMemory[signatureOf(o)] = { weight, name: cat ? cat.name : o.label };
      persist();
      toast(`💾 ${weight} kg mémorisé pour « ${cat ? cat.name : o.label} »`, 'var(--blue)');
      render();
    }));

  // Accepter un objet reconnu → inventaire (+ poids mémorisé pour ce type)
  app.querySelectorAll('[data-accept]').forEach(b =>
    b.addEventListener('click', () => {
      const o = state.lastScan?.objects?.[Number(b.dataset.accept)];
      if (!o) return;
      const wInput = app.querySelector(`[data-widx="${b.dataset.accept}"]`);
      const weight = wInput ? (parseFloat(wInput.value) || o.weightRange[1]) : o.weight;
      // forme au sol déduite de la reconnaissance
      let shape = null, volume = Math.max(1, o.volCells), footprint = null;
      if (o.shapeHint === 'rond') shape = o.volCells >= 4 ? SHAPES.rond4 : SHAPES.rond3;
      else if (o.shapeHint === 'long') shape = SHAPES.long;
      else if (o.shapeHint === 'bloc' && o.volCells >= 2) {
        const fp = footprintFor({ volume: o.volCells }, 3, 5); footprint = fp;
      }
      // nom : meilleur match catalogue (poids connu réutilisé), sinon libellé vu
      const cat = findCatalogMatch(o.label);
      const name = cat ? cat.name : o.label;
      addItem(name, weight, o.icon, shape ? null : volume, footprint, shape);
      // 🧠 mémorise sous la signature « forme + taille réelle » : la prochaine
      // photo d'un objet de MÊME gabarit reprendra ce poids — mais PAS un objet
      // plus petit/pus grand (ex. bouteille 0,5 L ≠ 1,5 L : autre palier).
      state.scanMemory[signatureOf(o)] = { weight, name };
      persist();
    }));
}

function addItem(name, weight, icon, volume = 1, footprint = null, shape = null) {
  state.items.push({ id: state.nextId++, name, weight, icon, volume, footprint, shape });
  persist();
  toast(`➕ ${name} ajouté`, 'var(--blue)');
  render();
}

// Après un changement de placement : on vérifie l'équilibre et on prévient
function afterChange(msg) {
  const rep = analyze(state.grid, state.items, currentVehicle(state));
  render();
  if (rep.overPayload) toast('⚠️ SURCHARGE : retirez des objets !', 'var(--red)');
  else if (rep.leftRightPct > 30) toast(msg + ' — ⚠️ attention, ça penche !', 'var(--orange)');
  else toast(msg);
}

render();
