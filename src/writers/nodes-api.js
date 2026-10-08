// Writer W1: pushes a page plan through the Nodes and Properties APIs.
// Writers share one interface — { name, applyPlan(plan, client, workspace) } — so the helper
// endpoint (W2) or REST import (W3) can replace this one without touching the transform.

export const nodesApiWriter = {
  name: 'nodes-api',

  async applyPlan(plan, client, workspace) {
    // Group consecutive "set" ops per node into one POST to keep the call count down.
    const byNode = new Map();
    const deletes = [];
    for (const op of plan.ops) {
      if (op.op === 'set') {
        if (!byNode.has(op.path)) byNode.set(op.path, []);
        byNode.get(op.path).push({ name: op.name, type: op.type, multiple: op.multiple, values: op.values });
      } else if (op.op === 'delete-prop') {
        deletes.push(op);
      } else {
        throw new Error(`nodes-api writer cannot handle op ${op.op}`);
      }
    }
    for (const [path, properties] of byNode) await client.setProperties(workspace, path, properties);
    // Deletes run after sets, so a rename never loses its value.
    for (const d of deletes) await client.deleteProperty(workspace, d.path, d.name);
  },
};

export const writers = { 'nodes-api': nodesApiWriter };
