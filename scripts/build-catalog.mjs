import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(root, 'data/source-snapshot.json');
const imageMapPath = path.join(root, 'data/product-images.json');
const outputPath = path.join(root, 'src/data/catalog.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const productImageMap = fs.existsSync(imageMapPath)
  ? JSON.parse(fs.readFileSync(imageMapPath, 'utf8'))
  : {};

const CATEGORY_ORDER = [
  '显卡',
  '主板',
  '存储',
  '显示器',
  '一体机',
  '机箱',
  '电源',
  '散热/风扇',
  '外设',
  '套餐',
  '其他',
];

const sheetByName = new Map(snapshot.sheets.map((sheet) => [sheet.displayName, sheet]));
const items = [];
let autoId = 0;

function text(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function oneLine(value) {
  return text(value).replace(/\s+/g, ' ').trim();
}

function lines(value) {
  return text(value)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function priceNumbers(value) {
  const source = text(value);
  return [...source.matchAll(/(?:￥|¥)?\s*(\d{2,7}(?:\.\d+)?)\s*元?/g)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
}

function priceInfo(value) {
  const source = text(value);
  if (isImageFormula(source) || /^https?:\/\//i.test(source)) return null;
  if (/PLUS|USB|HDMI|WIFI|PCIe/i.test(source) && !/元/.test(source) && !/^\s*[¥￥]?\d+(?:\.\d+)?\s*$/.test(source)) return null;
  const numbers = priceNumbers(source);
  if (!numbers.length) return null;
  return {
    price: numbers[0],
    priceText: source.replace(/\n/g, ' / '),
    priceNote: source
      .replace(/(?:￥|¥)?\s*\d{2,7}(?:\.\d+)?\s*元?/g, '')
      .replace(/[\/、，,;；\s]+/g, ' ')
      .trim(),
  };
}

function isImageFormula(value) {
  return /DISPIMG|^https?:\/\//i.test(text(value));
}

function brandOf(source) {
  const value = text(source);
  if (/colorful/i.test(value)) return '七彩虹';
  const brands = [
    'COLORFIRE', 'BATTLE-AX', 'iGame', '七彩虹', '战斧', 'CVN', '网驰',
    '鑫谷', '富勒', '超频三', '锐禧', '撒哈拉', '杰灵', '精粤', '铭鑫',
    '耕升', '讯景', '蓝戟', '海兰', '联想来酷', '锐储', '异极',
  ];
  return brands.find((brand) => value.toLowerCase().includes(brand.toLowerCase())) ?? '';
}

function stableId(sheet, row, col, name) {
  autoId += 1;
  const digest = crypto
    .createHash('sha1')
    .update(`${sheet}|${row}|${col}|${name}|${autoId}`)
    .digest('hex')
    .slice(0, 10);
  return `${sheet}-${digest}`;
}

function pushItem(item) {
  const name = oneLine(item.name);
  if (!name || isImageFormula(name) || /DISPIMG/i.test(name)) return;
  const category = CATEGORY_ORDER.includes(item.category) ? item.category : '其他';
  const brand = item.brand || brandOf(name);
  const displayName = brand && !name.toLowerCase().startsWith(brand.toLowerCase())
    ? `${brand} ${name}`
    : name;
  const sourceAddress = item.sourceAddress || `${item.col}${item.row}`;
  const image = productImageMap[`${item.sheet}!${sourceAddress}`] || item.image || '';
  items.push({
    id: stableId(item.sheet, item.row, item.col, displayName),
    category,
    name: displayName,
    brand,
    price: item.price ?? null,
    priceText: item.priceText || '',
    note: oneLine(item.note || ''),
    specs: oneLine(item.specs || ''),
    ...(image ? { image } : {}),
    sheet: item.sheet,
    row: item.row,
    col: item.col,
    sourceAddress,
  });
}

function simpleSheet(name, category, mapper) {
  const sheet = sheetByName.get(name);
  if (!sheet) return;
  sheet.values.forEach((row, rowIndex) => {
    const colCount = Math.max(...sheet.values.map((line) => line.length));
    const padded = Array.from({ length: colCount }, (_, index) => row[index] ?? '');
    const mapped = mapper(padded, rowIndex, sheet);
    for (const item of mapped) pushItem({ ...item, sheet: name, category });
  });
}

// 10月特价：拆成套包与套餐部件。
const deals = [];
const dealSheet = sheetByName.get('10月特价');
if (dealSheet) {
  for (let rowIndex = 0; rowIndex < dealSheet.values.length; rowIndex += 1) {
    const row = dealSheet.values[rowIndex];
    const headline = text(row[0]);
    if (!headline || headline === '七彩虹机箱活动价') continue;
    const components = [];
    let cursor = rowIndex;
    while (cursor < dealSheet.values.length) {
      const current = dealSheet.values[cursor];
      const type = text(current[1]);
      const componentName = text(current[2]);
      if (cursor > rowIndex && text(current[0])) break;
      if (type && componentName && priceInfo(current[5])) {
        const unit = priceInfo(current[5]);
        components.push({
          type,
          name: componentName,
          quantity: Number(text(current[4])) || null,
          unitPrice: unit?.price ?? null,
          amount: priceInfo(current[6])?.price ?? null,
        });
      }
      cursor += 1;
      if (cursor < dealSheet.values.length && !text(dealSheet.values[cursor].join(''))) break;
    }
    const packagePrice = priceInfo(row[7]);
    if (!components.length || !packagePrice) {
      rowIndex = cursor - 1;
      continue;
    }
    const packageName = lines(headline).join(' ');
    const componentSummary = components
      .map((component) => `${component.type} ${component.name}${component.quantity ? ` ×${component.quantity}` : ''}`)
      .join('；');
    deals.push({
      id: `deal-${deals.length + 1}`,
      name: packageName,
      category: '套餐',
      price: packagePrice.price,
      priceText: packagePrice.priceText,
      components,
      image: `deals/package-${deals.length + 1}.png`,
      sheet: '10月特价',
      startRow: rowIndex + 1,
      endRow: Math.max(rowIndex + 1, cursor),
    });
    pushItem({
      name: `${packageName}｜${components.map((component) => component.name).join(' + ')}`,
      category: '套餐',
      brand: brandOf(componentSummary),
      price: packagePrice.price,
      priceText: packagePrice.priceText,
      note: componentSummary,
      specs: '10月特价套包',
      sheet: '10月特价',
      row: rowIndex + 1,
      col: 'A',
    });
    for (const component of components) {
      const componentBrand = brandOf(component.name) || brandOf(componentSummary);
      pushItem({
        name: component.name,
        category: component.type.includes('风扇') || component.type.includes('散热') ? '散热/风扇' : '机箱',
        brand: componentBrand,
        price: component.unitPrice,
        priceText: component.unitPrice ? String(component.unitPrice) : '',
        note: `${packageName} 套餐部件${component.quantity ? ` ×${component.quantity}` : ''}`,
        specs: component.type,
        sheet: '10月特价',
        row: rowIndex + 1,
        col: 'A',
      });
    }
    rowIndex = cursor - 1;
  }
}

// 内存、硬盘。
simpleSheet('内存 硬盘', '存储', (row, rowIndex) => {
  const name = text(row[1]);
  const price = priceInfo(row[2]);
  const rawPrice = text(row[2]);
  if (!name || name === '锐储固态硬盘' || name === '七彩虹硬盘' || name.endsWith('内存条')) return [];
  return [{
    name,
    brand: brandOf(name),
    price: price?.price ?? null,
    priceText: price?.priceText ?? (/缺货/.test(rawPrice) ? '缺货' : ''),
    note: [price?.priceNote, text(row[0])].filter(Boolean).join(' · '),
    specs: name.includes('/') ? name.split('/').slice(1).join('/') : '',
    row: rowIndex + 1,
    col: 'B',
  }];
});

// 主板：左侧品牌表与右侧附加品牌表。
simpleSheet('主板综合', '主板', (row, rowIndex) => {
  const result = [];
  const mainName = text(row[4]);
  const mainPrice = priceInfo(row[6]);
  if (mainName && !/^(型号|产品型号)$/.test(mainName)) {
    const inferredBrand = brandOf(`${row[2]} ${mainName}`) || (mainName.startsWith('主板') ? '七彩虹' : '');
    result.push({
      name: mainName,
      brand: inferredBrand,
      price: mainPrice?.price ?? null,
      priceText: mainPrice?.priceText ?? '',
      note: [row[1], row[2], row[3], row[5]].map(text).filter(Boolean).join(' · '),
      specs: [row[0], row[1], row[2], row[3], row[5]].map(text).filter(Boolean).join(' · '),
      row: rowIndex + 1,
      col: 'E',
    });
  }
  const extraName = text(row[8]);
  const extraPrice = priceInfo(row[9]);
  if (extraName && !extraName.includes('价格') && /[A-Z]/i.test(extraName) && /\d/.test(extraName)) {
    result.push({
      name: extraName,
      brand: brandOf(extraName),
      price: extraPrice?.price ?? null,
      priceText: extraPrice?.priceText ?? '',
      note: '附加主板报价',
      specs: extraName,
      row: rowIndex + 1,
      col: 'I',
    });
  }
  return result;
});

// 显卡：左侧七彩虹/iGame，右侧其他品牌；型号后的“套提/套题”拆为备注。
simpleSheet('显卡综合10.30', '显卡', (row, rowIndex, sheet) => {
  const result = [];
  const rawLeft = text(row[1]);
  const leftPrice = priceInfo(row[2]);
  if (rawLeft && /[A-Za-z].*\d|\d+GB|RTX|GTX|RX|ARC/i.test(rawLeft)) {
    const marker = rawLeft.search(/套提|套题/);
    const model = marker >= 0 ? rawLeft.slice(0, marker).trim() : rawLeft;
    const suffix = marker >= 0 ? rawLeft.slice(marker).trim() : '';
    const detail = text(row[3]);
    const note = /套提|套题/.test(detail) ? detail : suffix;
    result.push({
      name: model,
      brand: brandOf(model) || '七彩虹',
      price: leftPrice?.price ?? null,
      priceText: leftPrice?.priceText ?? '',
      note,
      specs: [row[0]].map(text).filter(Boolean).join(' · '),
      row: rowIndex + 1,
      col: 'B',
    });
  }
  const rightCol4Raw = text(row[4]);
  const rightCol4 = /^(N卡|A卡)$/.test(rightCol4Raw) ? '' : rightCol4Raw;
  const rightCol5 = text(row[5]);
  const rightCol6 = text(row[6]);
  const rawRightName = rightCol4 && !isImageFormula(rightCol4)
    ? rightCol4
    : rightCol5.includes('显卡/')
      ? rightCol5
      : rightCol6 || rightCol5;
  const rightName = rawRightName.replace(/^[^/]+显卡\//, '').trim();
  const rightPrice = priceInfo(row[9]);
  let rightBrand = '';
  for (let cursor = rowIndex; cursor >= 0; cursor -= 1) {
    const heading = text(sheet.values[cursor]?.[5]);
    if (!heading.includes('显卡')) continue;
    rightBrand = brandOf(heading);
    break;
  }
  if (rightName && !rightName.includes('显卡') && rightName !== '中文名称' && rightName !== 'N卡' && rightName !== 'A卡' && !/系列$/.test(rightName) && /[A-Za-z]/.test(rightName)) {
    result.push({
      name: rightName,
      brand: brandOf(rightName) || rightBrand,
      price: rightPrice?.price ?? null,
      priceText: rightPrice?.priceText ?? '',
      note: '',
      specs: [row[5], row[6], row[7], row[8]].map(text).filter(Boolean).join(' · '),
      row: rowIndex + 1,
      col: 'E',
    });
  }
  return result;
});

// 显示器：按品牌标题动态划分区块，避免表格插入行后固定行号失效。
const displaySheet = sheetByName.get('显示器综合');
if (displaySheet) {
  const displayBrands = ['联想来酷', '优派', '泰坦', '海兰', '明基'];
  const sectionStarts = [];
  displaySheet.values.forEach((row, rowIndex) => {
    const first = text(row[0]);
    if (!first.includes('显示器')) return;
    if (row.slice(1).some((value) => text(value))) return;
    const brand = displayBrands.find((candidate) => first.includes(candidate));
    if (brand) sectionStarts.push({ brand, rowIndex });
  });
  sectionStarts.sort((a, b) => a.rowIndex - b.rowIndex);

  const sectionRows = (brand) => {
    const index = sectionStarts.findIndex((section) => section.brand === brand);
    if (index < 0) return [];
    const start = sectionStarts[index].rowIndex;
    const end = sectionStarts[index + 1]?.rowIndex ?? displaySheet.values.length;
    return displaySheet.values.slice(start, end).map((row, offset) => ({
      row,
      rowIndex: start + offset,
    }));
  };

  const pushDisplay = (rowIndex, item) => {
    const name = oneLine(item.name);
    if (!name || /网吧做单|做单型号/.test(name)) return;
    pushItem({
      ...item,
      name,
      sheet: '显示器综合',
      category: '显示器',
      row: rowIndex + 1,
      sourceAddress: `${item.col}${rowIndex + 1}`,
    });
  };

  // 联想来酷：B 型号、F 价格。
  for (const { row, rowIndex } of sectionRows('联想来酷')) {
    const name = text(row[1]);
    if (!name || name === '型号' || name === '流量型号') continue;
    const price = priceInfo(row[5]);
    pushDisplay(rowIndex, {
      name,
      brand: '联想来酷',
      price: price?.price ?? null,
      priceText: price?.priceText ?? '',
      note: [row[3], row[4], row[11]].map(text).filter(Boolean).join(' · '),
      specs: [row[2] ? `${row[2]}英寸` : '', row[6], row[7], row[8], row[9], row[10]].map(text).filter(Boolean).join(' · '),
      col: 'B',
    });
  }

  // 泰坦：A 型号、B 代理价。
  for (const { row, rowIndex } of sectionRows('泰坦')) {
    const name = text(row[0]);
    if (!name || name === '型号' || /网吧做单|做单型号/.test(name)) continue;
    if (!/[A-Z]/i.test(name) || !/\d/.test(name)) continue;
    const price = priceInfo(row[1]);
    pushDisplay(rowIndex, {
      name,
      brand: '泰坦',
      price: price?.price ?? null,
      priceText: price?.priceText ?? '',
      note: [row[7], row[8], row[9]].map(text).filter(Boolean).join(' · '),
      specs: [row[2] ? `${row[2]}英寸` : '', row[3], row[4], row[5], row[6]].map(text).filter(Boolean).join(' · '),
      col: 'A',
    });
  }

  // 优派：C 型号、G 渠道价，A 列分类向下沿用。
  let viewSonicCategory = '';
  for (const { row, rowIndex } of sectionRows('优派')) {
    const category = text(row[0]);
    if (category) viewSonicCategory = category;
    const name = text(row[2]);
    if (!name || name === '型号') continue;
    const price = priceInfo(row[6]);
    pushDisplay(rowIndex, {
      name,
      brand: '优派',
      price: price?.price ?? null,
      priceText: price?.priceText ?? '',
      note: [viewSonicCategory, row[4], row[5]].map(text).filter(Boolean).join(' · '),
      specs: [row[1] ? `${row[1]}英寸` : '', row[3], row[4], row[5], row[8]].map(text).filter(Boolean).join(' · '),
      col: 'C',
    });
  }

  // 海兰：A 型号、B 含税价。
  for (const { row, rowIndex } of sectionRows('海兰')) {
    const name = text(row[0]);
    if (!name || name === '型号' || !/^[A-Z]/i.test(name) || !/\d/.test(name)) continue;
    const price = priceInfo(row[1]);
    pushDisplay(rowIndex, {
      name,
      brand: '海兰',
      price: price?.price ?? null,
      priceText: price?.priceText ?? '',
      note: '显示器',
      specs: [row[2], row[3], row[4], row[5]].map(text).filter(Boolean).join(' · '),
      col: 'A',
    });
  }

  // 明基：B 型号、C 提货价，A 列系列向下沿用。
  let benQCategory = '';
  for (const { row, rowIndex } of sectionRows('明基')) {
    const category = text(row[0]);
    if (category) benQCategory = category;
    const name = text(row[1]);
    if (!name || name === '型号') continue;
    const price = priceInfo(row[2]);
    const detail = oneLine(row[3]);
    pushDisplay(rowIndex, {
      name,
      brand: '明基',
      price: price?.price ?? null,
      priceText: price?.priceText ?? '',
      note: benQCategory,
      specs: detail.slice(0, 140),
      col: 'B',
    });
  }
}

// 一体机。
simpleSheet('一体机', '一体机', (row, rowIndex) => {
  const name = text(row[0]);
  const price = priceInfo(row[2]);
  if (!name || name === '型号/颜色' || name.includes('安徽山水智元科技')) return [];
  return [{
    name,
    brand: '海兰',
    price: price?.price ?? null,
    priceText: price?.priceText ?? '',
    note: [row[3], row[7]].map(text).filter(Boolean).join(' · '),
    specs: [row[1], row[3]].map(text).filter(Boolean).join(' · '),
    row: rowIndex + 1,
    col: 'A',
  }];
});

// 富勒外设：章节标题需要向下沿用。
simpleSheet('富勒外设', '外设', (row, rowIndex, sheet) => {
  const name = text(row[0]);
  const price = priceInfo(row[4]);
  if (!name || !price) return [];
  let section = '';
  for (let cursor = rowIndex; cursor >= 0; cursor -= 1) {
    const candidate = text(sheet.values[cursor]?.[0]);
    if (!candidate) continue;
    if (!/^(A\d|L\d|G\d|K\d)/i.test(candidate) && candidate !== '产品型号') {
      section = candidate;
      break;
    }
  }
  return [{
    name: `${section ? `${section} / ` : ''}${name}`,
    brand: '富勒',
    price: price.price,
    priceText: price.priceText,
    note: [row[2], row[3], row[5]].map(text).filter(Boolean).join(' · '),
    specs: [row[1], row[2], row[3]].map(text).filter(Boolean).join(' · '),
    row: rowIndex + 1,
    col: 'A',
  }];
});



// 超频三为表格型明细：型号在 B 列，代理价在 F 列。
function parseChaopinSan() {
  const sheet = sheetByName.get('超频三');
  if (!sheet) return;
  sheet.values.forEach((row, rowIndex) => {
    const rawName = text(row[1]);
    const price = priceInfo(row[5]);
    if (!rawName || !price) return;
    const nameLines = lines(rawName).map((line) => line.replace(/^\s*\/\s*/, '').trim()).filter(Boolean);
    const productName = nameLines[0];
    if (!productName || /^产\s*品\s*型\s*号$/.test(productName)) return;
    pushItem({
      name: productName,
      category: '散热/风扇',
      brand: '超频三',
      price: price.price,
      priceText: price.priceText,
      note: nameLines.slice(1).join(' · '),
      specs: [row[0], row[3], row[4], row[6], row[7], row[8]].map(text).filter(Boolean).join(' · '),
      sheet: '超频三',
      row: rowIndex + 1,
      col: 'B',
    });
  });
}

function inferGridCategory(sheetName, fullText) {
  if (sheetName === '鑫谷机箱') return '机箱';
  if (sheetName === '鑫谷电源') return '电源';
  if (sheetName === '鑫谷散热器') return '散热/风扇';
  if (sheetName === '超频三') return '散热/风扇';
  if (/机箱|海景房|侧透|整机尺寸|走线大师|逆行者|神光|穿越|商悦|超级基地/i.test(fullText)) return '机箱';
  if (/电源|额定|金牌|铜牌|[0-9]{3}W|工包|盒包/i.test(fullText)) return '电源';
  if (/散热|水冷|冷排|风冷|风扇|热管|ARGB/i.test(fullText)) return '散热/风扇';
  return '其他';
}

function parseGrid(name) {
  const sheet = sheetByName.get(name);
  if (!sheet) return;
  const width = Math.max(...sheet.values.map((row) => row.length));
  const blocked = /^(官方网址|以下|价格|型号|产品|代理价|图片|颜色|规格|尺寸|核心价格|数量|单价|金额|套提特价)/;
  for (let rowIndex = 0; rowIndex < sheet.values.length - 1; rowIndex += 1) {
    const row = sheet.values[rowIndex];
    const next = sheet.values[rowIndex + 1] ?? [];
    for (let colIndex = 0; colIndex < width; colIndex += 1) {
      const raw = text(row[colIndex]);
      const nextRaw = text(next[colIndex]);
      if (!raw || isImageFormula(raw) || blocked.test(raw)) continue;
      const nextPrice = priceInfo(nextRaw);
      if (!nextPrice) continue;
      if (priceNumbers(raw).length === 1 && oneLine(raw).length < 8) continue;
      const parts = lines(raw);
      const productName = parts[0];
      if (!productName || productName.length < 3) continue;
      if (/^(黑|白|红|蓝|灰|银|粉|绿色|黑色|白色)$/.test(productName)) continue;
      if (/^L\d+(?:\.\d+)?\s*\*\s*W/i.test(productName)) continue;
      if (/\d+元|工包\d|盒包\d|DISPIMG/i.test(productName)) continue;
      if (!/[\u3400-\u9fff]/.test(productName) && !brandOf(productName)) continue;
      const full = parts.join(' · ');
      const category = inferGridCategory(name, full);
      pushItem({
        name: productName,
        category,
        brand: brandOf(productName) || (name.startsWith('鑫谷') ? '鑫谷' : name === '锐禧机电散' ? '锐禧' : name === '撒哈拉' ? '撒哈拉' : ''),
        price: nextPrice.price,
        priceText: nextPrice.priceText,
        note: nextPrice.priceNote,
        specs: parts.slice(1).join(' · '),
        sheet: name,
        row: rowIndex + 1,
        col: String.fromCharCode(65 + colIndex),
      });
    }
  }
}

// 少量表格把多个“型号 + 元”价格写在同一个单元格内，需要逐行拆分。
function parseInlinePricedModels(name) {
  const sheet = sheetByName.get(name);
  if (!sheet) return;
  const width = Math.max(...sheet.values.map((row) => row.length));
  for (let rowIndex = 0; rowIndex < sheet.values.length; rowIndex += 1) {
    for (let colIndex = 0; colIndex < width; colIndex += 1) {
      const detail = lines(sheet.values[rowIndex]?.[colIndex]);
      const priced = detail.filter((line) => /^\s*.+\d{2,7}\s*元\s*$/.test(line));
      if (priced.length < 2) continue;
      const specs = detail.filter((line) => !priced.includes(line)).join(' · ');
      for (const line of priced) {
        const match = line.match(/^(.*?)\s*(\d{2,7})\s*元\s*$/);
        if (!match) continue;
        const productName = oneLine(match[1]);
        const price = Number(match[2]);
        if (!productName || !Number.isFinite(price)) continue;
        pushItem({
          name: productName,
          category: inferGridCategory(name, `${productName} ${specs}`),
          brand: name.startsWith('鑫谷') ? '鑫谷' : '',
          price,
          priceText: String(price),
          note: '合并报价单元格',
          specs,
          sheet: name,
          row: rowIndex + 1,
          col: String.fromCharCode(65 + colIndex),
        });
      }
    }
  }
}

['鑫谷机箱', '鑫谷电源', '鑫谷散热器', '锐禧机电散', '撒哈拉'].forEach((name) => {
  parseGrid(name);
  parseInlinePricedModels(name);
});
parseChaopinSan();

// 去重与排序。
const deduped = [];
const seen = new Set();
for (const item of items) {
  const key = `${item.category}|${item.name}|${item.priceText}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(item);
}

const categoryCounts = Object.fromEntries(
  CATEGORY_ORDER.map((category) => [category, deduped.filter((item) => item.category === category).length]),
);

const catalog = {
  meta: {
    title: snapshot.title,
    sourceUrl: snapshot.url,
    capturedAt: snapshot.capturedAt,
    sheetCount: snapshot.sheets.length,
    itemCount: deduped.length,
  },
  categories: CATEGORY_ORDER.filter((category) => categoryCounts[category] > 0).map((category) => ({
    name: category,
    count: categoryCounts[category],
  })),
  deals,
  items: deduped,
};

fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));
console.log(JSON.stringify({ itemCount: deduped.length, deals: deals.length, categories: categoryCounts }, null, 2));
