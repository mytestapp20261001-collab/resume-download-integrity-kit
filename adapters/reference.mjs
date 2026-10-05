import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fetchFixture } from '../lib/transport.mjs';

const strongTag = value => typeof value === 'string' && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
const number = value => /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;

// A deliberately narrow, buffering example for these small synthetic fixtures.
export default async function resume({ url, partialPath, metadata, workDir, publish, timeoutMs }) {
  const candidate = path.join(workDir, 'candidate.bin');
  try {
    const partial = await readFile(partialPath);
    if (!strongTag(metadata.etag) || partial.length !== metadata.bytes) throw new Error('Untrusted partial metadata');
    const response = await fetchFixture(url, { Range: `bytes=${partial.length}-`, 'If-Range': metadata.etag, 'Accept-Encoding': 'identity' }, { timeoutMs });
    const { status, headers, body } = response;
    if (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity') throw new Error('Unsupported content coding');
    const length = number(headers['content-length']);
    if (length === null || length !== body.length) throw new Error('Incomplete body');
    let full;
    if (status === 200) {
      // A complete 200 replaces the partial, including a changed representation.
      if (headers['content-range']) throw new Error('Unexpected Content-Range on 200');
      full = body;
    } else if (status === 206) {
      if (!strongTag(headers.etag) || headers.etag !== metadata.etag) throw new Error('Validator mismatch');
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '');
      if (!match) throw new Error('Unsupported or invalid Content-Range');
      const [start, end, total] = match.slice(1).map(number);
      if ([start, end, total].includes(null) || start !== partial.length || end < start || end >= total || end !== total - 1 || body.length !== end - start + 1) throw new Error('Inconsistent Content-Range');
      full = Buffer.concat([partial, body]);
      if (full.length !== total) throw new Error('Incomplete representation');
    } else {
      // In particular, 416 and equal length are not identity/integrity proof.
      throw new Error(`Unsupported status ${status}`);
    }
    await writeFile(candidate, full, { flag: 'wx', mode: 0o600 });
    await publish(candidate);
    return { status: 'published' };
  } catch (error) {
    return { status: 'rejected', reason: error.message };
  } finally {
    await rm(candidate, { force: true });
  }
}
