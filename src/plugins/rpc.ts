export const VPP_PROTOCOL = 1;

export interface ProtocolMessage {
  vpp: number;
  kind: string;
}

export interface PluginCallMessage extends ProtocolMessage {
  kind: "call";
  id: string;
  method: string;
  params?: unknown;
}

export interface PluginLogMessage extends ProtocolMessage {
  kind: "log";
  level: string;
  message: string;
}

export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { vpp?: unknown; kind?: unknown };
  return message.vpp === VPP_PROTOCOL && typeof message.kind === "string";
}

export function isCallMessage(value: ProtocolMessage): value is PluginCallMessage {
  const call = value as Partial<PluginCallMessage>;
  return call.kind === "call" && typeof call.id === "string" && typeof call.method === "string";
}

export function isLogMessage(value: ProtocolMessage): value is PluginLogMessage {
  const log = value as Partial<PluginLogMessage>;
  return log.kind === "log" && typeof log.message === "string";
}

/**
 * Runs inside the sandboxed iframe. It exposes `window.VinePlugin` and relays
 * calls to the host with `postMessage`; the plugin never gets DOM or Tauri access.
 */
const BOOTSTRAP = String.raw`
(function () {
  "use strict";

  var VERSION = ${VPP_PROTOCOL};
  var parentWindow = window.parent;
  var pending = new Map();
  var handlers = new Map();
  var readyHandlers = [];
  var info = null;
  var ready = false;
  var sequence = 0;

  function post(message) {
    message.vpp = VERSION;
    parentWindow.postMessage(message, "*");
  }

  function emit(event, payload) {
    var list = handlers.get(event);
    if (!list) return;
    list.slice().forEach(function (handler) {
      try {
        handler(payload);
      } catch (error) {
        console.error("[plugin] handler failed", error);
      }
    });
  }

  var api = {
    version: VERSION,
    get info() {
      return info;
    },
    get isReady() {
      return ready;
    },
    onReady: function (handler) {
      if (typeof handler !== "function") return;
      if (ready) handler(info);
      else readyHandlers.push(handler);
    },
    on: function (event, handler) {
      if (typeof event !== "string" || typeof handler !== "function") return function () {};
      var list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
      return function () {
        var index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      };
    },
    call: function (method, params) {
      return new Promise(function (resolve, reject) {
        var id = "c" + (++sequence);
        pending.set(id, { resolve: resolve, reject: reject });
        post({ kind: "call", id: id, method: method, params: params || {} });
      });
    },
    say: function (text, duration) {
      return api.call("pet.say", { text: text, duration: duration });
    },
    setState: function (state) {
      return api.call("pet.setState", { state: state });
    },
    getPet: function () {
      return api.call("pet.get", {});
    },
    getConfig: function () {
      return api.call("config.get", {});
    },
    storage: {
      get: function (key) {
        return api.call("storage.get", { key: key });
      },
      set: function (key, value) {
        return api.call("storage.set", { key: key, value: value });
      },
      all: function () {
        return api.call("storage.all", {});
      }
    }
  };

  window.VinePlugin = api;

  window.addEventListener("message", function (event) {
    if (event.source !== parentWindow) return;
    var data = event.data;
    if (!data || data.vpp !== VERSION || typeof data.kind !== "string") return;

    if (data.kind === "init") {
      if (ready) return;
      info = data.payload || {};
      ready = true;
      var queued = readyHandlers;
      readyHandlers = [];
      queued.forEach(function (handler) {
        try {
          handler(info);
        } catch (error) {
          console.error("[plugin] onReady failed", error);
        }
      });
      emit("init", info);
      return;
    }

    if (data.kind === "result") {
      var entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.value);
      else entry.reject(new Error(data.error || "plugin call failed"));
      return;
    }

    if (data.kind === "event") emit(data.event, data.payload);
  });

  post({ kind: "ready" });
})();
`;

const BOOTSTRAP_MARKER = "data-vpp-bootstrap";

/** Injects the API bootstrap before any plugin script runs. */
export function injectBootstrap(html: string): string {
  if (html.includes(BOOTSTRAP_MARKER)) return html;

  const tag = `<script ${BOOTSTRAP_MARKER}>${BOOTSTRAP}</script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const index = head.index + head[0].length;
    return html.slice(0, index) + tag + html.slice(index);
  }

  const root = /<html[^>]*>/i.exec(html);
  if (root) {
    const index = root.index + root[0].length;
    return html.slice(0, index) + tag + html.slice(index);
  }

  return tag + html;
}
