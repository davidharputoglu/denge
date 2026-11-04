// Modèle de données : catégories de véhicules avec "poids d'encombrement"
// (facteur d'occupation de l'espace du parking)
export const CATEGORIES = {
  moto:        { label: 'Moto / Scooter', icon: '🏍️', factor: 0.5 },
  voiture:     { label: 'Voiture',        icon: '🚗', factor: 1.0 },
  suv:         { label: 'SUV / 4x4',      icon: '🚙', factor: 1.3 },
  van:         { label: 'Fourgonnette',   icon: '🚐', factor: 1.6 },
  camionnette: { label: 'Camionnette',    icon: '🛻', factor: 2.0 },
  bus:         { label: 'Bus / Minibus',  icon: '🚌', factor: 3.0 },
  camion:      { label: 'Camion',         icon: '🚛', factor: 4.0 },
};

// Zones de parking configurables
export function defaultZones() {
  return [
    { id: 'A', name: 'Zone A — Extérieur', capacity: 20 },
    { id: 'B', name: 'Zone B — Sous-sol 1', capacity: 15 },
    { id: 'C', name: 'Zone C — Sous-sol 2', capacity: 10 },
  ];
}

let _id = 1;
export function newId() {
  return `${Date.now().toString(36)}-${(_id++).toString(36)}`;
}

export function loadState() {
  try {
    const raw = localStorage.getItem('parking-state-v1');
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

export function saveState(state) {
  localStorage.setItem('parking-state-v1', JSON.stringify(state));
}

export function initialState() {
  return { vehicles: [], zones: defaultZones() };
}
