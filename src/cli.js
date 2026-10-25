#!/usr/bin/env node
// Usage: node src/cli.js <inventory|plan|apply|validate> --spec <file> [--limit N] [--go] [--writer nodes-api]
// Prints short summaries only. Full detail goes to out/<spec>/ files, which Claude should not read in bulk.

import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { MagnoliaClient, propValue } from './client.js';
import { loadSpec } from './spec.js';
import { planPage, summarize } from './transform.js';
import { writers } from './writers/nodes-api.js';

// ADR-0001 writer selection rule thresholds.
const MAX_CALLS_PER_PAGE = 20;
const MAX_HOURS_PER_1000 = 2;
const PAGE_DEPTH = 20;

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    spec: { type: 'string' },
    limit: { type: 'string' },
    go: { type: 'boolean', default: false },
    writer: { type: 'string', default: 'nodes-api' },
  },
});

const command = positionals[0];
if (!command || !args.spec) {
  console.error('Usage: node src/cli.js <inventory|plan|apply|validate> --spec <file> [--limit N] [--go]');
  process.exit(2);
}

const spec = loadSpec(args.spec);
const ws = spec.from.workspace;
const outDir = join('out', spec.name);
mkdirSync(join(outDir, 'plan'), { recursive: true });
const client = new MagnoliaClient();
const fileFor = (path) => join(outDir, 'plan', (path.replace(/^\//, '').replace(/\//g, '__') || 'root') + '.json');
const save = (name, data) => writeFileSync(join(outDir, name), JSON.stringify(data, null, 2));
const load = (name) => JSON.parse(readFileSync(join(outDir, name), 'utf8'));

async function inventory() {
  const pages = [];
  async function visit(path) {
    const node = await client.getNode(ws, path, 1);
    for (const child of node.children) {
      if (child.type !== 'mgnl:page') continue;
      pages.push({ path: child.path, template: propValue(child, 'mgnl:template') ?? null });
      await visit(child.path);
    }
  }
  await visit(spec.from.root);
  save('inventory.json', pages);
  const counts = {};
  for (const p of pages) counts[p.template] = (counts[p.template] ?? 0) + 1;
  console.log(`Inventory under ${ws}:${spec.from.root}: ${pages.length} pages`);
  for (const [tpl, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${tpl}`);
  console.log(`\nA (${spec.from.template}): ${counts[spec.from.template] ?? 0} pages · B (${spec.to.template}): ${counts[spec.to.template] ?? 0} pages`);
}

async function plan() {
  if (!existsSync(join(outDir, 'inventory.json'))) await inventory();
  let targets = load('inventory.json').filter((p) => p.template === spec.from.template || p.template === spec.to.template);
  if (args.limit) targets = targets.slice(0, Number(args.limit));
  // apply writes every file in plan/, so clear old plans: apply must match this dry run only.
  rmSync(join(outDir, 'plan'), { recursive: true, force: true });
  mkdirSync(join(outDir, 'plan'), { recursive: true });
  const plans = [];
  for (const t of targets) {
    const page = await client.getNode(ws, t.path, PAGE_DEPTH);
    const p = planPage(page, spec);
    plans.push(p);
    writeFileSync(fileFor(p.path), JSON.stringify(p, null, 2));
  }
  const s = summarize(plans);
  save('summary.json', s);
  save('exceptions.json', plans.filter((p) => p.status === 'exception').map(({ path, reasons }) => ({ path, reasons })));
  console.log(`DRY RUN ${spec.from.template} -> ${spec.to.template}`);
  console.log(`  pages: ${s.total} · clean: ${s.clean} · already migrated: ${s.already} · exceptions: ${s.exception}`);
  console.log(`  planned writes: ${s.ops} ops · no AI per page: ${s.total ? Math.round(((s.clean + s.already) / s.total) * 100) : 0}%`);
  for (const [r, n] of Object.entries(s.exceptionReasons)) console.log(`  exception x${n}: ${r}`);
  console.log(`\nNothing has been written. Review out/${spec.name}/, then run apply with --go.`);
}

async function apply() {
  if (!args.go) {
    console.error('Refusing to write without --go. Run plan first and get approval.');
    process.exit(1);
  }
  const writer = writers[args.writer];
  if (!writer) throw new Error(`Unknown writer ${args.writer}. Available: ${Object.keys(writers).join(', ')}`);
  const plans = readdirSync(join(outDir, 'plan')).map((f) => JSON.parse(readFileSync(join(outDir, 'plan', f), 'utf8'))).filter((p) => p.status === 'clean');
  const log = [];
  const started = Date.now();
  const callsBefore = client.calls;
  for (const p of plans) {
    const t0 = Date.now();
    const c0 = client.calls;
    try {
      // Guard against a stale plan: only write if the page is still on template A.
      const now = await client.getNode(ws, p.path, 0);
      if (propValue(now, 'mgnl:template') !== spec.from.template) {
        log.push({ path: p.path, result: 'skipped-stale' });
        continue;
      }
      await writer.applyPlan(p, client, ws);
      log.push({ path: p.path, result: 'written', calls: client.calls - c0, ms: Date.now() - t0 });
    } catch (e) {
      log.push({ path: p.path, result: 'failed', error: String(e.message).slice(0, 300) });
    }
  }
  save('apply-log.json', log);
  const written = log.filter((l) => l.result === 'written');
  const seconds = (Date.now() - started) / 1000;
  const callsPerPage = written.length ? (client.calls - callsBefore) / written.length : 0;
  const hoursPer1000 = written.length ? (seconds / written.length) * 1000 / 3600 : 0;
  console.log(`APPLY with writer ${writer.name}`);
  console.log(`  written: ${written.length} · failed: ${log.filter((l) => l.result === 'failed').length} · skipped (stale): ${log.filter((l) => l.result === 'skipped-stale').length}`);
  console.log(`  calls/page: ${callsPerPage.toFixed(1)} (rule: <= ${MAX_CALLS_PER_PAGE}) · projected 1,000 pages: ${hoursPer1000.toFixed(2)} h (rule: <= ${MAX_HOURS_PER_1000} h)`);
  if (callsPerPage > MAX_CALLS_PER_PAGE || hoursPer1000 > MAX_HOURS_PER_1000) console.log('  -> ADR-0001 writer rule fires: consider the helper endpoint writer.');
}

async function validate() {
  const log = load('apply-log.json').filter((l) => l.result === 'written');
  const results = [];
  for (const l of log) {
    const node = await client.getNode(ws, l.path, 0);
    const template = propValue(node, 'mgnl:template');
    const status = await client.renderStatus(l.path);
    results.push({ path: l.path, template, onB: template === spec.to.template, render: status });
  }
  save('validate.json', results);
  const bad = results.filter((r) => !r.onB || r.render !== 200);
  console.log(`VALIDATE: ${results.length} pages · on B: ${results.filter((r) => r.onB).length} · render 200: ${results.filter((r) => r.render === 200).length}`);
  for (const r of bad.slice(0, 10)) console.log(`  problem: ${r.path} template=${r.template} render=${r.render}`);
}

const commands = { inventory, plan, apply, validate };
if (!commands[command]) {
  console.error(`Unknown command ${command}`);
  process.exit(2);
}
commands[command]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
