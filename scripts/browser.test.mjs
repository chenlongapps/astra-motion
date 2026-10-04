import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Cdp, Page } from './browser.mjs';

class Socket extends EventTarget {
  readyState = WebSocket.OPEN;
  commands = [];
  send(data) { this.commands.push(JSON.parse(data)); }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close() { this.readyState = WebSocket.CLOSED; this.dispatchEvent(new Event('close')); }
}

test('CDP correlates out-of-order command responses and forwards browser events', async () => {
  const socket = new Socket(), connection = new Cdp(socket);
  const first = connection.send('Page.enable'), second = connection.send('Runtime.enable');
  let event;
  connection.on('Page.lifecycleEvent', value => { event = value; });
  socket.reply({ method: 'Page.lifecycleEvent', params: { name: 'DOMContentLoaded' } });
  socket.reply({ id: 2, result: { second: true } }); socket.reply({ id: 1, result: { first: true } });
  assert.deepEqual(await first, { first: true }); assert.deepEqual(await second, { second: true });
  assert.deepEqual(event, { name: 'DOMContentLoaded' }); assert.equal(connection.pending.size, 0);
  connection.close();
});

test('CDP surfaces protocol errors and expires commands instead of hanging', async () => {
  const socket = new Socket(), connection = new Cdp(socket);
  const failed = connection.send('Page.captureScreenshot');
  socket.reply({ id: 1, error: { message: 'Invalid clip' } });
  await assert.rejects(failed, /Page.captureScreenshot: Invalid clip/);
  await assert.rejects(connection.send('Runtime.evaluate', {}, 10), /timed out/);
  assert.equal(connection.pending.size, 0); connection.close();
});

test('CDP disconnect rejects outstanding and future commands and clears deadlines', async () => {
  const socket = new Socket(), connection = new Cdp(socket);
  const pending = connection.send('Runtime.evaluate'); socket.close();
  await assert.rejects(pending, /disconnected/);
  await assert.rejects(connection.send('Page.enable'), /not connected/);
  assert.equal(connection.pending.size, 0);
});

test('navigation waits for DOMContentLoaded from its own loader, not an earlier document', async () => {
  const connection = new EventEmitter(), page = new Page(connection, {}, 'test');
  let completed = false;
  connection.send = async () => {
    connection.emit('Page.lifecycleEvent', { name: 'DOMContentLoaded', loaderId: 'old' });
    queueMicrotask(() => {
      assert.equal(completed, false);
      connection.emit('Page.lifecycleEvent', { name: 'DOMContentLoaded', loaderId: 'new' });
    });
    return { loaderId: 'new' };
  };
  await page.goto('http://localhost/'); completed = true;
  assert.equal(connection.listenerCount('Page.lifecycleEvent'), 0);
});

test('failed or timed-out navigation removes its lifecycle listener', async () => {
  const connection = new EventEmitter(), page = new Page(connection, {}, 'test');
  connection.send = async () => ({ errorText: 'net::ERR_CONNECTION_REFUSED' });
  await assert.rejects(page.goto('http://localhost/'), /Navigation failed/);
  assert.equal(connection.listenerCount('Page.lifecycleEvent'), 0);
  connection.send = async () => ({ loaderId: 'pending' }); page.setDefaultTimeout(5);
  await assert.rejects(page.goto('http://localhost/'), /Navigation timed out/);
  assert.equal(connection.listenerCount('Page.lifecycleEvent'), 0);
});

test('page evaluation awaits promises, safely serializes arguments, and reports script failures', async () => {
  const connection = new EventEmitter(), page = new Page(connection, {}, 'test');
  connection.send = async (method, options) => {
    assert.equal(method, 'Runtime.evaluate'); assert.equal(options.awaitPromise, true); assert.equal(options.returnByValue, true);
    return { result: { value: await eval(options.expression) } };
  };
  assert.deepEqual(await page.evaluate(async value => value, { text: 'quotes " and \n newline', frame: 899 }), { text: 'quotes " and \n newline', frame: 899 });
  connection.send = async () => ({ exceptionDetails: { exception: { description: 'Error: font failed' } } });
  await assert.rejects(page.evaluate(() => null), /font failed/);
});
