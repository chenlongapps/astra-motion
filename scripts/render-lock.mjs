import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function isProcessRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function listProcesses() {
  const { stdout } = await run('ps', ['-axww', '-o', 'comm='], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 ** 22 });
  return stdout.split('\n').map(command => command.trim()).filter(Boolean);
}

async function readLock(file) {
  let contents;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let owner;
  try { owner = JSON.parse(contents); } catch { /* A new owner may still be writing its metadata. */ }
  return { contents, owner };
}

function lockedError(directory, file, owner, reason, cause) {
  return new Error(`Export directory is locked: ${directory}${owner?.pid ? ` (PID ${owner.pid})` : ''}.\n${reason}\nWait for the current export. If it was interrupted, confirm that no exporter or FFmpeg is writing here before removing ${file}.`, { cause });
}

function ownerStatus(owner, probe) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || !owner.token) return 'Lock metadata is incomplete; automatic recovery is unavailable.';
  try { return probe(owner.pid) ? 'The lock owner is still running.' : null; }
  catch (error) { return `Cannot check the lock owner; automatic recovery is unavailable: ${error.message}`; }
}

export async function createRenderWorkspace(directory) {
  const workspace = await mkdtemp(path.join(directory, '.render-'));
  return { workspace, temporary: path.join(workspace, 'astra-motion.partial.mp4') };
}

// A dead parent can leave FFmpeg alive. Recover only after both checks pass,
// and serialize recovery so competing exporters cannot unlink a new lock.
export async function acquireRenderLock(directory, { probe = isProcessRunning, processes = listProcesses } = {}) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, '.render.lock'), token = randomUUID();
  let handle, recoveredOwner;
  while (!handle) {
    try { handle = await open(file, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readLock(file);
      if (!previous) continue;
      const reason = ownerStatus(previous.owner, probe);
      if (reason) throw lockedError(directory, file, previous.owner, reason, error);
      const recoveryFile = `${file}.recovery`;
      let recovery;
      try { recovery = await open(recoveryFile, 'wx'); }
      catch (recoveryError) {
        if (recoveryError.code !== 'EEXIST') throw recoveryError;
        throw lockedError(directory, recoveryFile, previous.owner, 'Another exporter is recovering the lock, or its recovery was interrupted.', recoveryError);
      }
      try {
        await recovery.writeFile(JSON.stringify({ token, pid: process.pid }) + '\n');
        const current = await readLock(file);
        if (!current) continue;
        if (current.contents !== previous.contents) throw lockedError(directory, file, current.owner, 'Lock ownership changed during recovery.', error);
        const status = ownerStatus(current.owner, probe);
        if (status) throw lockedError(directory, file, current.owner, status, error);
        let commands;
        try {
          commands = await processes();
          if (!commands.length) throw new Error('The process listing is empty.');
        }
        catch (processError) { throw lockedError(directory, file, current.owner, `Cannot check active encoders; automatic recovery is unavailable: ${processError.message}`, processError); }
        // Check every FFmpeg, including unrelated encodes: old output paths or
        // directory aliases cannot reliably identify an orphaned writer.
        if (commands.some(command => /^ffmpeg(?:\.exe)?$/i.test(path.basename(command)))) throw lockedError(directory, file, current.owner, 'FFmpeg is still running; automatic recovery is deferred.', error);
        const latest = await readLock(file);
        if (!latest) continue;
        if (latest.contents !== current.contents) throw lockedError(directory, file, latest.owner, 'Lock ownership changed during recovery.', error);
        await unlink(file);
        recoveredOwner = current.owner;
      } finally {
        try { await recovery.close(); }
        finally { await unlink(recoveryFile); }
      }
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString(), command: process.argv.slice(1) }) + '\n');
  } catch (error) {
    await unlink(file);
    throw error;
  } finally { await handle.close(); }
  let released = false;
  return {
    file,
    recoveredOwner,
    async release() {
      if (released) return;
      const owner = JSON.parse(await readFile(file, 'utf8'));
      if (owner.token !== token) throw new Error(`Export lock ownership changed; refusing to remove ${file}.`);
      await unlink(file);
      released = true;
    },
  };
}
