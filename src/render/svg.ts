// Standalone SVG string renderer: mask, clay radial gradient, arcs, dots and the
// notification badge. Same paint order and attributes as the live DOM renderer.
import { RAYON, accessoryClayStops, accessoryPartColor } from '../engine/index.js';
import { mixHex } from '../math/index.js';
import { NOTIF_BLUE, PAPER } from '../palette.js';
import type { BlubSample, RenderDot } from '../types.js';

export { CREAM, INK, NOTIF_BLUE, PAPER, autoEye } from '../palette.js';

const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface RenderSVGOptions {
  /** Body hex colour, e.g. "#3b93f0". */
  color?: string;
  /** Output pixel size (square). */
  size?: number;
  /** Half-viewBox (default 124, same as the PNG export). */
  crop?: number;
  /** Gradient reference radius (default 158). */
  scale?: number;
  /** Paper / body-underfill colour. */
  paper?: string;
  /** Eye cut-out colour; defaults to paper. */
  eye?: string | null;
  clay?: boolean;
  /** Highlight multiplier, 0..2. Default 1. */
  clayHighlight?: number;
  /** Shadow multiplier, 0..2. Default 1. */
  clayShadow?: number;
  /** Light centre in unit coordinates. Default { x: -0.32, y: -0.4 }. */
  clayLight?: { x: number; y: number };
  /** Unique prefix; required when several SVGs share a document. */
  uid?: string;
  /** Flat background hex, or null for transparent. */
  background?: string | null;
}

