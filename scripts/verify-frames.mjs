import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pngPixels } from './frame-capture.mjs';
import { openRenderer } from './browser.mjs';
import { selectResolution } from './render-options.mjs';
import { checkFrameCache } from './frame-cache.mjs';

// Ensure cached PNGs encode the current editable source, including after a
// partial refresh. Compare decoded RGBA pixels, not PNG compression bytes.
const count = 900;
const resolution = selectResolution(process.argv.slice(2)), { output, width, height } = resolution;
const filename = f => path.join(output, 'frames', `${String(f).padStart(4, '0')}.png`);
await checkFrameCache(path.join(output, 'frames'), resolution, count);
const report = { startedAt: new Date().toISOString(), passed: false, resolution: resolution.name, width, height, frameCount: count, comparedFrames: 0, algorithm: 'SHA-256 of decoded RGBA pixels', mismatches: [], browserErrors: [] };
const sequence = createHash('sha256');
const runtime = await openRenderer({ resolution });
try {
  for (let f = 0; f < count; f++) {
    const rendered = await runtime.page.evaluate(async frame => {
      window.renderFrame(frame);
      const canvas = document.querySelector('#film');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    }, f);
    const info = await pngPixels(runtime.page, await readFile(filename(f)));
    assert.equal(info.width, width); assert.equal(info.height, height); assert.equal(info.channels, 4);
    const cached = info.hash;
    if (rendered !== cached) report.mismatches.push({ frame: f, rendered, cached });
    sequence.update(`${f}:${cached}\n`);
    report.comparedFrames++;
    if (f % 90 === 0 || f === 899) console.log(`Checked current-source pixels against ${f + 1} / 900 cached frames`);
  }
  report.browserErrors = runtime.errors;
  report.sequenceHash = sequence.digest('hex');
  report.passed = report.mismatches.length === 0 && report.browserErrors.length === 0;
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(output, 'frame-verification.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(report.passed, true, `${report.mismatches.length} cached frame(s) differ from the current renderer`);
} finally { await runtime.close(); }
