import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceUrl = 'https://www.kdocs.cn/l/cpn7SRJAtLzt';
const sourceProfile = process.env.CHROME_USER_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const chromeExecutable = process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const swiftExecutable = process.env.SWIFT_EXECUTABLE || 'swift';
const storageStatePath = process.env.WPS_STORAGE_STATE_FILE || '';
const collectImages = process.env.WPS_SKIP_IMAGES !== '1';
const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'kdocs-sync-'));
const tempDeals = fs.mkdtempSync(path.join(os.tmpdir(), 'kdocs-deals-'));

function copyProfile() {
  fs.mkdirSync(path.join(tempProfile, 'Default'), { recursive: true });
  const localState = path.join(sourceProfile, 'Local State');
  if (!fs.existsSync(localState)) {
    throw new Error(`找不到 Chrome 配置文件：${localState}`);
  }
  fs.copyFileSync(localState, path.join(tempProfile, 'Local State'));
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
}

async function main() {
  let browser;
  let context;
  if (storageStatePath) {
    browser = await chromium.launch({
      executablePath: chromeExecutable,
      headless: true,
      args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      storageState: storageStatePath,
    });
  } else {
    copyProfile();
    context = await chromium.launchPersistentContext(tempProfile, {
      executablePath: chromeExecutable,
      headless: true,
      viewport: { width: 1440, height: 1000 },
      args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
    });
    browser = context;
  }

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.sheet-name', { timeout: 30_000 });
    await page.waitForTimeout(8_000);

    const result = await page.evaluate(async ({ collectImages }) => {
      const app = window.WPSOpenApi.Application;
      const workbook = await app.Workbooks();
      const rawNames = [...document.querySelectorAll('.sheet-name')]
        .map((element) => element.textContent)
        .filter((name) => name && name.trim());
      const sheets = [];

      // WPS Value2 只返回合并区域左上角的值，把备注列展开到每个型号所在行。
      const expandMergedColumn = async (sheet, values, columnIndex, columnLetter) => {
        if (!Array.isArray(values)) return;
        const areaPattern = new RegExp(`^\\$${columnLetter}\\$(\\d+):\\$${columnLetter}\\$(\\d+)$`);
        for (let row = 1; row <= values.length; row += 1) {
          const range = await sheet.Range(`${columnLetter}${row}`);
          if (!(await range.MergeCells)) continue;
          const address = await (await range.MergeArea).Address();
          const match = address.match(areaPattern);
          if (!match) continue;
          const startRow = Number(match[1]);
          const endRow = Number(match[2]);
          const value = values[startRow - 1]?.[columnIndex] ?? '';
          for (let mergedRow = startRow; mergedRow <= endRow; mergedRow += 1) {
            values[mergedRow - 1][columnIndex] = value;
          }
          row = endRow;
        }
      };

      for (const sourceName of rawNames) {
        let sheet = await workbook.Worksheets(sourceName);
        if (!sheet) sheet = await workbook.Worksheets(sourceName.trim());
        if (!sheet) continue;
        const usedRange = sheet.UsedRange;
        const valueText = await usedRange.Value2;
        let values;
        try {
          values = JSON.parse(valueText);
        } catch {
          values = valueText;
        }
        const displayName = sourceName.trim();
        if (displayName === '显卡综合10.30') {
          await expandMergedColumn(sheet, values, 3, 'D');
        }
        sheets.push({ sourceName, displayName, values });
      }

      const dealsSheet = await workbook.Worksheets('10月特价');
      await dealsSheet.Activate();
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const images = [];
      if (collectImages) {
      const imageRanges = [
        ['D3', 'D4'],
        ['D7', 'D8'],
        ['D11', 'D12'],
        ['D15', 'D16'],
        ['D19', 'D20'],
        ['D25', 'D26'],
      ];
      const fetchImageDataUrl = async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`image request failed: ${response.status}`);
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      };
      const captureCell = async (address) => {
        const row = Number(address.slice(1)) - 1;
        const col = address.charCodeAt(0) - 65;
        try {
          const shape = window.APP.getUilCmdTool().getCellEmbeddedPictureInfo(row, col);
          const info = shape ? await shape.getOriginImageInfo?.() : null;
          if (info?.url) {
            return {
              address,
              dataUrl: await fetchImageDataUrl(info.url),
              width: info.size?.width ?? null,
              height: info.size?.height ?? null,
              source: 'origin',
            };
          }
        } catch {
          // Fall back to the lower-resolution range image below.
        }
        const range = await dealsSheet.Range(address);
        return { address, dataUrl: await range.ToImageDataURL(), source: 'range' };
      };
      for (const addresses of imageRanges) {
        const cells = [];
        for (const address of addresses) {
          cells.push(await captureCell(address));
        }
        images.push({ cells });
      }
      }

      return {
        title: document.title,
        url: location.href,
        capturedAt: new Date().toISOString(),
        sheets,
        images,
      };
    }, { collectImages });

    const snapshot = {
      title: result.title,
      url: result.url,
      capturedAt: result.capturedAt,
      sheets: result.sheets,
    };
    fs.writeFileSync(path.join(root, 'data/source-snapshot.json'), JSON.stringify(snapshot, null, 2));

    const dealsDir = path.join(root, 'public/deals');
    const manualDealsDir = path.join(root, 'data/manual-deals');
    fs.mkdirSync(dealsDir, { recursive: true });
    const packageImages = [];
    if (collectImages) result.images.forEach((dealImage, index) => {
      const manualInputs = fs.existsSync(manualDealsDir)
        ? fs.readdirSync(manualDealsDir)
          .filter((name) => name.startsWith(`package-${index + 1}-`) && name.endsWith('.png'))
          .sort()
          .map((name) => path.join(manualDealsDir, name))
        : [];
      const inputPaths = dealImage.cells.flatMap((cell, cellIndex) => {
        if (manualInputs[cellIndex]) return [manualInputs[cellIndex]];
        const base64 = cell.dataUrl.split(',')[1];
        if (!base64) return [];
        const inputPath = path.join(tempDeals, `deal-${index + 1}-${cell.address}.png`);
        fs.writeFileSync(inputPath, Buffer.from(base64, 'base64'));
        return [inputPath];
      });
      const packagePath = path.join(dealsDir, `package-${index + 1}.png`);
      execFileSync(swiftExecutable, [
        path.join(root, 'scripts/create-package-image.swift'),
        packagePath,
        ...inputPaths,
      ], { stdio: 'inherit' });
      packageImages.push(packagePath);
    });

    console.log(`已同步 ${result.sheets.length} 个工作表${collectImages ? `、${packageImages.length} 张透明背景活动图` : ''}。`);
    console.log(`来源：${result.url}`);
    if (process.env.WPS_STORAGE_STATE_OUTPUT) {
      const outputPath = process.env.WPS_STORAGE_STATE_OUTPUT;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await context.storageState({ path: outputPath });
      fs.chmodSync(outputPath, 0o600);
    }
  } finally {
    await browser.close();
    fs.rmSync(tempProfile, { recursive: true, force: true });
    fs.rmSync(tempDeals, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
