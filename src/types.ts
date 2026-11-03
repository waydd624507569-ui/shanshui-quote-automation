export type CategoryName =
  | '显卡'
  | '主板'
  | '存储'
  | '显示器'
  | '一体机'
  | '机箱'
  | '电源'
  | '散热/风扇'
  | '外设'
  | '套餐'
  | '其他';

export interface CatalogItem {
  id: string;
  category: CategoryName;
  name: string;
  brand: string;
  price: number | null;
  priceText: string;
  note: string;
  specs: string;
  sheet: string;
  row: number;
  col: string;
  sourceAddress: string;
}

export interface DealComponent {
  type: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface Deal {
  id: string;
  name: string;
  category: '套餐';
  price: number;
  priceText: string;
  components: DealComponent[];
  image: string;
  sheet: string;
  startRow: number;
  endRow: number;
}

export interface Catalog {
  meta: {
    title: string;
    sourceUrl: string;
    capturedAt: string;
    sheetCount: number;
    itemCount: number;
  };
  categories: Array<{ name: CategoryName; count: number }>;
  deals: Deal[];
  items: CatalogItem[];
}
