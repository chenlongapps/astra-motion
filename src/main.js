import { Renderer, cues } from './renderer.js';
import { W, clamp } from './sketch.js';
import { BASE_FPS, DEFAULT_FPS, DURATION, SUPPORTED_FPS, frameTiming, parseFps } from './frame-timing.js';
import renderProfiles from './render-profiles.json' with { type: 'json' };
import { exportVideo, getExportSupport } from './browser-export.js';

const qs = id => document.getElementById(id);
const canvas = qs('film'), audio = qs('soundtrack');
const playButton = qs('play'), seek = qs('seek'), mute = qs('mute');
const exportDialog = qs('export-dialog');
const resolutionButtons = [...qs('resolution').querySelectorAll('button')];
const fpsButtons = [...qs('export-fps').querySelectorAll('button')];
const params = new URLSearchParams(location.search), isRender = params.has('render');
let fps = DEFAULT_FPS, frames = frameTiming().frames;
if (isRender) document.documentElement.classList.add('render-mode');
let renderer, frame = 0, playing = false, raf = 0, ended = false;
let serial = 0, exporting = false, exportController, exportSupport, downloadUrl, downloadResolution, downloadFps;
let exportResolution = '1080p', exportFps = DEFAULT_FPS;
const preferredFps = [DEFAULT_FPS, ...SUPPORTED_FPS.filter(value => value !== DEFAULT_FPS)];
const supportFor = (resolution = exportResolution, rate = exportFps) => exportSupport?.[resolution]?.[rate];
const filenameFor = (resolution, rate) => `astra-motion-${resolution}-${rate}fps.mp4`;
const icons = {
  play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zm13 0 5 6m0-6-5 6"/>',
};
function showFrame(f) { frame = renderer.renderFrame(f); window.animation.frame = frame; return frame; }
function updateControls() {
  seek.value = String(frame); seek.style.setProperty('--progress', `${frame / (frames - 1) * 100}%`);
  const sec = ended ? DURATION : Math.floor(frame / fps);
  qs('time').value = `00:${String(sec).padStart(2, '0')} / 00:30`;
  seek.setAttribute('aria-valuetext', `${(frame / fps).toFixed(2)} 秒，第 ${frame + 1} 帧`);
  playButton.setAttribute('aria-label', playing ? '暂停' : ended ? '重播' : '播放');
  playButton.querySelector('svg').innerHTML = playing ? icons.pause : icons.play;
  playButton.querySelector('span').textContent = playing ? '暂停' : ended ? '重播' : '播放';
  window.animation.playing = playing;
}
function tick() {
  if (!playing) return;
  if (audio.currentTime >= DURATION || audio.ended) { finish(); return; }
  const next = Math.min(frames - 1, Math.floor((audio.currentTime + 1e-6) * fps));
  if (next !== frame) { showFrame(next); updateControls(); }
  raf = requestAnimationFrame(tick);
}
function pause() { serial++; playing = false; audio.pause(); cancelAnimationFrame(raf); if (renderer) updateControls(); }
async function play() {
  if (!window.animation.ready || exporting || exportDialog.open) return;
  if (ended || frame >= frames - 1) seekTo(0);
  const token = ++serial;
  try {
    await audio.play();
    if (serial !== token) return;
    playing = true; ended = false; updateControls(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    qs('error').hidden = true;
  } catch (e) { playing = false; updateControls(); const error = qs('error'); error.hidden = false; error.textContent = `音轨未能播放：${e instanceof Error ? e.message : String(e)}`; }
}
function seekTo(f) {
  if (exporting || exportDialog.open) return;
  f = Math.floor(clamp(f, 0, frames - 1)); ended = f === frames - 1;
  audio.currentTime = f / fps; showFrame(f); updateControls();
  if (ended && playing) pause();
}
function finish() { pause(); ended = true; showFrame(frames - 1); updateControls(); }
window.animation = { frame: 0, ready: false, playing: false, exporting: false, renderFrame: showFrame, seek: seekTo, play, pause };
window.renderFrame = showFrame;
window.animationReady = (async () => {
  if (params.getAll('fps').length > 1) throw new Error('帧率 fps 只能指定一次。');
  fps = parseFps(params.get('fps') ?? undefined);
  frames = frameTiming(fps).frames;
  Object.assign(window.animation, { fps, frames, duration: DURATION, cues: Object.fromEntries(Object.entries(cues).map(([key, value]) => [key, value * fps / BASE_FPS])) });
  seek.max = String(frames - 1);
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
  renderer = new Renderer(canvas, profile.width / W, fps); window.animation.ready = true;
  showFrame(Number(params.get('frame') || 0)); updateControls(); qs('loading').hidden = true;
  [playButton, seek, mute, qs('replay')].forEach(b => b.disabled = false);
})().catch(e => { const error = qs('error'); error.textContent = `加载失败：${e.message}`; error.hidden = false; qs('loading').textContent = '加载失败，请刷新后重试'; throw e; });
// The UI reports loading failures; exporters still receive the rejected promise.
void window.animationReady.catch(() => {});
playButton.addEventListener('click', () => { if (playing) pause(); else void play(); });
qs('replay').addEventListener('click', () => { if (exporting || exportDialog.open) return; pause(); seekTo(0); void play(); });
seek.addEventListener('input', () => { seekTo(Number(seek.value)); });
mute.addEventListener('click', () => { audio.muted = !audio.muted; mute.setAttribute('aria-pressed', String(audio.muted)); mute.setAttribute('aria-label', audio.muted ? '取消静音' : '静音'); mute.title = audio.muted ? '取消静音' : '静音'; mute.querySelector('svg').innerHTML = audio.muted ? icons.mute : icons.sound; });
qs('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.player').requestFullscreen(); } catch { /* Unsupported in some embedded browser views. */ }
});
audio.addEventListener('ended', finish);
audio.addEventListener('pause', () => { if (playing && !audio.ended) { playing = false; cancelAnimationFrame(raf); updateControls(); } });
document.addEventListener('keydown', e => {
  if (!window.animation.ready || isRender || exporting || exportDialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
  const focused = e.target; if (focused.matches('input, button, a, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); if (playing) pause(); else void play(); }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); pause(); seekTo(frame + (e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? fps : 1)); }
  if (e.code === 'KeyM') mute.click();
});

function updateExportAvailability() {
  const supported = !!supportFor()?.supported;
  for (const button of resolutionButtons) {
    const available = SUPPORTED_FPS.some(rate => supportFor(button.value, rate)?.supported);
    button.disabled = exporting || !available;
    button.setAttribute('aria-pressed', String(button.value === exportResolution));
    button.querySelector('.resolution-note').textContent = available ? button.value === '4k' ? 'Ultra HD' : 'Full HD' : '设备不支持';
    button.title = available ? '' : supportFor(button.value)?.reason ?? '';
  }
  for (const button of fpsButtons) {
    const support = supportFor(exportResolution, Number(button.value));
    button.disabled = exporting || !support?.supported;
    button.setAttribute('aria-pressed', String(Number(button.value) === exportFps));
    button.title = support?.reason ?? '';
  }
  qs('export').disabled = isRender || exporting || !window.animation.ready;
  qs('export-start').disabled = exporting || !supported;
  qs('download').disabled = exporting || !downloadUrl;
  qs('export-close').disabled = exporting;
  qs('export-again').disabled = exporting;
}
function updateExportDetails() {
  const resolution = exportResolution, profile = renderProfiles[resolution];
  qs('export-filename').textContent = filenameFor(resolution, exportFps);
  qs('export-frame-rate').textContent = `${exportFps} fps`;
  qs('export-progress').max = frameTiming(exportFps).frames;
  qs('export-dimensions').textContent = `${resolution === '4k' ? '4K UHD' : '1080p'} · ${profile.width} × ${profile.height}`;
}
function showSettingsStatus() {
  const support = supportFor();
  qs('export-status').textContent = support ? support.reason || '导出完整 30 秒短片' : '正在检查导出能力…';
}
function setExportState(state) {
  exportDialog.dataset.state = state;
  qs('export-quality').hidden = state === 'complete';
  qs('export-result').hidden = state !== 'complete';
  qs('export-progress-panel').hidden = state !== 'exporting';
  qs('export-percent').hidden = state !== 'exporting';
  qs('export-start').hidden = state !== 'settings';
  qs('export-cancel').hidden = state !== 'exporting';
  qs('download').hidden = state !== 'complete';
  qs('export-again').hidden = state !== 'complete';
  qs('export-footer-note').textContent = state === 'complete' ? '文件已保留，可重复下载' : state === 'exporting' ? '正在生成完整短片' : '导出后，手动下载到设备';
  updateExportAvailability();
}
function releaseDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = downloadResolution = downloadFps = undefined;
  qs('download').disabled = true;
}
function setExportBusy(busy) {
  exporting = busy; window.animation.exporting = busy;
  exportDialog.setAttribute('aria-busy', String(busy));
  [playButton, seek, qs('replay')].forEach(button => button.disabled = busy);
  qs('export-cancel').disabled = false;
  updateExportAvailability();
}
window.exportReady = isRender ? Promise.resolve() : window.animationReady.then(async () => {
  updateExportAvailability();
  qs('export-status').textContent = '正在检查导出能力…';
  exportSupport = await getExportSupport();
  if (!supportFor().supported) {
    const available = Object.keys(exportSupport).flatMap(resolution => preferredFps.map(rate => ({ resolution, rate }))).find(({ resolution, rate }) => supportFor(resolution, rate)?.supported);
    if (available) { exportResolution = available.resolution; exportFps = available.rate; }
  }
  updateExportDetails(); showSettingsStatus();
  updateExportAvailability();
}).catch(() => {
  if (window.animation.ready) qs('export-status').textContent = '无法检查导出能力，请刷新后重试。';
  updateExportAvailability();
});
qs('export').addEventListener('click', () => {
  if (isRender || exporting || !window.animation.ready || exportDialog.open) return;
  pause();
  if (downloadUrl && exportDialog.dataset.state === 'settings') {
    exportResolution = downloadResolution; exportFps = downloadFps; updateExportDetails(); setExportState('complete');
    qs('export-error').hidden = true; qs('export-status').textContent = '文件已就绪，可以下载';
  }
  const preview = qs('export-preview');
  preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
  preview.setAttribute('aria-label', `当前第 ${frame + 1} 帧的导出预览`);
  qs('export-preview-frame').textContent = `第 ${frame + 1} 帧`;
  qs('export-preview-time').textContent = `00:${String(Math.floor(frame / fps)).padStart(2, '0')}`;
  exportDialog.showModal(); document.documentElement.classList.add('export-open');
  const selectedButton = resolutionButtons.find(button => button.value === exportResolution);
  const focusTarget = exportDialog.dataset.state === 'complete' ? qs('download') : selectedButton.disabled ? qs('export-close') : selectedButton;
  focusTarget.focus();
});
function closeExportDialog() { if (!exporting) exportDialog.close(); }
qs('export-close').addEventListener('click', closeExportDialog);
exportDialog.addEventListener('cancel', event => { event.preventDefault(); closeExportDialog(); });
exportDialog.addEventListener('close', () => {
  if (exportDialog.open) return;
  document.documentElement.classList.remove('export-open');
  qs('export').focus({ preventScroll: true });
});
exportDialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const buttons = [...exportDialog.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length > 0);
  const first = buttons[0], last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
for (const button of resolutionButtons) button.addEventListener('click', () => {
  if (exporting || exportDialog.dataset.state !== 'settings' || !SUPPORTED_FPS.some(rate => supportFor(button.value, rate)?.supported)) return;
  exportResolution = button.value;
  if (!supportFor()?.supported) exportFps = preferredFps.find(rate => supportFor(exportResolution, rate)?.supported);
  updateExportAvailability();
  qs('export-error').hidden = true;
  updateExportDetails(); showSettingsStatus();
});
for (const button of fpsButtons) button.addEventListener('click', () => {
  const rate = Number(button.value);
  if (exporting || exportDialog.dataset.state !== 'settings' || !supportFor(exportResolution, rate)?.supported) return;
  exportFps = rate;
  qs('export-error').hidden = true;
  updateExportAvailability(); updateExportDetails(); showSettingsStatus();
});
for (const [id, buttons] of [['resolution', resolutionButtons], ['export-fps', fpsButtons]]) qs(id).addEventListener('keydown', event => {
  if (!buttons.includes(event.target) || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const available = buttons.filter(button => !button.disabled);
  const index = available.indexOf(event.target);
  const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1) : available[(index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
  if (!next) return;
  event.preventDefault(); next.focus(); next.click();
});
qs('export-again').addEventListener('click', () => {
  if (exporting || !exportDialog.open) return;
  qs('export-error').hidden = true;
  setExportState('settings'); showSettingsStatus();
  resolutionButtons.find(button => button.value === exportResolution).focus();
});
qs('export-start').addEventListener('click', async () => {
  if (isRender || exporting || !exportDialog.open || exportDialog.dataset.state !== 'settings' || !window.animation.ready || !supportFor()?.supported) return;
  const resolution = exportResolution, rate = exportFps, totalFrames = frameTiming(rate).frames;
  const label = `${resolution === '4k' ? '4K' : '1080p'} / ${rate} fps`;
  pause(); releaseDownload(); setExportBusy(true);
  setExportState('exporting');
  exportController = new AbortController();
  qs('export-error').hidden = true;
  qs('export-progress').value = 0; qs('export-percent').value = '0%';
  qs('export-progress').setAttribute('aria-valuetext', `0%，0 / ${totalFrames} 帧`);
  qs('export-status').textContent = '正在准备配乐…';
  qs('export-cancel').focus();
  let nextState = 'settings', lastStage;
  try {
    const blob = await exportVideo({ resolution, fps: rate, signal: exportController.signal, onProgress({ stage, completed, total }) {
      qs('export-progress').max = total;
      qs('export-progress').value = completed;
      const percent = `${Math.floor(completed / total * 100)}%`;
      qs('export-percent').value = percent;
      qs('export-progress').setAttribute('aria-valuetext', `${percent}，${completed} / ${total} 帧`);
      if (exportController.signal.aborted) return;
      if (stage === 'preparing') qs('export-status').textContent = '正在准备配乐…';
      else if (stage === 'finalizing') qs('export-status').textContent = '正在封装 MP4…';
      else if (stage !== lastStage || completed % (rate / 2) === 0 || completed === total) qs('export-status').textContent = `正在导出 ${label} · ${completed} / ${total} 帧`;
      lastStage = stage;
    } });
    if (exportController.signal.aborted) throw new DOMException('已取消导出。', 'AbortError');
    downloadUrl = URL.createObjectURL(blob);
    downloadResolution = resolution;
    downloadFps = rate;
    qs('download').dataset.filename = filenameFor(resolution, rate);
    qs('export-size').textContent = `${(blob.size / 1024 ** 2).toFixed(1)} MB`;
    qs('export-status').textContent = '文件已就绪，可以下载';
    nextState = 'complete';
  } catch (error) {
    if (error?.name === 'AbortError') qs('export-status').textContent = '已取消导出，可以重新开始';
    else {
      qs('export-status').textContent = '导出失败，请重试';
      qs('export-error').textContent = error instanceof Error ? error.message : String(error);
      qs('export-error').hidden = false;
    }
  } finally {
    exportController = undefined; setExportBusy(false); setExportState(nextState);
    if (exportDialog.open) (nextState === 'complete' ? qs('download') : qs('export-start')).focus();
  }
});
qs('export-cancel').addEventListener('click', () => {
  if (!exportController) return;
  qs('export-cancel').disabled = true; qs('export-status').textContent = '正在取消…'; exportController.abort();
});
qs('download').addEventListener('click', () => {
  if (!downloadUrl || exporting) return;
  const link = document.createElement('a'); link.href = downloadUrl; link.download = qs('download').dataset.filename;
  document.body.append(link); link.click(); link.remove();
});
window.addEventListener('pagehide', () => { exportController?.abort(); releaseDownload(); });
