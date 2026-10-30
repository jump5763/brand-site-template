/** The business API owns queued work; this process owns only the current execution. */
export function createBuilder({ api, execute, pollIntervalMs = 5000, logger = console }) {
  let stopping = false;
  const cancellation = new AbortController();
  let loopPromise;
  let wake;
  const wait = () => new Promise((resolve) => {
    const timer = setTimeout(done, pollIntervalMs);
    function done() { clearTimeout(timer); wake = undefined; resolve(); }
    wake = done;
    if (stopping) done();
  });
  async function loop() {
    while (!stopping) {
      let job;
      try { job = await api("POST", "/internal/site-jobs/claim", undefined, { signal: cancellation.signal }); }
      catch (error) {
        if (stopping) return;
        if (error.status && error.status < 500) throw error;
        logger.error(`Builder claim unavailable: ${error.message}`);
        await wait();
        continue;
      }
      if (!job) { await wait(); continue; }
      logger.log(`Builder begin: ${job._id}; ${job.kind}`);
      // execute includes confirmation. An unresolved result stops further claiming.
      const result = await execute(job, { signal: cancellation.signal });
      logger.log(`Builder end: ${job._id}; ${result.status}`);
    }
  }
  const controller = {
    start() {
      if (!loopPromise) {
        loopPromise = loop().catch((error) => { stopping = true; logger.error(`Builder stopped: ${error.message}`); throw error; });
        void loopPromise.catch(() => {});
      }
      return controller;
    },
    get done() { return loopPromise ?? Promise.resolve(); },
  };
  controller.stop = controller.drain = () => { stopping = true; cancellation.abort(); wake?.(); return loopPromise ?? Promise.resolve(); };
  return controller;
}
