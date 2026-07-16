import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    hmr: {
      overlay: false,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split CodeMirror into its own chunk
          codemirror: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/autocomplete',
            '@codemirror/lint',
            '@codemirror/search',
          ],
          // React vendor chunk
          react: ['react', 'react-dom', 'react-dom/client'],
          // Terminal emulator
          xterm: ['@xterm/xterm', '@xterm/addon-fit'],
          // State management
          zustand: ['zustand'],
        },
      },
    },
    // Increase warning limit for production build
    chunkSizeWarningLimit: 600,
  },
});
