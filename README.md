# T3 Jujutsu plugin

A T3 Code plugin for [Jujutsu](https://jj-vcs.github.io/jj/) repositories. It shows the working copy, change graph, operation log, bookmarks, workspaces and conflicts, read from the local `jj` CLI. If you turn changes on, panels can also describe, squash, abandon and rebase changes and create bookmarks.

The plugin is an MCP server (`src/mcp.ts`, stdio) described by a v2 manifest (`t3-plugin.json`). The managed-app runtime and plugin RPC were removed in 0.2.0, so T3 builds that only load v1 manifests cannot load this version.

## MCP server

It's a stdio server on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Views are MCP Apps: `ui://` HTML resources with the `text/html;profile=mcp-app` MIME type.

- `jj_snapshot` reads a repository and renders `ui://jujutsu/command-center.html`. Agents get a text summary, and views get the full snapshot.
- `jj_describe`, `jj_abandon`, `jj_squash`, `jj_rebase` and `jj_bookmark_create` change the repository. Only panels can call them (`_meta.ui.visibility: ["app"]`), and only when `JJ_MUTATIONS=enabled`. Abandon and squash ask for confirmation in the panel.

| Panel | Scope | View |
|---|---|---|
| Jujutsu (command center) | project | `ui://jujutsu/command-center.html` |
| Change graph | project | `ui://jujutsu/change-graph.html` |
| Operation log | project | `ui://jujutsu/operation-log.html` |
| Bookmarks | project | `ui://jujutsu/bookmarks.html` |
| Workspaces | project | `ui://jujutsu/workspaces.html` |
| Conflicts | thread | `ui://jujutsu/conflicts.html` |

Each panel reads the repository at `hostContext.t3.cwd`, so the thread-scoped Conflicts panel follows the thread's worktree. Panels refresh every `JJ_POLL_SECONDS` while visible.

### Configuration

| Env var | Old setting | Notes |
|---|---|---|
| `JJ_PROJECT_ROOT` | `jujutsu.project-root` | Absolute path, used when a call or panel names no repository. Defaults to the process working directory. |
| `JJ_POLL_SECONDS` | `jujutsu.polling-seconds` | 10–3600, default 30 |
| `JJ_MUTATIONS` | `filesystem.write` + `T3_PLUGIN_JJ_MUTATIONS=granted` | `enabled` lets panels change the repository. Default `disabled`. |
| `JJ_BIN` | (new) | jj executable, default `jj` |

Each jj command times out after 15 seconds. Tested with jj 0.38. Rebase uses `--onto`, so it needs a jj release that has it.

### Run it

```sh
bun install
bun test           # domain, runner, MCP client, DOM view and stdio install tests (the real-jj test runs when jj is on PATH)
bun run typecheck
JJ_PROJECT_ROOT=/path/to/repo bun run inspect   # MCP Inspector (Apps tab)
```

Install this directory through T3's plugin installer after running `bun install --frozen-lockfile`. `jj` must be installed on the machine that runs the T3 server.

See `docs/manifest-v2.md` for the v1 → v2 mapping, the server rules and the open questions.
