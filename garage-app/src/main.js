import './style.css';
import { CATEGORIES, loadState, saveState, initialState, newId } from './data.js';
import { zoneLoad, occupancyRate, categoryStats, balanceVehicles } from './balance.js';

let state = loadState() ?? initialState();
let tab = 'zones';

const app = document.getElementById('app');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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

// ── Rendu ──────────────────────────────────────────────────────────────────
function render() {
  app.innerHTML = `
    <header>
      <h1>🅿️ Parking Pro</h1>
      <p>Ranger et équilibrer vos véhicules</p>
    </header>
    <main>${tab === 'zones' ? viewZones() : tab === 'add' ? viewAdd() : viewStats()}</main>
    <nav class="tabs">
      ${['zones', 'add', 'stats'].map(t => `
        <button data-tab="${t}" class="${t === tab ? 'active' : ''}">
          <span class="tab-icon">${t === 'zones' ? '🗺️' : t === 'add' ? '➕' : '📊'}</span>
          ${t === 'zones' ? 'Places' : t === 'add' ? 'Ajouter' : 'Statistiques'}
        </button>`).join('')}
    </nav>`;
  bind();
}

function viewZones() {
  const totalCap = state.zones.reduce((a, z) => a + z.capacity, 0);
  const totalLoad = state.zones.reduce((a, z) => a + zoneLoad(z.id, state.vehicles), 0);
  const pctAll = totalCap ? Math.round((totalLoad / totalCap) * 100) : 0;

  const zonesHtml = state.zones.map(z => {
    const load = zoneLoad(z.id, state.vehicles);
    const rate = occupancyRate(z, state.vehicles);
    const cls = rate >= 1 ? 'full' : rate >= 0.75 ? 'warn' : 'ok';
    const color = rate >= 1 ? 'var(--red)' : rate >= 0.75 ? 'var(--amber)' : 'var(--green)';
    const vlist = state.vehicles
      .filter(v => v.zoneId === z.id)
      .map(v => `
        <div class="vehicle-row">
          <span class="icon">${CATEGORIES[v.category]?.icon ?? '🚗'}</span>
          <div class="info">
            <div class="plate">${esc(v.plate)}</div>
            <div class="meta">${CATEGORIES[v.category]?.label ?? v.category}${v.note ? ' · ' + esc(v.note) : ''}</div>
          </div>
          <select data-move="${v.id}" style="width:auto;padding:6px;font-size:.78rem">
            ${state.zones.map(zz => `<option value="${zz.id}" ${zz.id === z.id ? 'selected' : ''}>${zz.id}</option>`).join('')}
          </select>
          <button class="mini-btn del" data-del="${v.id}">✕</button>
        </div>`).join('');

    return `
      <div class="zone ${cls}">
        <div class="zone-head">
          <strong>${esc(z.name)}</strong>
          <span class="badge">${load.toFixed(1)} / ${z.capacity} (${Math.round(rate * 100)}%)</span>
        </div>
        <div class="bar"><div style="width:${Math.min(rate * 100, 100)}%;background:${color}"></div></div>
        ${vlist || '<div class="empty">Aucun véhicule ici</div>'}
      </div>`;
  }).join('');

  return `
    <div class="card">
      <h2>Vue d'ensemble</h2>
      <div class="stats">
        <div class="stat"><b>${state.vehicles.length}</b><span>Véhicules</span></div>
        <div class="stat"><b>${totalLoad.toFixed(1)}</b><span>Charge totale</span></div>
        <div class="stat"><b>${pctAll}%</b><span>Occupation</span></div>
      </div>
      <button id="btn-balance">⚖️ Équilibrer automatiquement les zones</button>
    </div>
    <div class="card"><h2>Zones de stationnement</h2>${zonesHtml}</div>`;
}

