import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile, rm, constants } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { createStaticServer } from './serve.mjs';
import { selectResolution } from './render-options.mjs';

export { root, output } from './render-options.mjs';

export async function chromiumPath() {
  const candidates = process.env.CHROMIUM_PATH ? [process.env.CHROMIUM_PATH] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap(name => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, name))),
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory, 'Google/Chrome/Application/chrome.exe')),
  ];
  for (const file of candidates) {
    try { await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return file; } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Install Chrome/Chromium, or set CHROMIUM_PATH to its executable. No browser is downloaded automatically.');
}

// A small CDP transport over Node's built-in WebSocket, not a browser automation
// framework. Each pending command has a deadline and is rejected on disconnect.
export class Cdp extends EventEmitter {
  constructor(socket) {
    super(); this.socket = socket; this.pending = new Map(); this.nextId = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const command = this.pending.get(message.id);
        if (!command) return;
        this.pending.delete(message.id); clearTimeout(command.timer);
        if (message.error) command.reject(new Error(`${command.method}: ${message.error.message}`));
        else command.resolve(message.result);
      } else this.emit(message.method, message.params);
    });
    const disconnected = () => {
      for (const command of this.pending.values()) { clearTimeout(command.timer); command.reject(new Error(`Browser disconnected during ${command.method}`)); }
      this.pending.clear();
    };
    socket.addEventListener('close', disconnected);
    socket.addEventListener('error', disconnected);
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('Browser WebSocket connection timed out')); }, 15000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to browser WebSocket')); }, { once: true });
      });
      return new Cdp(socket);
    } catch (error) { socket.close(); throw error; }
  }
  send(method, params = {}, timeout = 15000) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`Browser is not connected: ${method}`));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() { this.socket.close(); }
}

export class Page {
  constructor(connection, browser, id) {
    this.connection = connection; this.browser = browser; this.id = id; this.timeout = 15000; this.errors = [];
    connection.on('Runtime.exceptionThrown', ({ exceptionDetails }) => this.errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
  }
  on(...args) { this.connection.on(...args); return this; }
  send(method, params) { return this.connection.send(method, params, this.timeout); }
  setDefaultTimeout(timeout) { this.timeout = timeout; }
  async evaluate(fn, argument) {
    const expression = `(${fn.toString()})(${argument === undefined ? '' : JSON.stringify(argument)})`;
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
  async waitForFunction(fn, argument) {
    const deadline = performance.now() + this.timeout;
    do {
      if (await this.evaluate(fn, argument)) return;
      await delay(50);
    } while (performance.now() < deadline);
    throw new Error(`Browser condition timed out: ${fn}`);
  }
  async goto(url) {
    // readyState becomes "interactive" before deferred module scripts execute.
    // Wait for this navigation's actual DOMContentLoaded event, not an old page
    // or an undefined animationReady promise during module initialization.
    const loaded = new Set();
    const listener = event => { if (event.name === 'DOMContentLoaded') loaded.add(event.loaderId); };
    this.connection.on('Page.lifecycleEvent', listener);
    try {
      const result = await this.send('Page.navigate', { url });
      if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
      if (result.loaderId) {
        const deadline = performance.now() + this.timeout;
        while (!loaded.has(result.loaderId)) {
          if (performance.now() >= deadline) throw new Error(`Navigation timed out: ${url}`);
          await delay(20);
        }
      } else await this.waitForFunction(target => location.href === target && document.readyState !== 'loading', new URL(url).href);
    } finally { this.connection.removeListener('Page.lifecycleEvent', listener); }
  }
  async setViewportSize({ width, height }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    this.viewport = { width, height };
  }
  async screenshot({ path: file, fullPage = false, clip, optimizeForSpeed = false } = {}) {
    if (fullPage) {
      const { cssContentSize } = await this.send('Page.getLayoutMetrics');
      clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
    }
    const result = await this.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: fullPage, optimizeForSpeed,
      clip: clip ?? { x: 0, y: 0, ...this.viewport, scale: 1 },
    });
    const png = Buffer.from(result.data, 'base64');
    if (file) await writeFile(file, png);
    return png;
  }
  async close() {
    if (!this.browser.pages.delete(this)) return;
    try { await fetch(`${this.browser.endpoint}/json/close/${this.id}`, { signal: AbortSignal.timeout(3000) }); }
    finally { this.connection.close(); }
  }
}

export async function launchBrowser() {
  const executable = await chromiumPath();
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-chrome-'));
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${directory}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    // Keep all export/verification tabs unthrottled. Software Canvas prevents
    // Chrome's adaptive GPU-to-CPU readback switch from changing raster pixels.
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-accelerated-2d-canvas', '--disable-skia-runtime-opts', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError, stderr = '', exited = false, closing;
  child.on('error', error => { launchError = error; });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  const exit = new Promise(resolve => { child.once('close', () => { exited = true; resolve(); }); });
  const browser = {
    pages: new Set(), endpoint: '',
    async newPage({ viewport = { width: 1280, height: 720 } } = {}) {
      const response = await fetch(`${this.endpoint}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Cannot create browser page: HTTP ${response.status}`);
      const target = await response.json();
      const connection = await Cdp.connect(target.webSocketDebuggerUrl);
      const page = new Page(connection, this, target.id); this.pages.add(page);
      try {
        await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map(method => page.send(method)));
        await page.send('Page.setLifecycleEventsEnabled', { enabled: true });
        await page.setViewportSize(viewport);
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        return page;
      } catch (error) { await page.close(); throw error; }
    },
    close() {
      closing ??= (async () => {
        for (const page of this.pages) page.connection.close();
        this.pages.clear();
        if (!exited) {
          child.kill('SIGTERM');
          const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
          try { await exit; } finally { clearTimeout(timer); }
        }
        await rm(directory, { recursive: true, force: true });
      })();
      return closing;
    },
  };
  try {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      if (launchError || exited) throw new Error(`Chrome failed to start: ${launchError?.message ?? stderr}`);
      try {
        const [port] = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n');
        if (/^\d+$/.test(port)) { browser.endpoint = `http://127.0.0.1:${port}`; return browser; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(50);
    }
    throw new Error(`Chrome startup timed out. ${stderr}`);
  } catch (error) { await browser.close(); throw error; }
}

export async function openRenderer({ render = true, resolution = selectResolution(), width = resolution.width, height = resolution.height, handleSignals = true } = {}) {
  const server = await createStaticServer();
  let browser, closing;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const interrupt = () => { void close(); };
  function close() {
    closing ??= (async () => {
      for (const signal of signals) process.removeListener(signal, interrupt);
      try { await browser?.close(); } finally { await server.close(); }
    })();
    return closing;
  }
  try {
    browser = await launchBrowser();
    if (handleSignals) for (const signal of signals) process.once(signal, interrupt);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${server.url}${render ? `?render&resolution=${resolution.name}` : ''}`);
    await page.evaluate(() => window.animationReady);
    return { page, browser, server, url: server.url, errors: page.errors, close };
  } catch (error) { await close(); throw error; }
}
