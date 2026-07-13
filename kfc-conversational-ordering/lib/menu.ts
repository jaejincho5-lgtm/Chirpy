export type MenuCategory =
  | "chicken"
  | "combo"
  | "burger"
  | "rice"
  | "side"
  | "drink"
  | "dessert";

export type MenuOption = {
  id: string;
  name: string;
  priceDeltaVnd: number;
  group: "spice" | "side" | "drink" | "size" | "sauce";
};

export type MenuItem = {
  id: string;
  sku: string;
  name: string;
  vietnameseName: string;
  category: MenuCategory;
  description: string;
  priceVnd: number;
  tags: string[];
  options: MenuOption[];
  available: boolean;
  popular?: boolean;
};

export type MenuMatch = {
  source: "search_menu";
  matchId: string;
  catalogId: string;
  sku: string;
  name: string;
  vietnameseName: string;
  category: MenuCategory;
  description: string;
  priceVnd: number;
  displayPrice: string;
  tags: string[];
  options: MenuOption[];
  score: number;
};

export type MenuSearchResult = {
  query: string;
  matches: MenuMatch[];
  catalogVersion: string;
};

// Catalog grounded in the OFFICIAL KFC Vietnam online menu
// (kfcvietnam.com.vn, pulled 2026-07-06 — see menu.json at the project root).
// Internal ids are stable SKU keys; names/prices/contents are the real menu.
export const CATALOG_VERSION = "kfc-vn-official-2026-07-06";

const spiceOptions: MenuOption[] = [
  { id: "spice-original", name: "Original recipe", priceDeltaVnd: 0, group: "spice" },
  { id: "spice-spicy", name: "Hot & spicy", priceDeltaVnd: 0, group: "spice" },
  { id: "spice-non-spicy", name: "Not spicy", priceDeltaVnd: 0, group: "spice" },
];

const drinkOptions: MenuOption[] = [
  { id: "drink-pepsi", name: "Pepsi", priceDeltaVnd: 0, group: "drink" },
  { id: "drink-7up", name: "7Up", priceDeltaVnd: 0, group: "drink" },
  { id: "drink-lipton", name: "Lipton", priceDeltaVnd: 0, group: "drink" },
  { id: "drink-pepsi-zero", name: "Pepsi No Sugar", priceDeltaVnd: 0, group: "drink" },
];

const sideOptions: MenuOption[] = [
  { id: "side-fries", name: "French Fries", priceDeltaVnd: 0, group: "side" },
  { id: "side-mashed-potato", name: "Mashed potato", priceDeltaVnd: 0, group: "side" },
  { id: "side-coleslaw", name: "Coleslaw", priceDeltaVnd: 0, group: "side" },
];

