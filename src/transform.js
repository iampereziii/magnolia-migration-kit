// Pure transform: (page tree, mapping spec) -> plan for that page.
// No I/O, so it is unit-tested and its output is the reviewable dry run.
//
// The POC only does in-place changes (template swaps, property set/rename/drop) on existing
// nodes, so node identifiers are always kept. Anything that needs a move (area renames,
// restructuring) is out of scope here and goes to the exception queue.

import { propValue } from './client.js';

const TEMPLATE = 'mgnl:template';

export function planPage(page, spec) {
  const current = propValue(page, TEMPLATE);
  if (current === spec.to.template) return { path: page.path, status: 'already', reasons: [], ops: [] };
  if (current !== spec.from.template) return { path: page.path, status: 'out-of-scope', reasons: [], ops: [] };

  const ops = [];
  const reasons = [];

  ops.push(setOp(page.path, TEMPLATE, 'String', spec.to.template));
  applyRules(page, spec.page, ops, reasons);

  walk(page, (node) => {
    if (node.type !== 'mgnl:component') return;
    const tpl = propValue(node, TEMPLATE);
    const rule = spec.components?.[tpl];
    if (rule === undefined) {
      if ((spec.onUnmapped ?? 'exception') === 'exception') {
        reasons.push(`unmapped component ${tpl} at ${node.path}`);
      }
      return;
    }
    if (rule === 'keep') return;
    if (rule.template && rule.template !== tpl) ops.push(setOp(node.path, TEMPLATE, 'String', rule.template));
    applyRules(node, rule, ops, reasons);
  });

  // All-or-nothing per page: a page with any exception gets no writes.
  if (reasons.length) return { path: page.path, status: 'exception', reasons, ops: [] };
  return { path: page.path, status: 'clean', reasons, ops };
}

function applyRules(node, rules, ops, reasons) {
  if (!rules) return;
  for (const [from, to] of Object.entries(rules.rename ?? {})) {
    const p = node.props[from];
    if (!p) continue;
    if (node.props[to] && from !== to) {
      reasons.push(`rename ${from}->${to} would overwrite existing ${to} at ${node.path}`);
      continue;
    }
    ops.push({ op: 'set', path: node.path, name: to, type: p.type, multiple: p.multiple, values: p.values });
    ops.push({ op: 'delete-prop', path: node.path, name: from });
  }
  for (const [name, value] of Object.entries(rules.set ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    ops.push({ op: 'set', path: node.path, name, type: typeOf(values[0]), multiple: Array.isArray(value), values });
  }
  for (const name of rules.drop ?? []) {
    if (node.props[name]) ops.push({ op: 'delete-prop', path: node.path, name });
  }
}

function setOp(path, name, type, value) {
  return { op: 'set', path, name, type, multiple: false, values: [value] };
}

function typeOf(v) {
  if (typeof v === 'boolean') return 'Boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'Long' : 'Double';
  return 'String';
}

// Visit descendants of a page, but not sub-pages: each page is planned on its own.
function walk(node, visit) {
  for (const child of node.children) {
    if (child.type === 'mgnl:page') continue;
    visit(child);
    walk(child, visit);
  }
}

export function summarize(plans) {
  const s = { total: plans.length, clean: 0, already: 0, exception: 0, outOfScope: 0, ops: 0, exceptionReasons: {} };
  for (const p of plans) {
    if (p.status === 'clean') { s.clean++; s.ops += p.ops.length; }
    else if (p.status === 'already') s.already++;
    else if (p.status === 'exception') {
      s.exception++;
      for (const r of p.reasons) {
        const key = r.replace(/ at \/.*$/, '');
        s.exceptionReasons[key] = (s.exceptionReasons[key] ?? 0) + 1;
      }
    } else s.outOfScope++;
  }
  return s;
}
