export const KNOWN_PERMISSIONS = ["pet.say", "pet.state", "pet.read", "config.read"] as const;

export type PluginPermission = (typeof KNOWN_PERMISSIONS)[number];

export const PERMISSION_INFO: Record<PluginPermission, string> = {
  "pet.say": "让桌宠说话",
  "pet.state": "切换桌宠动画",
  "pet.read": "读取桌宠状态",
  "config.read": "读取显示设置",
};

/** Every plugin ships a `plugin.json` next to its entry document. */
export interface PluginManifest {
  schema: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions: PluginPermission[];
  entry: string;
}

export interface PluginInfo extends PluginManifest {
  builtin: boolean;
  /** Absolute directory of imported plugins. `null` for built-in plugins. */
  dir?: string | null;
}

export function isPluginPermission(value: string): value is PluginPermission {
  return (KNOWN_PERMISSIONS as readonly string[]).includes(value);
}

/** Validated state exposed to plugins through the `pet.get` call. */
export interface PetSnapshot {
  id: string;
  state: string;
  scale: number;
}

/** Read-only view of the app config exposed through `config.get`. */
export interface PublicConfig {
  petId: string;
  scale: number;
  alwaysOnTop: boolean;
  muted: boolean;
  bubbleEnabled: boolean;
}
