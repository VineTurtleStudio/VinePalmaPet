import { listen } from "@tauri-apps/api/event";
import { emitTo } from "@tauri-apps/api/event";
import { confirm, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";

import { listPlugins } from "../plugins/registry";
import { PERMISSION_INFO, type PluginInfo } from "../plugins/types";
import { getAutoStart, setAutoStart } from "../platform/autostart";
import {
  BUILTIN_PET_ID,
  importGifPack,
  importPetPack,
  isTauri,
  listPetPacks,
  notifyConfigChanged,
  notifyPetsChanged,
  removePetPack,
  type PetPackInfo,
} from "../store/pets";
import {
  importPlugin,
  notifyPluginsChanged,
  removePlugin,
  setPluginEnabled,
  testPlugin,
} from "../store/plugins";
import { MAX_SCALE, MIN_SCALE, useConfigStore, type PetConfig } from "../store/config";

const SCALE_STEP = 0.1;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function Settings() {
  const config = useConfigStore((state) => state.config);
  const loaded = useConfigStore((state) => state.loaded);
  const load = useConfigStore((state) => state.load);
  const applyAndFlush = useConfigStore((state) => state.applyAndFlush);

  const [packs, setPacks] = useState<PetPackInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [autoStart, setAutoStartState] = useState<boolean | null>(null);
  const [autoStartBusy, setAutoStartBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gifName, setGifName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledPlugins = useMemo(() => new Set(config.plugins.enabled), [config.plugins.enabled]);

  const refreshPacks = useCallback(async () => {
    setPacks(await listPetPacks());
  }, []);

  const refreshPlugins = useCallback(async () => {
    setPlugins(await listPlugins());
  }, []);

  const refreshAutoStart = useCallback(async () => {
    setAutoStartState(await getAutoStart());
  }, []);

  useEffect(() => {
    void load();
    void refreshPacks();
    void refreshPlugins();
    void refreshAutoStart();
  }, [load, refreshPacks, refreshPlugins, refreshAutoStart]);

  // The Rust side pings this window whenever it is shown again.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen("settings://refresh", () => {
      void load();
      void refreshPacks();
      void refreshPlugins();
      void refreshAutoStart();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [load, refreshPacks, refreshPlugins, refreshAutoStart]);

  const toast = (text: string) => {
    setError(null);
    setMessage(text);
  };

  // Toasts are informational; fade them out so they don't linger forever.
  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  const fail = (err: unknown) => {
    console.error(err);
    setMessage(null);
    setError(errorText(err));
  };

  const apply = async (partial: Partial<PetConfig>) => {
    await applyAndFlush(partial);
    await notifyConfigChanged();
  };

  const handleApply = async (partial: Partial<PetConfig>) => {
    if (busy) return;
    setBusy(true);
    try {
      await apply(partial);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSelect = async (pack: PetPackInfo) => {
    if (pack.id === config.petId) return;
    if (busy) return;
    setBusy(true);
    try {
      await apply({ petId: pack.id });
      toast(`已切换到「${pack.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleImportZip = async () => {
    if (busy) return;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: "选择宠物包 ZIP",
        filters: [{ name: "宠物包", extensions: ["zip"] }],
      });
      if (!picked || Array.isArray(picked)) return;

      setBusy(true);
      setMessage("正在导入宠物包…");
      setError(null);
      const info = await importPetPack(picked);
      await refreshPacks();
      await apply({ petId: info.id });
      await notifyPetsChanged();
      toast(`已导入「${info.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleImportGif = async () => {
    if (busy) return;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: "选择 GIF 图片",
        filters: [{ name: "GIF 图片", extensions: ["gif"] }],
      });
      if (!picked || Array.isArray(picked)) return;

      setBusy(true);
      setMessage("正在把 GIF 转换成宠物包…");
      setError(null);
      const info = await importGifPack(picked, gifName);
      setGifName("");
      await refreshPacks();
      await apply({ petId: info.id });
      await notifyPetsChanged();
      toast(`已导入「${info.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (pack: PetPackInfo) => {
    if (busy) return;
    const ok = await confirm(`确定删除宠物包「${pack.name}」吗？此操作无法撤销。`, {
      title: "删除宠物包",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!ok) return;

    setBusy(true);
    try {
      if (config.petId === pack.id) {
        await apply({ petId: BUILTIN_PET_ID });
      }
      await removePetPack(pack.id);
      await notifyPetsChanged();
      await refreshPacks();
      toast(`已删除「${pack.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleResetPosition = async () => {
    if (!isTauri()) return;
    try {
      await emitTo("pet", "pet://reset-position", null);
      toast("已让桌宠回到默认位置");
    } catch (err) {
      fail(err);
    }
  };

  const handleToggleAutoStart = async (enabled: boolean) => {
    if (autoStartBusy) return;
    setAutoStartBusy(true);
    try {
      const next = await setAutoStart(enabled);
      setAutoStartState(next);
      toast(next ? "已开启开机自启" : "已关闭开机自启");
    } catch (err) {
      fail(err);
      // Keep the checkbox in sync with the real OS state after a failure.
      setAutoStartState(await getAutoStart());
    } finally {
      setAutoStartBusy(false);
    }
  };

  const handleTogglePlugin = async (plugin: PluginInfo, enable: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const plugins = await setPluginEnabled(plugin.id, enable);
      useConfigStore.getState().applyLocal({ plugins });
      await notifyConfigChanged();
      toast(enable ? `已启用「${plugin.name}」` : `已停用「${plugin.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleTestPlugin = async (plugin: PluginInfo) => {
    try {
      await testPlugin(plugin.id);
      toast(`已让「${plugin.name}」执行一次`);
    } catch (err) {
      fail(err);
    }
  };

  const handleImportPlugin = async () => {
    if (busy) return;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: "选择插件 ZIP",
        filters: [{ name: "插件", extensions: ["zip"] }],
      });
      if (!picked || Array.isArray(picked)) return;

      setBusy(true);
      setMessage("正在导入插件…");
      setError(null);
      const info = await importPlugin(picked);
      await refreshPlugins();

      const plugins = await setPluginEnabled(info.id, true);
      useConfigStore.getState().applyLocal({ plugins });
      await notifyConfigChanged();
      await notifyPluginsChanged();
      toast(`已导入并启用「${info.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePlugin = async (plugin: PluginInfo) => {
    if (busy) return;
    const ok = await confirm(`确定删除插件「${plugin.name}」吗？此操作无法撤销。`, {
      title: "删除插件",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const plugins = await setPluginEnabled(plugin.id, false);
      useConfigStore.getState().applyLocal({ plugins });
      await notifyConfigChanged();
      await removePlugin(plugin.id);
      await notifyPluginsChanged();
      await refreshPlugins();
      toast(`已删除「${plugin.name}」`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <main className="settings settings--loading">正在读取设置…</main>;
  }

  return (
    <main className="settings">
      <header className="head">
        <div>
          <h1>VinePalmaPet</h1>
          <p>桌宠设置</p>
        </div>
        <span className="version">v0.1.0</span>
      </header>

      <section className="card">
        <div className="card__head">
          <div>
            <h2>宠物包</h2>
            <p className="card__hint">切换、导入 ZIP 宠物包，或直接把一张 GIF 变成宠物。</p>
          </div>
          <button className="button" type="button" onClick={handleImportZip} disabled={busy}>
            导入 ZIP
          </button>
        </div>

        <ul className="packs">
          {packs.map((pack) => {
            const active = pack.id === config.petId;
            return (
              <li key={pack.id} className={`pack${active ? " pack--active" : ""}`}>
                <button
                  type="button"
                  className="pack__main"
                  onClick={() => void handleSelect(pack)}
                  disabled={busy}
                  aria-pressed={active}
                >
                  <span className="pack__dot" aria-hidden="true" />
                  <span className="pack__text">
                    <span className="pack__name">
                      {pack.name}
                      {pack.builtin && <em>内置</em>}
                    </span>
                    <span className="pack__meta">
                      {pack.author || "未知作者"} · {pack.id}
                    </span>
                  </span>
                  {active && <span className="pack__badge">使用中</span>}
                </button>
                {!pack.builtin && (
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => void handleRemove(pack)}
                    disabled={busy}
                  >
                    删除
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="gif-row">
          <label htmlFor="gif-name">GIF 名称</label>
          <input
            id="gif-name"
            type="text"
            value={gifName}
            placeholder="留空则使用文件名"
            maxLength={40}
            onChange={(event) => setGifName(event.target.value)}
            disabled={busy}
          />
          <button className="button" type="button" onClick={handleImportGif} disabled={busy}>
            导入 GIF
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2>插件</h2>
            <p className="card__hint">
              插件在沙箱 iframe 中运行，只能使用它声明并经过你允许的能力。
            </p>
          </div>
          <button className="button" type="button" onClick={() => void handleImportPlugin()} disabled={busy}>
            导入插件 ZIP
          </button>
        </div>

        {plugins.length === 0 ? (
          <p className="plugin-empty">还没有可用插件。</p>
        ) : (
          <ul className="plugin-list">
            {plugins.map((plugin) => {
              const enabled = enabledPlugins.has(plugin.id);
              return (
                <li key={plugin.id} className={`plugin${enabled ? " plugin--enabled" : ""}`}>
                  <div className="plugin__top">
                    <label className="plugin__toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={busy}
                        onChange={(event) => void handleTogglePlugin(plugin, event.target.checked)}
                      />
                      <span className="plugin__text">
                        <span className="plugin__name">
                          {plugin.name}
                          <em>v{plugin.version}</em>
                          {plugin.builtin && <em>内置</em>}
                        </span>
                        <span className="plugin__desc">{plugin.description || "没有说明"}</span>
                      </span>
                    </label>
                    <div className="plugin__actions">
                      {enabled && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => void handleTestPlugin(plugin)}
                          disabled={busy}
                        >
                          试一下
                        </button>
                      )}
                      {!plugin.builtin && (
                        <button
                          type="button"
                          className="button button--danger"
                          onClick={() => void handleRemovePlugin(plugin)}
                          disabled={busy}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="plugin__perms">
                    <span className="plugin__perms-label">权限</span>
                    {plugin.permissions.length === 0 ? (
                      <span className="plugin__perm">无</span>
                    ) : (
                      plugin.permissions.map((permission) => (
                        <span key={permission} className="plugin__perm">
                          {PERMISSION_INFO[permission] ?? permission}
                        </span>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>显示</h2>

        <div className="row">
          <span className="row__label">大小</span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => void handleApply({ scale: clampScale(config.scale - SCALE_STEP) })}
              disabled={busy || config.scale <= MIN_SCALE}
              aria-label="缩小"
            >
              −
            </button>
            <span className="stepper__value">{Math.round(config.scale * 100)}%</span>
            <button
              type="button"
              onClick={() => void handleApply({ scale: clampScale(config.scale + SCALE_STEP) })}
              disabled={busy || config.scale >= MAX_SCALE}
              aria-label="放大"
            >
              +
            </button>
          </div>
        </div>

        <label className="row row--toggle">
          <span className="row__label">窗口置顶</span>
          <input
            type="checkbox"
            checked={config.alwaysOnTop}
            disabled={busy}
            onChange={(event) => void handleApply({ alwaysOnTop: event.target.checked })}
          />
        </label>

        <label className="row row--toggle">
          <span className="row__label">显示气泡</span>
          <input
            type="checkbox"
            checked={config.bubbleEnabled}
            disabled={busy}
            onChange={(event) => void handleApply({ bubbleEnabled: event.target.checked })}
          />
        </label>

        <label className="row row--toggle" title="登录 Windows 后自动在托盘启动">
          <span className="row__label">
            开机自启
            <em className="row__hint">
              {autoStart === null ? "当前环境不可用" : "登录 Windows 后自动启动"}
            </em>
          </span>
          <input
            type="checkbox"
            checked={autoStart === true}
            disabled={autoStartBusy || autoStart === null}
            onChange={(event) => void handleToggleAutoStart(event.target.checked)}
          />
        </label>

        <div className="row">
          <span className="row__label">位置</span>
          <button className="button" type="button" onClick={() => void handleResetPosition()} disabled={busy}>
            回到默认位置
          </button>
        </div>
      </section>

      <footer className="foot">
        <span>提示：右键桌宠也可以快速操作。</span>
        {busy && <span className="foot__status">处理中…</span>}
      </footer>

      {message && <div className="toast">{message}</div>}
      {error && <div className="toast toast--error">{error}</div>}
    </main>
  );
}
