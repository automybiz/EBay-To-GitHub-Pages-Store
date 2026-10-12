import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Direct inventory, managed through Sveltia CMS (`/admin/`).
 *
 * Sveltia writes one Markdown file per product into `src/content/products/`,
 * named after the SKU, with every field held in the front matter. eBay-synced
 * inventory lives separately in `src/data/ebay-products.json`; see
 * `src/lib/products.ts` for how the two are merged.
 */
const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: z.object({
    title: z.string(),
    sku: z.string(),
    description: z.string().default(''),
    price: z.coerce.number().nonnegative().default(0),
    stock: z.coerce.number().int().nonnegative().default(0),
    /**
     * Optional options — sizes, voltages, finishes … — each with its own SKU,
     * price and stock. Rendered as a selector on the product page.
     */
    variants: z
      .array(
        z.object({
          variant_option_name: z.string(),
          variant_sku: z.string(),
          variant_price: z.coerce.number().nonnegative().default(0),
          variant_stock: z.coerce.number().int().nonnegative().default(0),
        })
      )
      .default([]),
  }),
});

export const collections = { products };
