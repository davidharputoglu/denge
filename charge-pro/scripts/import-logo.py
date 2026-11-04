#!/usr/bin/env python3
"""Importe VOTRE image comme identité visuelle de Denge (logo, icônes PWA, favicon).

Usage :
    python3 scripts/import-logo.py chemin/vers/votre-image.png

Ce que le script fait automatiquement :
  1. Redimensionne en logo.png (1024x1024, carré centré) -> affiché dans l'app
  2. icon-192.png et icon-512.png   -> icônes Android / PWA (Play Store)
  3. icon-maskable-512.png          -> variante « maskable » (fonds découpés par les lanceurs d'apps Android) :
     l'image est réduite à ~80 % sur un fond assorti pour éviter que les bords soient rognés
  4. apple-touch-icon.png (180)     -> iPhone / iPad
  5. favicon.png (64)               -> onglet du navigateur

Dépendance : Pillow (pip install Pillow).
"""
import sys
from pathlib import Path
from PIL import Image, ImageOps

OUT = Path(__file__).resolve().parent.parent / "public"
BG = (15, 23, 42)  # #0f172a — couleur du thème de l'app, réutilisable ici


def square(img: Image.Image, pad_color=BG) -> Image.Image:
    """Rend l'image carrée en ajoutant des marges (pas de recadrage sauvage)."""
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), pad_color + (255,))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img if img.mode == "RGBA" else None)
    return canvas


def main(src_path: str) -> None:
    src = Path(src_path)
    if not src.exists():
        sys.exit(f"Image introuvable : {src}")
    OUT.mkdir(exist_ok=True)
    img = Image.open(src).convert("RGBA")
    img = square(img)

    targets = {
        "logo.png": 1024,
        "icon-512.png": 512,
        "icon-192.png": 192,
        "apple-touch-icon.png": 180,
        "favicon.png": 64,
    }
    for name, size in targets.items():
        ImageOps.fit(img, (size, size), method=Image.LANCZOS).save(OUT / name)
        print(f"  ✓ public/{name} ({size}x{size})")

    # --- variante maskable : contenu à 80% + marge de sécurité, fond uni ---
    m = Image.new("RGBA", (512, 512), BG + (255,))
    inner = ImageOps.fit(img, (410, 410), method=Image.LANCZOS)
    m.paste(inner, (51, 51), inner)
    m.save(OUT / "icon-maskable-512.png")
    print("  ✓ public/icon-maskable-512.png (512x512, safe-zone 80%)")

    print("\nEnsuite : npm run build — puis vérifiez l'aperçu sur téléphone.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
