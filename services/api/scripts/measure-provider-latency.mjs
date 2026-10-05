#!/usr/bin/env node
/**
 * W1-C C3 — the latency harness. Vendor-neutral, and it opens no account.
 *
 * **Why this exists.** Latency is one of the four criteria the operator named in `R10`, and
 * `docs/ai-platform/PROVIDER-SHORTLIST.md` marks it **UNVERIFIED for every candidate** — five of its
 * seventeen gaps. It is the one criterion that cannot be answered by reading documentation, because
 * the number depends on the network between an Indian phone and an Indian region, and nobody can
 * look that up.
 *
 * **What it is NOT.** It does not choose a vendor, name a vendor, or sign anything up. It is
 * configured entirely by environment variables, so the repository still names no provider (`C31`).
 *
 * **What to measure, and why these numbers rather than an average.**
 *
 * | Statistic | Why |
 * | --- | --- |
 * | **p50** | what a rep usually waits |
 * | **p95** | what a rep sometimes waits, which is what they will complain about |
 * | **max** | whether the 20 s gateway timeout (`product-qa.ts`) is anywhere near being hit |
 * | **time to first byte** | for a streamed answer, the only number a rep actually perceives |
 *
 * **A mean is deliberately not reported.** One 9-second outlier in twenty calls moves a mean by
 * half a second and moves p95 to 9 seconds, and the second number is the one that decides whether a
 * rep standing outside a clinic abandons the screen.
 *
 * ## Running it
 *
 * ```bash
 * PROVIDER_NAME=whoever \
 * PROVIDER_URL=https://<endpoint> \
 * PROVIDER_AUTH="Bearer $KEY" \
 * PROVIDER_BODY='{"model":"...","messages":[{"role":"user","content":"__PROMPT__"}]}' \
 * node services/api/scripts/measure-provider-latency.mjs
 * ```
 *
 * `__PROMPT__` in `PROVIDER_BODY` is replaced with a fixed, realistic product question. It is the
 * same prompt for every candidate, because comparing vendors on different prompts measures the
 * prompts.
 *
 * **Where it must be run from, and this is the part that is easy to get wrong.** A latency figure
 * measured from a laptop in one country to a region in another answers nothing. **Run it from inside
 * the target region** — a small VM in `ap-south-1`, or the Supabase Edge Function itself once a
 * vendor exists — and say in the result where it ran. A number without a location is not a
 * measurement.
 */

const REQUIRED = ['PROVIDER_NAME', 'PROVIDER_URL', 'PROVIDER_BODY'];

/**
 * The fixed prompt. Deliberately a real product question of realistic length: a two-word prompt
 * measures the network and a 4,000-token prompt measures the vendor's prefill, and `product_qa`
 * sends neither.
 */
const PROMPT =
  'A doctor asks about storage conditions for a tablet formulation in a humid climate. ' +
  'Answer only from approved sources, in three sentences, and name the sources you used.';

const CALLS = Number(process.env['PROVIDER_CALLS'] ?? '20');

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  // Nearest-rank. With 20 samples p95 is the 19th, which is honest about the sample size rather
  // than interpolating a number no call produced.
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
};

const main = async () => {
  const missing = REQUIRED.filter((k) => (process.env[k] ?? '') === '');
  if (missing.length > 0) {
    // Refuses loudly and says exactly what it needs. It does not fall back to a default endpoint,
    // because a default endpoint is a vendor choice and `#5` is open.
    console.error(`measure-provider-latency: not run. Missing: ${missing.join(', ')}`);
    console.error('');
    console.error('This harness is written and unused ON PURPOSE. Decision #5 (which AI provider,');
    console.error('and may data leave India) is open, so no key exists and no vendor is named in');
    console.error('this repository. Set the four variables above and it runs unchanged.');
    console.error('');
    console.error('Run it FROM INSIDE the target region. A latency number without a location is');
    console.error('not a measurement.');
    process.exit(2);
  }

  const url = process.env['PROVIDER_URL'];
  const name = process.env['PROVIDER_NAME'];
  const body = process.env['PROVIDER_BODY'].replace('__PROMPT__', PROMPT);
  const headers = { 'content-type': 'application/json' };
  const auth = process.env['PROVIDER_AUTH'] ?? '';
  if (auth !== '') headers['authorization'] = auth;

  const totals = [];
  const firstBytes = [];
  let failures = 0;

  for (let i = 0; i < CALLS; i += 1) {
    const started = performance.now();
    let firstByteAt = null;
    try {
      const response = await fetch(url, { method: 'POST', headers, body });
      // Read the stream so time-to-first-byte is real rather than the time to get headers back.
      if (response.body !== null) {
        const reader = response.body.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (firstByteAt === null) firstByteAt = performance.now();
          if (done) break;
        }
      }
      const total = performance.now() - started;
      if (!response.ok) {
        failures += 1;
        console.error(
          `  call ${String(i + 1)}: HTTP ${String(response.status)} after ${total.toFixed(0)} ms`,
        );
        continue;
      }
      totals.push(total);
      if (firstByteAt !== null) firstBytes.push(firstByteAt - started);
      process.stderr.write(`  call ${String(i + 1)}/${String(CALLS)}: ${total.toFixed(0)} ms\n`);
    } catch (error) {
      failures += 1;
      console.error(
        `  call ${String(i + 1)}: ${error instanceof Error ? error.message : 'failed'}`,
      );
    }
  }

  const sortedTotals = [...totals].sort((a, b) => a - b);
  const sortedFirst = [...firstBytes].sort((a, b) => a - b);
  const ms = (n) => (n === null ? null : Math.round(n));

  // JSON, so a result can be pasted into the shortlist without being retyped.
  console.log(
    JSON.stringify(
      {
        provider: name,
        measuredAt: new Date().toISOString(),
        // The one field a human must fill in. Left explicitly null rather than guessed, because
        // the script cannot know where it is running and a wrong location invalidates the numbers.
        measuredFrom: process.env['PROVIDER_REGION'] ?? null,
        calls: CALLS,
        succeeded: totals.length,
        failed: failures,
        totalMs: {
          p50: ms(percentile(sortedTotals, 50)),
          p95: ms(percentile(sortedTotals, 95)),
          max: ms(sortedTotals[sortedTotals.length - 1] ?? null),
        },
        timeToFirstByteMs: {
          p50: ms(percentile(sortedFirst, 50)),
          p95: ms(percentile(sortedFirst, 95)),
        },
        // The gateway aborts at 20 s (`packages/core/src/field/gateway/product-qa.ts`). A p95 near
        // that is a product problem, not a tuning one.
        gatewayTimeoutMs: 20_000,
      },
      null,
      2,
    ),
  );

  if (totals.length === 0) process.exit(1);
};

await main();
