export type WaitForConditionOptions = {
  timeoutMs: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCondition(
  predicate: () => boolean,
  options: WaitForConditionOptions
): Promise<boolean> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (predicate()) return true;

  return await new Promise(resolve => {
    let done = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let abortHandler: (() => void) | null = null;

    const cleanup = () => {
      if (poll) clearInterval(poll);
      if (timeout) clearTimeout(timeout);
      if (observer) observer.disconnect();
      if (abortHandler && options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    };

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(ok);
    };

    const check = () => {
      try {
        if (predicate()) finish(true);
      } catch {
        // ignore predicate errors; keep waiting
      }
    };

    poll = setInterval(check, pollIntervalMs);
    timeout = setTimeout(() => finish(false), options.timeoutMs);

    if (options.signal) {
      abortHandler = () => finish(false);
      if (options.signal.aborted) {
        finish(false);
        return;
      }
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      observer = new MutationObserver(() => check());
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch {
      // ignore observer errors
    }

    check();
  });
}
