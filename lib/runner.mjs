import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, manifest, scenarios, seedFor } from './scenarios.mjs';
import { startFixtureServer } from './server.mjs';

export const referenceAdapter = fileURLToPath(new URL('../adapters/reference.mjs', import.meta.url));
const childEntry = fileURLToPath(new URL('./adapter-child.mjs', import.meta.url));
const previous = Buffer.from('Previously published destination: leave intact on rejection.\n');

function execute(adapter, context, deadlineMs) {
  return new Promise(resolve => {
    const child = fork(childEntry, { detached: process.platform !== 'win32', cwd: context.workDir, execArgv: [], env: { TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const publications = [];
    let result;
    let error;
    let outputBytes = 0;
    let messages = 0;
    const stopGroup = () => {
      // The POSIX group belongs to this fork, including ordinary wrapper children.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (cause) { if (cause.code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const terminate = reason => {
      error ??= reason;
      stopGroup();
      // A detached descendant is outside the contract; never wait on its pipes.
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.connected) child.disconnect();
    };
    const timer = setTimeout(() => terminate('Adapter deadline exceeded'), deadlineMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      outputBytes += data.length;
      if (outputBytes > 16384) terminate('Adapter output limit exceeded');
    });
    child.on('error', cause => {
      error ??= cause.message;
      if (!child.pid) { clearTimeout(timer); resolve({ result, publications, error }); }
    });
    child.on('message', message => {
      if (++messages > 4) { terminate('Adapter message limit exceeded'); return; }
      if (message?.type === 'publication') publications.push({ sha256: message.sha256, bytes: message.bytes });
      else if (message?.type === 'result') result = message.result;
      else if (message?.type === 'error') error ??= message.reason;
      else terminate('Invalid adapter protocol');
    });
    child.on('exit', (code, signal) => {
      stopGroup();
      child.stdout.destroy();
      child.stderr.destroy();
      clearTimeout(timer);
      if (code !== 0 && !error) error = `Adapter exited ${code ?? signal}`;
      resolve({ result, publications, error });
    });
    child.send({ adapter, context }, cause => { if (cause) terminate(cause.message); });
  });
}

export async function runSuite({ adapter = referenceAdapter, cases = scenarios, deadlineMs = 3000, requestTimeoutMs = 1200, scratchParent = os.tmpdir() } = {}) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 30000) throw new Error('deadlineMs must be 100..30000');
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 50 || requestTimeoutMs >= deadlineMs) throw new Error('requestTimeoutMs must be >=50 and less than deadlineMs');
  const root = await mkdtemp(path.join(scratchParent, 'resume-integrity-'));
  const results = [];
  try {
    for (const [index, scenario] of cases.entries()) {
      const workDir = path.join(root, String(index));
      await mkdir(workDir, { mode: 0o700 });
      const partialPath = path.join(workDir, 'partial.bin');
      const destinationPath = path.join(workDir, 'destination.bin');
      const partial = seedFor(scenario);
      await writeFile(partialPath, partial, { mode: 0o600 });
      await writeFile(destinationPath, previous, { mode: 0o600 });
      const server = await startFixtureServer(scenario);
      try {
        const execution = await execute(path.resolve(adapter), { url: server.url, partialPath, destinationPath, workDir, metadata: { etag: manifest.payloads.v1.etag, bytes: partial.length }, timeoutMs: requestTimeoutMs }, deadlineMs);
        const issues = [];
        const expectedHash = manifest.payloads[scenario.version].sha256;
        const destination = await readFile(destinationPath).catch(() => null);
        const retainedPartial = await readFile(partialPath).catch(() => null);
        const actualHash = destination ? hash(destination) : null;
        if (execution.error) issues.push(execution.error);
        if (execution.result?.status !== scenario.expected) issues.push(`Expected ${scenario.expected}, received ${execution.result?.status ?? 'no result'}`);
        if (server.requests.length !== 1) issues.push(`Expected one fixture request, received ${server.requests.length}`);
        const request = server.requests[0];
        if (!request || request.method !== 'GET' || request.path !== '/artifact' || request.range !== `bytes=${partial.length}-` || request.ifRange !== manifest.payloads.v1.etag || request.acceptEncoding !== 'identity') issues.push('Request did not follow the adapter contract');
        if (scenario.expected === 'published') {
          if (actualHash !== expectedHash) issues.push('Final SHA-256 mismatch');
          if (execution.publications.length !== 1 || execution.publications.some(p => p.sha256 !== expectedHash || p.bytes !== manifest.payloads[scenario.version].bytes)) issues.push('Publication was missing or contained invalid bytes');
        } else {
          if (!destination?.equals(previous)) issues.push('Prior destination was damaged');
          if (execution.publications.length) issues.push('Rejected scenario attempted publication');
        }
        if (!retainedPartial?.equals(partial)) issues.push('Original partial was damaged');
        const leftovers = (await readdir(workDir)).filter(name => !['partial.bin', 'destination.bin'].includes(name));
        if (leftovers.length) issues.push('Adapter left temporary files');
        results.push({ scenario: scenario.id, pass: issues.length === 0, expected: scenario.expected, actual: execution.result?.status ?? 'error', ...(execution.result?.reason ? { reason: execution.result.reason } : {}), expectedSha256: scenario.expected === 'published' ? expectedHash : hash(previous), actualSha256: actualHash, publications: execution.publications, issues });
      } finally { await server.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
  return { schemaVersion: 1, policy: 'strict-single-response-v1', passed: results.every(r => r.pass), total: results.length, failures: results.filter(r => !r.pass).length, results };
}
