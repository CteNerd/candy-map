/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: env.VITE_API_BASE_URL ? {
        "/api": {
          target: env.VITE_API_BASE_URL,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ""),
        },
      } : undefined,
    },
    test: {
      environment: "jsdom",
      globals: false,
      css: false,
      setupFiles: ["./test/setup.ts"],
    },
  };
});
