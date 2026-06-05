import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(120_000);
const consoleLines = [];
page.on('console', msg => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

const navStart = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#benchmark');
const shellReady = Date.now();
await page.click('#benchmark');
await page.waitForFunction(() => {
  const text = document.querySelector('#output-log')?.textContent || '';
  return text.includes('Batch finished') || text.includes('Batch worker error') || text.includes('Batch worker terminated') || text.includes('Could not start Singular/WASM');
});
const done = Date.now();
const logText = await page.locator('#output-log').textContent();

console.log(JSON.stringify({
  url,
  pageShellMs: shellReady - navStart,
  benchmarkWallMs: done - shellReady,
  totalMs: done - navStart
}, null, 2));
console.log('\n--- output log ---');
console.log(logText || '');
if (consoleLines.length) {
  console.log('\n--- browser console ---');
  console.log(consoleLines.join('\n'));
}
await browser.close();
