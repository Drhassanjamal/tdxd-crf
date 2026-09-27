import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    // Transpile JavaScript for older iPhones too (Vite 8's default needs iOS 16.4+, which leaves a blank page on older iOS)
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14', 'ios14'],
    // Keep CSS on Vite's default target: lowering it would rewrite the logical (RTL-aware) properties
    cssTarget: ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'],
  },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
});
