// Live DOM renderer: builds the SVG once, then patches attributes per frame.
// Same element structure and paint order as renderSVG in ../render/svg.ts.
import { RAYON, accessoryClayStops, accessoryPartColor } from '../engine/index.js';
import { mixHex } from '../math/index.js';
import { NOTIF_BLUE } from '../palette.js';
import { DEFAULT_CLAY, clayEqual } from '../sdk/clay.js';
import type { ClaySettings } from '../sdk/clay.js';
import type { ViewStyle } from './style-transition.js';
import type { BlubModel } from './model.js';
import type { BlubSample, RenderDot } from '../types.js';

const NS = 'http://www.w3.org/2000/svg';
const EYES = 2;
const DOTS = 3;
const ARCS = 6;
const STOPS = 3;

const r2 = (n: number): number => Math.round(n * 100) / 100;

// Per-element attribute cache: a frame that changes nothing writes nothing.
const attrCache = new WeakMap<Element, Map<string, string>>();

function cacheFor(el: Element): Map<string, string> {
  let cache = attrCache.get(el);
  if (!cache) {
    cache = new Map();
    attrCache.set(el, cache);
  }
  return cache;
}

function attr(el: Element, key: string, value: string | number): void {
  const text = String(value);
  const cache = cacheFor(el);
  if (cache.get(key) === text) return;
  cache.set(key, text);
  el.setAttribute(key, text);
}

function clearAttr(el: Element, key: string): void {
  const cache = cacheFor(el);
  if (!cache.has(key)) return;
  cache.delete(key);
  el.removeAttribute(key);
}

function node(tag: string, attrs: Record<string, string | number> = {}): Element {
  const el = document.createElementNS(NS, tag);
  const cache = cacheFor(el);
  for (const key of Object.keys(attrs)) {
    const text = String(attrs[key]);
    cache.set(key, text);
    el.setAttribute(key, text);
  }
  return el;
}

function show(el: Element, visible: boolean): void {
  if (visible) clearAttr(el, 'display');
  else attr(el, 'display', 'none');
}

function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let uidSeq = 0;
const nextUid = (): string => `blubbles-${++uidSeq}`;

export interface BlubViewOptions {
  /** Half-viewBox. Default 124. */
  crop?: number;
  /** Gradient reference radius. Default 158. */
  scale?: number;
  /** Flat background colour, or null for transparent. */
  background?: string | null;
  /** Unique id prefix. Auto-generated when omitted. */
  uid?: string;
}

export interface BlubView {
  readonly el: SVGSVGElement;
  /** Override the style used by the next renders (SDK transitions). */
  setStyle(style: ViewStyle): void;
  render(t: number): void;
  destroy(): void;
}

interface DotSlot {
  circle: Element;
  path: Element;
}

interface DotPool {
  group: Element;
  slots: DotSlot[];
}

