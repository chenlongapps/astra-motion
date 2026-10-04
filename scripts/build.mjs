import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { root } from './render-options.mjs';
import { verifyExportAudio } from './export-audio.mjs';

// Native ES modules need no bundler. Validate syntax, then stage a self-contained
// website; a failed copy leaves the existing deployment untouched.
await verifyExportAudio();
for (const name of await readdir(path.join(root, 'src'))) {
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, 'src', name)], { stdio: 'inherit' });
}
const staging = await mkdtemp(path.join(root, '.build-'));
const target = path.join(root, 'dist');
try {
  for (const name of ['index.html', 'THIRD_PARTY.md', 'src']) await cp(path.join(root, name), path.join(staging, name), { recursive: true });
  for (const name of await readdir(path.join(root, 'public'))) await cp(path.join(root, 'public', name), path.join(staging, name), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await rename(staging, target);
  console.log('Built dist/ using Node.js only (native JavaScript, fonts, and soundtrack).');
} finally { await rm(staging, { recursive: true, force: true }); }
