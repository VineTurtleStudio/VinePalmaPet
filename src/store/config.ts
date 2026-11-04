import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type PluginValue = string | number | boolean | null;

/** Per-plugin key/value storage and the ids of enabled plugins. */
export interface PluginsConfig {
  enabled: string[];
  data: Record<string, Record<string, PluginValue>>;
}

export interface PetConfig {
  version: 1;
  petId: string;
  scale: number;
  alwaysOnTop: boolean;
  muted: boolean;
  bubbleEnabled: boolean;
  position: { x: number; y: number } | null;
  plugins: PluginsConfig;
}

export const DEFAULT_CONFIG: PetConfig = {
  version: 1,
  petId: "vine",
  scale: 1,
  alwaysOnTop: true,
  muted: false,
  bubbleEnabled: true,
  position: null,
  plugins: { enabled: [], data: {} },
};

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clampScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONFIG.scale;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPluginValue(value: unknown): value is PluginValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function normalizePlugins(raw: unknown): PluginsConfig {
  const value = isRecord(raw) ? raw : {};
  const enabled = Array.isArray(value.enabled)
    ? [
        ...new Set(
          value.enabled.filter(
            (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64,
          ),
        ),
      ].slice(0, 64)
    : [];

  const data: Record<string, Record<string, PluginValue>> = {};
  if (isRecord(value.data)) {
    for (const [id, store] of Object.entries(value.data).slice(0, 64)) {
      if (!isRecord(store)) continue;
      const clean: Record<string, PluginValue> = {};
      for (const [key, item] of Object.entries(store).slice(0, 64)) {
        if (key.length === 0 || key.length > 64) continue;
        if (typeof item === "string" && item.length > 2000) continue;
        if (isPluginValue(item)) clean[key] = item;
      }
      data[id] = clean;
    }
  }

  return { enabled, data };
}

function normalize(raw: unknown): PetConfig {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<PetConfig>;
  const position =
    value.position &&
    typeof value.position.x === "number" &&
    typeof value.position.y === "number" &&
    Number.isFinite(value.position.x) &&
    Number.isFinite(value.position.y)
      ? { x: Math.round(value.position.x), y: Math.round(value.position.y) }
      : null;

  return {
    version: 1,
    petId: typeof value.petId === "string" && value.petId.length > 0 ? value.petId : DEFAULT_CONFIG.petId,
    scale: clampScale(value.scale),
    alwaysOnTop: value.alwaysOnTop !== false,
    muted: value.muted === true,
    bubbleEnabled: value.bubbleEnabled !== false,
    position,
    plugins: normalizePlugins(value.plugins),
  };
}

interface ConfigStore {
  config: PetConfig;
  loaded: boolean;
  load: () => Promise<void>;
  patch: (partial: Partial<PetConfig>) => void;
  /** Updates the in-memory config without scheduling a disk write. */
  applyLocal: (partial: Partial<PetConfig>) => void;
  /** Writes the current config immediately, cancelling the pending debounce. */
  flush: () => Promise<void>;
  /** Re-reads the config from disk, applies `partial`, then writes it back immediately. */
  applyAndFlush: (partial: Partial<PetConfig>) => Promise<void>;
}

let saveTimer: number | undefined;
let pendingPatch: Partial<PetConfig> | null = null;

async function writePatch(partial: Partial<PetConfig>): Promise<void> {
  if (isTauri()) {
    await invoke("patch_config", { patch: partial });
  } else {
    const stored = localStorage.getItem("vinepalmapet.config");
    let current: Record<string, unknown> = {};
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (typeof parsed === "object" && parsed !== null) current = parsed as Record<string, unknown>;
      } catch {
        current = {};
      }
    }
    localStorage.setItem("vinepalmapet.config", JSON.stringify({ ...current, ...partial }));
  }
}

function persist(partial: Partial<PetConfig>): void {
  pendingPatch = { ...(pendingPatch ?? {}), ...partial };
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    const patch = pendingPatch;
    pendingPatch = null;
    if (patch) void writePatch(patch).catch((error) => console.error("patch_config failed", error));
  }, 250);
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  loaded: false,

  load: async () => {
    try {
      let raw: unknown = null;
      if (isTauri()) {
        raw = await invoke("load_config");
      } else {
        const stored = localStorage.getItem("vinepalmapet.config");
        raw = stored ? JSON.parse(stored) : null;
      }
      set({ config: normalize(raw), loaded: true });
    } catch (error) {
      console.error("load_config failed", error);
      set({ config: DEFAULT_CONFIG, loaded: true });
    }
  },

  patch: (partial) => {
    const next = normalize({ ...get().config, ...partial });
    set({ config: next });
    persist(partial);
  },

  applyLocal: (partial) => {
    set({ config: normalize({ ...get().config, ...partial }) });
  },

  flush: async () => {
    if (saveTimer !== undefined) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    const patch = pendingPatch;
    pendingPatch = null;
    if (patch) await writePatch(patch);
  },

  applyAndFlush: async (partial) => {
    await get().load();
    get().patch(partial);
    await get().flush();
  },
}));
