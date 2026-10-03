import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Version affichée dans la fenêtre du nuage : commit publié + date de compilation.
function commit(): string {
  try {
    return (process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString()).trim().slice(0, 7);
  } catch {
    return 'dev';
  }
}
const BUILD_VERSION = `${commit()} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// JSX compilé directement par esbuild (intégré à Vite) : pas de plugin ni de Babel à installer.
// BASE_PATH : sous-dossier de publication (ex. /WhatQuiz/ sur GitHub Pages). Par défaut, le site est à la racine.
export default defineConfig({
  root: 'client',
  define: { __BUILD_VERSION__: JSON.stringify(BUILD_VERSION) },
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
