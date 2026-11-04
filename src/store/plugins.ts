import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";

import type { PluginInfo } from "../plugins/types";
import type { PluginValue, PluginsConfig } from "./config";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Lists plugins installed under `%APPDATA%\com.vineturtle.vinepalmapet\plugins\`. */
export async function listInstalledPlugins(): Promise<PluginInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<PluginInfo[]>("list_plugins");
  } catch (error) {
    console.error("list_plugins failed", error);
    return [];
  }
}

export function importPlugin(zipPath: string): Promise<PluginInfo> {
  return invoke<PluginInfo>("import_plugin", { zipPath });
}

export function removePlugin(id: string): Promise<void> {
  return invoke("remove_plugin", { id });
}

/** Reads a file inside an imported plugin and returns its base64 content. */
export function readPluginFileBase64(id: string, file: string): Promise<string> {
  return invoke<string>("read_plugin_file", { id, file });
}

/** Adds/removes a plugin from the enabled list and returns the merged config. */
export function setPluginEnabled(id: string, enabled: boolean): Promise<PluginsConfig> {
  return invoke<PluginsConfig>("set_plugin_enabled", { id, enabled });
}

/** Atomically writes one plugin storage key and returns the merged config. */
export function setPluginStorage(
  pluginId: string,
  key: string,
  value: PluginValue,
): Promise<PluginsConfig> {
  return invoke<PluginsConfig>("set_plugin_storage", { pluginId, key, value });
}

/** Tells the pet window that the installed plugin list changed on disk. */
export async function notifyPluginsChanged(): Promise<void> {
  if (!isTauri()) return;
  try {
    await emitTo("pet", "pet://plugins-changed", null);
  } catch (error) {
    console.error("emit pet://plugins-changed failed", error);
  }
}

/** Asks one enabled plugin to run its action once, used by the settings window. */
export async function testPlugin(id: string): Promise<void> {
  if (!isTauri()) return;
  await emitTo("pet", "pet://plugin-test", id);
}
