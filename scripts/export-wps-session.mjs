import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sourceProfile = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-state-'));
const output = path.join(os.homedir(), '.config/product-quote/wps-storage-state.json');

fs.mkdirSync(path.join(tempProfile, 'Default'), { recursive: true });
fs.copyFileSync(path.join(sourceProfile, 'Local State'), path.join(tempProfile, 'Local State'));
execFileSync('rsync', [
  '-a',
  '--exclude', 'Cache',
  '--exclude', 'Code Cache',
  '--exclude', 'GPUCache',
  '--exclude', 'DawnGraphiteCache',
  '--exclude', 'DawnWebGPUCache',
  '--exclude', 'GrShaderCache',
  '--exclude', 'ShaderCache',
  '--exclude', 'Application Cache',
  '--exclude', 'CacheStorage',
  '--exclude', 'Singleton*',
  `${path.join(sourceProfile, 'Default')}/`,
  path.join(tempProfile, 'Default') + '/',
], { stdio: 'inherit' });

const browser = await chromium.launchPersistentContext(tempProfile, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
});

try {
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://www.kdocs.cn/l/cpn7SRJAtLzt', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.sheet-name', { timeout: 30_000 });
  await page.waitForTimeout(3_000);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await browser.storageState({ path: output });
  fs.chmodSync(output, 0o600);
  console.log(`已保存 WPS 登录态：${output}`);
} finally {
  await browser.close();
  fs.rmSync(tempProfile, { recursive: true, force: true });
}
