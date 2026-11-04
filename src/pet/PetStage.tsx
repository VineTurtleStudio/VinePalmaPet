import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { loadSelectedPetPack } from "../packs/loader";
import type { LoadedPetPack } from "../packs/types";
import { PluginHost } from "../plugins/PluginHost";
import { PetEngine } from "./engine";
import { Bubble, type BubbleMessage } from "./Bubble";
import { PetMenu } from "./PetMenu";
import {
  applyScale,
  createPassthrough,
  isTauri,
  logicalWindowSize,
  placeByDefault,
  snapToScreen,
} from "../platform/desktop";
import type { PetConfig } from "../store/config";

const PAT_LINES = [
  "嘿嘿，好舒服～",
  "再摸一下嘛！",
  "今天也要加油哦！",
  "叶子都被你摸亮了 ✨",
  "要不要休息一下？",
];

const TALK_LINES = [
  "我在这里陪着你呢。",
  "写代码累了就看看我。",
  "记得喝水呀！",
  "这个 bug 一定能修好的！",
];

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? "";
}

interface PetStageProps {
  config: PetConfig;
  patch: (partial: Partial<PetConfig>) => void;
}

export function PetStage({ config, patch }: PetStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PetEngine | null>(null);
  const passthroughRef = useRef<ReturnType<typeof createPassthrough> | null>(null);
  const configRef = useRef(config);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const bubbleTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const previousScale = useRef(config.scale);
  const mounted = useRef(false);

  const [pack, setPack] = useState<LoadedPetPack | null>(null);
  const [packRevision, setPackRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bubble, setBubble] = useState<BubbleMessage | null>(null);
  const [stateName, setStateName] = useState("idle");

  configRef.current = config;

  // --- load pet pack -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let loadedPack: LoadedPetPack | null = null;
    setReady(false);
    setPack(null);
    setError(null);

    loadSelectedPetPack(config.petId)
      .then((loaded) => {
        loadedPack = loaded;
        if (cancelled) {
          loaded.dispose?.();
          return;
        }
        setPack(loaded);
        // The selected pack may have been removed: fall back to the built-in pet.
        if (loaded.meta.id !== config.petId) patch({ petId: loaded.meta.id });
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      loadedPack?.dispose?.();
    };
  }, [config.petId, packRevision, patch]);

  // Imported packs can be reinstalled or removed while the pet is running.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen("pet://pets-changed", () => {
      setPackRevision((value) => value + 1);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // --- create the engine ---------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pack || !canvas) return;

    const engine = new PetEngine(canvas, pack, setStateName);
    engineRef.current = engine;
    engine.start();
    setReady(true);

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      engine.destroy();
      engineRef.current = null;
      setReady(false);
    };
  }, [pack]);

  // --- restore window geometry / tray wiring -------------------------------
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const win = getCurrentWindow();

    (async () => {
      try {
        const cfg = configRef.current;
        await win.setSize(new LogicalSize(logicalWindowSize(cfg.scale), logicalWindowSize(cfg.scale)));
        if (cfg.position) {
          await win.setPosition(new PhysicalPosition(cfg.position.x, cfg.position.y));
        } else {
          await placeByDefault(cfg.scale);
        }
        await win.setAlwaysOnTop(cfg.alwaysOnTop);
        await snapToScreen();
        if (cancelled) return;
        const position = await win.outerPosition();
        patch({ position: { x: position.x, y: position.y } });
      } catch (err) {
        console.error("window init failed", err);
      }
    })();

    const unlistenMoved = win.onMoved(() => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void (async () => {
          try {
            await snapToScreen();
            const position = await win.outerPosition();
            patch({ position: { x: position.x, y: position.y } });
          } catch (err) {
            console.error("save position failed", err);
          }
        })();
      }, 420);
    });
    void unlistenMoved.then((fn) => unlisteners.push(fn));

    const unlistenReset = listen("pet://reset-position", () => {
      void (async () => {
        await placeByDefault(configRef.current.scale);
        await snapToScreen();
        const position = await win.outerPosition();
        patch({ position: { x: position.x, y: position.y } });
      })();
    });
    void unlistenReset.then((fn) => unlisteners.push(fn));

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [ready, patch]);

  // --- click-through -------------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    const passthrough = createPassthrough({
      isOverPet: (x, y) => engineRef.current?.hitTest(x, y) ?? false,
    });
    passthroughRef.current = passthrough;
    const onMove = (event: MouseEvent) => passthrough.handleMouseMove(event);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      passthrough.dispose();
      passthroughRef.current = null;
    };
  }, [ready]);

  useEffect(() => {
    passthroughRef.current?.setBlocked(menuOpen);
  }, [menuOpen]);

  // --- react to config changes --------------------------------------------
  useEffect(() => {
    if (!ready || !isTauri()) return;
    const next = config.scale;
    const previous = previousScale.current;
    previousScale.current = next;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void applyScale(next, previous).catch((err) => console.error("applyScale failed", err));
  }, [config.scale, ready]);

  useEffect(() => {
    if (!ready || !isTauri()) return;
    void getCurrentWindow()
      .setAlwaysOnTop(config.alwaysOnTop)
      .catch((err) => console.error("setAlwaysOnTop failed", err));
  }, [config.alwaysOnTop, ready]);

  // --- speech --------------------------------------------------------------
  const playState = useCallback((state: string) => {
    const engine = engineRef.current;
    if (!engine) return false;
    // Plugins may end focus mode, but must not force their way past sleep or petting.
    const force = state === "idle" && engine.currentState === "focus";
    return engine.play(state, force);
  }, []);

  const say = useCallback((text: string, duration = 3800) => {
    if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current);

    if (!configRef.current.bubbleEnabled) {
      setBubble(null);
      engineRef.current?.playTalk();
      bubbleTimer.current = window.setTimeout(() => {
        engineRef.current?.endTalk();
        bubbleTimer.current = null;
      }, 1200);
      return;
    }

    setBubble({ id: Date.now() + Math.random(), text });
    engineRef.current?.playTalk();
    bubbleTimer.current = window.setTimeout(() => {
      setBubble(null);
      engineRef.current?.endTalk();
      bubbleTimer.current = null;
    }, duration);
  }, []);

  useEffect(() => {
    if (config.bubbleEnabled) return;
    if (bubbleTimer.current !== null) {
      window.clearTimeout(bubbleTimer.current);
      bubbleTimer.current = null;
    }
    setBubble(null);
    engineRef.current?.endTalk();
  }, [config.bubbleEnabled]);

  useEffect(
    () => () => {
      if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current);
    },
    [],
  );

  // --- interaction ---------------------------------------------------------
  const pat = useCallback(() => {
    engineRef.current?.play("pat");
    say(pick(PAT_LINES), 2600);
  }, [say]);

  const handlePointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    if (!engineRef.current?.hitTest(event.clientX, event.clientY)) return;
    dragRef.current = { x: event.screenX, y: event.screenY, moved: false };
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.moved) return;
    if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) > 4) {
      drag.moved = true;
      if (isTauri()) {
        void getCurrentWindow().startDragging().catch((err) => console.error("startDragging failed", err));
      }
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) pat();
  }, [pat]);

  const toggleFocus = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.currentState === "focus") {
      engine.play("idle", true);
      say("专注结束，休息一下吧！");
    } else {
      engine.play("focus");
      say("进入专注模式，我不打扰你。", 5000);
    }
    setMenuOpen(false);
  }, [say]);

  const sleep = useCallback(() => {
    engineRef.current?.play("sleep");
    setBubble(null);
    setMenuOpen(false);
  }, []);

  const toggleAlwaysOnTop = useCallback(() => {
    patch({ alwaysOnTop: !configRef.current.alwaysOnTop });
  }, [patch]);

  const resetPosition = useCallback(() => {
    void (async () => {
      await placeByDefault(configRef.current.scale);
      const position = await getCurrentWindow().outerPosition();
      patch({ position: { x: position.x, y: position.y } });
    })();
    setMenuOpen(false);
  }, [patch]);

  const changeScale = useCallback(
    (delta: number) => {
      const current = configRef.current.scale;
      const next = Math.min(1.6, Math.max(0.6, Math.round((current + delta) * 100) / 100));
      if (next !== current) patch({ scale: next });
    },
    [patch],
  );

  const quit = useCallback(() => {
    if (isTauri()) void invoke("quit_app");
  }, []);

  // Native menu actions are delivered from Rust as simple action ids.
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<string>("pet://action", ({ payload }) => {
      switch (payload) {
        case "pat":
          pat();
          break;
        case "focus":
          toggleFocus();
          break;
        case "sleep":
          sleep();
          break;
        case "talk":
          say(pick(TALK_LINES));
          break;
        case "scale-down":
          changeScale(-0.1);
          break;
        case "scale-up":
          changeScale(0.1);
          break;
        case "toggle-top":
          toggleAlwaysOnTop();
          break;
        case "reset":
          resetPosition();
          break;
        case "quit":
          quit();
          break;
        default:
          break;
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ready, pat, toggleFocus, sleep, say, changeScale, toggleAlwaysOnTop, resetPosition, quit]);

  const scaleLabel = useMemo(() => `${Math.round(config.scale * 100)}%`, [config.scale]);

  return (
    <div
      className="stage"
      data-pet-id={pack?.meta.id ?? config.petId}
      style={{ ["--s" as string]: config.scale }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (isTauri()) {
          void invoke("show_pet_menu").catch((err) => console.error("show_pet_menu failed", err));
        } else {
          setMenuOpen((open) => !open);
        }
      }}
      onPointerDown={(event) => {
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        handlePointerDown(event);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <canvas ref={canvasRef} className="pet-canvas" />
      <PluginHost
        config={config}
        say={say}
        playState={playState}
        stateName={stateName}
        petId={pack?.meta.id ?? config.petId}
      />
      {bubble && <Bubble message={bubble} />}
      {menuOpen && (
        <PetMenu
          stateName={stateName}
          scaleLabel={scaleLabel}
          alwaysOnTop={config.alwaysOnTop}
          onPat={pat}
          onFocus={toggleFocus}
          onSleep={sleep}
          onTalk={() => {
            say(pick(TALK_LINES));
            setMenuOpen(false);
          }}
          onScaleDown={() => changeScale(-0.1)}
          onScaleUp={() => changeScale(0.1)}
          onToggleTop={toggleAlwaysOnTop}
          onReset={resetPosition}
          onQuit={quit}
        />
      )}
      {error && <div className="error-card">{error}</div>}
    </div>
  );
}
