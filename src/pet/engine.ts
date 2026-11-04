import { DESIGN_SIZE } from "../packs/types";
import type { AnimationDef, LoadedPetPack, StateDef } from "../packs/types";

const BOTTOM_MARGIN = 2;
const HIT_ALPHA_THRESHOLD = 16;

/**
 * Canvas renderer + animation state machine for one pet pack.
 *
 * Everything is drawn inside a fixed 320x320 "design space"; the canvas transform
 * scales that space to the real window size, so the pet stays crisp at any DPI.
 */
export class PetEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pack: LoadedPetPack;
  private readonly onStateChange?: (state: string) => void;

  private stateName = "idle";
  private stateDef: StateDef;
  private animName: string;
  private animDef: AnimationDef;
  private image: HTMLImageElement;

  private frame = 0;
  private elapsed = 0;
  private transition = 1;
  private lastTs = 0;
  private rafId = 0;
  private running = false;
  private pixelRatio = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(canvas: HTMLCanvasElement, pack: LoadedPetPack, onStateChange?: (state: string) => void) {
    const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d context is not available");

    this.canvas = canvas;
    this.ctx = ctx;
    this.pack = pack;
    this.onStateChange = onStateChange;

    const idle = pack.meta.states.idle;
    if (!idle) throw new Error("pet pack has no idle state");

    this.stateDef = idle;
    this.animName = this.pickName(idle.anims);
    this.animDef = this.requireAnimation(this.animName);
    this.image = this.requireImage(this.animName);

    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    // Keep the 320x320 design space square even if the viewport is not (browser preview).
    const unit = Math.min(this.canvas.width, this.canvas.height) / DESIGN_SIZE;
    this.pixelRatio = unit;
    this.offsetX = (this.canvas.width - DESIGN_SIZE * unit) / 2;
    this.offsetY = this.canvas.height - DESIGN_SIZE * unit;
    this.ctx.setTransform(unit, 0, 0, unit, this.offsetX, this.offsetY);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.render();
  }

  get currentState(): string {
    return this.stateName;
  }

  /** Requests a state change. Lower priority states cannot interrupt higher ones. */
  play(state: string, force = false): boolean {
    const def = this.pack.meta.states[state];
    if (!def) return false;
    const currentPriority = this.stateDef.priority ?? 0;
    if (!force && (def.priority ?? 0) < currentPriority) return false;

    this.stateName = state;
    this.stateDef = def;
    this.setAnimation(this.pickName(def.anims));
    this.transition = 0;
    this.onStateChange?.(state);
    return true;
  }

  /** Returns to idle only when the current state is still "talk". */
  endTalk(): void {
    if (this.stateName === "talk") this.play("idle", true);
  }

  /** Alpha hit test in CSS client coordinates. */
  hitTest(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const x = ((clientX - rect.left) / rect.width) * DESIGN_SIZE;
    const y = ((clientY - rect.top) / rect.height) * DESIGN_SIZE;
    return this.alphaAt(x, y) > HIT_ALPHA_THRESHOLD;
  }

  /** Alpha hit test in design coordinates (0..320). */
  alphaAt(designX: number, designY: number): number {
    const px = Math.floor(this.offsetX + designX * this.pixelRatio);
    const py = Math.floor(this.offsetY + designY * this.pixelRatio);
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) return 0;
    return this.ctx.getImageData(px, py, 1, 1).data[3] ?? 0;
  }

  private requireAnimation(name: string): AnimationDef {
    const def = this.pack.meta.animations[name];
    if (!def) throw new Error(`missing animation "${name}"`);
    return def;
  }

  private requireImage(name: string): HTMLImageElement {
    const image = this.pack.images[name];
    if (!image) throw new Error(`missing image for animation "${name}"`);
    return image;
  }

  private pickName(pool: string[]): string {
    const names = pool.filter((name) => name in this.pack.meta.animations);
    if (names.length === 0) throw new Error("state references no valid animation");
    const index = Math.floor(Math.random() * names.length);
    return names[index] ?? names[0] ?? "idle";
  }

  private setAnimation(name: string): void {
    this.animName = name;
    this.animDef = this.requireAnimation(name);
    this.image = this.requireImage(name);
    this.frame = 0;
    this.elapsed = 0;
  }

  private onAnimationComplete(): void {
    const def = this.stateDef;
    if (def.next) {
      this.play(def.next, true);
      return;
    }
    if (def.loop) {
      const alternatives = def.anims.filter((name) => name !== this.animName);
      this.setAnimation(this.pickName(alternatives.length > 0 ? alternatives : def.anims));
      return;
    }
    this.play("idle", true);
  }

  private tick(dt: number): void {
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt / 170);
    }

    const frameDuration = 1000 / this.animDef.fps;
    this.elapsed += dt;
    let guard = 0;
    while (this.elapsed >= frameDuration && guard < 8) {
      guard++;
      this.elapsed -= frameDuration;
      this.frame++;
      if (this.frame >= this.animDef.frames) {
        if (this.animDef.loop) {
          this.frame = 0;
        } else {
          this.frame = this.animDef.frames - 1;
          this.onAnimationComplete();
          break;
        }
      }
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const meta = this.pack.meta;
    const { width, height } = meta.frame;
    const anchor = meta.anchor ?? { x: 0.5, y: 1 };

    ctx.clearRect(0, 0, DESIGN_SIZE, DESIGN_SIZE);

    const x = DESIGN_SIZE / 2 - width * anchor.x;
    const y = DESIGN_SIZE - BOTTOM_MARGIN - height * anchor.y;

    // "squash then pop" on state changes keeps swaps from looking like a hard cut.
    const squash = this.transition < 1 ? Math.sin(Math.PI * this.transition) : 0;
    const scaleX = 1 + squash * 0.045;
    const scaleY = 1 - squash * 0.09;
    const pivotX = DESIGN_SIZE / 2;
    const pivotY = DESIGN_SIZE - BOTTOM_MARGIN;

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(this.image, this.frame * width, 0, width, height, x, y, width, height);
    ctx.restore();
  }

  private readonly loop = (ts: number): void => {
    if (!this.running) return;
    const dt = Math.min(100, Math.max(0, ts - this.lastTs));
    this.lastTs = ts;
    this.tick(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };
}
