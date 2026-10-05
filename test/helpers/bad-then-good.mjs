import { writeFile } from 'node:fs/promises';
import path from 'node:path';
export default async function adapter({ workDir, publish }) {
  const file = path.join(workDir, 'bad.bin');
  await writeFile(file, 'not a complete download');
  await publish(file);
  return { status: 'rejected' };
}
