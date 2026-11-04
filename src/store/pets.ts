import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";

export interface PetPackInfo {
  id: string;
  name: string;
  author?: string | null;
  license?: string | null;
  description?: string | null;
  builtin: boolean;
  /** Absolute directory of imported packs. `null` for the built-in pack. */
  dir?: string | null;
}

export const BUILTIN_PET_ID = "vine";

export const BUILTIN_PACK: PetPackInfo = {
  id: BUILTIN_PET_ID,
  name: "Vine",
  author: "VineTurtleStudio",
  license: "CC-BY-4.0",
  description: "内置的藤芽角色",
  builtin: true,
  dir: null,
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Lists built-in and imported pet packs. Falls back to the built-in pack in a browser. */
export async function listPetPacks(): Promise<PetPackInfo[]> {
  if (!isTauri()) return [BUILTIN_PACK];
  try {
    const packs = await invoke<PetPackInfo[]>("list_pet_packs");
    return packs.length > 0 ? packs : [BUILTIN_PACK];
  } catch (error) {
    console.error("list_pet_packs failed", error);
    return [BUILTIN_PACK];
  }
}

export function importPetPack(zipPath: string): Promise<PetPackInfo> {
  return invoke<PetPackInfo>("import_pet_pack", { zipPath });
}

export function importGifPack(gifPath: string, name?: string): Promise<PetPackInfo> {
  return invoke<PetPackInfo>("import_gif_pack", { gifPath, name: name?.trim() ? name.trim() : null });
}

export function removePetPack(id: string): Promise<void> {
  return invoke("remove_pet_pack", { id });
}

/** Reads a file inside an imported pack and returns its base64 content. */
export function readPetFileBase64(id: string, file: string): Promise<string> {
  return invoke<string>("read_pet_file", { id, file });
}

/** Tells the pet window that the persisted config changed on disk. */
export async function notifyConfigChanged(): Promise<void> {
  if (!isTauri()) return;
  try {
    await emitTo("pet", "pet://config-changed", null);
  } catch (error) {
    console.error("emit pet://config-changed failed", error);
  }
}

/** Tells the pet window that the installed pet packs changed on disk. */
export async function notifyPetsChanged(): Promise<void> {
  if (!isTauri()) return;
  try {
    await emitTo("pet", "pet://pets-changed", null);
  } catch (error) {
    console.error("emit pet://pets-changed failed", error);
  }
}
