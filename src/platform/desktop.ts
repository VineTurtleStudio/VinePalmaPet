import { availableMonitors, currentMonitor, cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";

export const DESIGN_SIZE = 320;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function logicalWindowSize(scale: number): number {
  return Math.round(DESIGN_SIZE * scale);
}

/** Places the pet near the bottom-right corner of the monitor it is currently on. */
export async function placeByDefault(scale: number): Promise<void> {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  const monitor = (await currentMonitor()) ?? (await availableMonitors())[0];
  if (!monitor) return;

  const physicalSize = Math.round(logicalWindowSize(scale) * monitor.scaleFactor);
  const marginX = Math.round(36 * monitor.scaleFactor);
  const marginY = Math.round(88 * monitor.scaleFactor);
  const x = monitor.position.x + monitor.size.width - physicalSize - marginX;
  const y = monitor.position.y + monitor.size.height - physicalSize - marginY;
  await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}

/** Applies a new window size while keeping the pet's feet anchored. */
export async function applyScale(next: number, previous: number): Promise<void> {
  if (!isTauri() || next === previous) return;
  const win = getCurrentWindow();
  const [position, size, factor] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);

  const target = Math.round(DESIGN_SIZE * next * factor);
  const deltaX = Math.round((size.width - target) / 2);
  const deltaY = size.height - target;

  await win.setSize(new LogicalSize(logicalWindowSize(next), logicalWindowSize(next)));
  await win.setPosition(new PhysicalPosition(position.x + deltaX, position.y + deltaY));
}

/** Clamps the window into the monitor work area and snaps it to nearby edges. */
export async function snapToScreen(): Promise<void> {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return;

  const left = monitor.position.x;
  const top = monitor.position.y;
  const right = monitor.position.x + monitor.size.width;
  const bottom = monitor.position.y + monitor.size.height;
  const snap = Math.round(20 * monitor.scaleFactor);

  let x = position.x;
  let y = position.y;

  if (Math.abs(x - left) <= snap) x = left;
  if (Math.abs(right - (x + size.width)) <= snap) x = right - size.width;
  if (Math.abs(y - top) <= snap) y = top;
  if (Math.abs(bottom - (y + size.height)) <= snap) y = bottom - size.height;

  x = Math.min(Math.max(x, left), Math.max(left, right - size.width));
  y = Math.min(Math.max(y, top), Math.max(top, bottom - size.height));

  if (x !== position.x || y !== position.y) {
    await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
  }
}

export interface PassthroughOptions {
  /** Returns true when the pointer is over a non-transparent pixel. */
  isOverPet: (clientX: number, clientY: number) => boolean;
}

/**
 * Click-through for transparent pixels.
 *
 * When the window starts ignoring cursor events it stops receiving mousemove, so we
 * poll the global cursor position to notice when it comes back over the pet.
 */
export function createPassthrough({ isOverPet }: PassthroughOptions) {
  if (!isTauri()) {
    return { handleMouseMove: () => undefined, dispose: () => undefined, setBlocked: () => undefined };
  }

  const win = getCurrentWindow();
  let ignoring = false;
  let timer: number | undefined;
  let disposed = false;
  let blocked = false;

  // Geometry is cached so the poll only costs one IPC call most of the time.
  let geometry = { x: 0, y: 0, width: 0, height: 0, at: 0 };

  const stopPolling = () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  const setIgnoring = async (next: boolean) => {
    if (next === ignoring || disposed) return;
    ignoring = next;
    try {
      await win.setIgnoreCursorEvents(next);
    } catch (error) {
      console.error("setIgnoreCursorEvents failed", error);
    }
    if (next) startPolling();
    else stopPolling();
  };

  const poll = async () => {
    if (disposed || !ignoring) return;
    try {
      const now = performance.now();
      if (now - geometry.at > 1000) {
        const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        geometry = { x: position.x, y: position.y, width: size.width, height: size.height, at: now };
      }

      const cursor = await cursorPosition();
      const inside =
        cursor.x >= geometry.x &&
        cursor.y >= geometry.y &&
        cursor.x < geometry.x + geometry.width &&
        cursor.y < geometry.y + geometry.height;
      if (!inside || geometry.width === 0 || geometry.height === 0) return;

      // Physical cursor -> CSS client coordinates inside the webview.
      const scaleX = window.innerWidth / geometry.width;
      const scaleY = window.innerHeight / geometry.height;
      const clientX = (cursor.x - geometry.x) * scaleX;
      const clientY = (cursor.y - geometry.y) * scaleY;
      if (isOverPet(clientX, clientY)) {
        await setIgnoring(false);
      }
    } catch (error) {
      console.error("passthrough poll failed", error);
      stopPolling();
    }
  };

  const startPolling = () => {
    if (timer !== undefined) return;
    timer = window.setInterval(() => {
      void poll();
    }, 80);
  };

  return {
    handleMouseMove(event: MouseEvent) {
      if (blocked || disposed) return;
      const overPet = isOverPet(event.clientX, event.clientY);
      void setIgnoring(!overPet);
    },
    setBlocked(next: boolean) {
      blocked = next;
      if (next) void setIgnoring(false);
    },
    dispose() {
      disposed = true;
      stopPolling();
      if (ignoring) void win.setIgnoreCursorEvents(false).catch(() => undefined);
    },
  };
}
