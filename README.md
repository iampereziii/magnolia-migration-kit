# magnolia-migration-kit

Migrate Magnolia pages from template **A** to template **B** with Claude Code: `/magnolia-migrate A → B`.
Claude drafts the mapping for your approval and shows a dry run. Then deterministic scripts do every write
through Magnolia's Nodes and Properties REST APIs, so the AI never handles pages one by one.

Decision record: ADR-0001 in the `ais` repo (`projects/magnolia-migration/`).

## Setup (local instance only)

1. Node.js 22.19+, then `npm install`.
2. `cp .env.example .env` and set your local author instance URL and credentials.
3. Optional, for the read-only MCP: add the Magnolia Nexus registry to `~/.npmrc`
   (see the Magnolia MCP Dev Server docs). `.mcp.json` and `mgnl.mcp.config.json` are already in place.
4. Open the folder in Claude Code and run `/magnolia-migrate <A> → <B>`.

## Run by hand

```bash
npm run mm -- inventory --spec specs/local/my.mapping.yaml   # count pages per template
npm run mm -- plan      --spec specs/local/my.mapping.yaml --limit 10   # dry run, writes nothing
npm run mm -- apply     --spec specs/local/my.mapping.yaml --go         # writes
npm run mm -- validate  --spec specs/local/my.mapping.yaml              # template check + render 200
npm test
```

Output lands in `out/<spec name>/` (gitignored). Running `plan` a second time should show every page as "already migrated".

## Mapping spec

See `specs/example.mapping.yaml`. Keep client specs in `specs/local/` (gitignored) or in the client's own repo.

## What the POC does and doesn't do

- **Does:** in-place changes, all on existing nodes, so **node IDs are kept**: page template swap, page and component property rename, set and drop, and component template swap. A page with any unmapped component goes to the exception queue and gets no writes.
- **Doesn't (yet):** move or rename areas or components (needs the Groovy fallback or a helper endpoint), rich-text clean-up, or Pages → content-app migration (P2).
- **To check on your instance:** the exact JSON shape of `GET /.rest/nodes/v1`. The client accepts both shapes the docs show. If inventory finds 0 pages, that's the first thing to look at.
