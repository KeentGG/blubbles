// One requestAnimationFrame loop for every auto-clock blub on the page. It starts
// with the first subscriber and stops with the last, so idle pages schedule nothing.
type FrameCallback = (nowMs: number) => void;

const subscribers = new Set<FrameCallback>();
let raf = 0;
let inFrame = false;

function frame(nowMs: number): void {
  raf = 0;
  inFrame = true;
  // Request the next frame before running callbacks, so a throwing subscriber
  // cannot freeze every blub. The finally block cancels it if all unsubscribed.
  if (subscribers.size && typeof requestAnimationFrame === 'function') {
    raf = requestAnimationFrame(frame);
  }
  try {
    for (const callback of [...subscribers]) {
      try {
        callback(nowMs);
      } catch (error) {
        console.error('[blubbles] frame callback failed', error);
      }
    }
  } finally {
    inFrame = false;
    if (!subscribers.size && raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
    }
  }
}

export function subscribeFrame(callback: FrameCallback): () => void {
  subscribers.add(callback);
  if (!inFrame && !raf && subscribers.size > 0 && typeof requestAnimationFrame === 'function') {
    raf = requestAnimationFrame(frame);
  }
  return () => {
    subscribers.delete(callback);
    if (!subscribers.size && raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Test/debug hook: how many instances share the loop. */
export function schedulerSubscribers(): number {
  return subscribers.size;
}
