// Signature des notifications du téléphone (VAPID, ES256) : clés et signatures du serveur vérifiées par OpenSSL (Node).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../serveur/pb_hooks/lib/p256.js');

const hasard = () => crypto.randomBytes(32).toString('hex');
const clePubliqueNode = (b64) => {
  const o = Buffer.from(b64, 'base64url');
  return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: o.subarray(1, 33).toString('base64url'), y: o.subarray(33).toString('base64url') }, format: 'jwk' });
};

test('clés P-256 : la clé publique est celle que calcule OpenSSL', () => {
  for (let i = 0; i < 5; i++) {
    const k = C.cles(hasard());
    const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(k.prive, 'hex'));
    assert.equal(k.public, ecdh.getPublicKey().toString('base64url'));
    assert.equal(C.clePublique(k.prive), k.public);
  }
});

test('jeton VAPID signé (ES256) accepté par OpenSSL, refusé s’il est modifié', () => {
  const k = C.cles(hasard());
  const entree = C.texteBase64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + C.texteBase64url(JSON.stringify({ aud: 'https://fcm.googleapis.com', exp: 1793700000, sub: 'https://sokoyakwetu.com' }));
  assert.equal(entree.split('.')[0], Buffer.from('{"typ":"JWT","alg":"ES256"}').toString('base64url'));
  for (let i = 0; i < 10; i++) {
    const sig = C.signer(crypto.createHash('sha256').update(entree).digest('hex'), k.prive, hasard);
    assert.equal(Buffer.from(sig, 'base64url').length, 64);
    assert.ok(crypto.verify('sha256', Buffer.from(entree), { key: clePubliqueNode(k.public), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
    assert.ok(!crypto.verify('sha256', Buffer.from(entree + 'x'), { key: clePubliqueNode(k.public), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  }
});

test('base64url sans remplissage, comme les navigateurs', () => {
  for (const n of [0, 1, 2, 3, 16, 65]) {
    const o = crypto.randomBytes(n);
    assert.equal(C.base64url([...o]), o.toString('base64url'));
  }
});
