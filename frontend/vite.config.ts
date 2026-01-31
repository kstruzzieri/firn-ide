import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
          // Split CodeMirror language support
          'codemirror-languages': [
            '@codemirror/lang-javascript',
            '@codemirror/lang-python',
            '@codemirror/lang-go',
            '@codemirror/lang-css',
            '@codemirror/lang-html',
            '@codemirror/lang-json',
            '@codemirror/lang-markdown',
          ],
          // React vendor chunk
          react: ['react', 'react-dom'],
          // State management
          zustand: ['zustand'],
        },
      },
    },
    // Increase warning limit for production build
    chunkSizeWarningLimit: 600,
  },
});
