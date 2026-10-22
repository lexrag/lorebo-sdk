import { describe, expect, it } from "vitest";

import { LockedBaseError, LoreboToolError } from "../src/errors.js";
import { createLoreboClient, type LoreboClient } from "../src/lorebo.js";
import {
  createFakeLorebo,
  createMemorySkills,
  createScriptedModel,
  type FakeLorebo,
  type ScriptedModel,
  type ScriptedToolCall,
} from "./lorebo-fakes.js";

const LOCKED_BASE = "local:notes";

function fakeLorebo(): FakeLorebo {
  return createFakeLorebo(
    [
      { id: "page-ports", title: "Port policy", content: "Ports stay on loopback." },
      { id: "page-backups", title: "Backups", content: "Backups run nightly." },
    ],
    [
      { base_ref: LOCKED_BASE, label: "notes", kind: "local", entry_id: "notes" },
      { base_ref: "managed:ggl", label: "Graph Governance", kind: "managed", entry_id: "ggl" },
    ],
  );
}

function loreboClient(
  lorebo: FakeLorebo,
  toolCalls: ScriptedToolCall[],
  report: Record<string, unknown>,
  baseRef: string | null,
): { client: LoreboClient; model: ScriptedModel } {
  const model = createScriptedModel(toolCalls, report);
  const client = createLoreboClient({
    connect: lorebo.connect,
    model: model.model,
    skills: createMemorySkills(),
    baseRef,
  });

  return { client, model };
}

describe("capture", () => {
  it("reports each created and updated page once", async () => {
    const { client } = loreboClient(
      fakeLorebo(),
      [
        { toolName: "search", args: { query: "loopback", base_ref: LOCKED_BASE } },
        {
          toolName: "create_page",
          args: { title: "HTTP port", content: "Port 8757.", base_ref: LOCKED_BASE },
        },
        {
          toolName: "update_page",
          args: { page_id: "page-3", content: "Port 8758.", base_ref: LOCKED_BASE },
        },
        {
          toolName: "update_page",
          args: { page_id: "page-ports", content: "Loopback.", base_ref: LOCKED_BASE },
        },
        {
          toolName: "update_page",
          args: { page_id: "page-ports", content: "Loopback!", base_ref: LOCKED_BASE },
        },
      ],
      { summary: "Saved the HTTP port and refined the port policy." },
      LOCKED_BASE,
    );

    const result = await client.capture("The HTTP port is 8758 and stays on loopback.");

    expect(result).toEqual({
      summary: "Saved the HTTP port and refined the port policy.",
      created: [{ id: "page-3", title: "HTTP port", baseRef: LOCKED_BASE }],
      updated: [{ id: "page-ports", title: "Port policy", baseRef: LOCKED_BASE }],
    });
  });

  it("sends the locked base when the model omits it", async () => {
    const lorebo = fakeLorebo();
    const { client } = loreboClient(
      lorebo,
      [{ toolName: "create_page", args: { title: "HTTP port", content: "Port 8758." } }],
      { summary: "Saved the HTTP port." },
      LOCKED_BASE,
    );

    const result = await client.capture("The HTTP port is 8758.");

    expect(lorebo.receivedBaseRefs).toEqual([LOCKED_BASE]);
    expect(result.created).toEqual([{ id: "page-3", title: "HTTP port", baseRef: LOCKED_BASE }]);
  });

  it("stops when the model targets another base", async () => {
    const lorebo = fakeLorebo();
    const { client } = loreboClient(
      lorebo,
      [
        {
          toolName: "create_page",
          args: { title: "Elsewhere", content: "No.", base_ref: "local:other" },
        },
      ],
      { summary: "Saved." },
      LOCKED_BASE,
    );

    await expect(client.capture("Save this somewhere else.")).rejects.toBeInstanceOf(
      LockedBaseError,
    );
    expect(lorebo.receivedBaseRefs).toEqual([]);
  });

  it("can choose and create a base but not delete one when no base is locked", async () => {
    const { client, model } = loreboClient(fakeLorebo(), [], { summary: "Nothing to save." }, null);

    await client.capture("Nothing durable.");

    expect(model.availableTools()).toEqual([
      "base_create_base",
      "create_page",
      "get_page",
      "search",
      "update_page",
      "working_base_list_bases",
    ]);
  });
});

describe("explore", () => {
  it("returns only cited pages that the run read", async () => {
    const { client } = loreboClient(
      fakeLorebo(),
      [
        { toolName: "search", args: { query: "o", base_ref: LOCKED_BASE } },
        { toolName: "get_page", args: { identifier: "page-ports", base_ref: LOCKED_BASE } },
      ],
      {
        answer: "Ports stay on loopback.",
        source_page_ids: ["page-ports", "page-invented", "page-ports"],
      },
      LOCKED_BASE,
    );

    const result = await client.explore("Where do ports listen?");

    expect(result).toEqual({
      answer: "Ports stay on loopback.",
      sources: [{ id: "page-ports", title: "Port policy", baseRef: LOCKED_BASE }],
    });
  });

  it("sees only reading tools when a base is locked", async () => {
    const { client, model } = loreboClient(
      fakeLorebo(),
      [],
      { answer: "", source_page_ids: [] },
      LOCKED_BASE,
    );

    await client.explore("Anything?");

    expect(model.availableTools()).toEqual(["get_page", "search"]);
  });
});

describe("bases", () => {
  it("lists every base", async () => {
    const { client } = loreboClient(fakeLorebo(), [], {}, null);

    const bases = await client.listBases();

    expect(bases).toEqual([
      { baseRef: LOCKED_BASE, label: "notes", kind: "local" },
      { baseRef: "managed:ggl", label: "Graph Governance", kind: "managed" },
    ]);
  });

  it("returns the listed base after creating it", async () => {
    const { client } = loreboClient(fakeLorebo(), [], {}, null);

    const base = await client.createBase({
      label: "research",
      path: "/data/research.db",
      activate: false,
    });

    expect(base).toEqual({ baseRef: "local:entry-3", label: "research", kind: "local" });
  });

  it("reports a Lorebo tool error", async () => {
    const { client } = loreboClient(fakeLorebo(), [], {}, null);

    const creation = client.createBase({
      label: "research",
      path: "/data/research",
      activate: false,
    });

    await expect(creation).rejects.toBeInstanceOf(LoreboToolError);
    await expect(creation).rejects.toThrow("not a database path");
  });

  it("refuses to create a base when a base is locked", async () => {
    const { client } = loreboClient(fakeLorebo(), [], {}, LOCKED_BASE);

    const creation = client.createBase({
      label: "research",
      path: "/data/research.db",
      activate: false,
    });

    await expect(creation).rejects.toBeInstanceOf(LockedBaseError);
  });
});
