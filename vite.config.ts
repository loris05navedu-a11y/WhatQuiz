import { defineConfig } from 'vite';

// JSX compilé directement par esbuild (intégré à Vite) : pas de plugin ni de Babel à installer.
// BASE_PATH : sous-dossier de publication (ex. /WhatQuiz/ sur GitHub Pages). Par défaut, le site est à la racine.
export default defineConfig({
  root: 'client',
  base: process.env.BASE_PATH || '/',
  publicDir: 'public',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      // Directive « use client » de React Router : sans objet ici (pas de rendu serveur).
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
});
