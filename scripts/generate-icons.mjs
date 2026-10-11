// Renders the PWA icons from SVG with Playwright's Chromium. Run: node scripts/generate-icons.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const eye = (stroke, fill, scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M72 256c42-74 104-114 184-114s142 40 184 114c-42 74-104 114-184 114S114 330 72 256Z" fill="none" stroke="${stroke}" stroke-width="30" stroke-linejoin="round"/>
    <circle cx="256" cy="256" r="58" fill="${fill}"/>
  </g>`;

const icons = {
  'icon-512.png': [512, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#141923"/><rect x="1" y="1" width="510" height="510" rx="111" fill="none" stroke="#2a3243" stroke-width="2"/>${eye('#a9a3ff', '#a9a3ff')}</svg>`],
  'icon-192.png': [192, null],
  'apple-touch-icon.png': [180, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#141923"/>${eye('#a9a3ff', '#a9a3ff', 0.86)}</svg>`],
  'maskable-512.png': [512, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#141923"/>${eye('#a9a3ff', '#a9a3ff', 0.7)}</svg>`],
  'badge-96.png': [96, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${eye('#ffffff', '#ffffff', 1.05)}</svg>`],
};
icons['icon-192.png'][1] = icons['icon-512.png'][1];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, [size, svg]] of Object.entries(icons)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(`apps/web/public/icons/${name}`, await page.screenshot({ omitBackground: true }));
  console.log('wrote', name);
}
await browser.close();
