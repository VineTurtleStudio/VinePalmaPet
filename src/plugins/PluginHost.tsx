import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isTauri } from "../platform/desktop";
import { isPluginValue, useConfigStore, type PetConfig } from "../store/config";
import { setPluginStorage } from "../store/plugins";
import { listPlugins, loadPluginEntry } from "./registry";
import {
  injectBootstrap,
  isCallMessage,
  isLogMessage,
  isProtocolMessage,
  VPP_PROTOCOL,
  type PluginCallMessage,
} from "./rpc";
import type { PetSnapshot, PluginInfo, PluginPermission, PublicConfig } from "./types";

/** Animation states a plugin is allowed to request. */
const ALLOWED_STATES = ["idle", "pat", "celebrate", "focus", "sleep", "talk"];
const MAX_CALLS_PER_SECOND = 20;
const MAX_TEXT_LENGTH = 200;

interface PluginHostProps {
  config: PetConfig;
  say: (text: string, duration?: number) => void;
  playState: (state: string) => boolean;
  stateName: string;
  petId: string;
}

interface LoadedPlugin {
  info: PluginInfo;
  html: string;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function PluginFrame({
  id,
  html,
  register,
  onLoad,
}: {
  id: string;
  html: string;
  register: (id: string, frame: HTMLIFrameElement | null) => void;
  onLoad: () => void;
}) {
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    register(id, ref.current);
    return () => register(id, null);
  }, [id, register]);

  return (
    <iframe
      ref={ref}
      className="plugin-frame"
      title={`plugin:${id}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={html}
      onLoad={onLoad}
    />
  );
}

/**
 * Runs enabled plugins in sandboxed iframes and answers their `postMessage`
 * calls. The host validates every call against the permissions in `plugin.json`.
 */
export function PluginHost({ config, say, playState, stateName, petId }: PluginHostProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [resources, setResources] = useState<Record<string, LoadedPlugin>>({});
  const [revision, setRevision] = useState(0);

  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const loaded = useRef(new Set<string>());
  const buckets = useRef(new Map<string, { start: number; count: number }>());
  const latest = useRef({ config, say, playState, stateName, petId });
  latest.current = { config, say, playState, stateName, petId };

  const pluginById = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin])), [plugins]);
  const pluginByIdRef = useRef(pluginById);
  pluginByIdRef.current = pluginById;

  const enabledKey = config.plugins.enabled.slice().sort().join("|");
  const enabledIds = useMemo(() => (enabledKey ? enabledKey.split("|") : []), [enabledKey]);

  const registerFrame = useCallback((id: string, frame: HTMLIFrameElement | null) => {
    if (frame) frames.current.set(id, frame);
    else frames.current.delete(id);
  }, []);

  const postTo = useCallback((id: string, message: Record<string, unknown>) => {
    frames.current.get(id)?.contentWindow?.postMessage({ vpp: VPP_PROTOCOL, ...message }, "*");
  }, []);

  const sendInit = useCallback(
    (id: string, info: PluginInfo) => {
      const current = latest.current;
      postTo(id, {
        kind: "init",
        payload: {
          manifest: {
            id: info.id,
            name: info.name,
            version: info.version,
            description: info.description ?? null,
            author: info.author ?? null,
            permissions: info.permissions,
          },
          permissions: info.permissions,
          storage: current.config.plugins.data[id] ?? {},
          pet: {
            id: current.petId,
            state: current.stateName,
            scale: current.config.scale,
          },
        },
      });
    },
    [postTo],
  );

  const allowCall = useCallback((id: string): boolean => {
    const now = Date.now();
    const bucket = buckets.current.get(id);
    if (!bucket || now - bucket.start >= 1000) {
      buckets.current.set(id, { start: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= MAX_CALLS_PER_SECOND;
  }, []);

  const readStorage = useCallback((id: string, key: unknown) => {
    if (typeof key !== "string" || key.length === 0 || key.length > 64) {
      throw new Error("存储键不合法");
    }
    const store = latest.current.config.plugins.data[id] ?? {};
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  }, []);

  const writeStorage = useCallback(async (id: string, params: Record<string, unknown>) => {
    const key = params.key;
    if (typeof key !== "string" || key.length === 0 || key.length > 64) {
      throw new Error("存储键不合法");
    }
    if (typeof params.value === "string" && params.value.length > 2000) {
      throw new Error("单个值不能超过 2000 个字符");
    }
    if (!isPluginValue(params.value)) {
      throw new Error("只支持 string / number / boolean / null");
    }

    // Written by Rust with a read-modify-write cycle so it cannot clobber the
    // enabled list when the settings window toggles a plugin at the same time.
    const plugins = await setPluginStorage(id, key, params.value);
    useConfigStore.getState().applyLocal({ plugins });
    return true;
  }, []);

  const handleCall = useCallback(
    async (id: string, info: PluginInfo, call: PluginCallMessage): Promise<unknown> => {
      if (!allowCall(id)) throw new Error("调用太频繁，请稍后再试");

      const requirePermission = (permission: PluginPermission) => {
        if (!info.permissions.includes(permission)) {
          throw new Error(`插件没有 ${permission} 权限`);
        }
      };
      const params = isRecord(call.params) ? call.params : {};

      switch (call.method) {
        case "pet.say": {
          requirePermission("pet.say");
          const text = typeof params.text === "string" ? params.text.trim().slice(0, MAX_TEXT_LENGTH) : "";
          if (!text) throw new Error("text 不能为空");
          const duration =
            typeof params.duration === "number" && Number.isFinite(params.duration)
              ? Math.min(15000, Math.max(800, params.duration))
              : 3800;
          latest.current.say(text, duration);
          return null;
        }

        case "pet.setState": {
          requirePermission("pet.state");
          const state = typeof params.state === "string" ? params.state : "";
          if (!ALLOWED_STATES.includes(state)) throw new Error(`不支持的状态：${state}`);
          if (!latest.current.playState(state)) {
            throw new Error("当前动作优先级更高，稍后再试");
          }
          return true;
        }

        case "pet.get": {
          requirePermission("pet.read");
          const current = latest.current;
          return {
            id: current.petId,
            state: current.stateName,
            scale: current.config.scale,
          } satisfies PetSnapshot;
        }

        case "config.get": {
          requirePermission("config.read");
          const current = latest.current.config;
          return {
            petId: current.petId,
            scale: current.scale,
            alwaysOnTop: current.alwaysOnTop,
            muted: current.muted,
            bubbleEnabled: current.bubbleEnabled,
          } satisfies PublicConfig;
        }

        case "storage.get":
          return readStorage(id, params.key);

        case "storage.all":
          return latest.current.config.plugins.data[id] ?? {};

        case "storage.set":
          return writeStorage(id, params);

        default:
          throw new Error(`未知方法：${call.method}`);
      }
    },
    [allowCall, readStorage, writeStorage],
  );

  // Load the plugin list and refresh it when the settings window changes it.
  const refreshPlugins = useCallback(async () => {
    setPlugins(await listPlugins());
  }, []);

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins, revision]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void listen("pet://plugins-changed", () => {
      loaded.current.clear();
      setResources({});
      setRevision((value) => value + 1);
    }).then((fn) => (cancelled ? fn() : unlisteners.push(fn)));

    void listen<string>("pet://plugin-test", ({ payload }) => {
      const wanted = typeof payload === "string" && payload.length > 0 ? payload : null;
      for (const id of latest.current.config.plugins.enabled) {
        if (!wanted || wanted === id) postTo(id, { kind: "event", event: "plugin:test", payload: null });
      }
    }).then((fn) => (cancelled ? fn() : unlisteners.push(fn)));

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [postTo]);

  // Fetch entry documents for enabled plugins (built-in or imported).
  useEffect(() => {
    for (const id of enabledIds) {
      const info = pluginById.get(id);
      if (!info || loaded.current.has(id)) continue;
      loaded.current.add(id);
      void loadPluginEntry(info)
        .then((html) => {
          setResources((previous) => ({ ...previous, [id]: { info, html: injectBootstrap(html) } }));
        })
        .catch((error: unknown) => {
          loaded.current.delete(id);
          console.error(`[plugin] cannot load "${id}"`, error);
        });
    }
  }, [enabledIds, pluginById]);

  // Answer plugin calls and the initial handshake.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isProtocolMessage(event.data)) return;

      let pluginId: string | null = null;
      for (const [id, frame] of frames.current) {
        if (frame.contentWindow === event.source) {
          pluginId = id;
          break;
        }
      }
      if (!pluginId) return;

      const info = pluginByIdRef.current.get(pluginId);
      if (!info) return;

      if (event.data.kind === "ready") {
        sendInit(pluginId, info);
        return;
      }

      if (isLogMessage(event.data)) {
        console.log(`[plugin:${pluginId}] ${event.data.message}`);
        return;
      }

      if (isCallMessage(event.data)) {
        const call = event.data;
        void handleCall(pluginId, info, call).then(
          (value) => postTo(pluginId, { kind: "result", id: call.id, ok: true, value }),
          (error: unknown) =>
            postTo(pluginId, { kind: "result", id: call.id, ok: false, error: errorText(error) }),
        );
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleCall, postTo, sendInit]);

  // Keep plugins informed about the pet's current animation state.
  useEffect(() => {
    for (const id of enabledIds) {
      postTo(id, { kind: "event", event: "pet:state", payload: { state: stateName, petId } });
    }
  }, [enabledIds, postTo, stateName, petId]);

  const running = enabledIds
    .map((id) => pluginById.get(id))
    .filter((info): info is PluginInfo => info !== undefined);

  return (
    <div className="plugin-host" aria-hidden="true">
      {running.map((info) => {
        const resource = resources[info.id];
        if (!resource?.html) return null;
        return (
          <PluginFrame
            key={`${info.id}:${info.version}`}
            id={info.id}
            html={resource.html}
            register={registerFrame}
            onLoad={() => sendInit(info.id, info)}
          />
        );
      })}
    </div>
  );
}
