# 🅿️ Parking Pro — Application Android de gestion de parking

Application mobile (PWA → APK Android) pour **ranger et équilibrer les véhicules**
dans différentes zones de stationnement.

## ✨ Fonctionnalités
- ➕ **Enregistrer des véhicules** : immatriculation, catégorie (moto → camion),
  zone, notes. Chaque catégorie a un *facteur d'encombrement* (moto ×0.5 … camion ×4).
- 🗺️ **Vue des zones** avec jauges d'occupation colorées (vert / orange / rouge).
- ⚖️ **Équilibrage automatique** : algorithme LPT qui répartit optimalement la
  charge pondérée entre les zones selon leur capacité, sans jamais en saturer une
  si c'est évitable. Déterministe et idempotent.
- 📱 Déplacement manuel d'un véhicule entre zones, suppression, réglage des capacités.
- 📊 Statistiques : répartition par catégorie, taux d'occupation par zone.
- 💾 Sauvegarde locale (fonctionne **hors ligne**), interface sombre adaptée mobile.

## 🚀 Lancer en développement
```bash
cd garage-app
npm install
npm run dev        # http://localhost:5173 — ouvrir sur le téléphone via Chrome
```

## 📦 Construire l'APK Android
L'app est une **PWA** (Progressive Web App). Deux options :

### Option 1 — Bubblewrap (recommandée, APK natif "TWA")
```bash
npm run build                          # génère dist/
npx @bubblewrap/cli init --manifest https://VOTRE-URL/manifest.webmanifest
npx @bubblewrap/cli build              # produit app-release-signed.apk
```
*(Il faut héberger `dist/` en HTTPS, ex. Netlify / Vercel, gratuits.)*

### Option 2 — Capacitor (application complète, store-ready)
```bash
npm i @capacitor/core @capacitor/cli && npx cap init
npm run build && npx cap add android && npx cap sync && npx cap open android
```
Puis « Build > Build APK(s) » dans Android Studio.

## 📁 Structure
```
garage-app/
├── index.html            Point d'entrée
├── vite.config.js        Config Vite + PWA (manifest, service worker)
├── public/icon-*.png     Icônes de l'app
└── src/
    ├── main.js           UI (onglets Places / Ajouter / Stats)
    ├── data.js           Catégories, zones, persistance localStorage
    ├── balance.js        Algorithme d'équilibrage + statistiques
    └── style.css         Thème sombre mobile-first
```
