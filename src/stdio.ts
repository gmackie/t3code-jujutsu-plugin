import { createRpcHandler } from "./rpc.ts";
import { createBuiltinJjClient, createJjClient } from "./jj.ts";

const projectRoot = process.env.T3_PLUGIN_PROJECT_ROOT ?? process.cwd();
const snapshotEnv = process.env.T3_PLUGIN_SNAPSHOT;
const runConfigured = async (command: readonly string[]) => {
  if (snapshotEnv && command[0] === "jj_t3_snapshot") return JSON.parse(snapshotEnv);
  const prefix = (process.env.T3_PLUGIN_COMMAND ?? "jj_t3_snapshot").split(" ").filter(Boolean);
  const processResult = Bun.spawnSync([...prefix, ...command.slice(1)], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  if (processResult.exitCode !== 0) throw new Error(new TextDecoder().decode(processResult.stderr).trim() || `Jujutsu command failed: ${command.join(" ")}`);
  return JSON.parse(new TextDecoder().decode(processResult.stdout));
};
const runNative = async (command: readonly string[]) => {
  const processResult = Bun.spawnSync([...command], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  if (processResult.exitCode !== 0) throw new Error(new TextDecoder().decode(processResult.stderr).trim() || `Jujutsu command failed: ${command.join(" ")}`);
  return new TextDecoder().decode(processResult.stdout);
};
const client = process.env.T3_PLUGIN_COMMAND ? createJjClient({ projectRoot, run: runConfigured }) : createBuiltinJjClient({ projectRoot, run: runNative });
const mutationCapabilityGranted = process.env.T3_PLUGIN_JJ_MUTATIONS === "granted";
const mutate = async ({ command }: { command: readonly string[] }) => {
  const result = Bun.spawnSync(["jj", ...command, "--repository", projectRoot, "--no-pager", "--color", "never"], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim() || `Jujutsu mutation failed: ${command.join(" ")}`);
  return { status: "ok" };
};
const handler = createRpcHandler({ snapshot: null, refresh: client.snapshot, mutationCapabilityGranted, mutate });
for await (const line of console) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    const response = await handler(request.method, request.payload);
    console.log(JSON.stringify({ type: "plugin.response", requestId: request.requestId, pluginId: "com.t3code.jujutsu", ...response }));
  } catch (error) {
    console.log(JSON.stringify({ type: "plugin.response", pluginId: "com.t3code.jujutsu", ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}
