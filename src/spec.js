import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse } from 'yaml';

export function loadSpec(file) {
  const spec = parse(readFileSync(file, 'utf8'));
  validateSpec(spec, file);
  spec.name = spec.name || basename(file).replace(/\.mapping\.ya?ml$/, '');
  spec.from.workspace = spec.from.workspace || 'website';
  spec.from.root = spec.from.root || '/';
  return spec;
}

export function validateSpec(spec, file = 'spec') {
  const errors = [];
  if (!spec?.from?.template) errors.push('from.template is required');
  if (!spec?.to?.template) errors.push('to.template is required');
  if (spec?.from?.template && spec.from.template === spec?.to?.template) errors.push('from.template and to.template are the same');
  if (spec?.onUnmapped && !['exception', 'ignore'].includes(spec.onUnmapped)) errors.push('onUnmapped must be exception or ignore');
  if (spec?.areas) errors.push('areas: renaming or moving areas needs a move, which the nodes-api writer cannot do (use the Groovy fallback or the helper writer)');
  for (const [tpl, rule] of Object.entries(spec?.components ?? {})) {
    if (rule !== 'keep' && (typeof rule !== 'object' || rule === null)) errors.push(`components.${tpl} must be "keep" or a rule object`);
  }
  if (errors.length) throw new Error(`Invalid mapping spec ${file}:\n- ${errors.join('\n- ')}`);
}
