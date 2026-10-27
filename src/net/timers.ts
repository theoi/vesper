/** Minimal timer API so the host loop can run on unthrottled timers. */
export interface TimerApi {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** The page's own timers. */
export const plainTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

const WORKER_SOURCE = `
const timers = new Map();
onmessage = (e) => {
  const { op, id, ms } = e.data;
  if (op === 'set') {
    timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id); }, ms));
  } else {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
};
`;

/**
 * Timers that keep firing on time while the tab is hidden. Browsers throttle
 * main-thread timers in background tabs (Chrome aligns chained timers to once
 * a minute after a few minutes hidden), which would stall the host's game
 * loop. Timers inside a dedicated worker are not throttled that way.
 * Falls back to plain timers where workers are unavailable.
 */
export function workerTimers(): TimerApi {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return plainTimers;
  let worker: Worker;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch {
    return plainTimers;
  }
  const callbacks = new Map<number, () => void>();
  let nextId = 1;
  worker.onmessage = (e: MessageEvent<number>) => {
    const fn = callbacks.get(e.data);
    callbacks.delete(e.data);
    fn?.();
  };
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      callbacks.set(id, fn);
      worker.postMessage({ op: 'set', id, ms: Math.max(0, ms) });
      return id;
    },
    clearTimeout(id) {
      if (callbacks.delete(id)) worker.postMessage({ op: 'clear', id });
    },
  };
}

let shared: TimerApi | null = null;

/** One worker-backed timer source per page. */
export function backgroundTimers(): TimerApi {
  shared ??= workerTimers();
  return shared;
}
