// Shared pointer/focus/caret state for every follower on the page. One listener
// per input kind; the hidden caret mirror exists only while followers exist.
import { invalidateMetrics } from './element-metrics.js';
import type { FollowPoint } from '../sdk/commands.js';

export interface FollowInputState {
  pointer: {
    x: number;
    y: number;
    speed: number;
    windowInside: boolean;
    idle: number;
    active: boolean;
    down: boolean;
    type: 'mouse' | 'pen' | 'touch';
  };
  focus: { el: Element | null; typing: boolean; idle: number };
  caret: FollowPoint | null;
  /** Bumped on scroll/resize/focus; lets followers refresh their rect. */
  layout: number;
}

const state: FollowInputState = {
  pointer: {
    x: 0,
    y: 0,
    speed: 0,
    windowInside: false,
    idle: Number.POSITIVE_INFINITY,
    active: false,
    down: false,
    type: 'mouse',
  },
  focus: { el: null, typing: false, idle: Number.POSITIVE_INFINITY },
  caret: null,
  layout: 0,
};

let subscribers = 0;
let attached = false;
let caretDirty = true;
let mirror: HTMLDivElement | null = null;
let lastX = 0;
let lastY = 0;
let lastTime = 0;
let lastMoveAt = 0;
let lastKeyAt = 0;
let focusedAt = 0;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isTyping(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function onPointerMove(event: PointerEvent): void {
  if ((event.pointerType === 'touch' || event.pointerType === 'pen') && event.buttons === 0) {
    return;
  }
  const t = now();
  if (lastTime) {
    const dt = (t - lastTime) / 1000;
    const distance = Math.hypot(event.clientX - lastX, event.clientY - lastY);
    if (dt > 0) {
      const instant = distance / dt;
      state.pointer.speed = state.pointer.speed * 0.7 + instant * 0.3;
    }
  }
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  state.pointer.windowInside = true;
  state.pointer.down = event.buttons > 0;
  state.pointer.type = event.pointerType === 'pen' || event.pointerType === 'touch' ? event.pointerType : 'mouse';
  lastMoveAt = t;
  lastX = event.clientX;
  lastY = event.clientY;
  lastTime = t;
}

function onPointerDown(event: PointerEvent): void {
  state.pointer.down = true;
  state.pointer.type = event.pointerType === 'pen' || event.pointerType === 'touch' ? event.pointerType : 'mouse';
}

function onPointerUp(): void {
  state.pointer.down = false;
}

function onPointerOut(event: PointerEvent): void {
  if (event.relatedTarget) return;
  state.pointer.windowInside = false;
  state.pointer.speed = 0;
  state.pointer.down = false;
}

function onFocusChange(): void {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  state.focus.el =
    el === document.body || el === document.documentElement ? null : el;
  state.focus.typing = isTyping(state.focus.el);
  focusedAt = now();
  lastKeyAt = focusedAt;
  state.layout++;
  caretDirty = true;
  invalidateMetrics();
}

function onCaretChange(): void {
  caretDirty = true;
  lastKeyAt = now();
  invalidateMetrics();
}

function onLayout(): void {
  state.layout++;
  invalidateMetrics();
  caretDirty = true;
}

function ensureMirror(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (mirror) return mirror;
  mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '0',
    top: '-9999px',
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    wordWrap: 'break-word',
    overflow: 'hidden',
    margin: '0',
  });
  document.body.appendChild(mirror);
  return mirror;
}

function updateCaret(): void {
  const el = state.focus.el;
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    state.caret = null;
    caretDirty = false;
    return;
  }
  const start = el.selectionStart;
  if (start === null) {
    state.caret = null;
    caretDirty = false;
    return;
  }
  const box = ensureMirror();
  if (!box) {
    state.caret = null;
    caretDirty = false;
    return;
  }
  const style = getComputedStyle(el);
  const textarea = el instanceof HTMLTextAreaElement;
  box.style.font = style.font;
  box.style.lineHeight = style.lineHeight;
  box.style.letterSpacing = style.letterSpacing;
  box.style.textTransform = style.textTransform;
  box.style.padding = style.padding;
  box.style.border = style.border;
  box.style.boxSizing = style.boxSizing;
  box.style.width = `${el.clientWidth}px`;
  box.style.whiteSpace = textarea ? 'pre-wrap' : 'pre';
  box.textContent = el.value.slice(0, start);
  const marker = document.createElement('span');
  marker.textContent = el.value.slice(start) || '\u200b';
  box.appendChild(marker);

  const boxRect = box.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const inputRect = el.getBoundingClientRect();
  const lineHeight = Number.parseFloat(style.lineHeight) || markerRect.height || 16;
  const x = inputRect.left + (markerRect.left - boxRect.left) - el.scrollLeft;
  const y = inputRect.top + (markerRect.top - boxRect.top) - el.scrollTop + lineHeight / 2;
  if (!state.caret) state.caret = { x, y };
  else {
    state.caret.x = x;
    state.caret.y = y;
  }
  caretDirty = false;
}

function attach(): void {
  if (attached || typeof window === 'undefined') return;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  window.addEventListener('pointerout', onPointerOut, { passive: true });
  window.addEventListener('scroll', onLayout, { passive: true });
  window.addEventListener('resize', onLayout, { passive: true });
  document.addEventListener('focusin', onFocusChange);
  document.addEventListener('focusout', onFocusChange);
  document.addEventListener('selectionchange', onCaretChange);
  document.addEventListener('input', onCaretChange);
  document.addEventListener('keydown', onCaretChange);
  document.addEventListener('keyup', onCaretChange);
  document.addEventListener('click', onCaretChange);
  onFocusChange();
  attached = true;
}

function detach(): void {
  if (!attached || typeof window === 'undefined') return;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  window.removeEventListener('pointerout', onPointerOut);
  window.removeEventListener('scroll', onLayout);
  window.removeEventListener('resize', onLayout);
  document.removeEventListener('focusin', onFocusChange);
  document.removeEventListener('focusout', onFocusChange);
  document.removeEventListener('selectionchange', onCaretChange);
  document.removeEventListener('input', onCaretChange);
  document.removeEventListener('keydown', onCaretChange);
  document.removeEventListener('keyup', onCaretChange);
  document.removeEventListener('click', onCaretChange);
  attached = false;
  state.focus.el = null;
  state.focus.typing = false;
  state.focus.idle = Number.POSITIVE_INFINITY;
  state.caret = null;
  // Keep the last pointer position/inside fact so restoring a follow can pick it
  // up on the next frame without waiting for another pointermove.
  state.pointer.speed = 0;
  state.pointer.down = false;
  state.pointer.active = false;
  mirror?.remove();
  mirror = null;
}

export function acquireFollowInputs(): () => void {
  subscribers++;
  attach();
  return () => {
    subscribers--;
    if (subscribers <= 0) {
      subscribers = 0;
      detach();
    }
  };
}

/** Test/debug hook: how many followers share these listeners. */
export function followInputSubscribers(): number {
  return subscribers;
}

export function followInputs(): FollowInputState {
  if (caretDirty) updateCaret();
  const t = now();
  state.pointer.idle = lastMoveAt ? (t - lastMoveAt) / 1000 : Number.POSITIVE_INFINITY;
  state.pointer.active = state.pointer.windowInside && state.pointer.idle <= 2;
  state.focus.idle = lastKeyAt ? (t - lastKeyAt) / 1000 : t - focusedAt;
  if (state.focus.el && !isTyping(state.focus.el)) {
    // Contenteditable still counts as typing; plain elements do not.
  }
  state.focus.typing = isTyping(state.focus.el);
  return state;
}
