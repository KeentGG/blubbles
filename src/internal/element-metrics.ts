// Shared element measurements: ResizeObserver + IntersectionObserver plus a
// scroll/resize invalidation counter. Rects are read only when dirty.
export interface Metrics {
  readonly rect: DOMRectReadOnly;
  readonly visible: boolean;
  /** Last measured rect without forcing layout, or null if never measured. */
  readonly cached: DOMRectReadOnly | null;
  readonly cachedVisible: boolean;
  release(): void;
}

interface Entry {
  refs: number;
  rect: DOMRectReadOnly | null;
  dirty: boolean;
  intersecting: boolean;
}

const entries = new Map<Element, Entry>();
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;

function ensureObservers(): void {
  if (typeof IntersectionObserver === 'function' && !io) {
    io = new IntersectionObserver((records) => {
      for (const record of records) {
        const entry = entries.get(record.target);
        if (!entry) continue;
        entry.intersecting = record.isIntersecting;
        entry.dirty = true;
      }
    }, { threshold: 0 });
  }
  if (typeof ResizeObserver === 'function' && !ro) {
    ro = new ResizeObserver((records) => {
      for (const record of records) {
        const entry = entries.get(record.target);
        if (entry) entry.dirty = true;
      }
    });
  }
}

function disconnectIfIdle(): void {
  if (entries.size) return;
  io?.disconnect();
  ro?.disconnect();
  io = null;
  ro = null;
}

/** Mark every tracked rect dirty; called on passive scroll/resize. */
export function invalidateMetrics(): void {
  for (const entry of entries.values()) entry.dirty = true;
}

/** Test/debug hook: how many element measurements are still tracked. */
export function trackedElementCount(): number {
  return entries.size;
}

export function acquireMetric(element: Element): Metrics {
  ensureObservers();
  let entry = entries.get(element);
  if (!entry) {
    entry = { refs: 0, rect: null, dirty: true, intersecting: true };
    entries.set(element, entry);
    io?.observe(element);
    ro?.observe(element);
  }
  entry.refs++;
  const own = entry;
  if (!own.rect) {
    own.rect = element.getBoundingClientRect();
    own.dirty = false;
  }
  const measure = (): DOMRectReadOnly => {
    if (!own.rect || own.dirty) {
      own.rect = element.getBoundingClientRect();
      own.dirty = false;
    }
    return own.rect;
  };
  return {
    get rect(): DOMRectReadOnly {
      return measure();
    },
    get visible(): boolean {
      const rect = measure();
      return (
        element.isConnected &&
        own.intersecting &&
        rect.width > 0 &&
        rect.height > 0
      );
    },
    get cached(): DOMRectReadOnly | null {
      return own.rect;
    },
    get cachedVisible(): boolean {
      const rect = own.rect;
      return Boolean(
        rect &&
          element.isConnected &&
          own.intersecting &&
          rect.width > 0 &&
          rect.height > 0,
      );
    },
    release(): void {
      own.refs--;
      if (own.refs > 0) return;
      io?.unobserve(element);
      ro?.unobserve(element);
      entries.delete(element);
      disconnectIfIdle();
    },
  };
}
