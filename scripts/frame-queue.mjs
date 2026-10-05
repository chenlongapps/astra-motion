// Ordered delivery for parallel frame capture.
//
// Workers render frames concurrently and finish out of order, while the encoder
// and the on-disk caches must receive them in frame order. The queue buffers
// every published frame, releases the next one as soon as its turn comes, and
// only resolves a worker's publish once that frame has been written, so at most
// one frame per worker is ever held in memory.

export function createFrameQueue({ total = 0, write = async () => {} } = {}) {
  const ready = new Map();
  let next = 0, failure = null, chain = Promise.resolve();

  function reject(error) {
    for (const entry of ready.values()) entry.reject(error);
    ready.clear();
  }

  function flush() {
    chain = chain.then(async () => {
      while (next < total && ready.has(next)) {
        const index = next, entry = ready.get(index);
        ready.delete(index);
        // Claim the index before awaiting so a failed write cannot leave the
        // queue waiting forever on a frame that was already consumed.
        next += 1;
        try {
          await write(entry.payload, index);
          entry.resolve();
        } catch (error) {
          failure ??= error;
          // The failing frame is no longer queued, so it needs its own rejection
          // before the frames still waiting for their turn are released.
          entry.reject(error);
          reject(error);
          return;
        }
      }
    }).catch(() => {});
    return chain;
  }

  return {
    get failure() { return failure; },
    get pending() { return ready.size; },
    get written() { return next; },
    // Resolves once this frame has been written in order; rejects immediately if
    // the queue already failed, so workers stop instead of rendering ahead.
    publish(index, payload) {
      if (failure) return Promise.reject(failure);
      if (!Number.isInteger(index) || index < 0 || index >= total) return Promise.reject(new Error(`Frame index ${index} is outside the 0–${total - 1} capture range.`));
      if (index < next) return Promise.reject(new Error(`Frame index ${index} was already written.`));
      if (ready.has(index)) return Promise.reject(new Error(`Frame index ${index} was published twice.`));
      let resolve, rejectEntry;
      const waiting = new Promise((settle, fail) => { resolve = settle; rejectEntry = fail; });
      ready.set(index, { payload, resolve: resolve, reject: rejectEntry });
      void flush();
      return waiting;
    },
    // Wait until every published frame reached the writer.
    async settled() {
      await chain;
      if (failure) throw failure;
      if (next !== total) throw new Error(`Only ${next} of ${total} frames reached the encoder.`);
    },
    // Stop every worker: queued frames are rejected and later publishes fail.
    abort(error = new Error('Frame capture was aborted.')) {
      failure ??= error;
      reject(error);
    },
  };
}
