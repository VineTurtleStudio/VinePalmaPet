import type { AnimationDef, LoadedPetPack, PetPackMeta, StateDef } from "./types";

function fail(message: string): never {
  throw new Error(`[pet-pack] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

function validateAnimation(name: string, raw: unknown): AnimationDef {
  if (!isRecord(raw)) fail(`animation "${name}" must be an object`);
  if (typeof raw.file !== "string" || raw.file.length === 0) fail(`animation "${name}" needs a file`);
  if (raw.file.includes("..")) fail(`animation "${name}" must not reference a parent directory`);
  if (!isPositiveInt(raw.frames)) fail(`animation "${name}" needs frames > 0`);
  if (typeof raw.fps !== "number" || !(raw.fps > 0)) fail(`animation "${name}" needs fps > 0`);
  return {
    file: raw.file,
    frames: raw.frames,
    fps: raw.fps,
    loop: raw.loop === true,
  };
}

function validateState(name: string, raw: unknown, animations: Record<string, AnimationDef>): StateDef {
  if (!isRecord(raw)) fail(`state "${name}" must be an object`);
  if (!Array.isArray(raw.anims) || raw.anims.length === 0) fail(`state "${name}" needs a non-empty anims array`);
  const anims: string[] = [];
  for (const item of raw.anims) {
    if (typeof item !== "string") fail(`state "${name}" has a non-string animation reference`);
    if (!(item in animations)) fail(`state "${name}" references unknown animation "${item}"`);
    anims.push(item);
  }
  const next = typeof raw.next === "string" ? raw.next : undefined;
  return {
    anims,
    loop: raw.loop === true,
    next,
    priority: typeof raw.priority === "number" ? raw.priority : 0,
  };
}

export function validatePetPack(raw: unknown): PetPackMeta {
  if (!isRecord(raw)) fail("pet.json must be an object");
  if (raw.schema !== 1) fail("unsupported schema, expected 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-_]*$/i.test(raw.id)) fail("invalid id");
  if (typeof raw.name !== "string" || raw.name.length === 0) fail("missing name");

  if (!isRecord(raw.frame)) fail("missing frame");
  if (!isPositiveInt(raw.frame.width) || !isPositiveInt(raw.frame.height)) fail("frame width/height must be integers");

  if (!isRecord(raw.animations)) fail("missing animations");
  const animations: Record<string, AnimationDef> = {};
  for (const [name, anim] of Object.entries(raw.animations)) {
    animations[name] = validateAnimation(name, anim);
  }
  if (Object.keys(animations).length === 0) fail("pet pack needs at least one animation");

  if (!isRecord(raw.states)) fail("missing states");
  const states: Record<string, StateDef> = {};
  for (const [name, state] of Object.entries(raw.states)) {
    states[name] = validateState(name, state, animations);
  }
  if (!("idle" in states)) fail('pet pack must define an "idle" state');

  for (const [name, state] of Object.entries(states)) {
    if (state.next && !(state.next in states)) {
      fail(`state "${name}" points to unknown state "${state.next}"`);
    }
  }

  const anchor = isRecord(raw.anchor)
    ? { x: Number(raw.anchor.x ?? 0.5), y: Number(raw.anchor.y ?? 1) }
    : { x: 0.5, y: 1 };
  const bubble = isRecord(raw.bubble)
    ? { x: Number(raw.bubble.x ?? 0.5), y: Number(raw.bubble.y ?? 0.06) }
    : undefined;

  return {
    schema: 1,
    id: raw.id,
    name: raw.name,
    author: typeof raw.author === "string" ? raw.author : undefined,
    license: typeof raw.license === "string" ? raw.license : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    frame: { width: raw.frame.width, height: raw.frame.height },
    anchor,
    bubble,
    animations,
    states,
    sounds: isRecord(raw.sounds) ? (raw.sounds as Record<string, string>) : undefined,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      img
        .decode()
        .catch(() => undefined)
        .finally(() => resolve(img));
    };
    img.onerror = () => reject(new Error(`[pet-pack] cannot load image: ${src}`));
    img.src = src;
  });
}

/**
 * Loads a pet pack from a static directory, e.g. `/pets/vine/`.
 * Imported packs (from zip / folder) will reuse the same validator in M3.
 */
export async function loadPetPack(id: string, baseUrl?: string): Promise<LoadedPetPack> {
  const base = baseUrl ?? `${import.meta.env.BASE_URL}pets/${id}/`;
  const response = await fetch(`${base}pet.json`, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`[pet-pack] cannot fetch ${base}pet.json (${response.status})`);
  }
  const meta = validatePetPack(await response.json());

  const images: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.entries(meta.animations).map(async ([name, anim]) => {
      images[name] = await loadImage(`${base}${anim.file}`);
    }),
  );

  return { meta, baseUrl: base, images };
}
