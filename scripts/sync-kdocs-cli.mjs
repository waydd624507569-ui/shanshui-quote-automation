// sync-kdocs-cli.mjs — 用金山文档官方 CLI (kdocs-cli) 读原表，替代浏览器抓取。
// 输出 data/source-snapshot.json，格式与旧 sync-kdocs.mjs 完全一致，供 build-catalog.mjs 使用。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const url = 'https://www.kdocs.cn/l/cpn7SRJAtLzt';
const snapshotPath = path.join(root, 'data/source-snapshot.json');
const READ_COL_TO = 30; // 读列时留足余量，实际列数按数据动态裁剪

function kdocs(args) {
  const token = process.env.KDOCS_TOKEN;
  const tokenArg = token ? `--token "${token}" ` : '';
  const out = execSync(`kdocs-cli ${tokenArg}${args}`, {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  return JSON.parse(out);
}

// 把 rangeData（单元格对象列表）转成二维数组，合并单元格只放左上角，与旧 Value2 行为一致。
function rangeToValues(cells, rowTo) {
  let maxCol = -1;
  for (const c of cells) maxCol = Math.max(maxCol, c.colFrom);
  const colCount = maxCol + 1;
  const values = Array.from({ length: rowTo + 1 }, () => Array(colCount).fill(''));
  for (const c of cells) {
    const v = c.originalCellValue ?? '';
    values[c.rowFrom][c.colFrom] = v;
  }
  return values;
}

// 显卡综合10.30 的备注列（第 4 列）若纵向合并，把备注展开到合并区域内的每一行。
function expandMergedColumn(cells, values, columnIndex) {
  for (const c of cells) {
    if (c.colFrom !== columnIndex) continue;
    if (!c.isMerge) continue;
    if (c.rowTo <= c.rowFrom) continue;
    const v = c.originalCellValue ?? '';
    for (let r = c.rowFrom; r <= c.rowTo; r += 1) {
      if (r < values.length) values[r][columnIndex] = v;
    }
  }
}

function main() {
  const sheetsInfo = kdocs(`sheet get-sheets-info url="${url}"`).data.detail.sheetsInfo;

  const sheets = [];
  for (const info of sheetsInfo) {
    const sheetId = info.sheetId;
    const rowTo = info.rowTo;
    const range = { rowFrom: 0, rowTo, colFrom: 0, colTo: READ_COL_TO };
    const payload = JSON.stringify({ url, worksheet_id: sheetId, range });
    const cells = kdocs(`sheet get-range-data '${payload}'`).data.detail.rangeData;

    const values = rangeToValues(cells, rowTo);
    const displayName = info.sheetName.trim();

    if (displayName === '显卡综合10.30') {
      expandMergedColumn(cells, values, 3); // D 列
    }

    sheets.push({ sourceName: info.sheetName, displayName, values });
    console.log(`已读 ${displayName}：${values.length} 行`);
  }

  const snapshot = {
    title: '安徽山水智元全产品报价单',
    url,
    capturedAt: new Date().toISOString(),
    sheets,
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`\n已写入 source-snapshot.json（${sheets.length} 个工作表）`);
}

main();
