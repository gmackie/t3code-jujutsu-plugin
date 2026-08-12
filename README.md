# T3 Jujutsu plugin

Desktop/server-side companion plugin for Jujutsu repositories.

The P0 surface is read-only and exposes a normalized command center for the current working copy, change graph, operation log, bookmarks, workspaces, and conflicts. The plugin owns JJ-specific parsing and navigation while T3 remains responsible for generic project/thread lifecycle and host surfaces.

The adapter expects `T3_PLUGIN_COMMAND` to provide a JSON snapshot command. The default command is `jj_t3_snapshot`; `T3_PLUGIN_SNAPSHOT` is useful for fixtures and local smoke tests. The command receives `--root <project-root> --json`.
