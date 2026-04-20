import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const now = Date.now()

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_URL || "/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash]-" + now + ".js",
        chunkFileNames: "assets/[name]-[hash]-" + now + ".js",
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith(".css")) {
            return "assets/[name]-[hash]-" + now + ".css"
          }
          return "assets/[name]-[hash]-" + now + "[extname]"
        },
      },
    },
  },
})
