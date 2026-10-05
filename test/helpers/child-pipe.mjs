import { spawn } from 'node:child_process';
export default async function inheritedPipes() {
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
  await new Promise(() => {});
}
