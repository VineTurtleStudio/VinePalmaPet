export interface AnimationDef {
  file: string;
  frames: number;
  fps: number;
  loop: boolean;
}

export interface StateDef {
  anims: string[];
  loop?: boolean;
  next?: string;
  priority?: number;
}

export interface PetPackMeta {
  schema: number;
  id: string;
  name: string;
  author?: string;
  license?: string;
  description?: string;
  frame: { width: number; height: number };
  anchor?: { x: number; y: number };
  bubble?: { x: number; y: number };
  animations: Record<string, AnimationDef>;
  states: Record<string, StateDef>;
  sounds?: Record<string, string>;
}

export interface LoadedPetPack {
  meta: PetPackMeta;
  baseUrl: string;
  images: Record<string, HTMLImageElement>;
  /** Object URLs created for imported packs; revoked by `dispose`. */
  objectUrls?: string[];
  dispose?: () => void;
}

export const DESIGN_SIZE = 320;
