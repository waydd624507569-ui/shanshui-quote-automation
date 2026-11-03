import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(root, 'data/source-snapshot.json');
const catalogPath = path.join(root, 'src/data/catalog.json');
const imageMapPath = path.join(root, 'data/product-images.json');
const outputDir = path.join(root, 'public/products');
const sourceUrl = 'https://www.kdocs.cn/l/cpn7SRJAtLzt';
const storageStatePath = process.env.WPS_STORAGE_STATE_FILE
  || path.join(os.homedir(), '.config/product-quote/wps-storage-state.json');
const chromeExecutable = process.env.CHROME_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const itemsByCell = new Map(catalog.items.map((item) => [`${item.sheet}|${item.row}|${item.col}`, item]));

const RULES = {
  '显卡综合10.30': { exact: true },
  '一体机': { itemColumn: 'A', imageColumns: ['E', 'G'] },
  '富勒外设': { itemColumn: 'A', imageColumns: ['H', 'G'] },
  '鑫谷机箱': { itemColumnOffset: 1 },
  '鑫谷电源': { itemColumnOffset: 1 },
  '鑫谷散热器': { itemColumnOffset: 1 },
  '锐禧机电散': { itemColumnOffset: 1 },
  '撒哈拉': { itemColumnOffset: 1 },
  '超频三': { itemColumnOffset: -1 },
};

function columnNumber(name) {
  return [...name].reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0);
}

function columnName(number) {
  let result = '';
  while (number > 0) {
    number -= 1;
    result = String.fromCharCode(65 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

function buildTargets() {
  const targets = new Map();
  for (const sheet of snapshot.sheets) {
    const rule = RULES[sheet.displayName];
    if (!rule) continue;
    for (let rowIndex = 0; rowIndex < sheet.values.length; rowIndex += 1) {
      const row = sheet.values[rowIndex];
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        if (!/DISPIMG/i.test(String(row[columnIndex] ?? ''))) continue;
        const imageColumn = columnName(columnIndex + 1);
        if (rule.imageColumns && !rule.imageColumns.includes(imageColumn)) continue;
        const rowNumber = rowIndex + 1;
        const itemColumn = rule.exact
          ? imageColumn
          : rule.itemColumn || columnName(columnIndex + 1 + rule.itemColumnOffset);
        const item = itemsByCell.get(`${sheet.displayName}|${rowNumber}|${itemColumn}`);
        if (!item) continue;
        const itemKey = `${sheet.displayName}!${item.sourceAddress}`;
        const priority = rule.imageColumns ? rule.imageColumns.indexOf(imageColumn) : 0;
        const previous = targets.get(itemKey);
        if (previous && previous.priority <= priority) continue;
        targets.set(itemKey, {
          key: itemKey,
          sheet: sheet.displayName,
          sourceSheetName: sheet.sourceName,
          itemName: item.name,
          imageCell: `${imageColumn}${rowNumber}`,
          row: rowNumber,
          columnIndex,
          fallbackColumnIndex: columnNumber(itemColumn) - 1,
          priority,
        });
      }
    }
  }
  return [...targets.values()];
}

function extensionFor(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

async function main() {
  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`找不到 WPS 登录态：${storageStatePath}`);
  }
  const targets = buildTargets();
  if (!targets.length) throw new Error('没有找到可关联的商品图片');
  if (process.env.PRODUCT_IMAGE_DRY_RUN === '1') {
    const counts = {};
    for (const target of targets) counts[target.sheet] = (counts[target.sheet] || 0) + 1;
    console.log(JSON.stringify({ total: targets.length, counts }, null, 2));
    return;
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: storageStatePath,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.sheet-name', { timeout: 30_000 });
    await page.waitForTimeout(4_000);

    const imageMap = {};
    const savedFiles = new Map();
    const sheetNames = [...new Set(targets.map((target) => target.sheet))];

    for (const sheetName of sheetNames) {
      const sheetTargets = targets.filter((target) => target.sheet === sheetName);
      const sourceSheetName = sheetTargets[0].sourceSheetName;
      await page.evaluate(async (name) => {
        const workbook = await window.WPSOpenApi.Application.Workbooks();
        const sheet = await workbook.Worksheets(name);
        if (!sheet) throw new Error(`找不到工作表：${name}`);
        await sheet.Activate();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }, sourceSheetName);

      for (let offset = 0; offset < sheetTargets.length; offset += 25) {
        const chunk = sheetTargets.slice(offset, offset + 25);
        const results = await page.evaluate(async (requests) => {
          const output = [];
          for (const request of requests) {
            try {
              let info = null;
              const columnIndexes = [...new Set([request.columnIndex, request.fallbackColumnIndex])];
              for (const columnIndex of columnIndexes) {
                const shape = window.APP.getUilCmdTool()
                  .getCellEmbeddedPictureInfo(request.row - 1, columnIndex);
                info = shape ? await shape.getOriginImageInfo?.() : null;
                if (info?.url) break;
              }
              if (!info?.url) {
                output.push({ key: request.key, error: '未读取到原图' });
                continue;
              }
              const response = await fetch(info.url);
              if (!response.ok) {
                output.push({ key: request.key, error: `图片请求失败：${response.status}` });
                continue;
              }
              const blob = await response.blob();
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
              output.push({ key: request.key, dataUrl, size: info.size });
            } catch (error) {
              output.push({ key: request.key, error: String(error?.message || error) });
            }
          }
          return output;
        }, chunk);

        for (const result of results) {
          if (result.error) throw new Error(`${result.key}：${result.error}`);
          const match = result.dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
          if (!match) throw new Error(`${result.key}：图片数据格式异常`);
          const bytes = Buffer.from(match[2], 'base64');
          const digest = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
          const extension = extensionFor(match[1]);
          const fileName = `product-${digest}.${extension}`;
          if (!savedFiles.has(fileName)) {
            fs.writeFileSync(path.join(outputDir, fileName), bytes);
            savedFiles.set(fileName, bytes.length);
          }
          imageMap[result.key] = `/products/${fileName}`;
        }
        console.log(`${sheetName}: ${Math.min(offset + chunk.length, sheetTargets.length)}/${sheetTargets.length}`);
      }
    }

    const sortedMap = Object.fromEntries(Object.entries(imageMap).sort(([left], [right]) => left.localeCompare(right, 'zh-CN')));
    fs.writeFileSync(imageMapPath, `${JSON.stringify(sortedMap, null, 2)}\n`);
    console.log(JSON.stringify({
      itemsWithImages: Object.keys(sortedMap).length,
      files: savedFiles.size,
      bytes: [...savedFiles.values()].reduce((total, size) => total + size, 0),
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
