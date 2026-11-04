// Palette and the paper/ink contrast rule. Kept apart from the SVG string renderer
// so the browser entry does not pull in the XML builders.
export const PAPER = '#0a0a0c';
export const INK = '#0a0a0c';
export const CREAM = '#ffffff';
export const NOTIF_BLUE = '#2496e8';

const lum = (hex: string): number => {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((x) => {
    const s = x / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

/** Eye = the paper cut-out. For transparent avatars we pick contrast against the body. */
export function autoEye(body: string): string {
  return lum(body) < 0.42 ? '#ffffff' : INK;
}
