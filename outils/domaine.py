#!/usr/bin/env python3
"""
Sokoyetu — relie le nom de domaine (Namecheap) à la page d'attente GitHub Pages, puis au Droplet.

    python3 outils/domaine.py etat                  enregistrements DNS actuels du domaine
    python3 outils/domaine.py ip                    adresse IP à autoriser chez Namecheap (API Access → Whitelisted IPs)
    python3 outils/domaine.py github [--oui]        domaine et www → page « Bientôt en ligne » (GitHub Pages)
    python3 outils/domaine.py droplet IP [--oui]    domaine, www et admin → le Droplet (la vraie boutique)

Sans --oui, rien n'est modifié : l'outil montre ce qui changerait. Les autres enregistrements (e-mails MX, TXT,
autres sous-domaines) sont gardés tels quels, ainsi que le réglage des e-mails du domaine.

Variables d'environnement (jamais écrites dans le dépôt ni affichées) :
    NAMECHEAP_API_USER   nom d'utilisateur Namecheap        NAMECHEAP_API_KEY   clé de l'API (Profile → Tools → API Access)
    NAMECHEAP_USERNAME   compte du domaine (par défaut NAMECHEAP_API_USER)
    NAMECHEAP_CLIENT_IP  adresse IP autorisée (par défaut : l'adresse publique de cette machine, lue sur api.ipify.org)
    SOKOYETU_DOMAINE     sokoyakwetu.com par défaut          NAMECHEAP_URL       autre adresse de l'API (essais)
"""
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

DOMAINE = os.environ.get('SOKOYETU_DOMAINE', 'sokoyakwetu.com').strip().lower()
URL = os.environ.get('NAMECHEAP_URL', 'https://api.namecheap.com/xml.response')
NS = {'nc': 'http://api.namecheap.com/xml.response'}
# GitHub Pages : adresses officielles pour un domaine principal, et le site du compte pour www.
GITHUB_IP = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153']
GITHUB_WWW = 'arisecom07-lang.github.io'
TTL = '300'  # 5 minutes : le passage au Droplet sera pris en compte vite
# Enregistrements qui désignent « où est le site » : remplacés pour les noms concernés, tout le reste est gardé.
TYPES_SITE = {'A', 'AAAA', 'CNAME', 'ALIAS', 'URL', 'URL301', 'FRAME'}


class ErreurNamecheap(Exception):
    pass


_ip = None
def ip_publique():
    """Adresse IPv4 publique de cette machine (celle que voit Namecheap), ou '' si elle est introuvable."""
    global _ip
    if _ip is None:
        _ip = ''
        try:
            with urllib.request.urlopen('https://api.ipify.org', timeout=15) as r:
                t = r.read().decode().strip()
            if re.fullmatch(r'\d{1,3}(\.\d{1,3}){3}', t):
                _ip = t
        except Exception:
            pass
    return _ip


