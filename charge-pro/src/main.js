import './style.css';
import {
  VEHICLES, ITEM_TEMPLATES, initialState, loadState, saveState, currentVehicle,
  makeGrid, analyze, autoLoad, canPlace, placeItem, removeItem,
  colLabel, rowLabel, weightOf,
} from './engine.js';

let state = loadState() ?? initialState();
let tab = 'charger'; // charger | objets | véhicule

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
      <h1>🚚 Charge Pro</h1>
      <p>Charger au maximum — sans faire pencher le véhicule</p>
    </header>

    ${renderBalanceBar(report)}

    <main>${tab === 'charger' ? renderCharger(veh, report)
        : tab === 'objets' ? renderObjets(veh, report)
        : renderVehicule(veh)}</main>

    <nav class="tabbar">
      <button data-tab="charger" class="${tab === 'charger' ? 'active' : ''}">📦<span>Charger</span></button>
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
    const res = autoLoad([...pendingItems()], veh, { cols, rows });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (res.grid[r][c] === selected.id) adviceCell = { r, c };
    }
  }

  let cellsHtml = '';
  for (let r = 0; r < rows; r++) {
    cellsHtml += `<div class="grid-row">`;
    for (let c = 0; c < cols; c++) {
      const id = grid[r][c];
      const it = id != null ? byId[id] : null;
      const isAdvice = adviceCell && adviceCell.r === r && adviceCell.c === c;
      cellsHtml += `
        <button class="cell ${it ? 'occupied' : 'free'} ${isAdvice ? 'advice' : ''}"
                data-r="${r}" data-c="${c}" title="${esc(colLabel(cols, c))} · ${esc(rowLabel(rows, r))}">
          ${it ? `<span class="cell-icon">${it.icon || '📦'}</span><span class="cell-kg">${it.weight}kg</span>`
               : isAdvice ? '<span class="advice-tag">ICI ✅</span>' : '<span class="dot"></span>'}
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
  const templatesHtml = ITEM_TEMPLATES.map((t, idx) => `
    <button class="tpl" data-tpl="${idx}">
      ${t.icon} ${esc(t.name)} <b>${t.weight} kg</b><span class="plus">＋</span>
    </button>`).join('');

  const allHtml = state.items.length === 0
    ? `<p class="empty">Aucun objet. Ajoutez-en avec les modèles ci-dessus ou en haut.</p>`
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
    <h2>Ajouter un objet</h2>
    <form id="custom-form" class="custom">
      <input id="f-name" placeholder="Nom (ex.: Rouleau de câble)" required />
      <input id="f-weight" type="number" min="0.5" step="0.5" placeholder="Poids (kg)" required />
      <button class="primary" type="submit">Ajouter</button>
    </form>
    <div class="templates">${templatesHtml}</div>
  </section>

  <section class="card">
    <h2>Liste des objets (${state.items.length})</h2>
    ${allHtml}
  </section>`;
}

// Vue « Véhicule »
function renderVehicule(veh) {
  const cards = VEHICLES.map(v => `
    <button class="veh ${v.id === veh.id ? 'sel' : ''}" data-veh="${v.id}">
      <strong>${esc(v.name)}</strong>
      <span>Charge utile : ${v.payloadKg} kg · Coffre ${v.grid.cols}×${v.grid.rows}</span>
    </button>`).join('');

  return `
  <section class="card">
    <h2>Choisir le véhicule</h2>
    <div class="veh-list">${cards}</div>
    <p class="hint">Changer de véhicule vide le coffre (les objets restent dans la liste).</p>
  </section>

  <section class="card">
    <h2>Règles appliquées par l'app 💡</h2>
    <ul class="rules">
      <li>🧱 <b>Lourd au fond</b> : les objets lourds sont placés près du hayon/rond-point bas → centre de gravité descendu.</li>
      <li>⚖️ <b>Gauche = Droite</b> : l'algo répartit le poids de chaque côté pour que le véhicule ne penche pas.</li>
      <li>🎯 <b>Milieu d'essieu</b> : le barycentre est maintenu proche du centre pour ne pas surcharger un essieu.</li>
      <li>📦 <b>Maximiser</b> : on charge jusqu'à la limite de la charge utile ; les objets restants sont reportés.</li>
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
      state.grid = placeItem(state.grid, state.selectedItemId, r, c);
      const it = state.items.find(i => i.id === state.selectedItemId);
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

  // Modèles d'objets
  app.querySelectorAll('[data-tpl]').forEach(b =>
    b.addEventListener('click', () => {
      const t = ITEM_TEMPLATES[Number(b.dataset.tpl)];
      addItem(t.name, t.weight, t.icon);
    }));

  const form = $('#custom-form');
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const w = parseFloat($('#f-weight').value);
    if (!name || !(w > 0)) { toast('Nom et poids valides requis', 'var(--red)'); return; }
    addItem(name, w, '📦');
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

  // Choix du véhicule
  app.querySelectorAll('[data-veh]').forEach(b =>
    b.addEventListener('click', () => {
      const v = VEHICLES.find(x => x.id === b.dataset.veh);
      state.vehicleId = v.id;
      state.grid = makeGrid(v.grid.cols, v.grid.rows);
      state.selectedItemId = null;
      persist();
      toast(`Véhicule : ${v.name}`, 'var(--blue)');
      render();
    }));
}

function addItem(name, weight, icon) {
  state.items.push({ id: state.nextId++, name, weight, icon });
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
