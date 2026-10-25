#!/usr/bin/env python3
"""Sokoyetu — photos du catalogue d'exemple depuis Unsplash (licence Unsplash).

  python3 outils/photos_unsplash.py chercher [emplacement…]   propose 8 candidates libres par emplacement (planches à regarder)
  python3 outils/photos_unsplash.py installer                  télécharge les photos « choix » d'outils/photos.json,
                                                               les recadre, les convertit en WebP dans medias/photos/

Les photos Unsplash+ (payantes) sont écartées. Nécessite Pillow (PIL) et l'accès à unsplash.com et images.unsplash.com.
"""
import io, json, os, sys, urllib.parse, urllib.request
from PIL import Image, ImageDraw

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = os.path.join(RACINE, 'outils', 'photos.json')
PHOTOS = os.path.join(RACINE, 'medias', 'photos')
CANDIDATES = os.environ.get('CANDIDATES', os.path.join(RACINE, '.local', 'candidates'))
# format → (largeur, hauteur) de la grande image, puis de la petite
FORMATS = {'produit': ((800, 1000), (400, 500)), 'banniere': ((1600, 900), (900, 506)), 'rayon': ((600, 600), None)}
ORIENTATION = {'produit': 'portrait', 'banniere': 'landscape', 'rayon': 'squarish'}


def lire(url, binaire=False):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Sokoyetu)', 'Accept': '*/*' if binaire else 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binaire else json.loads(data)


def libre(p):
    return not (p.get('premium') or p.get('plus') or p.get('sponsorship'))


def chercher(noms):
    spec = json.load(open(SPEC, encoding='utf-8'))
    os.makedirs(CANDIDATES, exist_ok=True)
    for nom, s in spec.items():
        if nom == '_' or (noms and nom not in noms):
            continue
        q = urllib.parse.urlencode({'query': s['recherche'], 'per_page': 30, 'orientation': ORIENTATION[s['format']]})
        res = [p for p in lire('https://unsplash.com/napi/search/photos?' + q).get('results', []) if libre(p)][:8]
        planche = Image.new('RGB', (4 * 260, 2 * 300), 'white'); d = ImageDraw.Draw(planche)
        for i, p in enumerate(res):
            im = Image.open(io.BytesIO(lire(p['urls']['small'], True))).convert('RGB'); im.thumbnail((252, 260))
            x, y = (i % 4) * 260, (i // 4) * 300
            planche.paste(im, (x + 4, y + 4)); d.text((x + 4, y + 272), f"{i} {p['id']} {p['user']['name'][:18]}", fill='black')
        planche.save(os.path.join(CANDIDATES, nom + '.png'))
        json.dump([{'id': p['id'], 'alt': p.get('alt_description'), 'auteur': p['user']['name'], 'page': p['links']['html']} for p in res],
                  open(os.path.join(CANDIDATES, nom + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(nom, ':', ', '.join(p['id'] for p in res))


def recadrer(im, w, h, fx=0.5, fy=0.5):
    """Recadre au rapport w/h autour du point (fx, fy), puis redimensionne."""
    r = w / h; W, H = im.size
    if W / H > r:
        nw = round(H * r); x = min(max(0, round(fx * W - nw / 2)), W - nw); im = im.crop((x, 0, x + nw, H))
    else:
        nh = round(W / r); y = min(max(0, round(fy * H - nh / 2)), H - nh); im = im.crop((0, y, W, y + nh))
    return im.resize((w, h), Image.LANCZOS)


def installer():
    """Télécharge chaque photo « choix » depuis images.unsplash.com (photos sous licence Unsplash gratuite)."""
    spec = json.load(open(SPEC, encoding='utf-8'))
    for f in os.listdir(PHOTOS):
        if f.endswith('.webp'):
            os.remove(os.path.join(PHOTOS, f))
    lignes = []
    for nom, s in spec.items():
        if nom == '_' or not s.get('choix'):
            continue
        url = 'https://images.unsplash.com/photo-' + s['choix']
        im = Image.open(io.BytesIO(lire(url + '?w=2400&q=85&fm=jpg', True))).convert('RGB')
        grand, petit = FORMATS[s['format']]
        fx, fy = s.get('fx', 0.5), s.get('fy', 0.5)
        recadrer(im, *grand, fx, fy).save(os.path.join(PHOTOS, nom + '.webp'), 'WEBP', quality=80, method=6)
        if petit:
            recadrer(im, *petit, fx, fy).save(os.path.join(PHOTOS, nom + '-s.webp'), 'WEBP', quality=78, method=6)
        lignes.append(f"{nom}.webp : {s['alt']} — {url}")
        print('✓', nom, s['choix'], im.size)
    with open(os.path.join(PHOTOS, 'LICENCE.txt'), 'w', encoding='utf-8') as f:
        f.write("Photos d'exemple de Sokoyetu\n\n"
                "Toutes ces photos viennent d'Unsplash (https://unsplash.com) et sont publiées sous la licence Unsplash :\n"
                "usage libre, y compris commercial, sans obligation de citer l'auteur (https://unsplash.com/license).\n"
                "Elles ont été recadrées et converties en WebP. Elles illustrent le catalogue d'exemple : remplacez-les par les photos\n"
                "de vos propres articles (Administration → Plus → Général → Retirer les exemples).\n\n"
                "Merci aux photographes d'Unsplash. Photos d'origine :\n" + '\n'.join(lignes) + '\n')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'chercher':
        chercher(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == 'installer':
        installer()
    else:
        print(__doc__)
