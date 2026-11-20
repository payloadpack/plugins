---
title: Limits
description: The few rare cases where a path can end up wrong, when each can happen, and the one step that puts it right.
---

## Paths

| What you see                                                             | When                                                                                                                                                                                                                                                 | What to do                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A document's path still has its old slug or parent                       | It was saved with a new slug or parent while a rename or move of a document above it was running. That takes about a hundredth of a second with a few documents below, and 0.1 to 0.5 seconds with a thousand. [Speed](/path/speed/) has the numbers | Save that document again, or run `backfillPaths`                                  |
| Two documents are at the same path, and `findByPath` returns one of them | Both were saved with that path within the same hundredth of a second, as a script that creates documents in parallel can do                                                                                                                          | Give one of them another slug or parent. `backfillPaths` lists both               |
| Some documents below a moved document keep their old paths               | The move failed partway, such as when the server stopped, on a database without [transactions](/path/installation/#transactions), which is SQLite's default                                                                                          | Run `backfillPaths`. With transactions, a failed move leaves everything as it was |

Each of these needs two changes to hit the same documents within a few hundredths of a second of each other, or a server that stops in the middle of a move, so you won't meet them in everyday use.

:::tip
Run [`backfillPaths`](/path/api/backfill-paths/) on a schedule, such as once a night, and you never need to think about these. It gives every document the path its slug and parent make, and lists the few that need a decision from you.
:::

## Bulk updates

| What you see                                                                                                                     | When                                                         | What to do                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| A refused document is listed in the operation's `errors` with Payload's own line, such as "The following field is invalid: slug" | Every time a bulk update holds a document the plugin refuses | Save that document on its own to get the [message](/path/refusals/) |
| One of two documents is refused. When the other is refused too, for a reason of its own, neither ends up at the path             | One bulk update gives two documents the same path            | Save the refused document again                                     |

Nothing is wrong with your documents in either of these.

<details>
<summary>What would close them</summary>

We found no way to rule these out with what Payload and the databases offer today.

- **A path with its old slug or parent:** a way to hold a branch still while a move runs.
- **Two documents at the same path:** a unique index across collections, which none of the three databases has. The check before each save is what keeps them apart.
- **A move that stops halfway:** transactions, which you can turn on today.
- **A refused document without the plugin's message:** Payload passing the message of a refusal on in a bulk update's `errors`.

</details>