export const MENU_CATALOG: MenuItem[] = [
  {
    id: "fried-chicken-1pc",
    sku: "KFCVN-CHK-001",
    name: "1 Fried Chicken",
    vietnameseName: "1 mieng ga ran",
    category: "chicken",
    description: "Crispy bone-in chicken (original or hot & spicy) + 1 sauce sachet.",
    priceVnd: 37000,
    tags: ["ga ran", "fried chicken", "chicken", "original", "spicy", "mot mieng"],
    options: spiceOptions,
    available: true,
    popular: true,
  },
  {
    id: "fried-chicken-2pc",
    sku: "KFCVN-CHK-002",
    name: "2 Fried Chicken",
    vietnameseName: "2 mieng ga ran",
    category: "chicken",
    description: "Two crispy bone-in chicken pieces + 2 sauce sachets.",
    priceVnd: 74000,
    tags: ["ga ran", "fried chicken", "two pieces", "hai mieng", "spicy"],
    options: spiceOptions,
    available: true,
    popular: true,
  },
  {
    id: "tenders-3pc",
    sku: "KFCVN-CHK-003",
    name: "3 Tenders Chicken",
    vietnameseName: "3 ga tenders",
    category: "chicken",
    description: "Three crispy boneless tenders + 1 sauce sachet.",
    priceVnd: 42000,
    tags: ["tenders", "ga tenders", "boneless", "gion", "snack", "cay"],
    options: spiceOptions,
    available: true,
  },
  {
    id: "popcorn-regular",
    sku: "KFCVN-CHK-004",
    name: "Popcorn Chicken (R)",
    vietnameseName: "ga popcorn",
    category: "chicken",
    description: "Bite-size crispy popcorn chicken, regular box.",
    priceVnd: 40000,
    tags: ["popcorn", "ga vien", "bites", "snack", "tre em", "gion"],
    options: [],
    available: true,
  },
  {
    id: "zinger-burger",
    sku: "KFCVN-BRG-005",
    name: "Burger Zinger",
    vietnameseName: "burger zinger",
    category: "burger",
    description: "Spicy crispy chicken fillet burger with lettuce and mayo.",
    priceVnd: 56000,
    tags: ["burger", "zinger", "sandwich", "ga cay", "lunch", "spicy"],
    options: [{ id: "no-mayo", name: "No mayo", priceDeltaVnd: 0, group: "sauce" }],
    available: true,
    popular: true,
  },
  {
    id: "shrimp-burger",
    sku: "KFCVN-BRG-006",
    name: "Burger Shrimp",
    vietnameseName: "burger tom",
    category: "burger",
    description: "Crispy shrimp patty burger with lettuce.",
    priceVnd: 45000,
    tags: ["burger", "tom", "shrimp", "seafood"],
    options: [{ id: "no-tartar", name: "No tartar sauce", priceDeltaVnd: 0, group: "sauce" }],
    available: true,
  },
  {
    id: "burger-ga-yo",
    sku: "KFCVN-BRG-007",
    name: "Burger Yo (Chicken)",
    vietnameseName: "burger ga yo",
    category: "burger",
    description: "Snack-size chicken burger, spicy or non-spicy.",
    priceVnd: 30000,
    tags: ["burger", "ga yo", "snack", "re", "cheap", "spicy"],
    options: spiceOptions.slice(1),
    available: true,
  },
  {
    id: "fried-chicken-rice",
    sku: "KFCVN-RCE-008",
    name: "Fried Chicken Rice",
    vietnameseName: "com ga ran",
    category: "rice",
    description: "Rice plate with crispy fried chicken.",
    priceVnd: 49000,
    tags: ["rice", "com", "com ga", "com ga ran", "lunch"],
    options: spiceOptions.slice(1),
    available: true,
  },
  {
    id: "fried-chicken-pasta",
    sku: "KFCVN-PST-009",
    name: "Fried Chicken Pasta",
    vietnameseName: "mi y ga ran",
    category: "rice",
    description: "KFC pasta topped with crispy fried chicken.",
    priceVnd: 68000,
    tags: ["pasta", "mi y", "spaghetti", "kids", "tre em"],
    options: [],
    available: true,
  },
  {
    id: "combo-classic",
    sku: "KFCVN-CMB-010",
    name: "Combo 1 Fried Chicken",
    vietnameseName: "combo 1 mieng ga ran",
    category: "combo",
    description: "1 fried chicken + French fries (R) + Pepsi (STD).",
    priceVnd: 59000,
    tags: ["combo", "meal", "ga ran", "pepsi", "fries", "mot nguoi"],
    options: [...spiceOptions, ...drinkOptions, ...sideOptions],
    available: true,
    popular: true,
  },
  {
    id: "combo-zinger",
    sku: "KFCVN-CMB-011",
    name: "Combo Burger Zinger",
    vietnameseName: "combo burger zinger",
    category: "combo",
    description: "Zinger burger + French fries (R) + Pepsi (STD).",
    priceVnd: 79000,
    tags: ["combo", "burger", "zinger", "pepsi", "lunch", "mot nguoi"],
    options: [...drinkOptions, ...sideOptions],
    available: true,
    popular: true,
  },
  {
    id: "combo-couple",
    sku: "KFCVN-CMB-012",
    name: "Couple's Bucket 189k",
    vietnameseName: "bucket doi 189k",
    category: "combo",
    description: "Bucket 5 fried chicken + French fries (R) + 2 Pepsi (M). List price 239k.",
    priceVnd: 189000,
    tags: ["bucket", "couple", "2 nguoi", "hai nguoi", "sharing", "hot deal"],
    options: [...spiceOptions, ...drinkOptions],
    available: true,
  },
  {
    id: "combo-family-4",
    sku: "KFCVN-CMB-013",
    name: "Big Combo 279k",
    vietnameseName: "big combo nhom 4 nguoi",
    category: "combo",
    description: "4 fried chicken + 2 Zinger burgers + French fries (R) + 4 Pepsi (STD).",
    priceVnd: 279000,
    tags: ["combo nhom", "family", "4 nguoi", "sharing", "ga ran cho 4 nguoi", "big combo"],
    options: [...spiceOptions, ...drinkOptions],
    available: true,
    popular: true,
  },
  {
    id: "combo-party-6",
    sku: "KFCVN-CMB-014",
    name: "Party Bucket 269k",
    vietnameseName: "party bucket nhom 6 nguoi",
    category: "combo",
    description: "Bucket 9 fried chicken + 3 Pepsi (M). List price 404k.",
    priceVnd: 269000,
    tags: ["bucket", "party", "party 6 nguoi", "nhom 6 nguoi", "ga ran nhieu", "hot deal"],
    options: [...spiceOptions, ...drinkOptions],
    available: true,
  },
  {
    id: "fries-regular",
    sku: "KFCVN-SID-015",
    name: "French Fries (R)",
    vietnameseName: "khoai tay chien",
    category: "side",
    description: "Crispy French fries, regular.",
    priceVnd: 20000,
    tags: ["fries", "khoai tay", "side"],
    options: [
      { id: "fries-large", name: "Large (L)", priceDeltaVnd: 10000, group: "size" },
      { id: "fries-jumbo", name: "Jumbo (J)", priceDeltaVnd: 20000, group: "size" },
    ],
    available: true,
  },
  {
    id: "seaweed-soup",
    sku: "KFCVN-SID-016",
    name: "Seaweed Soup",
    vietnameseName: "sup rong bien",
    category: "side",
    description: "Hot seaweed soup cup.",
    priceVnd: 20000,
    tags: ["soup", "sup", "rong bien", "warm", "am nong"],
    options: [],
    available: true,
  },
  {
    id: "coleslaw",
    sku: "KFCVN-SID-017",
    name: "Coleslaw (R)",
    vietnameseName: "salad bap cai",
    category: "side",
    description: "Chilled cabbage salad, regular.",
    priceVnd: 13000,
    tags: ["salad", "coleslaw", "bap cai", "fresh", "light"],
    options: [
      { id: "coleslaw-large", name: "Large (L)", priceDeltaVnd: 10000, group: "size" },
      { id: "coleslaw-jumbo", name: "Jumbo (J)", priceDeltaVnd: 19000, group: "size" },
    ],
    available: true,
  },
  {
    id: "egg-tart",
    sku: "KFCVN-DST-018",
    name: "1 Eggtart",
    vietnameseName: "banh trung",
    category: "dessert",
    description: "Warm flaky egg tart.",
    priceVnd: 20000,
    tags: ["egg tart", "banh trung", "dessert", "sweet"],
    options: [],
    available: true,
  },
  {
    id: "pepsi-std",
    sku: "KFCVN-DRK-019",
    name: "Pepsi (STD)",
    vietnameseName: "pepsi nho",
    category: "drink",
    description: "Standard Pepsi.",
    priceVnd: 13000,
    tags: ["pepsi", "drink", "nuoc", "soft drink"],
    options: [],
    available: true,
  },
  {
    id: "pepsi-medium",
    sku: "KFCVN-DRK-020",
    name: "Pepsi (M)",
    vietnameseName: "pepsi vua",
    category: "drink",
    description: "Medium Pepsi.",
    priceVnd: 17000,
    tags: ["pepsi", "drink", "nuoc", "soft drink"],
    options: [{ id: "drink-jumbo", name: "Jumbo (J)", priceDeltaVnd: 3000, group: "size" }],
    available: true,
  },
  {
    id: "7up-medium",
    sku: "KFCVN-DRK-021",
    name: "7Up (M)",
    vietnameseName: "7up vua",
    category: "drink",
    description: "Medium 7Up.",
    priceVnd: 17000,
    tags: ["7up", "seven up", "drink", "nuoc", "soft drink"],
    options: [{ id: "drink-jumbo", name: "Jumbo (J)", priceDeltaVnd: 3000, group: "size" }],
    available: true,
  },
  {
    id: "lipton-medium",
    sku: "KFCVN-DRK-022",
    name: "Lipton (M)",
    vietnameseName: "tra lipton",
    category: "drink",
    description: "Iced Lipton tea, medium — the hot-day pick.",
    priceVnd: 17000,
    tags: ["lipton", "tra", "tea", "iced tea", "mat lanh", "drink"],
    options: [{ id: "drink-jumbo", name: "Jumbo (J)", priceDeltaVnd: 3000, group: "size" }],
    available: true,
  },
];

