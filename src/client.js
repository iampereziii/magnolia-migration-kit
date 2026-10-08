// Thin client for Magnolia's Nodes and Properties REST APIs (v1).
// Everything here runs outside the model: request and response bodies never enter Claude's context.

export function config(env = process.env) {
  const host = (env.MGNL_HOST || 'http://localhost:8080').replace(/\/$/, '');
  const ctx = (env.MGNL_AUTHOR_CONTEXT ?? 'magnoliaAuthor').replace(/^\/|\/$/g, '');
  return {
    base: ctx ? `${host}/${ctx}` : host,
    user: env.MGNL_USER || '',
    password: env.MGNL_PASSWORD || '',
  };
}

// The docs show two response shapes for GET /nodes/v1 (properties as an array of
// {name,type,multiple,values} or as a plain object; children under "nodes" or "children",
// sometimes wrapped in {node: ...}). Normalise both so the rest of the kit sees one shape:
// { name, path, type, id, props: { name: { type, multiple, values } }, children: [] }
export function normalize(raw) {
  const n = raw && raw.node ? raw.node : raw;
  const props = {};
  if (Array.isArray(n.properties)) {
    for (const p of n.properties) {
      props[p.name] = { type: p.type || 'String', multiple: !!p.multiple, values: p.values ?? [] };
    }
  } else if (n.properties && typeof n.properties === 'object') {
    for (const [name, v] of Object.entries(n.properties)) {
      const values = Array.isArray(v) ? v : [v];
      props[name] = { type: inferType(values[0]), multiple: Array.isArray(v), values };
    }
  }
  const kids = n.nodes || n.children || [];
  return {
    name: n.name,
    path: n.path,
    type: n.type || n.nodeType,
    id: n.identifier || n.id,
    props,
    children: kids.map(normalize),
  };
}

export function inferType(v) {
  if (typeof v === 'boolean') return 'Boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'Long' : 'Double';
  return 'String';
}

export function propValue(node, name) {
  const p = node.props[name];
  return p ? p.values[0] : undefined;
}

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

export class MagnoliaClient {
  constructor(cfg = config(), fetchImpl = globalThis.fetch) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.calls = 0;
  }

  headers(json) {
    const h = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (this.cfg.user) {
      h.Authorization = 'Basic ' + Buffer.from(`${this.cfg.user}:${this.cfg.password}`).toString('base64');
    }
    return h;
  }

  async request(method, url, body) {
    this.calls++;
    const res = await this.fetch(url, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
    }
    return res;
  }

  async getNode(workspace, path, depth = 0) {
    const url = `${this.cfg.base}/.rest/nodes/v1/${workspace}${enc(path)}?depth=${depth}`;
    const res = await this.request('GET', url);
    return normalize(await res.json());
  }

  // POST updates only the properties sent; other properties and subnodes are untouched.
  async setProperties(workspace, path, properties) {
    const url = `${this.cfg.base}/.rest/nodes/v1/${workspace}${enc(path)}`;
    await this.request('POST', url, { properties });
  }

  async deleteProperty(workspace, path, name) {
    const url = `${this.cfg.base}/.rest/properties/v1/${workspace}${enc(path)}/${encodeURIComponent(name)}`;
    await this.request('DELETE', url);
  }

  async renderStatus(path) {
    this.calls++;
    const res = await this.fetch(`${this.cfg.base}${enc(path)}.html`, { headers: this.headers(false) });
    return res.status;
  }
}
