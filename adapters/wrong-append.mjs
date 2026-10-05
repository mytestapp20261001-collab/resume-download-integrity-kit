// Intentionally unsafe negative control. Never copy this into a downloader.
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fetchFixture } from '../lib/transport.mjs';
export default async function wrong({ url, partialPath, metadata, workDir, publish, timeoutMs }) {
  const candidate = path.join(workDir, 'wrong.bin');
  try {
    const partial = await readFile(partialPath);
    const response = await fetchFixture(url, { Range: `bytes=${partial.length}-`, 'If-Range': metadata.etag, 'Accept-Encoding': 'identity' }, { timeoutMs });
    // Three typical mistakes: append any response, trust 416 length, ignore validators/ranges.
    const full = response.status === 416 ? partial : Buffer.concat([partial, response.body]);
    await writeFile(candidate, full, { flag: 'wx' });
    await publish(candidate);
    return { status: 'published' };
  } catch (error) { return { status: 'rejected', reason: error.message }; }
  finally { await rm(candidate, { force: true }); }
}
