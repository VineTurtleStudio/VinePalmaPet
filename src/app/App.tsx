import { useEffect } from "react";

import { PetStage } from "../pet/PetStage";
import { useConfigStore } from "../store/config";

export default function App() {
  const config = useConfigStore((state) => state.config);
  const loaded = useConfigStore((state) => state.loaded);
  const load = useConfigStore((state) => state.load);
  const patch = useConfigStore((state) => state.patch);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;

  return <PetStage config={config} patch={patch} />;
}
