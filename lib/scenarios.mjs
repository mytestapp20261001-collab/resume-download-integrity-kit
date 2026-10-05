import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url)));
export const payloads = Object.fromEntries(['v1', 'v2'].map(v => [v, readFileSync(new URL(`../fixtures/${v}.txt`, import.meta.url))]));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [version, bytes] of Object.entries(payloads)) {
  if (bytes.length !== manifest.payloads[version].bytes || hash(bytes) !== manifest.payloads[version].sha256) throw new Error('Fixture manifest mismatch');
}
export const scenarios = [
  { id: 'matching-206', expected: 'published', version: 'v1' },
  { id: 'changed-etag-200', expected: 'published', version: 'v2' },
  { id: 'ignored-range-200', expected: 'published', version: 'v1' },
  ...['wrong-start-206', 'invalid-end-206', 'invalid-total-206', 'unknown-total-206', 'short-body-206', 'truncated-206', 'changed-etag-206', 'missing-etag-206', 'weak-etag-206', 'unproven-416', 'encoded-206', 'encoded-200'].map(id => ({ id, expected: 'rejected', version: 'v1' })),
];
export function seedFor(scenario) {
  // A same-length, corrupted file defeats the tempting "416 + length == total" shortcut.
  if (scenario.id === 'unproven-416') {
    const bytes = Buffer.from(payloads.v1);
    bytes[0] ^= 1;
    return bytes;
  }
  return Buffer.from(payloads.v1.subarray(0, manifest.offset));
}
