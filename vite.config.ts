import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri is compiled by cargo; watching it would restart the dev server for nothing.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome110",
    sourcemap: false,
    rollupOptions: {
      input: {
        pet: fileURLToPath(new URL("./index.html", import.meta.url)),
        settings: fileURLToPath(new URL("./settings.html", import.meta.url)),
      },
    },
  },
});
