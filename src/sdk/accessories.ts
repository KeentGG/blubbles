// Public accessory values: names, validation and the normal form the engine takes.
import { ACCESSORIES } from '../engine/index.js';
import type { AccessoryId, AccessoryWear } from '../engine/index.js';
import { colorHex, requireColor } from '../resolve.js';

/** Things a blub can wear: one on the head, one at the neck and one on the lip. */
export type Accessory = AccessoryId;

/**
 * A name, or a name with a colour. Without a colour it picks a tone from the body,
 * except a mustache, which is black.
 */
export type AccessoryInput = Accessory | { id: Accessory; color?: string };

export const ACCESSORY_NAMES = ACCESSORIES.map((item) => item.id);

/** Validates a worn list. A later item replaces an earlier one in the same slot. */
export function normalizeAccessories(value: unknown): AccessoryWear[] {
  if (!Array.isArray(value)) {
    throw new TypeError('accessories must be an array, such as ["hat", "tie"].');
  }
  const bySlot = new Map<string, AccessoryWear>();
  for (const item of value as unknown[]) {
    const id = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : item;
    const known = ACCESSORIES.find((entry) => entry.id === id);
    if (!known) {
      throw new TypeError(
        `Unknown accessory ${JSON.stringify(id)}. Valid accessories: ${ACCESSORY_NAMES.map((name) => `"${name}"`).join(', ')}.`,
      );
    }
    const color = typeof item === 'object' && item !== null ? (item as { color?: string | null }).color : undefined;
    bySlot.set(known.slot, {
      id: known.id,
      color: color == null ? null : colorHex(requireColor(color)),
    });
  }
  return [...bySlot.values()];
}
