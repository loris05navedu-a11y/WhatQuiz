// Génère les icônes PNG de la PWA à partir de client/public/icons/icon.svg.
// Nécessite Playwright (outil de développement facultatif) : `npx playwright` ou installation globale.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('client/public/icons/icon.svg', 'utf8');
const targets = [
  { file: 'icon-192.png', size: 192, padding: 0.06, background: 'transparent' },
  { file: 'icon-512.png', size: 512, padding: 0.06, background: 'transparent' },
  { file: 'maskable-512.png', size: 512, padding: 0.2, background: '#1c1446' },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.14, background: '#1c1446' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding, background } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inset = Math.round(size * padding);
  await page.setContent(
    `<html><body style="margin:0;background:${background}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">` +
      `<div style="width:${size - inset * 2}px;height:${size - inset * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`,
  );
  await page.screenshot({ path: `client/public/icons/${file}`, omitBackground: background === 'transparent' });
  console.log(`✓ ${file}`);
}
await browser.close();
