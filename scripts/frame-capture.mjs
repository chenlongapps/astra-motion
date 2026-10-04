import { option } from './render-options.mjs';

export function selectCaptureMode(args = []) {
  const mode = option(args, '--capture') ?? 'fast';
  if (!['fast', 'standard'].includes(mode)) throw new Error('Use --capture=fast or --capture=standard.');
  return mode;
}

export async function createFrameCapture(page, { width, height }, mode = 'fast') {
  if (!['fast', 'standard'].includes(mode)) throw new Error(`Unsupported capture mode: ${mode}`);
  return {
    capture: () => page.screenshot({ optimizeForSpeed: mode === 'fast', clip: { x: 0, y: 0, width, height, scale: 1 } }),
    async close() {},
  };
}

// The browser already has a native, fully featured PNG decoder. Reuse it for
// pixel checks rather than installing a second image-processing library.
export async function pngPixels(page, png) {
  return page.evaluate(async encoded => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    try {
      const canvas = new OffscreenCanvas(image.width, image.height), c = canvas.getContext('2d');
      c.drawImage(image, 0, 0);
      const digest = await crypto.subtle.digest('SHA-256', c.getImageData(0, 0, image.width, image.height).data);
      return { width: image.width, height: image.height, channels: 4, hash: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
    } finally { image.close(); }
  }, png.toString('base64'));
}
