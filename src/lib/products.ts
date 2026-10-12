import { getCollection } from 'astro:content';
import ebayProducts from '../data/ebay-products.json';

/** Where a catalogue item came from. */
export type ProductSource = 'eBay' | 'Direct';

/** A purchasable option on a Direct product (size / voltage / finish …). */
export interface StoreVariant {
  /** e.g. "14V / 75 AMP" */
  optionName: string;
  sku: string;
  price: number | null;
  /** Pre-formatted, e.g. "$99.50". */
  priceLabel: string | null;
  stock: number | null;
}

/**
 * The single shape both sources are normalised into, so the catalogue and the
 * product pages never need to care where an item came from.
 */
export interface StoreProduct {
  /** URL segment for /products/<id>. */
  id: string;
  sku: string;
  title: string;
  source: ProductSource;
  price: number | null;
  currency: string;
  /** Pre-formatted, e.g. "$414.28". */
  priceLabel: string;
  image: string | null;
  images: string[];
  /** External listing, when there is one. */
  url: string | null;
  brand: string | null;
  condition: string | null;
  mpn: string | null;
  category: string | null;
  stock: number | null;
  specifics: Record<string, string>;
  description: string;
  /** eBay descriptions are legacy HTML; Direct ones are plain text. */
  descriptionIsHtml: boolean;
  variants: StoreVariant[];
}

/** Shape of one record in src/data/ebay-products.json. */
interface EbayProduct {
  id: string;
  sku: string;
  title: string;
  price?: number | null;
  currency?: string | null;
  image?: string | null;
  images?: string[] | null;
  url?: string | null;
  condition?: string | null;
  brand?: string | null;
  mpn?: string | null;
  category?: string | null;
  estimated_quantity?: number | null;
  specifics?: Record<string, string> | null;
  description?: string | null;
}

/** Format a numeric price + ISO currency code into a display string. */
export function formatPrice(price: unknown, currency: unknown): string {
  const amount = typeof price === 'number' ? price : Number(price);
  if (!Number.isFinite(amount)) return 'Contact for price';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: typeof currency === 'string' && currency ? currency : 'USD',
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/**
 * Everything a buyer might paste into the search box: title, SKU, MPN and the
 * interchange / OE / OEM reference numbers that live in `specifics`.
 * Lower-cased once, at build time.
 */
export function buildSearchIndex(product: StoreProduct): string {
  const s = product.specifics;
  return [
    product.title,
    product.sku,
    product.id,
    product.mpn,
    product.brand,
    ...product.variants.flatMap((variant) => [variant.optionName, variant.sku]),
    s['Interchange Part Number'],
    s['OE/OEM Part Number'],
    s['Reference OE/OEM Number'],
    s['Manufacturer Part Number'],
    s['Other Part Number'],
    s['Superseded Part Number'],
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function toNullableNumber(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function fromEbay(raw: EbayProduct): StoreProduct {
  const images = (raw.images?.length ? raw.images : [raw.image]).filter(
    (src): src is string => Boolean(src)
  );

  return {
    id: raw.id,
    sku: raw.sku,
    title: raw.title,
    source: 'eBay',
    price: toNullableNumber(raw.price),
    currency: raw.currency || 'USD',
    priceLabel: formatPrice(raw.price, raw.currency),
    image: raw.image ?? null,
    images,
    url: raw.url ?? null,
    brand: raw.brand ?? null,
    condition: raw.condition ?? null,
    mpn: raw.mpn ?? null,
    category: raw.category ?? null,
    stock: toNullableNumber(raw.estimated_quantity),
    specifics: raw.specifics ?? {},
    description: raw.description ?? '',
    descriptionIsHtml: true,
    variants: [],
  };
}

async function fromDirect(): Promise<StoreProduct[]> {
  const entries = await getCollection('products');

  return entries.map((entry) => {
    const data = entry.data;

    const variants: StoreVariant[] = data.variants.map((variant) => ({
      optionName: variant.variant_option_name,
      sku: variant.variant_sku,
      price: variant.variant_price,
      priceLabel: formatPrice(variant.variant_price, 'USD'),
      stock: variant.variant_stock,
    }));

    // With options on offer the headline figure is the cheapest one — and the
    // stock belongs to the options rather than to the parent record.
    const variantPrices = variants
      .map((variant) => variant.price)
      .filter((price): price is number => price !== null);
    const lowestVariantPrice = variantPrices.length ? Math.min(...variantPrices) : null;
    const highestVariantPrice = variantPrices.length ? Math.max(...variantPrices) : null;

    const price = data.price > 0 ? data.price : lowestVariantPrice;
    const priceLabel =
      lowestVariantPrice !== null &&
      highestVariantPrice !== null &&
      lowestVariantPrice !== highestVariantPrice
        ? `From ${formatPrice(lowestVariantPrice, 'USD')}`
        : formatPrice(price, 'USD');

    const variantStock = variants.reduce((total, variant) => total + (variant.stock ?? 0), 0);
    const stock = data.stock > 0 ? data.stock : variants.length > 0 ? variantStock : 0;

    return {
      id: entry.id,
      sku: data.sku,
      title: data.title,
      source: 'Direct',
      price,
      currency: 'USD',
      priceLabel,
      image: null,
      images: [],
      url: null,
      brand: null,
      condition: null,
      mpn: null,
      category: null,
      stock,
      specifics: {},
      description: data.description,
      descriptionIsHtml: false,
      variants,
    };
  });
}

/**
 * The full catalogue: every eBay-synced listing plus every hand-managed Direct
 * product from Sveltia CMS.
 *
 * eBay ids are generated from the listing id and are always authoritative, so if
 * a Direct product re-uses one it is skipped rather than producing a duplicate
 * (and an ambiguous route).
 */
export async function getAllProducts(): Promise<StoreProduct[]> {
  const ebay = (ebayProducts as EbayProduct[]).map(fromEbay);
  const direct = await fromDirect();

  const takenIds = new Set(ebay.map((product) => product.id));
  const uniqueDirect = direct.filter((product) => !takenIds.has(product.id));

  return [...ebay, ...uniqueDirect];
}
