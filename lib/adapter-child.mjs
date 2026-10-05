import { lstat, realpath, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// A process deadline boundary for trusted adapters, NOT a code-execution sandbox.
process.once('message', async ({ adapter, context }) => {
  const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
  let publications = 0;
  try {
    const { default: resume } = await import(pathToFileURL(adapter));
    const root = await realpath(context.workDir);
    const publish = async candidatePath => {
      if (++publications > 1) throw new Error('Only one publication is permitted');
      const candidate = path.resolve(candidatePath);
      const stat = await lstat(candidate);
      if (path.dirname(candidate) !== root || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || candidate === context.partialPath || candidate === context.destinationPath || stat.size > 262144) throw new Error('Candidate must be an owned, bounded regular file directly in workDir');
      const bytes = await readFile(candidate);
      // Record bytes BEFORE renaming. This is observational, not an integrity filter.
      await send({ type: 'publication', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      await rename(candidate, context.destinationPath);
    };
    const result = await resume(Object.freeze({ ...context, metadata: Object.freeze(context.metadata), publish }));
    await send({ type: 'result', result });
  } catch (error) { await send({ type: 'error', reason: String(error.message).slice(0, 500) }); }
  finally { process.disconnect(); }
});