export function createBlubView(
  target: Element,
  blub: BlubModel,
  { crop = 124, scale = 158, background = null, uid }: BlubViewOptions = {},
): BlubView {
  const id = uid ?? nextUid();
  const maskId = `${id}-m`;
  const fillId = `${id}-f`;
  const c = crop;
  const vb = `${-c} ${-c} ${2 * c} ${2 * c}`;

  const adopted = target.namespaceURI === NS && target.tagName?.toLowerCase() === 'svg';
  const svg = (adopted ? target : node('svg')) as SVGSVGElement;
  if (adopted) clear(svg);
  svg.setAttribute('viewBox', vb);
  if (!adopted) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  }
  svg.setAttribute('aria-hidden', 'true');

  const defs = node('defs');

  // mask: body cut-out, eye holes, notification notch
  const mask = node('mask', {
    id: maskId,
    maskUnits: 'userSpaceOnUse',
    x: -c,
    y: -c,
    width: 2 * c,
    height: 2 * c,
  });
  const maskBody = node('path', { fill: '#fff' });
  mask.appendChild(maskBody);
  const maskEyes = Array.from({ length: EYES }, (): Element => {
    const p = node('path', { fill: '#000', display: 'none' });
    mask.appendChild(p);
    return p;
  });
  const notch = node('circle', { fill: '#000', display: 'none' });
  mask.appendChild(notch);
  defs.appendChild(mask);

  // clay body gradient (always present; only referenced when finish === 'clay')
  const bodyGrad = node('radialGradient', {
    id: fillId,
    gradientUnits: 'userSpaceOnUse',
    cx: r2(-0.32 * scale),
    cy: r2(-0.4 * scale),
    r: r2(1.55 * scale),
  });
  const bodyStops = ['0%', '32%', '72%', '100%'].map((offset) => {
    const stop = node('stop', { offset });
    bodyGrad.appendChild(stop);
    return stop;
  });
  defs.appendChild(bodyGrad);

  // per-arc linear gradients + back/front strokes
  const arcGrads: Element[] = [];
  const arcStops: Element[][] = [];
  const arcBack: Element[] = [];
  const arcFront: Element[] = [];
  for (let i = 0; i < ARCS; i++) {
    const grad = node('linearGradient', { id: `${id}-g-${i}`, gradientUnits: 'userSpaceOnUse' });
    const stops = Array.from({ length: STOPS }, (): Element => {
      const stop = node('stop', { offset: 0 });
      grad.appendChild(stop);
      return stop;
    });
    defs.appendChild(grad);
    arcGrads.push(grad);
    arcStops.push(stops);
    const back = node('path', { display: 'none' });
    const front = node('path', { display: 'none' });
    arcBack.push(back);
    arcFront.push(front);
  }
  svg.appendChild(defs);

  // background plate
  const backgroundRect = node('rect', {
    x: -c,
    y: -c,
    width: 2 * c,
    height: 2 * c,
    fill: background ?? 'none',
  });
  show(backgroundRect, Boolean(background));
  svg.appendChild(backgroundRect);

  const arcsBackGroup = node('g', { fill: 'none', 'stroke-linecap': 'round' });
  arcBack.forEach((p) => arcsBackGroup.appendChild(p));
  svg.appendChild(arcsBackGroup);

  const makeDots = (): DotPool => {
    const group = node('g');
    const slots = Array.from({ length: DOTS }, (): DotSlot => {
      const circle = node('circle', { display: 'none' });
      const path = node('path', { display: 'none' });
      group.appendChild(circle);
      group.appendChild(path);
      return { circle, path };
    });
    return { group, slots };
  };
  const dotsBehind = makeDots();
  const dotsFront = makeDots();
  dotsBehind.group.setAttribute('display', 'none');
  svg.appendChild(dotsBehind.group);

  // body: paper underfill, eye fills, then the masked clay/flat plate
  const bodyGroup = node('g');
  const bodyPath = node('path');
  const eyeFills = Array.from({ length: EYES }, () => node('path', { display: 'none' }));
  const plateGroup = node('g', { mask: `url(#${maskId})` });
  const plate = node('rect', { x: -c, y: -c, width: 2 * c, height: 2 * c });
  plateGroup.appendChild(plate);
  bodyGroup.appendChild(bodyPath);
  eyeFills.forEach((p) => bodyGroup.appendChild(p));
  bodyGroup.appendChild(plateGroup);
  svg.appendChild(bodyGroup);

  svg.appendChild(dotsFront.group);

  const notif = node('circle', { fill: NOTIF_BLUE, display: 'none' });
  svg.appendChild(notif);

  const arcsFrontGroup = node('g', { fill: 'none', 'stroke-linecap': 'round' });
  arcFront.forEach((p) => arcsFrontGroup.appendChild(p));
  svg.appendChild(arcsFrontGroup);

  if (!adopted) target.appendChild(svg);

  let styleOverride: ViewStyle | null = null;
  let activeStyle: ViewStyle = {
    color: blub.color,
    paper: blub.paper,
    eye: blub.eye,
    finish: blub.finish,
    clay: DEFAULT_CLAY,
  };
  let lastColor: string | null = null;
  let lastPaper: string | null = null;
  let lastEye: string | null = null;
  let lastFinish: string | null = null;
  let lastClay: ClaySettings | null = null;

  function syncStyle(): void {
    activeStyle = styleOverride ?? {
      color: blub.color,
      paper: blub.paper,
      eye: blub.eye,
      finish: blub.finish,
      clay: DEFAULT_CLAY,
    };
    const { color, paper, eye, finish, clay } = activeStyle;
    const clayChanged = lastClay === null || !clayEqual(lastClay, clay);
    const colorChanged = color !== lastColor;

    if (colorChanged || clayChanged) {
      lastColor = color;
      lastClay = clay;
      const values = [
        mixHex(color, '#ffffff', 0.62 * clay.highlight),
        mixHex(color, '#ffffff', 0.2 * clay.highlight),
        color,
        mixHex(color, '#0a0a0c', 0.4 * clay.shadow),
      ];
      bodyStops.forEach((stop, i) => attr(stop, 'stop-color', values[i]));
      attr(bodyGrad, 'cx', r2(clay.light.x * scale));
      attr(bodyGrad, 'cy', r2(clay.light.y * scale));
      if (finish === 'flat') attr(plate, 'fill', color);
    }
    if (finish !== lastFinish || (finish === 'flat' && colorChanged)) {
      lastFinish = finish;
      attr(plate, 'fill', finish === 'clay' ? `url(#${fillId})` : color);
    }
    if (paper !== lastPaper) {
      lastPaper = paper;
      attr(bodyPath, 'fill', paper);
    }
    if (eye !== lastEye || paper !== lastPaper) {
      lastEye = eye;
      const visible = eye !== paper;
      eyeFills.forEach((p) => {
        show(p, visible);
        if (visible) attr(p, 'fill', eye);
      });
    }
  }

  function renderDots(pool: DotPool, dots: RenderDot[], visible: boolean): void {
    show(pool.group, visible);
    if (!visible) return;
    const color = activeStyle.color;
    const paper = activeStyle.paper;
    for (let i = 0; i < DOTS; i++) {
      const slot = pool.slots[i];
      const d = dots[i];
      if (!d) {
        show(slot.circle, false);
        show(slot.path, false);
        continue;
      }
      const fill = d.color ?? (d.depth === undefined ? color : mixHex(paper, color, d.depth));
      if (d.d) {
        show(slot.path, true);
        show(slot.circle, false);
        attr(slot.path, 'd', d.d);
        attr(slot.path, 'fill', fill);
        attr(slot.path, 'opacity', d.opacity);
        slot.path.setAttribute(
          'transform',
          `translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})`,
        );
      } else {
        show(slot.circle, true);
        show(slot.path, false);
        attr(slot.circle, 'cx', d.x);
        attr(slot.circle, 'cy', d.y);
        attr(slot.circle, 'r', d.r);
        attr(slot.circle, 'fill', fill);
        attr(slot.circle, 'opacity', d.opacity);
      }
    }
  }

  // Worn things: built only on first use, so a bare blub keeps its original structure.
  let wornGroup: Element | null = null;
  const wornSlots: {
    path: Element;
    grad: Element;
    stops: Element[];
    gradId: string;
    /** Built the first time this slot paints a blurred part. */
    blur: { filter: Element; gaussian: Element; id: string } | null;
  }[] = [];

  function renderWorn(s: BlubSample): void {
    const parts = (s.accessories ?? []).flatMap((item) => item.parts);
    if (!wornGroup) {
      if (parts.length === 0) return;
      wornGroup = node('g');
      svg.insertBefore(wornGroup, notif);
    }
    const { color, finish, clay } = activeStyle;
    for (let i = 0; i < parts.length; i++) {
      let slot = wornSlots[i];
      if (!slot) {
        const gradId = `${id}-a${i}`;
        const grad = node('radialGradient', {
          id: gradId,
          gradientUnits: 'userSpaceOnUse',
          r: r2(1.55 * scale),
        });
        const stops = ['0%', '32%', '72%', '100%'].map((offset) => {
          const stop = node('stop', { offset });
          grad.appendChild(stop);
          return stop;
        });
        defs.appendChild(grad);
        const path = node('path');
        wornGroup.appendChild(path);
        slot = { path, grad, stops, gradId, blur: null };
        wornSlots[i] = slot;
      }
      const part = parts[i];
      const base = accessoryPartColor(part, color);
      attr(slot.path, 'd', part.d);
      attr(slot.path, 'opacity', r2(part.opacity));
      if (part.clay && finish === 'clay') {
        attr(slot.grad, 'cx', r2(clay.light.x * scale));
        attr(slot.grad, 'cy', r2(clay.light.y * scale));
        const stops = accessoryClayStops(base, clay.highlight, clay.shadow);
        slot.stops.forEach((stop, n) => attr(stop, 'stop-color', stops[n]));
        attr(slot.path, 'fill', `url(#${slot.gradId})`);
      } else {
        attr(slot.path, 'fill', base);
      }
      if (part.masked) attr(slot.path, 'mask', `url(#${maskId})`);
      else clearAttr(slot.path, 'mask');
      if (part.blur) {
        if (!slot.blur) {
          const blurId = `${id}-b${i}`;
          const filter = node('filter', {
            id: blurId,
            filterUnits: 'userSpaceOnUse',
            'color-interpolation-filters': 'sRGB',
          });
          const gaussian = node('feGaussianBlur');
          filter.appendChild(gaussian);
          defs.appendChild(filter);
          slot.blur = { filter, gaussian, id: blurId };
        }
        attr(slot.blur.filter, 'x', part.blur.x);
        attr(slot.blur.filter, 'y', part.blur.y);
        attr(slot.blur.filter, 'width', part.blur.width);
        attr(slot.blur.filter, 'height', part.blur.height);
        attr(slot.blur.gaussian, 'stdDeviation', part.blur.deviation);
        attr(slot.path, 'filter', `url(#${slot.blur.id})`);
      } else {
        clearAttr(slot.path, 'filter');
      }
      show(slot.path, true);
    }
    for (let i = parts.length; i < wornSlots.length; i++) show(wornSlots[i].path, false);
  }

  function render(t: number): void {
    const s: BlubSample = blub.sample(t);
    syncStyle();

    attr(bodyPath, 'd', s.bodyPath);
    attr(maskBody, 'd', s.bodyPath);
    attr(bodyGroup, 'opacity', s.bodyAlpha);

    for (let i = 0; i < EYES; i++) {
      const e = s.eyes[i];
      const maskEye = maskEyes[i];
      const fillEye = eyeFills[i];
      if (!e) {
        show(maskEye, false);
        show(fillEye, false);
        continue;
      }
      attr(maskEye, 'd', e.d);
      attr(maskEye, 'transform', e.matrix);
      attr(maskEye, 'opacity', e.alpha);
      show(maskEye, true);
      if (blub.eye !== blub.paper) {
        attr(fillEye, 'd', e.d);
        attr(fillEye, 'transform', e.matrix);
        show(fillEye, true);
      } else {
        show(fillEye, false);
      }
    }

    if (s.notch) {
      attr(notch, 'cx', s.notch.x);
      attr(notch, 'cy', s.notch.y);
      attr(notch, 'r', s.notch.r);
      show(notch, true);
    } else {
      show(notch, false);
    }

    for (let i = 0; i < ARCS; i++) {
      const a = s.arcs[i];
      const back = arcBack[i];
      const front = arcFront[i];
      if (!a) {
        show(back, false);
        show(front, false);
        continue;
      }
      const grad = arcGrads[i];
      attr(grad, 'x1', a.grad.x1);
      attr(grad, 'y1', a.grad.y1);
      attr(grad, 'x2', a.grad.x2);
      attr(grad, 'y2', a.grad.y2);
      const n = a.grad.stops.length;
      const stops = arcStops[i];
      for (let k = 0; k < STOPS; k++) {
        const stop = stops[k];
        if (k < n) {
          attr(stop, 'offset', n === 1 ? 0 : k / (n - 1));
          attr(stop, 'stop-color', a.grad.stops[k]);
        } else {
          attr(stop, 'offset', n === 1 ? 0 : 1);
          attr(stop, 'stop-color', a.grad.stops[n - 1]);
        }
      }
      const stroke = `url(#${id}-g-${i})`;
      attr(back, 'd', a.back);
      attr(back, 'stroke', stroke);
      attr(back, 'stroke-width', a.width);
      attr(back, 'opacity', a.opacity);
      show(back, true);
      attr(front, 'd', a.front);
      attr(front, 'stroke', stroke);
      attr(front, 'stroke-width', a.width);
      attr(front, 'opacity', a.opacity);
      show(front, true);
    }

    renderDots(dotsBehind, s.dots, s.dotsBehind);
    renderDots(dotsFront, s.dots, !s.dotsBehind);
    renderWorn(s);

    if (s.notif) {
      attr(notif, 'cx', s.notif.x);
      attr(notif, 'cy', s.notif.y);
      attr(notif, 'r', s.notif.r);
      show(notif, true);
    } else {
      show(notif, false);
    }
  }

  function destroy(): void {
    if (adopted) clear(svg);
    else svg.remove();
  }

  render(0);

  return {
    el: svg,
    setStyle(style: ViewStyle): void {
      styleOverride = style;
    },
    render,
    destroy,
  };
}
