// functions/api/push/_webpush.js
// Minimal RFC 8291 (Content-Encoding: aes128gcm) Web Push sender + RFC 8292
// VAPID signer, pure WebCrypto — no npm, matching the style of the
// existing prayer-time push worker. Leading underscore keeps this out of
// the Pages Functions router; it's imported by poke.js for on-demand
// (non-scheduled) sends.
//
// Assumes env.VAPID_PUBLIC_KEY / env.VAPID_PRIVATE_KEY are the standard
// base64url-encoded P-256 keypair format (uncompressed point / raw 32-byte
// scalar) — the same format the `web-push` library's generateVAPIDKeys()
// produces, and what the existing scheduled push Worker should already be
// using. If those secret names differ from what's actually configured,
// update the two references below to match.

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

async function vapidPrivateJwk(publicKeyB64url, privateKeyB64url) {
  const pub = b64urlToBytes(publicKeyB64url); // 65 bytes: 0x04 || x(32) || y(32)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  return {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(x),
    y: bytesToB64url(y),
    d: privateKeyB64url,
    ext: true,
  };
}

async function signVapidJwt(endpoint, subject, publicKeyB64url, privateKeyB64url) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const encHeader = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const jwk = await vapidPrivateJwk(publicKeyB64url, privateKeyB64url);
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)
  );
  // WebCrypto's ECDSA sign() already returns raw r||s (64 bytes for P-256),
  // which is exactly the format JWS ES256 wants — no DER conversion needed.
  const sig = bytesToB64url(new Uint8Array(sigBuf));

  return `${signingInput}.${sig}`;
}

// Encrypts `payloadObj` (JSON-stringified) per RFC 8291 for one subscription.
async function encryptPayload(subscription, payloadObj) {
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));

  const uaPublicBytes = b64urlToBytes(subscription.p256dh); // subscriber's public key, 65 bytes
  const authSecret = b64urlToBytes(subscription.auth);      // 16 bytes

  const senderKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', senderKeyPair.publicKey)
  ); // 65 bytes, uncompressed point

  const subscriberPublicKey = await crypto.subtle.importKey(
    'raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberPublicKey }, senderKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // ikm = HKDF(auth_secret, ecdh_secret, "WebPush: info\0"+ua_pub+sender_pub, 32)
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'), uaPublicBytes, senderPublicRaw
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Single-record message: plaintext + 0x02 padding delimiter, no further padding.
  const recordPlaintext = concatBytes(plaintext, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, recordPlaintext)
  );

  // aes128gcm header: salt(16) | record size(4, BE) | keyid length(1) | keyid(sender pub, 65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, recordPlaintext.length + 16, false); // +16 for the GCM tag
  const header = concatBytes(salt, rs, new Uint8Array([senderPublicRaw.length]), senderPublicRaw);

  return concatBytes(header, encrypted);
}

// Sends one push message. Returns { ok, status } — caller decides how to
// treat 404/410 (expired subscription — caller should prune it).
export async function sendWebPush(env, subscription, payloadObj) {
  const body = await encryptPayload(subscription, payloadObj);
  const jwt = await signVapidJwt(
    subscription.endpoint,
    env.VAPID_SUBJECT || 'mailto:hello@wherewepraying.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });

  return { ok: res.ok, status: res.status };
}
