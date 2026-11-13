import { afterAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJjRunner, jjErrorMessage } from "./runner.ts";

const dir = await mkdtemp(join(tmpdir(), "jj-runner-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function script(name: string, body: string) {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("jj runner", () => {
  it("passes the argv through and returns stdout", async () => {
    const run = createJjRunner({ bin: await script("echo-jj", 'printf "%s|" "$@"; printf "editor=%s" "$JJ_EDITOR"') });
    expect(await run(["jj", "--repository=/r", "log", "-T", 'a ++ "\\t"'])).toBe('--repository=/r|log|-T|a ++ "\\t"|editor=false');
  });

  it("turns a failed command into jj's own error line", async () => {
    const run = createJjRunner({ bin: await script("fail-jj", 'echo "Error: Revision \\"nope\\" doesn\'t exist" >&2; echo "Hint: try harder" >&2; exit 1') });
    await expect(run(["jj", "log"])).rejects.toThrow('jj log failed: Revision "nope" doesn\'t exist');
  });

  it("bounds a hung command with the timeout", async () => {
    const run = createJjRunner({ bin: await script("slow-jj", "sleep 5"), timeoutMs: 100 });
    const started = Date.now();
    await expect(run(["jj", "--no-pager", "op", "log"])).rejects.toThrow("jj op log timed out after 100ms");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("explains a missing jj binary", async () => {
    const run = createJjRunner({ bin: join(dir, "does-not-exist") });
    await expect(run(["jj", "root"])).rejects.toThrow("Install jj or set JJ_BIN");
  });

  it("points a non-jj directory at jj git init", () => {
    expect(jjErrorMessage("root", 'Error: There is no jj repo in "."\n')).toBe('There is no jj repo in ".". Open a Jujutsu repository, or run `jj git init --colocate` in a Git one.');
    expect(jjErrorMessage("root", "")).toBe("jj root failed");
    expect(jjErrorMessage("log", `Error: ${"x".repeat(400)}`)).toHaveLength("jj log failed: ".length + 301);
  });
});