export function formatVnd(amount: number) {
  return `${new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(amount)))} VND`;
}

export function createMatchId(catalogId: string) {
  return `search_menu:${CATALOG_VERSION}:${catalogId}`;
}

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u0111/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCatalogEntry(catalogId: string) {
  return MENU_CATALOG.find((item) => item.id === catalogId);
}

export function getMenuOption(item: MenuItem, optionId: string) {
  return item.options.find((option) => option.id === optionId);
}

function scoreEntry(query: string, item: MenuItem) {
  const normalizedQuery = normalizeText(query);
  const searchable = normalizeText(
    [item.name, item.vietnameseName, item.description, item.category, ...item.tags].join(" "),
  );

  if (!normalizedQuery) return item.popular ? 3 : 1;

  let score = 0;
  if (searchable.includes(normalizedQuery)) score += 8;

  for (const token of normalizedQuery.split(" ")) {
    if (token.length < 2) continue;
    if (searchable.includes(token)) score += 2;
  }

  if (normalizedQuery.includes("combo") && item.category === "combo") score += 4;
  if ((normalizedQuery.includes("nhom") || normalizedQuery.includes("family")) && item.id.includes("family")) score += 4;
  if ((normalizedQuery.includes("4") || normalizedQuery.includes("bon nguoi")) && item.id.includes("family-4")) score += 3;
  if ((normalizedQuery.includes("party") || normalizedQuery.includes("6 nguoi")) && item.id.includes("party-6")) score += 6;
  // "com" as a word means rice — and substring-matches "COMbo", so rice dishes
  // need the explicit boost to beat combos on rice queries.
  if (/(^| )com( |$)/.test(normalizedQuery) && item.category === "rice") score += 5;
  if ((normalizedQuery.includes("mi y") || normalizedQuery.includes("pasta")) && item.id.includes("pasta")) score += 5;
  if ((normalizedQuery.includes("burger") || normalizedQuery.includes("zinger")) && item.category === "burger") score += 3;
  if ((normalizedQuery.includes("pepsi") || normalizedQuery.includes("nuoc")) && item.category === "drink") score += 3;
  if ((normalizedQuery.includes("khong cay") || normalizedQuery.includes("not spicy")) && item.tags.includes("spicy")) score += 1;

  return score;
}

