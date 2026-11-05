#!/usr/bin/env python3
"""Vérifie la disponibilité de noms d'app sur Google Play + identifiant du package.
Usage: python3 scripts/check-name-availability.py "Nom1" "Nom2" ...
Méthode : interroge play.google.com/store/search (les 12 premiers résultats),
extrait les titres des cartes (label « Lire "..." ») et compare.
NB : vérification indicative — le dépôt officiel se fait via l'interface Play Console.
"""
import sys, re, time, requests

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9"}

def play_titles(term):
    r = requests.get(f"https://play.google.com/store/search?q={requests.utils.quote(term)}&hl=fr&gl=FR",
                     headers=UA, timeout=15)
    if r.status_code != 200:
        return None
    titles = list(dict.fromkeys(re.findall(r'Lire &quot;([^&]{2,60}?)&quot;', r.text)))[:12]
    return titles

def pkg_free(pkg):
    r = requests.get(f"https://play.google.com/store/apps/details?id={pkg}&hl=fr", headers=UA, timeout=12)
    return r.status_code == 404  # 404 => aucune app avec cet id

def main():
    names = sys.argv[1:] or ["Tepsi"]
    ok = True
    for term in names:
        titles = play_titles(term)
        if titles is None:
            print(f"❓ {term}: erreur réseau"); ok = False; continue
        exact = [t for t in titles if t.lower().strip() == term.lower().strip()]
        similar = [t for t in titles if term.lower()[:4] in t.lower() and t not in exact]
        if exact:
            print(f"❌ {term}: nom EXACT déjà utilisé sur Play par {exact}")
        elif similar:
            print(f"⚠️  {term}: pas de jumeau exact, mais ressemblances -> {similar}")
        else:
            print(f"✅ {term}: aucun titre identique dans les 12 premiers résultats Play")
        time.sleep(0.5)
    print()
    print("📦 com.tepsi.app :", "LIBRE ✅" if pkg_free("com.tepsi.app") else "PRIS ❌")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
