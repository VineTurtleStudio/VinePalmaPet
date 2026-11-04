import {
  isPluginPermission,
  type PluginInfo,
  type PluginManifest,
  type PluginPermission,
} from "./types";
import { listInstalledPlugins, readPluginFileBase64 } from "../store/plugins";

/** Built-in plugins live in `public/plugins/<id>/` and ship with the app. */
const BUILTIN_PLUGIN_IDS = ["pomodoro", "water"] as const;

const PLUGIN_BASE = `${import.meta.env.BASE_URL}plugins/`;

function fail(message: string): never {
  throw new Error(`[plugin] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEntry(entry: string): boolean {
  return (
    entry.toLowerCase().endsWith(".html") &&
    !entry.includes("..") &&
    !entry.startsWith("/") &&
    !entry.includes("\\")
  );
}

export function validatePluginManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) fail("plugin.json must be an object");
  if (raw.schema !== 1) fail("不支持的插件 schema，请使用 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-_]*$/i.test(raw.id)) fail("插件 id 不合法");
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) fail("插件缺少名称");

  const entry = typeof raw.entry === "string" && raw.entry.length > 0 ? raw.entry : "plugin.html";
  if (!safeEntry(entry)) fail("插件入口必须是包内的 .html 文件");

  if (raw.permissions !== undefined && !Array.isArray(raw.permissions)) {
    fail("permissions 必须是数组");
  }
  const permissions: PluginPermission[] = [];
  for (const item of Array.isArray(raw.permissions) ? raw.permissions : []) {
    if (typeof item !== "string" || !isPluginPermission(item)) {
      fail(`未知权限：${String(item)}`);
    }
    if (!permissions.includes(item)) permissions.push(item);
  }

  return {
    schema: 1,
    id: raw.id,
    name: raw.name,
    version:
      typeof raw.version === "string" && raw.version.trim().length > 0 ? raw.version : "0.0.0",
    description: typeof raw.description === "string" ? raw.description : undefined,
    author: typeof raw.author === "string" ? raw.author : undefined,
    permissions,
    entry,
  };
}

async function fetchBuiltinManifest(id: string): Promise<PluginInfo | null> {
  try {
    const response = await fetch(`${PLUGIN_BASE}${id}/plugin.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ...validatePluginManifest(await response.json()), builtin: true, dir: null };
  } catch (error) {
    console.warn(`[plugin] cannot load built-in plugin "${id}"`, error);
    return null;
  }
}

/** Lists built-in plugins plus every plugin installed in the app data folder. */
export async function listPlugins(): Promise<PluginInfo[]> {
  const builtin = (await Promise.all(BUILTIN_PLUGIN_IDS.map(fetchBuiltinManifest))).filter(
    (plugin): plugin is PluginInfo => plugin !== null,
  );

  const imported = (await listInstalledPlugins())
    .filter((plugin) => !builtin.some((known) => known.id === plugin.id))
    .map((plugin): PluginInfo | null => {
      try {
        const manifest = validatePluginManifest(plugin);
        return { ...manifest, builtin: false, dir: plugin.dir ?? null };
      } catch (error) {
        console.warn(`[plugin] skipping invalid plugin "${plugin.id}"`, error);
        return null;
      }
    })
    .filter((plugin): plugin is PluginInfo => plugin !== null);

  return [...builtin, ...imported];
}

function decodeBase64Text(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

/** Reads the plugin entry document so the host can run it inside a sandboxed iframe. */
export async function loadPluginEntry(plugin: PluginInfo): Promise<string> {
  if (plugin.builtin) {
    const response = await fetch(`${PLUGIN_BASE}${plugin.id}/${plugin.entry}`, { cache: "no-cache" });
    if (!response.ok) fail(`无法加载插件页面 (${response.status})`);
    return response.text();
  }

  const base64 = await readPluginFileBase64(plugin.id, plugin.entry);
  const html = decodeBase64Text(base64);
  if (html.length === 0) fail("插件页面是空的");
  return html;
}
