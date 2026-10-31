// Tests de la lecture des pages fournisseurs (import par lien) et du tableau d'import en masse : node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../serveur/pb_hooks/lib/import.js');

test('adresses acceptées', () => {
  assert.equal(I.adresseFournisseur('https://detail.1688.com/offer/123.html'), 'https://detail.1688.com/offer/123.html');
  assert.equal(I.adresseFournisseur('http://www.alibaba.com/product-detail/x_1.html'), 'https://www.alibaba.com/product-detail/x_1.html');
  assert.equal(I.adresseFournisseur('https://fr.aliexpress.com/item/1.html'), 'https://fr.aliexpress.com/item/1.html');
  assert.equal(I.adresseFournisseur('https://faux1688.com/offer/1.html'), '');
  assert.equal(I.adresseFournisseur('https://exemple.com/?u=1688.com'), '');
  assert.equal(I.adressePhoto('//cbu01.alicdn.com/img/a.jpg'), 'https://cbu01.alicdn.com/img/a.jpg');
  for (const u of ['http://127.0.0.1/a.jpg', 'http://localhost/a.jpg', 'http://192.168.1.4/a.jpg', 'http://10.0.0.1/a.jpg', 'http://[::1]/a.jpg', 'file:///etc/passwd', 'http://2130706433/a.jpg']) assert.equal(I.adressePhoto(u), '', u);
});

test('copie de photo : jamais vers le réseau du serveur, même par une adresse déguisée', () => {
  for (const u of ['https://ae01.alicdn.com/kf/S1.jpg', 'https://img.kwcdn.com/product/a.webp', 'https://exemple.cd:443/a.png', 'http://8.8.8.8/a.jpg', 'https://xn--80ak6aa92e.com/a.jpg']) assert.equal(I.adressePhoto(u), u, u);
  for (const u of [
    'https://exemple.com@127.0.0.1/a.jpg', 'https://exemple.com:x@169.254.169.254/a.jpg', 'https://evil.com\\@127.0.0.1/a.jpg', // identifiant devant l'adresse réelle
    'https://localhost./a.jpg', 'https://exemple.com./a.jpg', 'https://metadata/a.jpg', 'https://metadata.google.internal/a.jpg', 'https://nas.local/a.jpg',
    'https://169.254.169.254/latest/meta-data', 'https://0.0.0.0/a.jpg', 'https://100.100.100.200/a.jpg', 'https://172.20.1.1/a.jpg', 'https://224.0.0.1/a.jpg',
    'https://0x7f000001/a.jpg', 'https://0x7f.0.0.1/a.jpg', 'https://0177.0.0.1/a.jpg', 'https://127.1/a.jpg', 'https://1.2.3/a.jpg', 'https://256.1.1.1/a.jpg',
    'https://exemple.com:8090/a.jpg', 'http://exemple.com:443/a.jpg', 'https://[::ffff:127.0.0.1]/a.jpg', 'https://ex_emple.com/a.jpg', 'gopher://exemple.com/a.jpg'
  ]) assert.equal(I.adressePhoto(u), '', u);
  // Page fournisseur : le site reconnu doit être le vrai site visité.
  for (const u of ['https://1688.com@127.0.0.1/offer/1.html', 'https://evil.com\\.1688.com/offer/1.html', 'https://detail.1688.com:8443/offer/1.html', 'https://detail.1688.com./offer/1.html']) assert.equal(I.adresseFournisseur(u), '', u);
  assert.deepEqual(I.decouper('https://Detail.1688.com:443/offer/1.html?x=@y'), { protocole: 'https', hote: 'detail.1688.com', port: 443 });
});

test('page 1688 : titre, photos en grand, prix en yuans', () => {
  const html = `<html><head><title>女士夏季连衣裙 中长款 - 阿里巴巴</title>
    <meta property="og:image" content="https://cbu01.alicdn.com/img/ibank/O1CN01a.jpg_220x220.jpg"></head>
    <body><img src="//cbu01.alicdn.com/img/ibank/O1CN01b.jpg_50x50.jpg"><img src="https://img.alicdn.com/tps/i1/logo-30-30.png">
    <script>window.__INIT__={"subject":"女士夏季连衣裙 中长款","price":"45.00","attributeName":"材质","value":"聚酯纤维"}</script></body></html>`;
  const r = I.extraire(html, 'https://detail.1688.com/offer/1.html');
  assert.equal(r.title, '女士夏季连衣裙 中长款');
  assert.deepEqual(r.images, ['https://cbu01.alicdn.com/img/ibank/O1CN01a.jpg', 'https://cbu01.alicdn.com/img/ibank/O1CN01b.jpg']);
  assert.equal(r.price, 45);
  assert.equal(r.currency, 'CNY');
  assert.match(I.texteDe(html, r), /材质 : 聚酯纤维/);
});

test('page Alibaba : données structurées', () => {
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Smart Watch 1.8&quot; screen","image":["https://s.alicdn.com/@sc04/kf/H1.jpg_300x300.jpg"],"description":"Fitness tracker","offers":{"@type":"AggregateOffer","lowPrice":"6.80","priceCurrency":"USD"}}</script>`;
  const r = I.extraire(html, 'https://www.alibaba.com/product-detail/x.html');
  assert.equal(r.title, 'Smart Watch 1.8" screen');
  assert.deepEqual(r.images, ['https://s.alicdn.com/@sc04/kf/H1.jpg']);
  assert.equal(r.price, 6.8);
  assert.equal(r.currency, 'USD');
});

test('page de connexion : rien à lire', () => {
  const r = I.extraire('<html><title>登录</title><body>请登录</body></html>', 'https://detail.1688.com/offer/1.html');
  assert.equal(r.images.length, 0);
  assert.equal(r.price, 0);
});
