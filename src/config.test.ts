import { expect, it } from "bun:test";

import { loadConfig } from "./config.ts";

it("reads the plugin variables with v1 defaults and bounds", () => {
  expect(loadConfig({})).toEqual({ jjBin: "jj", pollSeconds: 30, mutationsEnabled: false });
  expect(loadConfig({ JJ_PROJECT_ROOT: " /repo ", JJ_BIN: "/opt/jj", JJ_POLL_SECONDS: "5", JJ_MUTATIONS: "Enabled" })).toEqual({ projectRoot: "/repo", jjBin: "/opt/jj", pollSeconds: 10, mutationsEnabled: true });
  expect(loadConfig({ JJ_POLL_SECONDS: "99999", JJ_MUTATIONS: "granted" })).toMatchObject({ pollSeconds: 3600, mutationsEnabled: false });
  expect(() => loadConfig({ JJ_PROJECT_ROOT: "relative" })).toThrow("absolute");
});
