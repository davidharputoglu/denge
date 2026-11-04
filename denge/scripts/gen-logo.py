#!/usr/bin/env python3
"""Génère le logo / icônes / favicon de Denge (Pillow, 100% local).

Concept : un « tepsi » (plateau) vu de dessus, chargé d'objets de chantier
et parfaitement équilibré sur son fulcrum — plateau ambre, caisse bleue,
grille de chargement, objets rangés, pivot central.

Sorties dans public/ : logo.png (1024), icon-192.png, icon-512.png,
apple-touch-icon.png (180), favicon.png (64).
"""
import os
from PIL import Image, ImageDraw

C = {
    "bg1": (26, 40, 66), "bg2": (11, 18, 34),            # dégradé ardoise sombre
    "tray": (245, 158, 11), "tray_dk": (190, 120, 8),    # plateau ambre
    "body": (59, 130, 246), "body_dk": (37, 82, 158),    # caisse bleue
    "crate": (226, 232, 240), "metal": (148, 163, 184), "green": (34, 197, 94),
    "ink": (15, 23, 42),
}

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make_master(S=1024):
    u = S / 1024.0

    # --- Fond avec léger dégradé vertical, détouré en disque ---
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for yy in range(S):
        col = lerp(C["bg1"], C["bg2"], yy / S)
        d.line([(0, yy), (S, yy)], fill=col + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
    img.putalpha(mask)
    d = ImageDraw.Draw(img)

    def E(x, y, w, h, fill, r=0):
        d.rounded_rectangle([x * u, y * u, (x + w) * u, (y + h) * u], radius=r * u, fill=fill)

    def CIRC(cx, cy, rr, fill):
        d.ellipse([(cx - rr) * u, (cy - rr) * u, (cx + rr) * u, (cy + rr) * u], fill=fill)

    # --- Plateau tepsi : poignée gauche + disque ambre ---
    E(70, 452, 120, 120, C["tray_dk"], r=26)       # poignée
    E(96, 478, 60, 68, C["bg2"], r=18)             # trou de poignée
    CIRC(560, 512, 330, C["tray"])                 # plateau
    CIRC(560, 512, 292, C["tray_dk"])              # rebord intérieur
    CIRC(560, 512, 276, C["body"])                 # fond de caisse bleu

    # --- Grille de chargement (cases au sol) ---
    g = C["body_dk"]
    for i in range(1, 4):
        x = (560 - 276 + (552 / 4) * i) * u
        d.line([(x, (512 - 250) * u), (x, (512 + 250) * u)], fill=g, width=int(6 * u))
    for j in range(1, 3):
        y = (512 - 276 + (552 / 3) * j) * u
        d.line([((560 - 250) * u, y), ((560 + 250) * u, y)], fill=g, width=int(6 * u))

    # --- Objets rangés (asymétriques mais équilibrés) ---
    E(330, 320, 150, 110, C["crate"], r=18)                       # bac à mortier (haut-gauche)
    E(330, 320, 150, 26, lerp(C["crate"], C["ink"], .18), r=10)   # anse du bac
    E(560, 300, 120, 150, C["metal"], r=16)                       # bétonnière (haut-droite)
    CIRC(620, 375, 44, lerp(C["metal"], C["ink"], .25))           # cuve ronde
    E(318, 470, 170, 90, C["green"], r=16)                        # sac de ciment (milieu-gauche)
    d.line([(330 * u, 515 * u), (475 * u, 515 * u)],
           fill=lerp(C["green"], C["ink"], .3), width=int(8 * u))
    E(560, 500, 44, 210, C["crate"], r=12)                        # tuyau PVC (droite, bas)
    E(620, 560, 44, 150, C["metal"], r=12)                        # barre d'acier
    E(330, 600, 200, 60, C["metal"], r=14)                        # manche de pelle (bas-gauche)
    E(300, 592, 60, 76, C["tray"], r=14)                          # fer de pelle

    # --- Ligne d'équilibre + fulcrum (l'app dit « pencher » -> balance) ---
    d.line([(560 * u, 250 * u), (560 * u, 770 * u)],
           fill=(255, 255, 255, 110), width=int(6 * u))
    tri = [(560, 742), (506, 812), (614, 812)]
    d.polygon([(x * u, y * u) for x, y in tri], fill=C["crate"])  # triangle du pivot
    E(470, 812, 180, 34, C["crate"], r=14)                        # socle
    CIRC(560, 742, 16, C["tray"])                                 # axe du pivot

    # --- Reflet discret sur le rebord ambre ---
    d.arc([(560 - 320) * u, (512 - 320) * u, (560 + 320) * u, (512 + 320) * u],
          200, 260, fill=(255, 255, 255, 70), width=int(14 * u))
    return img

def save_icon(master, size, path, pad=0.06, bg=(15, 23, 42, 255)):
    """Colle le master circulaire centré sur un fond carré (icône Android/PWA)."""
    s = int(size * pad)
    inner = size - 2 * s
    ic = master.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), bg)
    out.alpha_composite(ic, (s, s))
    out.save(path)

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pub = os.path.join(root, "public")
    os.makedirs(pub, exist_ok=True)

    master = make_master()
    master.save(os.path.join(pub, "logo.png"))                      # logo maître 1024px
    for n in (192, 512):
        save_icon(master, n, os.path.join(pub, f"icon-{n}.png"))    # icônes PWA/Android
    save_icon(master, 180, os.path.join(pub, "apple-touch-icon.png"), pad=0.02)
    save_icon(master, 64, os.path.join(pub, "favicon.png"), pad=0.0)
    # Variante maskable Android : contenu réduit à ~80 % sur fond uni (safe-zone)
    mk = Image.new("RGBA", (512, 512), (15, 23, 42, 255))
    inner = master.resize((410, 410), Image.LANCZOS)
    mk.alpha_composite(inner, (51, 51))
    mk.save(os.path.join(pub, "icon-maskable-512.png"))
    print("OK:", sorted(os.listdir(pub)))
