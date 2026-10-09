import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runSuite, referenceAdapter } from '../lib/runner.mjs';
import { scenarios, manifest, payloads, hash } from '../lib/scenarios.mjs';
import { startFixtureServer } from '../lib/server.mjs';
import { fetchFixture } from '../lib/transport.mjs';

const adapterPath = name => fileURLToPath(new URL(name, import.meta.url));
test('fixture versions are different representations of the same byte length', () => {
  assert.equal(payloads.v1.length, payloads.v2.length);
  assert.notEqual(hash(payloads.v1), hash(payloads.v2));
});
test('reference passes every scenario; successful publications match manifest hashes', async () => {
  const report = await runSuite();
  assert.equal(report.total, 15);
  assert.equal(report.passed, true, JSON.stringify(report.results.filter(r => !r.pass)));
  assert.equal(report.results.filter(r => r.actual === 'published').length, 3);
});
test('append-only negative control is detected on replacement, invalid ranges, coding and 416', async () => {
  const report = await runSuite({ adapter: adapterPath('../adapters/wrong-append.mjs') });
  assert.equal(report.passed, false);
  for (const id of ['changed-etag-200', 'ignored-range-200', 'wrong-start-206', 'invalid-end-206', 'invalid-total-206', 'short-body-206', 'changed-etag-206', 'missing-etag-206', 'weak-etag-206', 'unproven-416', 'encoded-206', 'encoded-200']) {
    assert.equal(report.results.find(r => r.scenario === id).pass, false, id);
  }
  assert.equal(report.results.find(r => r.scenario === 'matching-206').pass, true);
});
test('reject-all cannot masquerade as a correct downloader', async () => {
  const report = await runSuite({ adapter: adapterPath('helpers/reject-all.mjs'), cases: [scenarios[0]] });
  assert.equal(report.passed, false);
});
test('publication event is preserved even when adapter reports rejection', async () => {
  const report = await runSuite({ adapter: adapterPath('helpers/bad-then-good.mjs'), cases: [scenarios[3]] });
  assert.equal(report.passed, false);
  assert(report.results[0].issues.includes('Rejected scenario attempted publication'));
  assert(report.results[0].issues.includes('Prior destination was damaged'));
});
test('owned scratch is removed after success, rejection, import error and process timeout', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'resume-test-parent-'));
  try {
    for (const adapter of [referenceAdapter, adapterPath('helpers/reject-all.mjs'), adapterPath('helpers/missing.mjs'), adapterPath('helpers/hang.mjs')]) {
      const report = await runSuite({ adapter, cases: [scenarios[0]], scratchParent: parent, deadlineMs: 600, requestTimeoutMs: 300 });
      if (adapter.endsWith('hang.mjs')) assert(report.results[0].issues.includes('Adapter deadline exceeded'));
      assert.deepEqual(await readdir(parent), []);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});
test('server is exactly IPv4 loopback on an ephemeral port and closes its listener', async () => {
  const fixture = await startFixtureServer(scenarios[0]);
  const url = new URL(fixture.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert(Number(url.port) > 0);
  await fixture.close();
  await assert.rejects(fetchFixture(fixture.url, {}, { timeoutMs: 200 }));
});
test('transport rejects external, credential-bearing, redirect-shaped and nonfixture inputs', async () => {
  for (const url of ['https://example.com/artifact', 'http://localhost:12/artifact', 'http://user:secret@127.0.0.1:12/artifact', 'http://127.0.0.1:12/elsewhere', 'http://127.0.0.1:12/artifact?target=https://example.com']) {
    assert.throws(() => fetchFixture(url, {}), /Only the generated loopback/);
  }
});
test('request deadline rejects a stalled response without damaging prior destination', async () => {
  const report = await runSuite({ cases: [{ id: 'stall', version: 'v1', expected: 'rejected' }], deadlineMs: 1500, requestTimeoutMs: 100 });
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.match(report.results[0].reason, /deadline/);
});
test('truncated framing and unsupported coding produce explicit rejection', async () => {
  const report = await runSuite({ cases: scenarios.filter(s => ['truncated-206', 'encoded-206', 'encoded-200'].includes(s.id)) });
  assert(report.passed);
  assert.match(report.results[0].reason, /Truncated|aborted|socket|Incomplete/i);
  for (const result of report.results.slice(1)) assert.match(result.reason, /coding/);
});
test('CLI report is JSON and invalid URL arguments exit 2', () => {
  const cli = fileURLToPath(new URL('../bin/run.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, true);
  const invalid = spawnSync(process.execPath, [cli, '--adapter', 'https://example.com/adapter.mjs'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
});
test('deadline terminates ordinary wrapper descendants holding inherited pipes', { skip: process.platform === 'win32' }, async () => {
  const start = performance.now();
  const report = await runSuite({ adapter: adapterPath('helpers/child-pipe.mjs'), cases: [scenarios[0]], deadlineMs: 500, requestTimeoutMs: 250 });
  assert(report.results[0].issues.includes('Adapter deadline exceeded'));
  assert(performance.now() - start < 3000, 'Inherited pipes must not extend the adapter deadline indefinitely');
});


test('CLI classifies missing, malformed, dependency-missing and non-function adapters as setup failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resume-setup-test-'));
  const cli = fileURLToPath(new URL('../bin/run.mjs', import.meta.url));
  try {
    const inputs = [
      ['missing.mjs', null],
      ['syntax.mjs', 'export default function broken( {'],
      ['dependency.mjs', "import './absent-dependency.mjs'; export default () => {};"],
      ['nonfunction.mjs', 'export default 42;'],
    ];
    for (const [name, content] of inputs) {
      const file = path.join(directory, name);
      if (content !== null) await writeFile(file, content);
      const result = spawnSync(process.execPath, [cli, '--adapter', file], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 2, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.passed, false);
      assert.ok(report.results.every(value => value.setupError && !value.pass));
    }
    const invalid = spawnSync(process.execPath, [cli, '--unknown'], { encoding: 'utf8' });
    assert.equal(invalid.status, 2);
    const wrong = spawnSync(process.execPath, [cli, '--adapter', adapterPath('../adapters/wrong-append.mjs')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(wrong.status, 1);
    assert.ok(JSON.parse(wrong.stdout).results.every(value => !value.setupError));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
