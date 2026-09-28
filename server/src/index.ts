import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from './app';
import { loadConfig } from './config';
import { lanAddresses } from './routes/meta';

async function main(): Promise<void> {
  const config = loadConfig();
  const whatquiz = createApp(config);
  const { app, httpServer } = whatquiz;

  if (config.isProduction) {
    const clientDir = path.resolve('dist/client');
    if (!existsSync(path.join(clientDir, 'index.html'))) {
      throw new Error('Frontend introuvable : lancez « npm run build » avant « npm start ».');
    }
    app.use('/assets', express.static(path.join(clientDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDir, 'index.html'), { maxAge: 0 }));
  } else {
    // En développement, Vite est branché directement dans Express : un seul port, un seul processus.
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.resolve('vite.config.ts'),
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(config.port, config.host, () => {
    const mode = config.isProduction ? 'production' : 'développement';
    console.log(`\n  WhatQuiz démarré en mode ${mode}\n`);
    console.log(`  ➜ Sur cet appareil :   http://localhost:${config.port}`);
    for (const ip of lanAddresses()) console.log(`  ➜ Sur le réseau local : http://${ip}:${config.port}`);
    console.log('');
  });

  const shutdown = () => {
    console.log('\n  Arrêt de WhatQuiz…');
    httpServer.close();
    void whatquiz.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
