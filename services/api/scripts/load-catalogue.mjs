#!/usr/bin/env node
/**
 * W2-I A — the catalogue loader: a company's markets and products, from a file. The course and
 * approved-material loaders name a market and a product and refuse until they exist; until this,
 * nothing in the repository created them. Copy `docs/operator/catalogue-template.md`.
 *
 * **The shape, from `20260924000400_catalogue.sql`.** A MARKET is one country (ISO code, two capital
 * letters) with a name, one per country per company. A PRODUCT is a brand name, optionally a generic
 * name and a therapy area, and the markets it is sold in. **Identity only** — no indication, dose or
 * claim; those are approved material.
 *
 *   ---
 *   catalogue: Acme Pharma, October 2026
 *   ---
 *   ## Markets
 *   IN | India
 *   ## Products
 *   Benchmarol | benchmarolum | Pain | IN
 *        brand | generic (may be empty) | therapy area (may be empty) | market codes, comma-separated
 *
 * **What it refuses, by line, before anything is written** (`checkCatalogue`): missing_header /
 * bad_header_line, missing_field (catalogue), example_content (starts EXAMPLE), unknown_section,
 * stray_text, bad_market_line, bad_country_code, empty_name, duplicate_market (a code or a name twice),
 * bad_product_line, duplicate_product (a brand or generic name used twice — the other loaders find a
 * product by either, so a clash would make it ambiguous), nothing_to_load;
 * and, signed in: not_admin, market_differs (the company already has that code under another name, or
 * that name under another code), product_differs (that brand with another generic name), name_clash
 * (a name already used by a different product), inactive (it exists and is retired), unknown_market (a
 * product sold in a code neither the file nor the company has).
 *
 * **Re-running is safe, and that is the recovery.** A row the company already holds, exactly as the
 * file says, is left alone and counted; only what is missing is written. Catalogue rows cannot be
 * deleted (no grant allows it — history points at them), so a load that fails part-way is finished
 * by running it again, never by cleaning up.
 *
 *   node services/api/scripts/load-catalogue.mjs <file.md>                 check only, offline
 *   LOADER_PASSWORD=… node services/api/scripts/load-catalogue.mjs <file.md> --write \
 *     --url http://127.0.0.1:54321 --key <publishable key> --email admin@company
 */
import { readFileSync } from 'node:fs';
import {
  formatProblems,
  isExample,
  restClient,
  signIn,
  splitHeader,
  whoAmI,
} from './content-loader.mjs';

const SECTIONS = { markets: 'markets', products: 'products' };
const lower = (s) => s.trim().toLowerCase();
const cells = (raw) => raw.split('|').map((c) => c.trim());
const isCode = (s) => /^[A-Z]{2}$/u.test(s);

/**
 * Parse and check a catalogue file. Pure: every refusal, by line. No network.
 * @param {string} text
 */
