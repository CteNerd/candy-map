/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  test: {
    environment: "jsdom",
    globals: false,
    css: false,
    setupFiles: ["./test/setup.ts"],
  },
});
