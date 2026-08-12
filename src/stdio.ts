import { createRpcHandler } from "./rpc.ts";
import { createJjClient } from "./jj.ts";

const projectRoot = process.env.T3_PLUGIN_PROJECT_ROOT ?? process.cwd();
const snapshotEnv = process.env.T3_PLUGIN_SNAPSHOT;
const run = async (command: readonly string[]) => {
  if (snapshotEnv && command[0] === "jj_t3_snapshot") return JSON.parse(snapshotEnv);
  const prefix = (process.env.T3_PLUGIN_COMMAND ?? "jj_t3_snapshot").split(" ").filter(Boolean);
  const processResult = Bun.spawnSync([...prefix, ...command.slice(1)], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  if (processResult.exitCode !== 0) throw new Error(new TextDecoder().decode(processResult.stderr).trim() || `Jujutsu command failed: ${command.join(" ")}`);
  return JSON.parse(new TextDecoder().decode(processResult.stdout));
};
const client = createJjClient({ projectRoot, run });
const handler = createRpcHandler({ snapshot: null, refresh: client.snapshot });
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