export const checkCatalogue = (text) => {
  const { header, body, bodyStartLine, problems } = splitHeader(text);
  const catalogue = { title: header['catalogue']?.value ?? '', markets: [], products: [] };
  if (problems.some((p) => p.code === 'missing_header')) return { catalogue, problems };
  if (catalogue.title === '') {
    problems.push({ code: 'missing_field', line: 1, detail: 'no "catalogue:" in the header' });
  } else if (isExample(catalogue.title)) {
    problems.push({
      code: 'example_content',
      line: header['catalogue']?.line ?? 1,
      detail: `"${catalogue.title}" is the template's example — load your company's catalogue, not the sample`,
    });
  }

  let section = null;
  const codes = new Map();
  const marketNames = new Map();
  const productNames = new Map();
  body.split(/\r?\n/).forEach((raw, i) => {
    const line = bodyStartLine + i;
    const text = raw.trim();
    // A line starting with ONE "#" is the operator's note; "##" starts a section.
    if (text === '' || /^#(?!#)/u.test(text)) return;
    const heading = /^##\s+(.*)$/u.exec(text);
    if (heading !== null) {
      section = SECTIONS[lower(heading[1] ?? '')] ?? null;
      if (section === null)
        problems.push({
          code: 'unknown_section',
          line,
          detail: `"${text}" — the sections are "## Markets" and "## Products"`,
        });
      return;
    }
    if (section === null) {
      problems.push({
        code: 'stray_text',
        line,
        detail: `"${text}" is not under "## Markets" or "## Products"`,
      });
      return;
    }
    const parts = cells(text);
    if (section === 'markets') {
      if (parts.length !== 2) {
        problems.push({ code: 'bad_market_line', line, detail: `"${text}" is not "CODE | name"` });
        return;
      }
      const [code = '', name = ''] = parts;
      if (!isCode(code))
        problems.push({
          code: 'bad_country_code',
          line,
          detail: `"${code}" is not a two-letter country code in capitals (IN, LK, …)`,
        });
      if (name === '')
        problems.push({ code: 'empty_name', line, detail: 'the market has no name' });
      if (codes.has(code) || (name !== '' && marketNames.has(lower(name)))) {
        problems.push({
          code: 'duplicate_market',
          line,
          detail: `"${text}" repeats line ${String(codes.get(code) ?? marketNames.get(lower(name)))}`,
        });
        return;
      }
      codes.set(code, line);
      if (name !== '') marketNames.set(lower(name), line);
      catalogue.markets.push({ code, name, line });
      return;
    }
    if (parts.length > 4) {
      problems.push({
        code: 'bad_product_line',
        line,
        detail: `"${text}" has more than "brand | generic | therapy area | markets"`,
      });
      return;
    }
    const [brand = '', generic = '', area = '', sold = ''] = parts;
    if (brand === '') {
      problems.push({ code: 'empty_name', line, detail: 'the product has no brand name' });
      return;
    }
    const markets = sold === '' ? [] : sold.split(',').map((c) => c.trim());
    for (const code of markets) {
      if (!isCode(code))
        problems.push({
          code: 'bad_country_code',
          line,
          detail: `"${code}" is not a two-letter country code in capitals`,
        });
    }
    const names = [brand, generic].filter((n) => n !== '');
    const clash = names.find((n) => productNames.has(lower(n)));
    if (clash !== undefined) {
      problems.push({
        code: 'duplicate_product',
        line,
        detail: `"${clash}" is already used on line ${String(productNames.get(lower(clash)))} — a product is found by brand OR generic name, so each must be unique`,
      });
      return;
    }
    for (const n of names) productNames.set(lower(n), line);
    catalogue.products.push({ brand, generic, area, markets, line });
  });
  // Only when nothing else is wrong: a file of bad lines has nothing to load, and saying so buries why.
  if (problems.length === 0 && catalogue.markets.length === 0 && catalogue.products.length === 0) {
    problems.push({
      code: 'nothing_to_load',
      line: 1,
      detail: 'no markets and no products under "## Markets" / "## Products"',
    });
  }
  return { catalogue, problems };
};

/**
 * Check against the company, then write only what it does not already hold. Throws on any refusal;
 * writes NOTHING unless every check passed.
 */
export const loadCatalogue = async (catalogue, { url, apiKey, email, password, fetchImpl }) => {
  const session = await signIn({ url, apiKey, email, password, fetchImpl });
  const rest = restClient({ url, apiKey, token: session.token, fetchImpl });
  const problems = [];
  const me = await whoAmI(rest, session.userId);
  if (me?.role !== 'admin') {
    const error = new Error(
      `NOTHING WRITTEN. Refused:\n${formatProblems([{ code: 'not_admin', line: 1, detail: `${email} is not an admin of a company — only an admin writes the catalogue` }])}`,
    );
    error.problems = [{ code: 'not_admin', line: 1, detail: `${email} is not an admin` }];
    throw error;
  }

  const heldMarkets = await rest.get('markets?select=id,country_code,name,is_active');
  const heldProducts = await rest.get('products?select=id,brand_name,generic_name,is_active');
  const heldAreas = await rest.get('therapy_areas?select=id,name,is_active');
  const heldLinks = await rest.get('product_markets?select=product_id,market_id');

  const newMarkets = [];
  for (const m of catalogue.markets) {
    const byCode = heldMarkets.find((h) => h.country_code === m.code);
    const byMarketName = heldMarkets.find((h) => lower(String(h.name)) === lower(m.name));
    if (byCode === undefined && byMarketName === undefined) {
      newMarkets.push(m);
    } else if (byCode === undefined || byCode !== byMarketName) {
      const h = byCode ?? byMarketName;
      problems.push({
        code: 'market_differs',
        line: m.line,
        detail: `your company already has ${String(h.country_code)} | ${String(h.name)}; the file says ${m.code} | ${m.name}`,
      });
    } else if (byCode.is_active !== true) {
      problems.push({
        code: 'inactive',
        line: m.line,
        detail: `market ${m.code} exists and is retired — reactivate it in the console, not by loading`,
      });
    }
  }

  const productNamesHeld = (h) =>
    [h.brand_name, h.generic_name].filter(Boolean).map((n) => lower(String(n)));
  const newProducts = [];
  for (const p of catalogue.products) {
    const same = heldProducts.find((h) => lower(String(h.brand_name)) === lower(p.brand));
    if (same !== undefined) {
      if (lower(String(same.generic_name ?? '')) !== lower(p.generic)) {
        problems.push({
          code: 'product_differs',
          line: p.line,
          detail: `your company already has ${p.brand} with generic name "${String(same.generic_name ?? '')}"; the file says "${p.generic}"`,
        });
      } else if (same.is_active !== true) {
        problems.push({
          code: 'inactive',
          line: p.line,
          detail: `product ${p.brand} exists and is retired — reactivate it in the console, not by loading`,
        });
      }
    } else {
      newProducts.push(p);
    }
    for (const n of [p.brand, p.generic].filter((x) => x !== '')) {
      const other = heldProducts.find((h) => h !== same && productNamesHeld(h).includes(lower(n)));
      if (other !== undefined)
        problems.push({
          code: 'name_clash',
          line: p.line,
          detail: `"${n}" is already a name of your product ${String(other.brand_name)}`,
        });
    }
    for (const code of p.markets) {
      if (
        !catalogue.markets.some((m) => m.code === code) &&
        !heldMarkets.some((h) => h.country_code === code)
      )
        problems.push({
          code: 'unknown_market',
          line: p.line,
          detail: `${p.brand} is sold in ${code}, which is neither in this file nor in your company`,
        });
    }
  }
  if (problems.length > 0) {
    const error = new Error(`NOTHING WRITTEN. Refused:\n${formatProblems(problems)}`);
    error.problems = problems;
    throw error;
  }

  // organisation_id defaults to the caller's company (markets, areas, products) or is derived from the
  // product by trigger (product_markets); RLS checks it either way.
  const marketIds = new Map(heldMarkets.map((h) => [h.country_code, h.id]));
  for (const m of newMarkets) {
    marketIds.set(
      m.code,
      (await rest.insert('markets', { country_code: m.code, name: m.name })).id,
    );
  }
  const areaIds = new Map(heldAreas.map((h) => [lower(String(h.name)), h.id]));
  let areasCreated = 0;
  const productIds = new Map(heldProducts.map((h) => [lower(String(h.brand_name)), h.id]));
  for (const p of newProducts) {
    let areaId = null;
    if (p.area !== '') {
      areaId = areaIds.get(lower(p.area)) ?? null;
      if (areaId === null) {
        areaId = (await rest.insert('therapy_areas', { name: p.area })).id;
        areaIds.set(lower(p.area), areaId);
        areasCreated += 1;
      }
    }
    const row = await rest.insert('products', {
      brand_name: p.brand,
      generic_name: p.generic === '' ? null : p.generic,
      therapy_area_id: areaId,
    });
    productIds.set(lower(p.brand), row.id);
  }
  let linksCreated = 0;
  for (const p of catalogue.products) {
    const productId = productIds.get(lower(p.brand));
    for (const code of p.markets) {
      const marketId = marketIds.get(code);
      if (heldLinks.some((l) => l.product_id === productId && l.market_id === marketId)) continue;
      await rest.insert('product_markets', {
        product_id: productId,
        market_id: marketId,
        organisation_id: me.organisation_id,
      });
      linksCreated += 1;
    }
  }
  return {
    marketsCreated: newMarkets.length,
    marketsAlreadyHeld: catalogue.markets.length - newMarkets.length,
    productsCreated: newProducts.length,
    productsAlreadyHeld: catalogue.products.length - newProducts.length,
    therapyAreasCreated: areasCreated,
    linksCreated,
  };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const opt = (name) => args[args.indexOf(name) + 1];
  if (file === undefined) {
    console.error(
      'usage: load-catalogue.mjs <file.md> [--write --url <url> --key <publishable key> --email <admin>]',
    );
    process.exit(2);
  }
  const { catalogue, problems } = checkCatalogue(readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    console.error(
      `NOTHING WRITTEN. ${file} has ${String(problems.length)} problem(s):\n${formatProblems(problems)}`,
    );
    process.exit(1);
  }
  if (!args.includes('--write')) {
    console.log(
      `${file} is loadable: ${String(catalogue.markets.length)} market(s), ${String(catalogue.products.length)} product(s). Nothing written (no --write).`,
    );
    process.exit(0);
  }
  const password = process.env.LOADER_PASSWORD;
  if (password === undefined || password === '') {
    console.error(
      'LOADER_PASSWORD is not set. The admin password is read from the environment only.',
    );
    process.exit(2);
  }
  try {
    const out = await loadCatalogue(catalogue, {
      url: opt('--url'),
      apiKey: opt('--key'),
      email: opt('--email'),
      password,
    });
    console.log(
      `Written: ${String(out.marketsCreated)} market(s), ${String(out.productsCreated)} product(s), ${String(out.therapyAreasCreated)} therapy area(s), ${String(out.linksCreated)} product-market link(s). Already held, left alone: ${String(out.marketsAlreadyHeld)} market(s), ${String(out.productsAlreadyHeld)} product(s).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
