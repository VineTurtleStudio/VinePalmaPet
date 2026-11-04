import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { PetStage } from "../pet/PetStage";
import { isTauri } from "../platform/desktop";
import { useConfigStore } from "../store/config";

export default function App() {
  const config = useConfigStore((state) => state.config);
  const loaded = useConfigStore((state) => state.loaded);
  const load = useConfigStore((state) => state.load);
  const patch = useConfigStore((state) => state.patch);

  useEffect(() => {
    void load();
  }, [load]);

  // The settings window writes config to disk and pings us; re-read it here.
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen("pet://config-changed", () => {
      void load();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loaded, load]);

  if (!loaded) return null;

  return <PetStage config={config} patch={patch} />;
}
