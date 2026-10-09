#!/usr/bin/env node
import path from 'node:path';
import { runSuite } from '../lib/runner.mjs';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node bin/run.mjs [--adapter ./trusted-local-adapter.mjs]\nRuns synthetic loopback fixtures. Prints JSON; exit 0 passes, 1 fails, 2 setup/usage error.');
} else if (args.length && (args.length !== 2 || args[0] !== '--adapter' || !args[1] || /^[a-z][a-z\d+.-]*:/i.test(args[1]))) {
  console.error('Usage: node bin/run.mjs [--adapter ./trusted-local-adapter.mjs]'); process.exitCode = 2;
} else {
  try {
    const report = await runSuite(args.length ? { adapter: path.resolve(args[1]) } : {});
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.results.some(result => result.setupError) ? 2 : report.passed ? 0 : 1;
  } catch (error) { console.error(`Setup failed: ${error.message}`); process.exitCode = 2; }
}
