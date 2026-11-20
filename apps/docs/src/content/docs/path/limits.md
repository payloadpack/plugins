---
title: Limits
description: The few rare cases where a path can end up wrong, when each happens, and the one step that fixes it.
---

## Paths

| What you see                                                             | When                                                                                                                                                                                                                                                      | What to do                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A document's path still has its old slug or parent                       | It was saved with a new slug or parent during a rename or move of a document above it. A rename or move takes about a hundredth of a second with a few documents below, and 0.1 to 0.5 seconds with a thousand. See [Speed](/path/speed/) for the numbers | Save that document again, or run `backfillPaths`                      |
| Two documents are at the same path, and `findByPath` returns one of them | Both were saved with that path within the same hundredth of a second. A script that creates documents in parallel can do this                                                                                                                             | Give one of them another slug or parent. `backfillPaths` lists both   |
| Some documents below a moved document keep their old paths               | The move failed partway, for example because the server stopped, on a database without [transactions](/path/installation/#transactions). SQLite runs without them by default                                                                              | Run `backfillPaths`. With transactions, a failed move changes nothing |

Each of these needs two changes to the same documents within a few hundredths of a second, or a server that stops in the middle of a move. You won't see them in everyday use.

:::tip
Run [`backfillPaths`](/path/api/backfill-paths/) on a schedule, such as once a night, and you never need to think about these. It gives every document the path its slug and parent make. It lists the few that need a decision from you.
:::

## Bulk updates

| What you see                                                                                                                        | When                                                      | What to do                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A refused document is listed in the operation's `errors` with Payload's own message, such as "The following field is invalid: slug" | Every time the plugin refuses a document in a bulk update | Save that document on its own to see the plugin's [message](/path/refusals/) |
| One of the two documents is refused. If the other is also refused for another reason, neither gets the path                         | One bulk update gives two documents the same path         | Save the refused document again                                              |

In both cases, your documents are fine.

<details>
<summary>What would remove them</summary>

We found no way to prevent these with what Payload and the databases offer today.

- **A path with its old slug or parent:** a way to lock a branch while a move runs.
- **Two documents at the same path:** a unique index across collections. None of the three databases has one. Today, the check before each save keeps them apart.
- **A move that stops halfway:** transactions, which you can turn on today.
- **A refused document without the plugin's message:** Payload putting the refusal's message in a bulk update's `errors`.

</details>
