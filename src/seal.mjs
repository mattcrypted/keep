// Keep — Sealed Market encryption layer.
//
// AES-256-GCM via Node's built-in node:crypto (no new dependency). Pure functions
// with NO 0G / Express coupling, so they're trivially unit-testable. seal()
// encrypts a memory's content into a self-describing envelope that is safe to
// store on 0G as ciphertext, and hands back the symmetric key for the caller to
// custody SERVER-SIDE. open() decrypts that envelope with the key. GCM's auth tag
// means open() THROWS on a wrong key or any tampered byte — real integrity, not a
// silent garbage read. The key is NEVER part of the envelope.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALG = 'aes-256-gcm';

// Encrypt UTF-8 plaintext. Returns { envelope, keyB64 }:
//  - envelope: { keep:'sealed', v, alg, iv, tag, ct, model, sealedAt } — carries
//    NO key and no plaintext beyond the ciphertext; safe to put on 0G.
//  - keyB64: the 32-byte symmetric key, base64 — the caller custodies this and it
//    must never be written into the envelope, returned to a client, or logged.
export function seal(plaintextUtf8, model) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = {
    keep: 'sealed',
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
    model: model || '',
    sealedAt: Date.now(),
  };
  return { envelope, keyB64: key.toString('base64') };
}

// Decrypt an envelope with its base64 key. Throws on a non-envelope, a wrong key,
// or any tampered byte (the GCM auth tag is verified in decipher.final()).
export function open(envelope, keyB64) {
  if (!envelope || envelope.keep !== 'sealed' || !envelope.iv || !envelope.tag || !envelope.ct) {
    throw new Error('not a sealed envelope');
  }
  const decipher = createDecipheriv(
    ALG,
    Buffer.from(keyB64, 'base64'),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}
