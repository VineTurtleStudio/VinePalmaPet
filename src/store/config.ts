import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface PetConfig {
  version: 1;
  petId: string;
  scale: number;
  alwaysOnTop: boolean;
  muted: boolean;
  bubbleEnabled: boolean;
  position: { x: number; y: number } | null;
}

export const DEFAULT_CONFIG: PetConfig = {
  version: 1,
  petId: "vine",
  scale: 1,
  alwaysOnTop: true,
  muted: false,
  bubbleEnabled: true,
  position: null,
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
  };
}

interface ConfigStore {
  config: PetConfig;
  loaded: boolean;
  load: () => Promise<void>;
  patch: (partial: Partial<PetConfig>) => void;
}

let saveTimer: number | undefined;

function persist(config: PetConfig): void {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (isTauri()) {
      invoke("save_config", { config }).catch((error) => console.error("save_config failed", error));
    } else {
      localStorage.setItem("vinepalmapet.config", JSON.stringify(config));
    }
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
    persist(next);
  },
}));
