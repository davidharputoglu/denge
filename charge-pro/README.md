# 🧺 Tepsi — Chargement équilibré des véhicules de chantier

> **Tepsi** (du turc « tepsi », plateau large et plat) : l'app qui transforme le coffre
> de votre camionnette en plateau parfaitement chargé et équilibré. Nom d'origine turcique,
> comme les autres mots turcs passés en français : bazar, kiosque, divan, ottoman, turban.

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
tepsi/
├── index.html            point d'entrée (+ enregistrement du service worker)
├── vite.config.js        config PWA (manifest, icônes, offline)
├── src/
│   ├── engine.js         cœur métier : grille, analyse d'équilibre, autoLoad, véhicules
│   ├── main.js           interface (3 onglets : Charger / Objets / Véhicule)
│   └── style.css         thème sombre mobile-first
└── tests/engine.test.js  tests unitaires (node --test)
```

## 📦 Générer l'APK avec GitHub (GitHub Actions)

GitHub ne crée pas l'APK automatiquement, mais **GitHub Actions** (intégré à
chaque dépôt, gratuit pour les dépôts publics) le fait à votre place grâce au
workflow `.github/workflows/android-apk.yml` :

1. Poussez ce dépôt sur GitHub (`git push`).
2. Hébergez la PWA (fichiers de `dist/`) sur un HTTPS gratuit : Netlify ou Vercel.
3. Dans le dépôt GitHub : *Settings → Secrets and variables → Actions → Variables*
   → ajoutez `PWA_URL` = `https://votre-site.exemple.com`.
4. Chaque push sur `main` (ou bouton *Run workflow*) construit et livre :
   - **pwa-dist** : le site à déployer ;
   - **tepsi-apk** : le fichier `.apk` (onglet Actions → Artifacts), prêt
     à installer sur Android (*paramètres → installer des apps inconnues*).

⚠️ Limites : cet APK est **non signé** (parfait pour tester en interne ; il
faut une clé de signature pour le Play Store) et un TWA charge l'app depuis
l'URL hébergée — prévoyez donc l'hébergement. Pour une app 100 % autonome
sans serveur, la voie est Capacitor + Android Studio (build local ou dans
Actions avec l'action `react-native-android-build-apk`/`setup-java` + Gradle).

## 🏷️ Nom & disponibilité sur le Google Play Store

Vérification automatisée des 12 premiers résultats de recherche Play (France) — novembre 2026 :

| Nom turcique | Signification | Disponibilité Play | Verdict |
|---|---|---|---|
| **Tepsi** ✅ retenu | plateau large (le coffre comme un plateau équilibré) | aucun titre identique ; `com.tepsi.app` LIBRE | meilleur candidat |
| **Küfe** | panier/cage en osier (rangement) | aucun titre identique | bon plan B |
| **Töz** | souche/fondement (charger à la base, lourd au fond) | aucun titre identique | bon plan B |
| **Denge** | équilibre | aucun titre identique | sémantique parfaite, mot très courant |
| **Balgı** | estimation/mesure (poids estimé) | aucun titre identique | original |
| **Çadır** | tente/bâche (bâchage de chargement) | aucun titre identique | évocateur chantier |
| ⚠️ Bagaj | bagages/coffre | « Bagagici » existe | similarité risquée |
| ⚠️ Kazan | chaudron / gagne | plusieurs jeux « Kazan… » | trop occupé |
| ❌ Alp | héros | app « alp » existe | pris |
| ❌ Yük | charge/fret | apps « yükCEPte » etc. | trop générique en turc |

Relancer la vérification à tout moment :

```bash
python3 scripts/check-name-availability.py Tepsi Küfe Töz Denge
```

⚠️ *Indicatif uniquement* : le dépôt officiel du nom se fait via [Play Console](https://play.google.com/console) (25 € une fois). Pensez aussi à vérifier les marques déposées (INPI/EUIPO) si vous comptez commercialiser.

## 🎨 Identité visuelle (logo, icônes, favicon)

Le logo **Tepsi** représente un plateau (tepsi) vu de dessus, chargé d'objets
de chantier et parfaitement équilibré sur son fulcrum — exactement le rôle de
l'application.

Tous les fichiers sont **générés par script** (aucune dépendance externe, 100 % local) :

```bash
python3 scripts/gen-logo.py   # régénère tout en 2 secondes
```

| Fichier (`public/`)        | Usage                                        |
|----------------------------|----------------------------------------------|
| `logo.png` (1024 px)       | Logo maître, affiché dans l'en-tête de l'app |
| `icon-192.png`             | Icône PWA (Android, écran d'accueil)         |
| `icon-512.png`             | Icône PWA + `maskable` (Play Store / TWA)    |
| `apple-touch-icon.png`     | iOS / iPad                                   |
| `favicon.png`              | Onglet du navigateur                           |

Pour changer les couleurs du branding : éditer le dictionnaire `C` en haut de
`scripts/gen-logo.py`, relancer le script, puis `npm run build`.