export function renderSVG(
  sample: BlubSample,
  {
    color = '#3b93f0',
    size = 512,
    crop = 124,
    scale = 158,
    paper = PAPER,
    eye = null,
    clay = true,
    clayHighlight = 1,
    clayShadow = 1,
    clayLight = { x: -0.32, y: -0.4 },
    uid = 'b',
    background = null,
  }: RenderSVGOptions = {},
): string {
  const maskId = `${uid}-m`;
  const fillId = `${uid}-f`;
  const gid = (id: string): string => `${uid}-g-${id}`;
  const c = crop;
  const vb = `${-c} ${-c} ${2 * c} ${2 * c}`;
  const eyeColor = eye ?? paper;

  const defs: string[] = [];
  defs.push(
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${-c}" y="${-c}" width="${2 * c}" height="${2 * c}">` +
      `<path d="${sample.bodyPath}" fill="#fff"/>` +
      sample.eyes
        .map((e) => `<path d="${e.d}" transform="${e.matrix}" opacity="${e.alpha}" fill="#000"/>`)
        .join('') +
      (sample.notch
        ? `<circle cx="${sample.notch.x}" cy="${sample.notch.y}" r="${sample.notch.r}" fill="#000"/>`
        : '') +
      `</mask>`,
  );

  if (clay) {
    defs.push(
      `<radialGradient id="${fillId}" gradientUnits="userSpaceOnUse" cx="${r2(clayLight.x * scale)}" cy="${r2(clayLight.y * scale)}" r="${r2(1.55 * scale)}">` +
        `<stop offset="0%" stop-color="${mixHex(color, '#ffffff', 0.62 * clayHighlight)}"/>` +
        `<stop offset="32%" stop-color="${mixHex(color, '#ffffff', 0.2 * clayHighlight)}"/>` +
        `<stop offset="72%" stop-color="${color}"/>` +
        `<stop offset="100%" stop-color="${mixHex(color, '#0a0a0c', 0.4 * clayShadow)}"/>` +
        `</radialGradient>`,
    );
  }

  for (const arc of sample.arcs) {
    const stops = arc.grad.stops
      .map(
        (stop, i) =>
          `<stop offset="${arc.grad.stops.length === 1 ? 0 : i / (arc.grad.stops.length - 1)}" stop-color="${stop}"/>`,
      )
      .join('');
    defs.push(
      `<linearGradient id="${gid(arc.id)}" gradientUnits="userSpaceOnUse" x1="${arc.grad.x1}" y1="${arc.grad.y1}" x2="${arc.grad.x2}" y2="${arc.grad.y2}">${stops}</linearGradient>`,
    );
  }

  const dot = (d: RenderDot): string => {
    const fill = d.color ?? (d.depth === undefined ? color : mixHex(paper, color, d.depth));
    if (d.d) {
      return `<path d="${d.d}" fill="${fill}" opacity="${d.opacity}" transform="translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})"/>`;
    }
    return `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${fill}" opacity="${d.opacity}"/>`;
  };

  const wornParts = (sample.accessories ?? []).flatMap((item) => item.parts);
  const worn = wornParts
    .map((part, i) => {
      const base = accessoryPartColor(part, color);
      let fill = base;
      if (clay && part.clay) {
        const id = `${uid}-a${i}`;
        fill = `url(#${id})`;
        defs.push(
          `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r2(clayLight.x * scale)}" cy="${r2(clayLight.y * scale)}" r="${r2(1.55 * scale)}">` +
            accessoryClayStops(base, clayHighlight, clayShadow)
              .map((stop, n) => `<stop offset="${['0%', '32%', '72%', '100%'][n]}" stop-color="${stop}"/>`)
              .join('') +
            `</radialGradient>`,
        );
      }
      const masked = part.masked ? ` mask="url(#${maskId})"` : '';
      let filter = '';
      if (part.blur) {
        const id = `${uid}-b${i}`;
        const { deviation, x, y, width, height } = part.blur;
        filter = ` filter="url(#${id})"`;
        defs.push(
          `<filter id="${id}" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}" color-interpolation-filters="sRGB">` +
            `<feGaussianBlur stdDeviation="${deviation}"/>` +
            `</filter>`,
        );
      }
      return `<path d="${part.d}" fill="${fill}" opacity="${r2(part.opacity)}"${filter}${masked}/>`;
    })
    .join('');

  const arcsBack = sample.arcs
    .map(
      (arc) =>
        `<path d="${arc.back}" stroke="url(#${gid(arc.id)})" stroke-width="${arc.width}" opacity="${arc.opacity}"/>`,
    )
    .join('');
  const arcsFront = sample.arcs
    .map(
      (arc) =>
        `<path d="${arc.front}" stroke="url(#${gid(arc.id)})" stroke-width="${arc.width}" opacity="${arc.opacity}"/>`,
    )
    .join('');

  const eyeFill =
    eyeColor === paper
      ? ''
      : sample.eyes
          .map((e) => `<path d="${e.d}" transform="${e.matrix}" fill="${eyeColor}"/>`)
          .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${size}" height="${size}" aria-hidden="true">` +
    `<defs>${defs.join('')}</defs>` +
    (background
      ? `<rect x="${-c}" y="${-c}" width="${2 * c}" height="${2 * c}" fill="${background}"/>`
      : '') +
    (arcsBack ? `<g fill="none" stroke-linecap="round">${arcsBack}</g>` : '') +
    (sample.dotsBehind ? sample.dots.map(dot).join('') : '') +
    `<g opacity="${sample.bodyAlpha}">` +
    `<path d="${sample.bodyPath}" fill="${paper}"/>` +
    eyeFill +
    `<g mask="url(#${maskId})"><rect x="${-c}" y="${-c}" width="${2 * c}" height="${2 * c}" fill="${clay ? `url(#${fillId})` : color}"/></g>` +
    `</g>` +
    (!sample.dotsBehind ? sample.dots.map(dot).join('') : '') +
    worn +
    (sample.notif
      ? `<circle cx="${sample.notif.x}" cy="${sample.notif.y}" r="${sample.notif.r}" fill="${NOTIF_BLUE}"/>`
      : '') +
    (arcsFront ? `<g fill="none" stroke-linecap="round">${arcsFront}</g>` : '') +
    `</svg>`
  );
}
