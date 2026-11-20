---
title: Limits
description: The few rare cases where a path can end up out of step, when they happen, and how to fix them.
---

## Paths

| What you see                                                     | When it happens                                                                                                                                     | Fix                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A document's path still has its old slug or parent               | Saved with a new slug or parent while a document above it was moving (~0.01 s for a few docs below, 0.1–0.5 s for 1,000; see [Speed](/path/speed/)) | Save that document again, or run `backfillPaths`                     |
| Two documents share a path, and `findByPath` returns one of them | Both were saved with the same path within the same ~0.01 s (e.g. a script creating documents in parallel)                                           | Change one document's slug or parent — `backfillPaths` lists both    |
| Some documents below a moved document keep their old paths       | A move stopped halfway (e.g. server crash) on a database without [transactions](/path/installation/#transactions) (SQLite's default)                | Run `backfillPaths` (with transactions, failed moves change nothing) |

Each case needs two overlapping writes within hundredths of a second, or a server stopping mid-move. You won't hit them in everyday use.

:::tip
Run [`backfillPaths`](/path/api/backfill-paths/) on a schedule (e.g. nightly) so you never need to think about these. It recalculates every path from slugs and parents, and lists the few documents that need your decision.
:::

## Bulk updates

| What you see                                                                                                          | When it happens                                         | Fix                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A refused document appears in `errors` with Payload's generic message (e.g. `"The following field is invalid: slug"`) | Whenever the plugin refuses a document in a bulk update | Save that document on its own to see the plugin's [refusal](/path/refusals/) |
| One of the two documents is refused — and if the other is also refused for another reason, neither gets the path      | One bulk update assigns two documents to the same path  | Save the refused document again                                              |

In both cases, your documents stay intact.

<details>
<summary>What would remove these limits</summary>

None of these can be prevented cleanly with what Payload and the databases provide today:

- **Stale path after a concurrent move:** locking an entire branch while a move runs.
- **Two documents at the same path:** a unique index across multiple collections (not supported by MongoDB, Postgres, or SQLite). Today, the pre-save check keeps them apart.
- **A move that stops halfway:** database transactions (which you can enable today).
- **Generic refusal message in bulk updates:** Payload passing field refusal messages through into bulk `errors`.

</details>
