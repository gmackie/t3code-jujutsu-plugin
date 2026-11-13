import { STYLES, type Section } from "./render.ts";

// One bundle serves every panel; the section it shows is fixed per resource.
export const VIEWS = {
  "command-center": { uri: "ui://jujutsu/command-center.html", title: "Jujutsu command center" },
  "change-graph": { uri: "ui://jujutsu/change-graph.html", title: "Jujutsu change graph" },
  "operation-log": { uri: "ui://jujutsu/operation-log.html", title: "Jujutsu operation log" },
  bookmarks: { uri: "ui://jujutsu/bookmarks.html", title: "Jujutsu bookmarks" },
  workspaces: { uri: "ui://jujutsu/workspaces.html", title: "Jujutsu workspaces" },
  conflicts: { uri: "ui://jujutsu/conflicts.html", title: "Jujutsu conflicts" },
} as const satisfies Record<Section, { uri: string; title: string }>;

export type ViewName = keyof typeof VIEWS;

let script: Promise<string> | undefined;

// Views are single self-contained HTML documents: T3 snapshots the resource
// and serves it into a sandboxed iframe with connect-src 'none', so the script
// is bundled and inlined rather than loaded from anywhere.
export async function viewHtml(name: ViewName): Promise<string> {
  script ??= bundle();
  const view = VIEWS[name];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view.title}</title>
<style>${STYLES}</style>
</head>
<body>
<main id="app" data-section="${name}" aria-live="polite">Loading…</main>
<script type="module">${await script}</script>
</body>
</html>`;
}

async function bundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL("jujutsu.client.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "failed to bundle jujutsu.client.ts");
  return (await result.outputs[0]!.text()).replaceAll("</script", "<\\/script");
}
