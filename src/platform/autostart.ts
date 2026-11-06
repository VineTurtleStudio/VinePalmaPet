import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

import { isTauri } from "./desktop";

/**
 * Reads the real OS state instead of mirroring it in config, so the settings
 * window stays correct even if the user changes it outside the app.
 * Returns null in a plain browser preview.
 */
export async function getAutoStart(): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    return await isEnabled();
  } catch (error) {
    console.error("autostart isEnabled failed", error);
    return null;
  }
}

/** Enables/disables launch-at-login and returns the resulting OS state. */
export async function setAutoStart(enabled: boolean): Promise<boolean> {
  if (!isTauri()) throw new Error("浏览器预览不支持开机自启");
  if (enabled) await enable();
  else await disable();
  return isEnabled();
}
