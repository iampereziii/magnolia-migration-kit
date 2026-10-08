import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/client.js';
import { planPage, summarize } from '../src/transform.js';

const spec = {
  from: { template: 'm:pages/standard' },
  to: { template: 'm:pages/article' },
  page: { rename: { subtitle: 'abstract' }, set: { hideInNav: false }, drop: ['legacyLayout'] },
  components: {
    'm:components/text': 'keep',
    'm:components/oldTeaser': { template: 'm:components/teaser', rename: { linkTarget: 'link' } },
  },
};

const prop = (name, value) => ({ name, type: 'String', multiple: false, values: [value] });

function page(template, components) {
  return normalize({
    name: 'p1', path: '/site/p1', type: 'mgnl:page', identifier: 'id-p1',
    properties: [prop('mgnl:template', template), prop('subtitle', 'Hi'), prop('legacyLayout', 'x')],
    nodes: [{
      name: 'main', path: '/site/p1/main', type: 'mgnl:area', properties: [],
      nodes: components.map((tpl, i) => ({
        name: String(i), path: `/site/p1/main/${i}`, type: 'mgnl:component',
        properties: [prop('mgnl:template', tpl), prop('linkTarget', '/x')], nodes: [],
      })),
    }, {
      name: 'child', path: '/site/p1/child', type: 'mgnl:page',
      properties: [prop('mgnl:template', 'm:pages/other')], nodes: [],
    }],
  });
}

test('clean page: template swap, renames, set and drop, all in place', () => {
  const plan = planPage(page('m:pages/standard', ['m:components/text', 'm:components/oldTeaser']), spec);
  assert.equal(plan.status, 'clean');
  const ops = plan.ops.map((o) => `${o.op} ${o.path} ${o.name}${o.values ? '=' + o.values[0] : ''}`);
  assert.deepEqual(ops, [
    'set /site/p1 mgnl:template=m:pages/article',
    'set /site/p1 abstract=Hi',
    'delete-prop /site/p1 subtitle',
    'set /site/p1 hideInNav=false',
    'delete-prop /site/p1 legacyLayout',
    'set /site/p1/main/1 mgnl:template=m:components/teaser',
    'set /site/p1/main/1 link=/x',
    'delete-prop /site/p1/main/1 linkTarget',
  ]);
});

test('unmapped component sends the whole page to the exception queue with no writes', () => {
  const plan = planPage(page('m:pages/standard', ['m:components/video']), spec);
  assert.equal(plan.status, 'exception');
  assert.equal(plan.ops.length, 0);
  assert.match(plan.reasons[0], /unmapped component m:components\/video/);
});

test('already on B is a no-op (idempotent re-run); other templates are out of scope', () => {
  assert.equal(planPage(page('m:pages/article', []), spec).status, 'already');
  assert.equal(planPage(page('m:pages/home', []), spec).status, 'out-of-scope');
});

test('normalize accepts the object-style properties shape too', () => {
  const n = normalize({ node: { name: 'a', path: '/a', nodeType: 'mgnl:page', properties: { 'mgnl:template': 'x' }, children: [] } });
  assert.equal(n.type, 'mgnl:page');
  assert.equal(n.props['mgnl:template'].values[0], 'x');
});

test('summary counts', () => {
  const s = summarize([
    { status: 'clean', ops: [1, 2], reasons: [] },
    { status: 'already', ops: [], reasons: [] },
    { status: 'exception', ops: [], reasons: ['unmapped component m:c/x at /a/main/0'] },
  ]);
  assert.equal(s.clean, 1);
  assert.equal(s.ops, 2);
  assert.deepEqual(s.exceptionReasons, { 'unmapped component m:c/x': 1 });
});