export function toMenuMatch(item: MenuItem, score = 1): MenuMatch {
  return {
    source: "search_menu",
    matchId: createMatchId(item.id),
    catalogId: item.id,
    sku: item.sku,
    name: item.name,
    vietnameseName: item.vietnameseName,
    category: item.category,
    description: item.description,
    priceVnd: item.priceVnd,
    displayPrice: formatVnd(item.priceVnd),
    tags: item.tags,
    options: item.options,
    score,
  };
}

function searchWithCatalog(catalog: MenuItem[], query: string, limit: number): MenuSearchResult {
  const matches = catalog
    .filter((item) => item.available)
    .map((item) => ({ item, score: scoreEntry(query, item) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.item.popular)) - Number(Boolean(a.item.popular)))
    .slice(0, limit)
    .map(({ item, score }) => toMenuMatch(item, score));

  return {
    query,
    matches,
    catalogVersion: CATALOG_VERSION,
  };
}

/** Synchronous, in-memory search — used by tests, the eval, and as the fallback. */
export function searchMenu(query: string, limit = 6): MenuSearchResult {
  return searchWithCatalog(MENU_CATALOG, query, limit);
}

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

type MenuRow = {
  id: string;
  sku: string;
  name: string;
  vietnamese_name: string;
  category: MenuCategory;
  description: string;
  price_vnd: number;
  tags: string[] | null;
  options: MenuOption[] | null;
  is_active: boolean;
};

function rowToMenuItem(row: MenuRow): MenuItem {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    vietnameseName: row.vietnamese_name,
    category: row.category,
    description: row.description,
    priceVnd: row.price_vnd,
    tags: row.tags ?? [],
    options: row.options ?? [],
    available: row.is_active,
  };
}

/**
 * Load the catalog from Supabase when configured, otherwise the in-memory
 * catalog. The seed (db/seed.ts) pushes MENU_CATALOG verbatim into kfc_menu, so
 * the two stay in sync and catalogId/matchId validation still holds.
 */
export async function loadCatalog(): Promise<{ catalog: MenuItem[]; source: "supabase" | "memory" }> {
  if (!hasSupabaseEnv()) return { catalog: MENU_CATALOG, source: "memory" };
  try {
    const { supabaseAdmin } = await import("./supabase");
    const { data, error } = await supabaseAdmin()
      .from("kfc_menu")
      .select("id, sku, name, vietnamese_name, category, description, price_vnd, tags, options, is_active")
      .eq("is_active", true);
    if (error || !data?.length) return { catalog: MENU_CATALOG, source: "memory" };
    return { catalog: (data as MenuRow[]).map(rowToMenuItem), source: "supabase" };
  } catch {
    return { catalog: MENU_CATALOG, source: "memory" };
  }
}

/** Supabase-backed search with an automatic in-memory fallback. */
export async function searchMenuGrounded(
  query: string,
  limit = 6,
): Promise<MenuSearchResult & { source: "supabase" | "memory" }> {
  const { catalog, source } = await loadCatalog();
  return { ...searchWithCatalog(catalog, query, limit), source };
}
