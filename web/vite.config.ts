import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API = process.env.LANATLAS_API ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: false } } },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], data: ['@tanstack/react-query', 'axios'] } } },
  },
});