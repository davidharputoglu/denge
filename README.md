# Denge ⚖️

**Denge** (mot turcique signifiant « équilibre ») — application Android pour les artisans et équipes de chantier.

Prenez une photo de votre matériel, l'application calcule **où placer chaque objet dans le véhicule** (camionnette, camion, remorque…) pour :
- 📦 **charger un maximum** (optimisation de la place au sol, formes réelles et non des rectangles pleins),
- ⚖️ **équilibrer le véhicule** (centre de gravité centré, lourds au fond, pas de penchement gauche/droite),
- 🗂️ **ranger malin** (zones supplémentaires : étagères latérales, hayon, etc.).

## Contenu du dépôt

| Dossier | Description |
|---|---|
| `denge/` | L'application complète (PWA Vite + JS, moteur d'optimisation, vision par photo, tests) |
| `denge/.github/workflows/` | Pipeline GitHub Actions qui génère automatiquement l'**APK Android** à chaque push |

## Démarrage rapide

```bash
cd denge
npm install
npm run dev        # tester dans le navigateur (mobile-first)
npm run build      # build de production -> dist/
npm test           # tests unitaires du moteur
```

## Installer sur Android / tablette

1. `npm run build` puis déployez `dist/` sur un HTTPS gratuit (Netlify, Vercel).
2. Ouvrez l'URL dans Chrome Android → menu ⋮ → **« Installer l'application »**.
3. Ou laissez GitHub Actions générer l'APK : voir `denge/README.md`, section *Générer l'APK avec GitHub* (ajoutez la variable `PWA_URL` dans les secrets du dépôt).

## Importer votre propre logo

```bash
python3 denge/scripts/import-logo.py mon-logo.png   # génère icônes PWA + favicon + maskable
```

Plus de détails (fonctionnement du moteur, gestion des formes, nom & disponibilité) : **[denge/README.md](denge/README.md)**.
