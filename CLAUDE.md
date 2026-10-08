# CLAUDE.md — magnolia-migration-kit

**Docs hub:** `ais/projects/magnolia-migration/` (ADR-0001, research report, spike plan).

## What this is
A Claude Code kit that migrates Magnolia pages from template A to template B. The entry point is the `/magnolia-migrate` Skill in `.claude/skills/`.

## Rules
1. **Local instances only.** `.env` must point at a local author instance.
2. **The MCP (`magnolia-dev`) is read-only.** Never call create, update or delete node tools.
3. **Writes only through `npm run mm -- apply --go`**, and only after the user says "go".
4. **Deterministic first.** The mapping spec holds the judgment, and the code applies it. Don't add per-page AI steps.
5. **Read summaries, not `out/*/plan/` dumps.**
6. **No credentials in files.** Use `.env` (gitignored) and `${VAR}` in `mgnl.mcp.config.json`.

## Layout
- `src/client.js`: Nodes and Properties API client (normalises the response shape)
- `src/transform.js`: pure page → plan transform (unit-tested)
- `src/writers/`: pluggable writers. `nodes-api` exists; a helper endpoint is the planned alternative
- `src/cli.js`: inventory, plan, apply and validate
- `specs/`: the mapping-spec format; client specs go in `specs/local/` (gitignored)

## Checks
`npm test` must pass before any commit.
