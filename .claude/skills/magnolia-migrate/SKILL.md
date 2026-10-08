---
name: magnolia-migrate
description: Migrate Magnolia pages from one template to another (A -> B) on a LOCAL instance. Use when the user says "/magnolia-migrate", "migrate <A> to <B>", or asks to move pages from one Magnolia template to another. Drafts a mapping spec for approval, shows a dry run, and writes only after the user says "go".
---

# /magnolia-migrate — A → B content migration

Arguments: `<template A> → <template B>`, for example `my-module:pages/standard → my-module:pages/article`.

## Rules (from ADR-0001 — do not break)

- **Local instances only.** Never run against a shared or client environment.
- **The MCP only reads.** Use `magnolia-dev` tools for definitions, samples and render checks. Never call `mgnl_api_create_node`, `mgnl_api_update_node` or `mgnl_api_delete_node`.
- **Code writes, not you.** All writes go through `npm run mm -- apply`. Never write page by page yourself.
- **Read summaries, not dumps.** Read the CLI's printed summary and `out/<name>/summary.json` / `exceptions.json`. Don't open the `out/<name>/plan/` folder in bulk.
- **Two pauses, always:** approval of a new mapping spec, and "go" after the dry run.

## Steps

1. **Find or draft the mapping spec.**
   - Look for an existing spec for this pair in `specs/local/` (or the path the user gives).
   - **Found:** go to step 2.
   - **Not found:**
     1. Run `npm run mm -- inventory --spec <a temporary spec with just from/to>` to see how many pages use A.
     2. Read both page templates and their dialogs with `mgnl_api_get_template_definition` and `mgnl_api_get_dialog_definition`.
     3. Export 3–5 sample pages with `mgnl_api_export_node`.
     4. Draft `specs/local/<a>__<b>.mapping.yaml`, following `specs/example.mapping.yaml`.
     5. **Show it to the user and wait for approval.**
2. **Dry run.** Run `npm run mm -- plan --spec <spec> [--limit N]`. Report the printed summary: pages, clean, already migrated, exceptions and their reasons.
   **Stop and wait for the user to say "go".**
3. **Apply.** Run `npm run mm -- apply --spec <spec> --go`. Report written, failed, calls per page, and projected time for 1,000 pages. If the writer-rule line appears, point it out.
4. **Validate.** Run `npm run mm -- validate --spec <spec>`. Report how many pages are on B and how many render with status 200. For one page, offer a before/after check with `mgnl_api_render_page`.
5. **Exceptions.** Summarise `out/<name>/exceptions.json` by reason. Suggest a spec change, such as a missing component rule, and re-run from step 2 once the user approves it.

## Re-runs

Running the same pair again should report everything as "already migrated" with nothing to write. That's the proof the run is idempotent.
