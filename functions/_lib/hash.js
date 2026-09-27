// functions/_lib/hash.js
// SHA-256 as hex. Used to store magic-link tokens as hashes only.
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
