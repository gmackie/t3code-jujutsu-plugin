import { isAbsolute } from "node:path";

// The v1 settings (jujutsu.project-root, jujutsu.polling-seconds) and the
// filesystem.write grant map onto these env vars, declared under
// mcpServer.transport.env in t3-plugin.json.
export type JujutsuConfig = {
  readonly projectRoot?: string;
  readonly jjBin: string;
  readonly pollSeconds: number;
  readonly mutationsEnabled: boolean;
};

export const POLL_SECONDS = { default: 30, min: 10, max: 3600 } as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): JujutsuConfig {
  const projectRoot = env.JJ_PROJECT_ROOT?.trim();
  if (projectRoot && !isAbsolute(projectRoot)) throw new Error(`JJ_PROJECT_ROOT must be an absolute path, got "${projectRoot}"`);
  return {
    ...(projectRoot ? { projectRoot } : {}),
    jjBin: env.JJ_BIN?.trim() || "jj",
    pollSeconds: pollSeconds(env.JJ_POLL_SECONDS),
    mutationsEnabled: env.JJ_MUTATIONS?.trim().toLowerCase() === "enabled",
  };
}

function pollSeconds(raw: string | undefined): number {
  const value = Number(raw);
  if (!raw?.trim() || !Number.isFinite(value)) return POLL_SECONDS.default;
  return Math.min(POLL_SECONDS.max, Math.max(POLL_SECONDS.min, Math.round(value)));
}
