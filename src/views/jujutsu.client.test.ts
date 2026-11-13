import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

import { connectedClient } from "../testing.ts";

// Runs the real view module against a DOM, with this test acting as the host
// frame and forwarding tools/call to the Jujutsu MCP server.
describe("Jujutsu view in a DOM", () => {
  it("loads the panel's repository from host context and abandons a change after confirmation", async () => {
    const { client, jj } = await connectedClient({ config: { mutationsEnabled: true } });
    const win = new Window({ url: "https://view.invalid/" });
    const calls: { name: string; arguments: Record<string, unknown> }[] = [];
    const deliver = (data: unknown) => win.dispatchEvent(new win.MessageEvent("message", { data, source: parent as never }));
    const parent = {
      async postMessage(message: { id?: number; method?: string; params?: { name: string; arguments: Record<string, unknown> } }) {
        if (message.method === "ui/initialize") deliver({ jsonrpc: "2.0", id: message.id, result: { hostContext: { theme: "dark", t3: { projectId: "p1", cwd: "/thread/worktree" } } } });
        if (message.method === "tools/call") {
          calls.push(message.params!);
          deliver({ jsonrpc: "2.0", id: message.id, result: await client.callTool(message.params!) });
        }
      },
    };
    Object.defineProperty(win, "parent", { value: parent });
    win.document.body.innerHTML = `<main id="app" data-section="change-graph">Loading…</main>`;
    Object.assign(globalThis, { window: win, document: win.document, ResizeObserver: class { observe() {} } });

    await import("./jujutsu.client.ts");
    const doc = win.document;
    const settle = (ms = 30) => Bun.sleep(ms);
    // A panel opened from a command gets no tool result, so the view fetches.
    await settle(350);
    expect(doc.documentElement.dataset.theme).toBe("dark");
    expect(calls[0]).toEqual({ name: "jj_snapshot", arguments: { root: "/thread/worktree" } });
    expect(doc.querySelector("h1")?.textContent).toBe("Change graph");
    expect(doc.querySelectorAll("[data-action=edit-abandon]")).toHaveLength(2);

    (doc.querySelector('[data-action=edit-abandon][data-change-id="xxww"]') as unknown as HTMLElement).click();
    await settle();
    expect(jj.mutations).toEqual([]);
    (doc.querySelector("[data-action=confirm-abandon]") as unknown as HTMLElement).click();
    await settle();
    expect(calls.at(-1)).toEqual({ name: "jj_abandon", arguments: { root: "/thread/worktree", revision: "xxww" } });
    expect(jj.mutations).toEqual([["abandon", "--", "xxww"]]);
    expect(doc.querySelector("[role=status]")?.textContent).toBe("Abandoned xxww.");

    // A failed tool call shows jj's error instead of stale success.
    (doc.querySelector('[data-action=edit-describe][data-change-id="zzyy"]') as unknown as HTMLElement).click();
    await settle();
    (doc.querySelector('[data-form=describe] input[name="message"]') as unknown as HTMLInputElement).value = "--";
    (doc.querySelector("[data-form=describe]") as unknown as HTMLFormElement).requestSubmit();
    await settle();
    expect(jj.mutations.at(-1)).toEqual(["describe", "--message=--", "--", "zzyy"]);

    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { isError: true, content: [{ type: "text", text: "There is no jj repo in \"/x\"." }] } });
    await settle();
    expect(doc.querySelector("[role=alert]")?.textContent).toBe('There is no jj repo in "/x".');
  });
});
