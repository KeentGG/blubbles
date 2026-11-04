// Pure selection maths for follow targets: priority hysteresis, weighted blend
// and gaze shaping. No DOM, so node:test can drive it with synthetic positions.
import type { FollowRange } from '../sdk/commands.js';

export interface FollowCandidate {
  key: string;
  label: string;
  weight: number;
  active: boolean;
  yaw: number;
  pitch: number;
}

export interface SelectOptions {
  pick: 'strongest' | 'blend';
  switchMargin: number;
  minHold: number;
}

export interface SelectState {
  currentKey: string | null;
  currentLabel: string | null;
  leadKey: string | null;
  leadSince: number;
}

export function createSelectState(): SelectState {
  return { currentKey: null, currentLabel: null, leadKey: null, leadSince: 0 };
}

export interface SelectResult {
  key: string | null;
  label: string | null;
  switched: boolean;
}

const active = (candidates: FollowCandidate[]): FollowCandidate[] =>
  candidates.filter((candidate) => candidate.active && candidate.weight > 0);

function strongest(candidates: FollowCandidate[]): FollowCandidate | null {
  let best: FollowCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.weight > best.weight) best = candidate;
  }
  return best;
}

export function selectStrongest(
  candidates: FollowCandidate[],
  state: SelectState,
  now: number,
  options: SelectOptions,
): SelectResult {
  const live = active(candidates);
  if (!live.length) {
    state.currentKey = null;
    state.currentLabel = null;
    state.leadKey = null;
    return { key: null, label: null, switched: true };
  }
  const current = live.find((candidate) => candidate.key === state.currentKey) ?? null;
  const best = strongest(live)!;
  if (!current) {
    state.leadKey = null;
    const switched = state.currentKey !== best.key;
    state.currentKey = best.key;
    state.currentLabel = best.label;
    return { key: best.key, label: best.label, switched };
  }
  const rival = strongest(live.filter((candidate) => candidate.key !== current.key));
  if (rival && rival.weight > current.weight + options.switchMargin) {
    if (state.leadKey !== rival.key) {
      state.leadKey = rival.key;
      state.leadSince = now;
    } else if (now - state.leadSince >= options.minHold) {
      state.currentKey = rival.key;
      state.currentLabel = rival.label;
      state.leadKey = null;
      return { key: rival.key, label: rival.label, switched: true };
    }
  } else {
    state.leadKey = null;
  }
  return { key: current.key, label: current.label, switched: false };
}

export function blendLook(candidates: FollowCandidate[]): { yaw: number; pitch: number } | null {
  const live = active(candidates);
  if (!live.length) return null;
  let weight = 0;
  let yaw = 0;
  let pitch = 0;
  for (const candidate of live) {
    weight += candidate.weight;
    yaw += candidate.yaw * candidate.weight;
    pitch += candidate.pitch * candidate.weight;
  }
  if (weight <= 0) return null;
  return { yaw: yaw / weight, pitch: pitch / weight };
}

export function shapeGaze(
  yaw: number,
  pitch: number,
  range: FollowRange | undefined,
  mode: 'look' | 'avoid',
): { yaw: number; pitch: number } {
  let outYaw = mode === 'avoid' ? -yaw : yaw;
  let outPitch = mode === 'avoid' ? -pitch : pitch;
  if (range) {
    const limitYaw = Math.abs(range.yaw);
    const limitPitch = Math.abs(range.pitch);
    outYaw = Math.max(-limitYaw, Math.min(limitYaw, outYaw));
    outPitch = Math.max(-limitPitch, Math.min(limitPitch, outPitch));
  }
  return { yaw: outYaw, pitch: outPitch };
}
