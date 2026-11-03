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

const RENDER_RULES = {
  '一体机': { itemColumn: 'A', columnFrom: 3, columnTo: 6 },
  '超频三': { itemColumn: 'B', columnFrom: 2, columnTo: 2 },
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
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 3,
    storageState: storageStatePath,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.sheet-name', { timeout: 30_000 });
    await page.waitForTimeout(4_000);

    const closeButton = page.locator('.wps-login-panel__header button.is-icon').first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(300);
    }

    const imageMap = {};
    const savedFiles = new Map();
    const saveImage = (key, mime, bytes) => {
      const digest = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const extension = extensionFor(mime);
      const fileName = `product-${digest}.${extension}`;
      if (!savedFiles.has(fileName)) {
        fs.writeFileSync(path.join(outputDir, fileName), bytes);
        savedFiles.set(fileName, bytes.length);
      }
      imageMap[key] = `/products/${fileName}`;
    };
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

      const renderedKeys = new Set();
      const renderRule = RENDER_RULES[sheetName];
      if (renderRule) {
        const renderItems = catalog.items.filter(
          (item) => item.sheet === sheetName && item.col === renderRule.itemColumn,
        );
        for (const item of renderItems) {
          await page.evaluate(async ({ sheetName: name, row, column }) => {
            const workbook = await window.WPSOpenApi.Application.Workbooks();
            const sheet = await workbook.Worksheets(name);
            const scrollBar = window.APP.getActiveView().getScrollBar();
            scrollBar.scrollCellToVisible(row, column);
          }, { sheetName: sourceSheetName, row: item.row, column: renderRule.columnFrom + 1 });
          await page.waitForTimeout(700);

          const capture = await page.evaluate(async ({ row, columnFrom, columnTo }) => {
            const workbook = await window.WPSOpenApi.Application.Workbooks();
            const worksheet = window.APP.getActiveSheetView()._worksheet;
            await worksheet.getName();
            const shapes = await worksheet.getShapes();
            const shapeIds = [];
            for (const shape of shapes) {
              const anchor = shape.shapeData?.private?.anchor?.region?.private;
              if (!anchor || anchor.rowFrom + 1 !== row) continue;
              if (anchor.colFrom > columnTo || anchor.colTo < columnFrom) continue;
              await shape.loadImage?.();
              const objectId = shape.getObjID?.();
              if (objectId) shapeIds.push(`shape_${objectId}`);
            }
            if (!shapeIds.length) return null;

            let rects = [];
            for (let attempt = 0; attempt < 6; attempt += 1) {
              rects = shapeIds
                .map((id) => document.getElementById(id)?.getBoundingClientRect())
                .filter((rect) => rect && rect.width > 0 && rect.height > 0);
              if (rects.length >= shapeIds.length) break;
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            if (!rects.length) return null;

            const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - 10);
            const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - 10);
            const right = Math.min(window.innerWidth, Math.max(...rects.map((rect) => rect.right)) + 10);
            const bottom = Math.min(window.innerHeight, Math.max(...rects.map((rect) => rect.bottom)) + 10);
            if (right <= left || bottom <= top) return null;
            return {
              x: left + window.scrollX,
              y: top + window.scrollY,
              width: right - left,
              height: bottom - top,
              shapes: shapeIds.length,
              images: rects.length,
            };
          }, { row: item.row, columnFrom: renderRule.columnFrom, columnTo: renderRule.columnTo });

          if (!capture) continue;
          const bytes = await page.screenshot({
            clip: { x: capture.x, y: capture.y, width: capture.width, height: capture.height },
            scale: 'device',
          });
          const key = `${sheetName}!${item.sourceAddress}`;
          saveImage(key, 'image/png', bytes);
          renderedKeys.add(key);
          console.log(`合成图 ${sheetName} 第${item.row}行：${capture.images}/${capture.shapes}`);
        }
      }

      const remainingTargets = sheetTargets.filter((target) => !renderedKeys.has(target.key));

      for (let offset = 0; offset < remainingTargets.length; offset += 25) {
        const chunk = remainingTargets.slice(offset, offset + 25);
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
          saveImage(result.key, match[1], bytes);
        }
        console.log(`${sheetName}: ${Math.min(offset + chunk.length, remainingTargets.length)}/${remainingTargets.length}`);
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
