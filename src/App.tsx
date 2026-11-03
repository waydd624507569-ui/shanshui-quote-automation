import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircuitBoard,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  Keyboard,
  Layers,
  Monitor,
  Package,
  Search,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Catalog, CatalogItem, CategoryName, Deal } from './types';

const ALL = '全部' as const;
type ActiveCategory = CategoryName | typeof ALL;
type SortMode = 'relevance' | 'priceAsc' | 'priceDesc';

const categoryIcons: Record<CategoryName, LucideIcon> = {
  显卡: Cpu,
  主板: CircuitBoard,
  存储: HardDrive,
  显示器: Monitor,
  一体机: Monitor,
  机箱: Box,
  电源: Zap,
  '散热/风扇': Wind,
  外设: Keyboard,
  套餐: Package,
  其他: Layers,
};

const categoryTones: Record<CategoryName, string> = {
  显卡: '#e45835',
  主板: '#9b6a2f',
  存储: '#39756a',
  显示器: '#3e6e9f',
  一体机: '#6e6299',
  机箱: '#5e7352',
  电源: '#bf762f',
  '散热/风扇': '#46818a',
  外设: '#8b5e73',
  套餐: '#d44828',
  其他: '#77766f',
};

const aliases: Record<string, string[]> = {
  gpu: ['显卡'],
  显卡: ['gpu'],
  ssd: ['存储', '固态硬盘'],
  硬盘: ['存储', '固态硬盘'],
  固态: ['存储', '固态硬盘'],
  内存: ['存储', '内存条'],
  内存条: ['存储'],
  monitor: ['显示器'],
  屏: ['显示器'],
  电源: ['电源', '额定'],
  机箱: ['机箱', '海景房'],
  散热: ['散热/风扇', '风扇', '水冷'],
  风扇: ['散热/风扇'],
  水冷: ['散热/风扇', '冷排'],
  键盘: ['外设', '键鼠'],
  鼠标: ['外设', '键鼠'],
  套提: ['套提', '套餐'],
  套题: ['套提', '套餐'],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

interface EncryptedCatalogEnvelope {
  schemaVersion: number;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  payload: string;
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function loadCatalog(passphrase: string): Promise<Catalog> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/catalog.enc.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('报价数据加载失败');
  const envelope = await response.json() as EncryptedCatalogEnvelope;
  if (envelope.schemaVersion !== 1) throw new Error('报价数据版本不支持');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: decodeBase64(envelope.kdf.salt),
      iterations: envelope.kdf.iterations,
      hash: envelope.kdf.hash,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(envelope.cipher.iv) },
    key,
    decodeBase64(envelope.payload),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as Catalog;
}

function dealComponentTotal(deal: Deal) {
  return deal.components.reduce((total, component) => {
    if (component.amount != null) return total + component.amount;
    return total + (component.unitPrice ?? 0) * (component.quantity ?? 1);
  }, 0);
}

function priceHint(item: CatalogItem) {
  const raw = item.priceText.trim();
  if (!raw) return '';
  const priceCount = [...raw.matchAll(/\d+(?:\.\d+)?/g)].length;
  if (priceCount > 1) return raw.replace(/^\s*(?:￥|¥)\s*/, '');
  const cleaned = raw
    .replace(/(?:￥|¥)\s*/g, '')
    .replace(/\d+(?:\.\d+)?/g, '')
    .replace(/[\/、，,;；\s]+/g, ' ')
    .trim();
  return cleaned;
}

