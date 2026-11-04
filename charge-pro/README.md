# 🚚 Charge Pro — Chargement équilibré des véhicules de chantier

Application mobile (PWA installable sur Android) qui dit **où placer chaque objet** dans le coffre
d'une camionnette / fourgon / pick-up pour :

1. **Charger un maximum** (jusqu'à la charge utile, sans jamais la dépasser) ;
2. **Équilibrer le véhicule** pour qu'il **ne penche pas d'un côté** (gauche/droite),
   ne soit pas déséquilibré avant/arrière (essieu), et garde un centre de gravité bas
   (objets lourds au fond).

## ✨ Fonctionnalités

- **Vue du coffre vue de dessus** (grille Gauche/Centre/Droite × Avant/Milieu/Arrière) :
  touchez une case pour y déposer l'objet sélectionné.
- **⚡ Chargement optimal automatique** : algorithme glouton (tri par poids décroissant +
  minimisation du coût d'équilibre à chaque placement) qui place tous les objets correctement.
- **Conseil intelligent** : quand vous sélectionnez un objet, la meilleure case est
  surlignée « ICI ✅ ».
- **Jauge d'équilibre en temps réel** : score /100, % gauche/droite, % avant/arrière,
  statut coloré (`Équilibré ✓`, `Déséquilibré`, `Penche d'un côté ⚠️`, `SURCHARGE !`).
- **Catalogue d'objets de chantier** (ciment, OSB, groupe électrogène, big-bag…) + ajout manuel
  (nom + poids).
- **Plusieurs véhicules** : fourgon 1000 kg, utilitaire 800 kg, pick-up 600 kg, plateau 1500 kg
  (chacun avec sa grille de coffre).
- **Hors-ligne** : sauvegarde locale (localStorage) + service worker (l'app fonctionne sans réseau).

## 🧮 Comment ça marche ?

Pour chaque objet (du plus lourd au plus léger), l'app essaie toutes les cases libres et garde
celle qui minimise ce coût :

| Critère | Effet |
|---|---|
| Écart du barycentre gauche/droite au centre | empêche le véhicule de **pencher** |
| Écart du barycentre avant/arrière au milieu | protège l'**essieu** |
| Position des charges lourdes vers le fond | **centre de gravité bas** = stabilité |
| Rapprochement de l'allée centrale | bon sens de chargement |

La charge est stoppée dès qu'un objet dépasserait la charge utile ou qu'il n'y a plus de case :
les objets restants sont listés comme « non chargés » (à prendre dans un second trajet).

## 📱 Installation sur Android

### Option A — PWA (immédiate)
```bash
npm install
npm run dev        # puis ouvrez l'URL affichée dans Chrome sur le téléphone
```
Dans Chrome : menu ⋮ → **« Ajouter à l'écran d'accueil »** → l'app se lance plein écran, hors ligne.

### Option B — Vrai APK via Bubblewrap (recommandé pour le Play Store)
```bash
npm run build
# hébergez dist/ en HTTPS (Netlify/Vercel gratuit), puis :
npx @bubblewrap/cli init --manifest https://votre-site/manifest.webmanifest
npx @bubblewrap/cli build          # génère app-release.apk
```

### Option C — Capacitor (projet Android Studio natif)
```bash
npm i @capacitor/core @capacitor/cli && npx cap init
npx cap add android && npx cap copy && npx cap open android
```

## ✅ Tests

```bash
npm test    # 8 tests : équilibre, charge max, surcharge détectée, cases pleines, multi-véhicules
```

## 📁 Structure

```
charge-pro/
├── index.html            point d'entrée (+ enregistrement du service worker)
├── vite.config.js        config PWA (manifest, icônes, offline)
├── src/
│   ├── engine.js         cœur métier : grille, analyse d'équilibre, autoLoad, véhicules
│   ├── main.js           interface (3 onglets : Charger / Objets / Véhicule)
│   └── style.css         thème sombre mobile-first
└── tests/engine.test.js  tests unitaires (node --test)
```
