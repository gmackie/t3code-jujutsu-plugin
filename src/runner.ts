import type { CommandRunner } from "./jj.ts";

export const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 300;

/**
 * Runs jj as a child process with a bounded wall clock. argv[0] is replaced by
 * the configured binary. stdin is closed and JJ_EDITOR fails fast, so a command
 * that wants an editor errors instead of hanging.
 */
export function createJjRunner(options: { bin: string; timeoutMs?: number; cwd?: string }): CommandRunner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (command, call) => {
    const cwd = call?.cwd ?? options.cwd;
    const argv = [options.bin, ...command.slice(1)];
    const subcommand = commandName(command);
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(argv, {
        ...(cwd ? { cwd } : {}),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, JJ_EDITOR: "false", NO_COLOR: "1" },
      });
    } catch (error) {
      throw new Error(`The Jujutsu CLI could not be started (JJ_BIN=${options.bin}). Install jj or set JJ_BIN to its path.`, { cause: error });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Rejects without waiting for the pipes: a killed jj's own children could hold them open.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`jj ${subcommand} timed out after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`}`));
      }, timeoutMs);
    });
    const completed = Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ]).then(([stdout, stderr, exitCode]) => {
      if (exitCode !== 0) throw new Error(jjErrorMessage(subcommand, stderr));
      return stdout;
    });
    try {
      return await Promise.race([completed, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

const GROUPS = new Set(["op", "bookmark", "workspace", "git"]);

/** "log", "op log", "bookmark create": names the command in errors. */
function commandName(command: readonly string[]): string {
  const words = command.slice(1).filter((arg) => !arg.startsWith("-"));
  if (!words[0]) return "command";
  return GROUPS.has(words[0]) && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

/** The first `Error:` line from jj, trimmed; hints and backtraces are dropped. */
export function jjErrorMessage(subcommand: string, stderr: string): string {
  const rows = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const error = rows.find((line) => /^error:/i.test(line)) ?? rows[0];
  if (!error) return `jj ${subcommand} failed`;
  if (/There is no jj repo in/i.test(error)) return `${error.replace(/^error:\s*/i, "")}. Open a Jujutsu repository, or run \`jj git init --colocate\` in a Git one.`;
  const message = error.replace(/^error:\s*/i, "");
  return `jj ${subcommand} failed: ${message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message}`;
}
