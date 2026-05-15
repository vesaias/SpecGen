import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6100,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:6101",
      "/static": "http://localhost:6101",
    },
  },
});
