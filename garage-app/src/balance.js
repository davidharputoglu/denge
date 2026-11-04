import { CATEGORIES } from './data.js';

// Occupation pondérée d'une zone (somme des facteurs d'encombrement)
export function zoneLoad(zoneId, vehicles) {
  return vehicles
    .filter(v => v.zoneId === zoneId)
    .reduce((s, v) => s + (CATEGORIES[v.category]?.factor ?? 1), 0);
}

// Statistiques globales par catégorie
export function categoryStats(vehicles) {
  const stats = {};
  for (const v of vehicles) {
    stats[v.category] = (stats[v.category] || 0) + 1;
  }
  return stats;
}

// Taux d'occupation d'une zone (0..1+)
export function occupancyRate(zone, vehicles) {
  return zone.capacity > 0 ? zoneLoad(zone.id, vehicles) / zone.capacity : 0;
}

// ── Équilibrage intelligent ────────────────────────────────────────────────
// Algorithme LPT (Longest Processing Time) sur charge normée : équilibrage
// optimal par zone selon la capacité, sans jamais saturer une zone si c'est
// évitable. Déterministe et idempotent (relancer ne déplace plus rien).
export function balanceVehicles(zones, vehicles) {
  const totalCap = zones.reduce((a, z) => a + z.capacity, 0);
  if (totalCap === 0 || vehicles.length === 0) {
    return { moves: [], updated: vehicles, balanced: true };
  }

  const moves = [];

  // Algorithme LPT (Longest Processing Time) sur charge "normée" :
  // on trie tous les véhicules du plus encombrant au plus petit et l'on place
  // chacun dans la zone dont la charge relative (charge / capacité) est la
  // plus faible. Résultat équilibré AU MIEU, déterministe et idempotent
  // (re-lancer l'équilibrage ne déplace plus rien).
  const sortedVeh = [...vehicles].sort(
    (a, b) => (CATEGORIES[b.category]?.factor ?? 1) - (CATEGORIES[a.category]?.factor ?? 1)
  );

  const assign = {}; // vehicleId -> zoneId
  const norm = {};   // charge normalisée par zone (facteur / capacité)
  zones.forEach(z => (norm[z.id] = 0));

  for (const veh of sortedVeh) {
    const f = CATEGORIES[veh.category]?.factor ?? 1;
    // Zones candidates non saturées, triées par charge relative croissante
    const cand = zones
      .filter(z => norm[z.id] + f / z.capacity <= 1 + 1e-9)
      .sort((a, b) => (norm[a.id] - norm[b.id]) || (b.capacity - a.capacity));
    const dst = cand[0] ??
      zones.slice().sort((a, b) => (norm[a.id] - norm[b.id]))[0]; // parking complet → moindre charge
    norm[dst.id] += f / dst.capacity;
    assign[veh.id] = dst.id;
  }

  for (const v of vehicles) {
    if (assign[v.id] !== v.zoneId) {
      moves.push({ vehicleId: v.id, plate: v.plate, from: v.zoneId, to: assign[v.id] });
    }
  }

  // Appliquer les mouvements sur une copie des véhicules
  const updated = vehicles.map(v => {
    const m = moves.find(mm => mm.vehicleId === v.id);
    return m ? { ...v, zoneId: m.to } : v;
  });

  return { moves, updated, balanced: moves.length === 0 };
}
