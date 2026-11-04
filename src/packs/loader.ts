import type { AnimationDef, LoadedPetPack, PetPackMeta, StateDef } from "./types";
import { BUILTIN_PET_ID, isTauri, listPetPacks, readPetFileBase64 } from "../store/pets";

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

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function imageMime(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

async function readPackText(id: string, file: string): Promise<string> {
  const base64 = await readPetFileBase64(id, file);
  return new TextDecoder().decode(decodeBase64(base64));
}

/** Loads a pack installed under `%APPDATA%\com.vineturtle.vinepalmapet\pets\<id>\`. */
async function loadImportedPetPack(id: string): Promise<LoadedPetPack> {
  const meta = validatePetPack(JSON.parse(await readPackText(id, "pet.json")));
  const images: Record<string, HTMLImageElement> = {};
  const objectUrls: string[] = [];

  try {
    await Promise.all(
      Object.entries(meta.animations).map(async ([name, anim]) => {
        const base64 = await readPetFileBase64(id, anim.file);
        const blob = new Blob([decodeBase64(base64)], { type: imageMime(anim.file) });
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        images[name] = await loadImage(url);
      }),
    );
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }

  return {
    meta,
    baseUrl: `pet-pack://${id}/`,
    images,
    objectUrls,
    dispose: () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

export interface LoadPetPackOptions {
  /** Read the pack from the app data directory instead of the bundled static files. */
  imported?: boolean;
}

/**
 * Loads a pet pack from the static `/pets/<id>/` directory (built-in packs) or from
 * the imported pack directory in the app data folder.
 */
export async function loadPetPack(id: string, options: LoadPetPackOptions = {}): Promise<LoadedPetPack> {
  if (options.imported) {
    if (!isTauri()) fail("imported pet packs are only available in the desktop app");
    return loadImportedPetPack(id);
  }

  const base = `${import.meta.env.BASE_URL}pets/${id}/`;
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

/**
 * Resolves which storage a pack lives in, then loads it. Unknown, deleted or broken
 * packs fall back to the built-in pet so the window never stays empty.
 */
export async function loadSelectedPetPack(id: string): Promise<LoadedPetPack> {
  const loadWithFallback = async (load: () => Promise<LoadedPetPack>): Promise<LoadedPetPack> => {
    try {
      return await load();
    } catch (error) {
      if (id === BUILTIN_PET_ID) throw error;
      console.warn(`[pet-pack] cannot load "${id}", falling back to "${BUILTIN_PET_ID}"`, error);
      return loadPetPack(BUILTIN_PET_ID);
    }
  };

  if (isTauri()) {
    const packs = await listPetPacks();
    const info = packs.find((pack) => pack.id === id);
    if (info && !info.builtin) {
      return loadWithFallback(() => loadImportedPetPack(id));
    }
  }

  return loadWithFallback(() => loadPetPack(id));
}
