import { Renderer } from './renderer.js';
import { FPS, FRAMES, W } from './sketch.js';
import profiles from './render-profiles.json' with { type: 'json' };
import { muxMp4, readAacTrack } from './mp4.js';

const codecs = { '1080p': 'avc1.420028', '4k': 'avc1.420033' };
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
const abortError = () => new DOMException('已取消导出。', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function configFor(resolution) {
  if (!Object.hasOwn(profiles, resolution)) throw new Error('请选择 1080p 或 4K。');
  const { width, height, bitrate } = profiles[resolution];
  return { codec: codecs[resolution], width, height, bitrate: Number.parseFloat(bitrate) * 1e6, framerate: FPS, latencyMode: 'realtime', hardwareAcceleration: 'no-preference', avc: { format: 'avc' } };
}

export async function getExportSupport() {
  const result = {};
  for (const resolution of Object.keys(profiles)) {
    let reason = '';
    if (!globalThis.isSecureContext) reason = '请通过 HTTPS 或 localhost 打开网页后导出。';
    else if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') reason = '此浏览器暂不支持逐帧 MP4 导出，请使用新版 Chrome 或 Edge。';
    else {
      try { if (!(await VideoEncoder.isConfigSupported(configFor(resolution))).supported) reason = `此设备暂不支持 ${resolution === '4k' ? '4K' : '1080p'} MP4 编码。`; }
      catch { reason = '无法检查视频编码能力，请更新浏览器后重试。'; }
    }
    result[resolution] = { supported: !reason, reason };
  }
  return result;
}

export async function exportVideo({ resolution = '1080p', signal, onProgress = () => {} } = {}) {
  const config = configFor(resolution);
  checkAbort(signal);
  const support = await getExportSupport();
  checkAbort(signal);
  if (!support[resolution].supported) throw new Error(support[resolution].reason);
  onProgress({ stage: 'preparing', completed: 0, total: FRAMES });
  await Promise.all([document.fonts.load('26px "Patrick Hand"'), document.fonts.load('40px "Lilita One"'), document.fonts.load('700 100px "Caveat"'), document.fonts.load('40px "ZCOOL KuaiLe"')]);
  await document.fonts.ready;
  checkAbort(signal);
  const response = await fetch(new URL('../audio/generated.m4a', import.meta.url), { signal });
  if (!response.ok) throw new Error('导出配乐无法加载，请刷新后重试。');
  const audioTrack = readAacTrack(await response.arrayBuffer());
  if (Math.abs(audioTrack.duration - FRAMES / FPS) > 1 / 48000) throw new Error('导出配乐时长与动画不匹配。');
  checkAbort(signal);
  const surface = document.createElement('canvas');
  let renderer, encoder, videoConfig, failure, rejectWait;
  const samples = [];
  let rejectFailure;
  const failed = new Promise((resolve, reject) => { rejectFailure = reject; });
  void failed.catch(() => {});
  function fail(error) {
    if (failure) return;
    failure = error;
    rejectFailure(error); rejectWait?.(error);
  }
  function check() { checkAbort(signal); if (failure) throw failure; }
  function interrupt() {
    fail(abortError());
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
  function waitForCapacity() {
    check();
    if (encoder.encodeQueueSize < 3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { encoder.removeEventListener('dequeue', ready); rejectWait = null; };
      const ready = () => { if (encoder.encodeQueueSize < 3) { cleanup(); resolve(); } };
      rejectWait = error => { cleanup(); reject(error); };
      encoder.addEventListener('dequeue', ready);
      ready();
    });
  }
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    check();
    renderer = new Renderer(surface, config.width / W);
    encoder = new VideoEncoder({
      output(chunk, metadata) {
        if (failure) return;
        try {
          if (chunk.timestamp !== Math.round(samples.length * 1e6 / FPS)) throw new Error('浏览器输出的视频帧顺序异常，请更新浏览器后重试。');
          if (metadata.decoderConfig?.description) {
            const description = new Uint8Array(metadata.decoderConfig.description);
            if (videoConfig && (description.length !== videoConfig.length || description.some((byte, i) => byte !== videoConfig[i]))) throw new Error('浏览器在导出过程中改变了编码配置。');
            videoConfig = description.slice();
          }
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          samples.push({ data, key: chunk.type === 'key' });
        } catch (error) { fail(error); }
      },
      error(error) { fail(new Error(`视频编码失败：${error.message}`)); },
    });
    encoder.configure(config);
    for (let frame = 0; frame < FRAMES; frame++) {
      await waitForCapacity(); check();
      renderer.renderFrame(frame);
      const timestamp = Math.round(frame * 1e6 / FPS), duration = Math.round((frame + 1) * 1e6 / FPS) - timestamp;
      const videoFrame = new VideoFrame(surface, { timestamp, duration });
      try { encoder.encode(videoFrame, { keyFrame: frame % (FPS * 2) === 0 }); }
      finally { videoFrame.close(); }
      onProgress({ stage: 'rendering', completed: frame + 1, total: FRAMES });
      await yieldToBrowser(); check();
    }
    onProgress({ stage: 'finalizing', completed: FRAMES, total: FRAMES });
    await Promise.race([encoder.flush(), failed]); check();
    if (samples.length !== FRAMES) throw new Error(`浏览器只编码了 ${samples.length} / ${FRAMES} 帧，请重试。`);
    await yieldToBrowser(); check();
    return muxMp4({ width: config.width, height: config.height, fps: FPS, videoSamples: samples, videoConfig, audioTrack });
  } finally {
    signal?.removeEventListener('abort', interrupt);
    if (encoder && encoder.state !== 'closed') encoder.close();
    surface.width = surface.height = 1;
    if (renderer) renderer.texture.width = renderer.texture.height = 1;
    samples.length = 0;
  }
}