function viewAdd() {
  return `
    <div class="card">
      <h2>➕ Enregistrer un véhicule</h2>
      <form id="form-add">
        <label>Immatriculation *</label>
        <input name="plate" required placeholder="Ex : AB-123-CD" autocomplete="off" />
        <div class="grid2" style="margin-top:10px">
          <div>
            <label>Catégorie</label>
            <select name="category">
              ${Object.entries(CATEGORIES).map(([k, c]) =>
                `<option value="${k}">${c.icon} ${c.label} (×${c.factor})</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Zone</label>
            <select name="zoneId">
              ${state.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px">
          <label>Note (optionnel)</label>
          <input name="note" placeholder="Ex : Client VIP, à sortir en premier…" autocomplete="off" />
        </div>
        <button type="submit">Enregistrer le véhicule</button>
      </form>
    </div>
    <div class="card">
      <h2>Configurer les zones</h2>
      ${state.zones.map(z => `
        <div class="vehicle-row">
          <div class="info"><div class="plate">${esc(z.name)}</div></div>
          <input data-cap="${z.id}" type="number" min="1" value="${z.capacity}" style="width:80px;padding:6px" />
        </div>`).join('')}
      <button class="secondary" id="btn-save-zones">💾 Sauvegarder les capacités</button>
    </div>`;
}

function viewStats() {
  const stats = categoryStats(state.vehicles);
  const rows = Object.entries(CATEGORIES).map(([k, c]) => {
    const n = stats[k] || 0;
    const pct = state.vehicles.length ? Math.round((n / state.vehicles.length) * 100) : 0;
    return `
      <div class="vehicle-row">
        <span class="icon">${c.icon}</span>
        <div class="info">
          <div class="plate">${c.label}</div>
          <div class="bar" style="margin-top:4px"><div style="width:${pct}%;background:var(--accent)"></div></div>
        </div>
        <span class="badge">${n}</span>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <h2>📊 Répartition par catégorie</h2>
      ${state.vehicles.length ? rows : '<div class="empty">Aucun véhicule enregistré</div>'}
    </div>
    <div class="card">
      <h2>Chargement par zone</h2>
      ${state.zones.map(z => {
        const load = zoneLoad(z.id, state.vehicles);
        const rate = occupancyRate(z, state.vehicles);
        return `<div class="zone ${rate >= 1 ? 'full' : rate >= .75 ? 'warn' : 'ok'}">
          <div class="zone-head"><strong>${esc(z.name)}</strong><span class="badge">${Math.round(rate * 100)}%</span></div>
          <div class="bar"><div style="width:${Math.min(rate * 100, 100)}%;background:${rate >= 1 ? 'var(--red)' : rate >= .75 ? 'var(--amber)' : 'var(--green)'}"></div></div>
        </div>`;
      }).join('')}
      <button class="danger" id="btn-clear">🗑️ Tout réinitialiser</button>
    </div>`;
}

// ── Événements ─────────────────────────────────────────────────────────────
function bind() {
  app.querySelectorAll('[data-tab]').forEach(b =>
    b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

  // Déplacer un véhicule entre zones
  app.querySelectorAll('[data-move]').forEach(sel =>
    sel.addEventListener('change', () => {
      const v = state.vehicles.find(x => x.id === sel.dataset.move);
      if (v) { v.zoneId = sel.value; persist(); render(); toast(`📍 ${v.plate} → Zone ${sel.value}`); }
    }));

  // Supprimer
  app.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => {
      state.vehicles = state.vehicles.filter(x => x.id !== btn.dataset.del);
      persist(); render(); toast('❌ Véhicule retiré', 'var(--red)');
    }));

  // Formulaire d'ajout
  const form = app.querySelector('#form-add');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const plate = String(fd.get('plate')).trim().toUpperCase();
    if (!plate) return;
    state.vehicles.push({
      id: newId(), plate,
      category: fd.get('category'),
      zoneId: fd.get('zoneId'),
      note: String(fd.get('note') ?? '').trim(),
      addedAt: Date.now(),
    });
    persist(); tab = 'zones'; render(); toast(`✅ ${plate} garé !`);
  });

  // Sauvegarde des capacités de zones
  app.querySelector('#btn-save-zones')?.addEventListener('click', () => {
    app.querySelectorAll('[data-cap]').forEach(inp => {
      const z = state.zones.find(x => x.id === inp.dataset.cap);
      if (z) z.capacity = Math.max(1, parseInt(inp.value) || z.capacity);
    });
    persist(); render(); toast('💾 Capacités enregistrées');
  });

  // Équilibrage automatique
  app.querySelector('#btn-balance')?.addEventListener('click', () => {
    const { moves, updated, balanced } = balanceVehicles(state.zones, state.vehicles);
    if (balanced) { toast('⚖️ Déjà équilibré, rien à faire !'); return; }
    state.vehicles = updated;
    persist(); render();
    toast(`⚖️ ${moves.length} véhicule${moves.length > 1 ? 's' : ''} repositionné${moves.length > 1 ? 's' : ''}`);
  });

  // Réinitialisation
  app.querySelector('#btn-clear')?.addEventListener('click', () => {
    if (confirm('Supprimer tous les véhicules ?')) {
      state = initialState(); persist(); render(); toast('🗑️ Réinitialisé', 'var(--red)');
    }
  });
}

render();
