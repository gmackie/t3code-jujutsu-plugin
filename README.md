# T3 Jujutsu plugin

Desktop/server-side companion plugin for Jujutsu repositories.

The command center exposes a normalized view of the current working copy, change graph, operation log, bookmarks, workspaces, and conflicts. The plugin owns JJ-specific parsing and navigation while T3 remains responsible for generic project/thread lifecycle and host surfaces.

With no command configured, the plugin invokes native `jj` read commands directly. `T3_PLUGIN_COMMAND` can instead provide a JSON snapshot command; `T3_PLUGIN_SNAPSHOT` is useful for fixtures and local smoke tests. The command receives `--root <project-root> --json`.

Mutations are disabled unless T3 grants the `filesystem.write` capability and the host sets `T3_PLUGIN_JJ_MUTATIONS=granted`. Supported guarded actions currently include describe, abandon, squash, rebase, and bookmark creation.
