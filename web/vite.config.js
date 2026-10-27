import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const page = (p) => fileURLToPath(new URL(p, import.meta.url));

// Three pages: the website (/), the web app (/app/) and the privacy policy (/privacy/).
// base './' makes the build work in any folder of any domain.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: page('./index.html'),
        app: page('./app/index.html'),
        privacy: page('./privacy/index.html'),
      },
    },
  },
});
