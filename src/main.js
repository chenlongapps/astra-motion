import { Renderer, cues } from './renderer.js';
import { FRAMES, FPS, W, clamp } from './sketch.js';
import renderProfiles from './render-profiles.json' with { type: 'json' };

const qs = id => document.getElementById(id);
const canvas = qs('film'), audio = qs('soundtrack');
const playButton = qs('play'), seek = qs('seek'), mute = qs('mute');
const params = new URLSearchParams(location.search), isRender = params.has('render');
if (isRender) document.documentElement.classList.add('render-mode');
let renderer, frame = 0, playing = false, raf = 0, ended = false;
let serial = 0;
const icons = {
  play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zm13 0 5 6m0-6-5 6"/>',
};
function showFrame(f) { frame = renderer.renderFrame(f); window.animation.frame = frame; return frame; }
function updateControls() {
  seek.value = String(frame); seek.style.setProperty('--progress', `${frame / (FRAMES - 1) * 100}%`);
  const sec = ended ? 30 : Math.floor(frame / FPS);
  qs('time').value = `00:${String(sec).padStart(2, '0')} / 00:30`;
  seek.setAttribute('aria-valuetext', `${(frame / FPS).toFixed(2)} 秒，第 ${frame + 1} 帧`);
  playButton.setAttribute('aria-label', playing ? '暂停' : ended ? '重播' : '播放');
  playButton.querySelector('svg').innerHTML = playing ? icons.pause : icons.play;
  playButton.querySelector('span').textContent = playing ? '暂停' : ended ? '重播' : '播放';
  window.animation.playing = playing;
}
function tick() {
  if (!playing) return;
  if (audio.currentTime >= 30 || audio.ended) { finish(); return; }
  showFrame(Math.min(FRAMES - 1, Math.floor((audio.currentTime + 1e-6) * FPS))); updateControls();
  raf = requestAnimationFrame(tick);
}
function pause() { serial++; playing = false; audio.pause(); cancelAnimationFrame(raf); if (renderer) updateControls(); }
async function play() {
  if (!window.animation.ready) return;
  if (ended || frame >= FRAMES - 1) seekTo(0);
  const token = ++serial;
  try {
    await audio.play();
    if (serial !== token) return;
    playing = true; ended = false; updateControls(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    qs('error').hidden = true;
  } catch (e) { playing = false; updateControls(); const error = qs('error'); error.hidden = false; error.textContent = `音轨未能播放：${e instanceof Error ? e.message : String(e)}`; }
}
function seekTo(f) {
  f = Math.floor(clamp(f, 0, FRAMES - 1)); ended = f === FRAMES - 1;
  audio.currentTime = f / FPS; showFrame(f); updateControls();
  if (ended && playing) pause();
}
function finish() { pause(); ended = true; showFrame(FRAMES - 1); updateControls(); }
window.animation = { frame: 0, ready: false, playing: false, renderFrame: showFrame, cues, seek: seekTo, play, pause };
window.renderFrame = showFrame;
window.animationReady = (async () => {
  const resolution = isRender ? params.get('resolution') ?? '1080p' : '1080p';
  if (!Object.hasOwn(renderProfiles, resolution) || (isRender && params.getAll('resolution').length > 1)) throw new Error('导出分辨率请使用 resolution=1080p 或 resolution=4k。');
  const profile = renderProfiles[resolution];
  if (isRender) {
    document.documentElement.style.setProperty('--render-width', `${profile.width}px`);
    document.documentElement.style.setProperty('--render-height', `${profile.height}px`);
  }
  await Promise.all([document.fonts.load('26px "Patrick Hand"'), document.fonts.load('40px "Lilita One"'), document.fonts.load('700 100px "Caveat"'), document.fonts.load('40px "ZCOOL KuaiLe"')]);
  await document.fonts.ready;
  if (!isRender && audio.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise((resolve, reject) => { audio.addEventListener('loadedmetadata', () => resolve(), { once: true }); audio.addEventListener('error', () => reject(new Error('音轨无法加载。')), { once: true }); });
  }
  renderer = new Renderer(canvas, profile.width / W); window.animation.ready = true;
  showFrame(Number(params.get('frame') || 0)); updateControls(); qs('loading').hidden = true;
  [playButton, seek, mute, qs('replay')].forEach(b => b.disabled = false);
})().catch(e => { const error = qs('error'); error.textContent = `加载失败：${e.message}`; error.hidden = false; qs('loading').textContent = '加载失败，请刷新后重试'; throw e; });
// The UI reports loading failures; exporters still receive the rejected promise.
void window.animationReady.catch(() => {});
playButton.addEventListener('click', () => { if (playing) pause(); else void play(); });
qs('replay').addEventListener('click', () => { pause(); seekTo(0); void play(); });
seek.addEventListener('input', () => { seekTo(Number(seek.value)); });
mute.addEventListener('click', () => { audio.muted = !audio.muted; mute.setAttribute('aria-pressed', String(audio.muted)); mute.setAttribute('aria-label', audio.muted ? '取消静音' : '静音'); mute.title = audio.muted ? '取消静音' : '静音'; mute.querySelector('svg').innerHTML = audio.muted ? icons.mute : icons.sound; });
qs('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.player').requestFullscreen(); } catch { /* Unsupported in some embedded browser views. */ }
});
audio.addEventListener('ended', finish);
audio.addEventListener('pause', () => { if (playing && !audio.ended) { playing = false; cancelAnimationFrame(raf); updateControls(); } });
document.addEventListener('keydown', e => {
  if (!window.animation.ready || isRender || e.altKey || e.ctrlKey || e.metaKey) return;
  const focused = e.target; if (focused.matches('input, button, a, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); if (playing) pause(); else void play(); }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); pause(); seekTo(frame + (e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? FPS : 1)); }
  if (e.code === 'KeyM') mute.click();
});
