---
name: example-todos
description: Read and update the Canvas plugin's example todo list with the `bb canvas` CLI. Use when the user asks to add, complete, reopen, remove, or review todos, or when the steps of a task should be tracked as todos.
---

# Example todos

The Canvas plugin keeps one todo list. The Example todos page in the BB sidebar and
the `bb canvas` command read and write the same list, so a change from either
side shows in the other at once.

## Commands

| Command | Effect |
| --- | --- |
| `bb canvas list` | Show every todo with its id. `[x]` marks a done todo. |
| `bb canvas add <title>` | Add a todo. Quote a title that has spaces. |
| `bb canvas done <todo-id>` | Mark a todo done. |
| `bb canvas undo <todo-id>` | Mark a todo not done. |
| `bb canvas remove <todo-id>` | Delete a todo. |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `bb canvas list` before you change the list. Use the ids it prints;
   never guess an id.
2. Add todos one at a time with a short title that starts with a verb:
   `bb canvas add "Write the release notes"`.
3. When you finish a todo, mark it done: `bb canvas done <todo-id>`. Do not
   remove a todo to mark it done.
4. Remove a todo only when the user asks for it or when it duplicates
   another todo.
5. End with a short summary of what you added, completed, or removed.

## Rules

- Change the list only through `bb canvas`. Do not edit bb.db or the plugin's
  storage directly.
- A non-zero exit with "No todo with id" means the id is stale: run
  `bb canvas list` again.