def appel(commande, **params):
    user = os.environ.get('NAMECHEAP_API_USER', '').strip()
    cle = os.environ.get('NAMECHEAP_API_KEY', '').strip()
    if not user or not cle:
        raise ErreurNamecheap('NAMECHEAP_API_USER et NAMECHEAP_API_KEY manquent dans l’environnement.')
    sld, _, tld = DOMAINE.partition('.')
    corps = {
        'ApiUser': user, 'ApiKey': cle, 'UserName': os.environ.get('NAMECHEAP_USERNAME', '').strip() or user,
        'ClientIp': os.environ.get('NAMECHEAP_CLIENT_IP', '').strip() or ip_publique() or '127.0.0.1',
        'Command': commande, 'SLD': sld, 'TLD': tld, **params
    }
    # Envoi en POST : la clé ne figure jamais dans une adresse ni dans un journal.
    req = urllib.request.Request(URL, data=urllib.parse.urlencode(corps).encode(), method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            texte = r.read().decode('utf-8', 'replace')
    except Exception as e:  # réseau, proxy, certificat
        raise ErreurNamecheap(f'Namecheap injoignable : {str(e).replace(cle, "…")}')
    racine = ET.fromstring(texte)
    if racine.get('Status') != 'OK':
        msgs = [f"{e.get('Number', '')} {(e.text or '').strip()}" for e in racine.findall('.//nc:Errors/nc:Error', NS)]
        raise ErreurNamecheap(' ; '.join(msgs) or 'réponse en erreur')
    return racine


def lire():
    r = appel('namecheap.domains.dns.getHosts')
    res = r.find('.//nc:DomainDNSGetHostsResult', NS)
    hotes = [{'nom': h.get('Name', ''), 'type': h.get('Type', '').upper(), 'valeur': h.get('Address', ''),
              'mx': h.get('MXPref', '10'), 'ttl': h.get('TTL', '1800')} for h in res.findall('nc:host', NS)]
    return {'hotes': hotes, 'email': res.get('EmailType', ''), 'notre_dns': res.get('IsUsingOurDNS', '').lower() == 'true'}


def afficher(hotes, titre):
    print(titre)
    for h in sorted(hotes, key=lambda x: (x['nom'], x['type'], x['valeur'])):
        print(f"  {h['type']:<7} {h['nom']:<10} {h['valeur']}{'  (priorité ' + h['mx'] + ')' if h['type'] == 'MX' else ''}")
    if not hotes:
        print('  (aucun)')


def cible(mode, ip=''):
    if mode == 'github':
        return {'noms': {'@', 'www'}, 'hotes': [{'nom': '@', 'type': 'A', 'valeur': a, 'mx': '10', 'ttl': TTL} for a in GITHUB_IP]
                + [{'nom': 'www', 'type': 'CNAME', 'valeur': GITHUB_WWW, 'mx': '10', 'ttl': TTL}]}
    return {'noms': {'@', 'www', 'admin'}, 'hotes': [{'nom': n, 'type': 'A', 'valeur': ip, 'mx': '10', 'ttl': TTL} for n in ('@', 'www', 'admin')]}


def nouveaux(actuels, c):
    gardes = [h for h in actuels if not (h['nom'] in c['noms'] and h['type'] in TYPES_SITE)]
    return gardes + c['hotes']


def ecrire(hotes, email):
    params = {}
    for i, h in enumerate(hotes, 1):
        params.update({f'HostName{i}': h['nom'], f'RecordType{i}': h['type'], f'Address{i}': h['valeur'], f'TTL{i}': h['ttl']})
        if h['type'] == 'MX':
            params[f'MXPref{i}'] = h['mx']
    if email:
        params['EmailType'] = email  # garde le réglage des e-mails du domaine (MX, transfert…)
    appel('namecheap.domains.dns.setHosts', **params)


def main(args):
    oui = '--oui' in args
    args = [a for a in args if a != '--oui']
    mode = args[0] if args else ''
    try:
        if mode == 'ip':
            aide = 'Profile → Tools → API Access → Whitelisted IPs'
            try:
                lire()
                print(f'L’adresse IP de cette machine ({ip_publique() or "inconnue"}) est déjà autorisée chez Namecheap.')
            except ErreurNamecheap as e:
                m = re.search(r'(\d{1,3}(?:\.\d{1,3}){3})', str(e))
                trouvee = ip_publique() or (m.group(1) if m and m.group(1) != '127.0.0.1' else '')
                if not trouvee:
                    raise
                print(f'Adresse IP à autoriser chez Namecheap ({aide}) : {trouvee}')
                print(f'Réponse de Namecheap : {e}')
            return 0
        if mode not in ('etat', 'github', 'droplet'):
            print(__doc__.strip())
            return 1
        ip = ''
        if mode == 'droplet':
            ip = args[1] if len(args) > 1 else ''
            if not re.fullmatch(r'(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}', ip):
                print('Indiquez l’adresse IP du Droplet : python3 outils/domaine.py droplet 203.0.113.10')
                return 1
        e = lire()
        afficher(e['hotes'], f'Enregistrements actuels de {DOMAINE} :')
        if not e['notre_dns']:
            print('\nAttention : le domaine n’utilise pas les serveurs de noms de Namecheap (Domain → Nameservers →'
                  ' « Namecheap BasicDNS »). Les changements faits ici ne seraient pas visibles.')
            return 1
        if mode == 'etat':
            return 0
        n = nouveaux(e['hotes'], cible(mode, ip))
        print()
        afficher(n, 'Après le changement :')
        if not oui:
            print('\nRien n’est modifié. Relancez avec --oui pour appliquer.')
            return 0
        ecrire(n, e['email'])
        apres = lire()['hotes']
        afficher(apres, '\nEnregistré chez Namecheap :')
        print('\nLa propagation prend de quelques minutes à quelques heures.')
        return 0
    except ErreurNamecheap as e:
        print(f'Échec : {e}')
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