function getCopyText(item: CatalogItem) {
  return [
    `【${item.category}】${item.name}`,
    item.price != null ? `价格：¥${formatNumber(item.price)}${item.priceText !== String(item.price) ? `（${item.priceText}）` : ''}` : '价格：无价',
    item.specs ? `规格：${item.specs}` : '',
    item.note ? `备注：${item.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function DealCarousel({ catalog }: { catalog: Catalog }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = catalog.deals.length;
  const deal = catalog.deals[current];
  const componentTotal = deal ? dealComponentTotal(deal) : 0;
  const imageSrc = deal
    ? `${import.meta.env.BASE_URL}${deal.image.replace(/^\/+/, '')}?v=${encodeURIComponent(catalog.meta.capturedAt)}`
    : '';

  useEffect(() => {
    if (paused || total <= 1) return;
    const timer = window.setInterval(() => setCurrent((index) => (index + 1) % total), 5600);
    return () => window.clearInterval(timer);
  }, [paused, total]);

  if (!deal) return null;

  return (
    <section className="deal-section" aria-labelledby="deal-title">
      <div className="section-heading deal-heading">
        <div>
          <h2 id="deal-title">10 月特价</h2>
          <p>套餐价与商品组合来自原表，按活动顺序展示。</p>
        </div>
        <div className="carousel-controls" aria-label="切换特价套餐">
          <button
            type="button"
            className="icon-button"
            aria-label="上一个套餐"
            onClick={() => setCurrent((index) => (index - 1 + total) % total)}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="carousel-count">{String(current + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="下一个套餐"
            onClick={() => setCurrent((index) => (index + 1) % total)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div
        className="deal-card"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="deal-visual">
          <div className="deal-visual-glow" />
          <img key={deal.id} src={imageSrc} alt={`${deal.name} 套餐商品图`} />
          <span className="deal-label">套包 {current + 1}</span>
        </div>
        <div className="deal-content">
          <div className="deal-title-row">
            <div>
              <span className="deal-kicker">本月活动套餐</span>
              <h3>{deal.name}</h3>
            </div>
            <div className="deal-price-block">
              <div className="deal-price-row deal-price-primary">
                <span>套提价</span>
                <strong>¥{formatNumber(deal.price)}</strong>
              </div>
              {componentTotal ? (
                <div className="deal-price-row deal-price-secondary">
                  <span>部件合计</span>
                  <span>¥{formatNumber(componentTotal)}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="component-list">
            {deal.components.map((component) => (
              <div className="component-chip" key={`${deal.id}-${component.type}-${component.name}`}>
                <span className="component-type">{component.type}</span>
                <span className="component-name">{component.name}</span>
                {component.quantity ? <span className="component-qty">×{component.quantity}</span> : null}
              </div>
            ))}
          </div>

          <div className="deal-meta">
            <span>来源 · {deal.sheet}</span>
            <span>第 {deal.startRow}–{deal.endRow} 行</span>
          </div>
        </div>
      </div>

      <div className="carousel-dots" role="tablist" aria-label="特价套餐列表">
        {catalog.deals.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === current ? 'dot active' : 'dot'}
            aria-label={`查看${item.name}`}
            aria-selected={index === current}
            role="tab"
            onClick={() => setCurrent(index)}
          />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ item }: { item: CatalogItem }) {
  const [copied, setCopied] = useState(false);
  const Icon = categoryIcons[item.category] ?? Layers;
  const hint = priceHint(item);

  async function copyItem() {
    try {
      await navigator.clipboard.writeText(getCopyText(item));
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = getCopyText(item);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <article className="product-card">
      <div className="product-card-top">
        <span
          className="category-badge"
          style={{ '--category-tone': categoryTones[item.category] } as React.CSSProperties}
        >
          <Icon size={14} />
          {item.category}
        </span>
        <button type="button" className="copy-button" onClick={copyItem} aria-label={`复制${item.name}报价`}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>

      <div className="product-card-main">
        <h3>{item.name}</h3>
        {item.specs ? <p className="product-specs">{item.specs}</p> : null}
      </div>

      {item.note ? (
        <div className="product-note">
          <span>备注</span>
          <p>{item.note}</p>
        </div>
      ) : null}

      <div className="product-card-bottom">
        <div className="price-area">
          <strong>{item.price != null ? `¥${formatNumber(item.price)}` : '无价'}</strong>
          {hint ? <span>{hint}</span> : null}
        </div>
        <div className="source-area">
          <span>{item.sheet}</span>
          <span>{item.sourceAddress}</span>
        </div>
      </div>
    </article>
  );
}

function QuoteApp({ catalog }: { catalog: Catalog }) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>(ALL);
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [visibleCount, setVisibleCount] = useState(24);

  const filteredItems = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const normalizedTokens = tokens.map(normalize);

    let items = catalog.items.filter((item) => {
      if (activeCategory !== ALL && item.category !== activeCategory) return false;
      if (!normalizedTokens.length) return true;

      const haystack = normalize([
        item.name,
        item.brand,
        item.category,
        item.specs,
        item.note,
        item.sheet,
        item.priceText,
      ].join(' '));

      return normalizedTokens.every((token) => {
        if (haystack.includes(token)) return true;
        const terms = aliases[token] ?? aliases[tokens[normalizedTokens.indexOf(token)]];
        return terms?.some((term) => haystack.includes(normalize(term))) ?? false;
      });
    });

    if (sortMode === 'priceAsc') {
      items = [...items].sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER));
    } else if (sortMode === 'priceDesc') {
      items = [...items].sort((left, right) => (right.price ?? -1) - (left.price ?? -1));
    } else {
      const normalizedQuery = normalize(query);
      const categoryRank = new Map(catalog.categories.map((category, index) => [category.name, index]));
      items = [...items].sort((left, right) => {
        const leftName = normalize(left.name);
        const rightName = normalize(right.name);
        const leftScore = normalizedQuery
          ? (leftName === normalizedQuery ? 4 : leftName.startsWith(normalizedQuery) ? 3 : leftName.includes(normalizedQuery) ? 2 : 0)
          : 0;
        const rightScore = normalizedQuery
          ? (rightName === normalizedQuery ? 4 : rightName.startsWith(normalizedQuery) ? 3 : rightName.includes(normalizedQuery) ? 2 : 0)
          : 0;
        if (leftScore !== rightScore) return rightScore - leftScore;
        const leftRank = categoryRank.get(left.category) ?? 999;
        const rightRank = categoryRank.get(right.category) ?? 999;
        if (leftRank !== rightRank) return leftRank - rightRank;
        if (!normalizedQuery) {
          return left.sheet.localeCompare(right.sheet, 'zh-CN') || left.row - right.row || left.col.localeCompare(right.col);
        }
        return left.name.localeCompare(right.name, 'zh-CN');
      });
    }

    return items;
  }, [activeCategory, query, sortMode]);

  useEffect(() => {
    setVisibleCount(24);
  }, [query, activeCategory, sortMode]);

  const allIcon = Layers;
  const AllIcon = allIcon;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="返回顶部">
          <span className="brand-mark">山</span>
          <span className="brand-copy">
            <strong>山水报价</strong>
            <small>安徽山水智元</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="sync-state" title={`数据抓取自 ${catalog.meta.capturedAt}`}>
            <span className="sync-dot" />
            <Database size={14} />
            快照 · {formatDate(catalog.meta.capturedAt)}
          </span>
          <a className="source-link" href={catalog.meta.sourceUrl} target="_blank" rel="noreferrer">
            打开原表
            <ExternalLink size={15} />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="search-shell">
            <Search className="search-icon" size={22} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 RTX 5070、B760M、16G、套提…"
              aria-label="搜索商品型号、规格或备注"
            />
            {query ? (
              <button type="button" className="clear-search" onClick={() => setQuery('')}>
                清除
              </button>
            ) : null}
          </div>

          <div className="category-strip" aria-label="商品分类筛选">
            <button
              type="button"
              className={activeCategory === ALL ? 'category-chip active' : 'category-chip'}
              onClick={() => setActiveCategory(ALL)}
            >
              <AllIcon size={15} />
              全部
              <span>{catalog.meta.itemCount}</span>
            </button>
            {catalog.categories.map((category) => {
              const Icon = categoryIcons[category.name] ?? Layers;
              return (
                <button
                  type="button"
                  key={category.name}
                  className={activeCategory === category.name ? 'category-chip active' : 'category-chip'}
                  onClick={() => setActiveCategory(category.name)}
                  style={{ '--category-tone': categoryTones[category.name] } as React.CSSProperties}
                >
                  <Icon size={15} />
                  {category.name}
                  <span>{category.count}</span>
                </button>
              );
            })}
          </div>

          <div className="hero-meta">
            <span>{catalog.meta.sheetCount} 个原始工作表</span>
            <span>{catalog.meta.itemCount} 条可搜索报价</span>
            <span>原表只读，不修改</span>
          </div>
        </section>

        <DealCarousel catalog={catalog} />

        <section className="results-section" aria-labelledby="results-title">
          <div className="results-heading">
            <div>
              <h2 id="results-title">{query || activeCategory !== ALL ? '搜索结果' : '全部商品'}</h2>
              <p>
                找到 <strong>{filteredItems.length}</strong> 条
                {activeCategory !== ALL ? ` · ${activeCategory}` : ''}
              </p>
            </div>
            <label className="sort-control">
              <span>排序</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="relevance">相关度</option>
                <option value="priceAsc">价格从低到高</option>
                <option value="priceDesc">价格从高到低</option>
              </select>
            </label>
          </div>

          {filteredItems.length ? (
            <>
              <div className="product-grid">
                {filteredItems.slice(0, visibleCount).map((item) => (
                  <ProductCard key={item.id} item={item} />
                ))}
              </div>
              {visibleCount < filteredItems.length ? (
                <button type="button" className="load-more" onClick={() => setVisibleCount((count) => count + 24)}>
                  加载更多
                  <span>还有 {filteredItems.length - visibleCount} 条</span>
                </button>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              <Search size={30} />
              <h3>没有找到匹配报价</h3>
              <p>试试型号片段、容量或“套提”等备注关键词。</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setActiveCategory(ALL);
                }}
              >
                清空搜索条件
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <span>数据来源：{catalog.meta.title}</span>
        <span>只读同步 · 最近抓取 {formatDate(catalog.meta.capturedAt)}</span>
      </footer>
    </div>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const passphrase = import.meta.env.VITE_CATALOG_PASSPHRASE as string | undefined;
    if (!passphrase) {
      setError('报价数据配置错误');
      return () => { active = false; };
    }
    loadCatalog(passphrase)
      .then((nextCatalog) => {
        if (active) setCatalog(nextCatalog);
      })
      .catch(() => {
        if (active) setError('报价数据加载失败');
      });
    return () => { active = false; };
  }, []);

  if (!catalog) {
    return (
      <main className="access-page">
        <div className="access-card">
          <div className="brand access-brand">
            <span className="brand-mark">山</span>
            <span className="brand-copy">
              <strong>山水报价</strong>
              <small>安徽山水智元</small>
            </span>
          </div>
          <div className="access-loading">{error || '正在打开报价数据…'}</div>
        </div>
      </main>
    );
  }

  return <QuoteApp catalog={catalog} />;
}
