import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CON: ${m.text()}`); });

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

const state = await page.evaluate(() => ({
  hasL: typeof L !== 'undefined',
  mapH: document.getElementById('map')?.offsetHeight,
  panelH: document.querySelector('.map-panel')?.offsetHeight,
  tiles: document.querySelectorAll('.leaflet-tile').length,
  wardPaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
  leafletReady: document.body.dataset.leafletReady,
  bootStatus: document.getElementById('boot-status')?.textContent,
  provenance: document.getElementById('provenance')?.textContent || '',
  hero: document.getElementById('hero-net')?.textContent,
  captured: document.getElementById('hero-captured')?.textContent,
  rows: document.querySelectorAll('#summary-body tr').length,
}));

console.log(JSON.stringify(state, null, 2));
console.log('ERRORS:', errors);
await browser.close();
