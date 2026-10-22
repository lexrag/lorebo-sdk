import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { openLoreboSession, type ConnectLorebo } from "../src/session.js";
import type { Skill, SkillSource } from "../src/skills.js";

export type FakePage = { id: string; title: string; content: string };

export type FakeBase = { base_ref: string; label: string; kind: string; entry_id: string };

export type ScriptedToolCall = { toolName: string; args: Record<string, unknown> };

export type FakeLorebo = {
  pages: Map<string, FakePage>;
  bases: FakeBase[];
  receivedBaseRefs: string[];
  connect: ConnectLorebo;
};

export function createFakeLorebo(pages: FakePage[], bases: FakeBase[]): FakeLorebo {
  const lorebo: FakeLorebo = {
    pages: new Map(pages.map((page) => [page.id, page])),
    bases,
    receivedBaseRefs: [],
    connect: async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await createFakeServer(lorebo).connect(serverTransport);

      return openLoreboSession(clientTransport);
    },
  };

  return lorebo;
}

function createFakeServer(lorebo: FakeLorebo): McpServer {
  const server = new McpServer({ name: "fake-lorebo", version: "1.0.0" });

  server.registerTool(
    "create_page",
    { inputSchema: { title: z.string(), content: z.string(), base_ref: z.string() } },
    ({ title, content, base_ref }) => {
      lorebo.receivedBaseRefs.push(base_ref);
      const page = { id: `page-${lorebo.pages.size + 1}`, title, content };

      lorebo.pages.set(page.id, page);

      return structuredResult(page);
    },
  );

  server.registerTool(
    "update_page",
    { inputSchema: { page_id: z.string(), content: z.string(), base_ref: z.string() } },
    ({ page_id, content, base_ref }) => {
      lorebo.receivedBaseRefs.push(base_ref);
      const page = { ...storedPage(lorebo, page_id), content };

      lorebo.pages.set(page.id, page);

      return structuredResult(page);
    },
  );

  server.registerTool(
    "get_page",
    { inputSchema: { identifier: z.string(), base_ref: z.string() } },
    ({ identifier, base_ref }) => {
      lorebo.receivedBaseRefs.push(base_ref);

      return structuredResult(storedPage(lorebo, identifier));
    },
  );

  server.registerTool(
    "search",
    { inputSchema: { query: z.string(), base_ref: z.string() } },
    ({ query, base_ref }) => {
      lorebo.receivedBaseRefs.push(base_ref);
      const items = [...lorebo.pages.values()].filter((page) => page.content.includes(query));

      return structuredResult({ items });
    },
  );

  server.registerTool("working_base_list_bases", {}, () =>
    structuredResult({ items: lorebo.bases }),
  );

  server.registerTool(
    "base_create_base",
    { inputSchema: { display_name: z.string(), path: z.string(), activate: z.boolean() } },
    ({ display_name, path }) => {
      if (!path.endsWith(".db")) {
        return {
          isError: true,
          content: [{ type: "text", text: `${path} is not a database path` }],
        };
      }

      const entryId = `entry-${lorebo.bases.length + 1}`;

      lorebo.bases.push({
        base_ref: `local:${entryId}`,
        label: display_name,
        kind: "local",
        entry_id: entryId,
      });

      return structuredResult({ entry_id: entryId, display_name, path });
    },
  );

  server.registerTool("base_delete_base", { inputSchema: { entry_id: z.string() } }, () =>
    structuredResult({ items: lorebo.bases }),
  );

  return server;
}

function storedPage(lorebo: FakeLorebo, pageId: string): FakePage {
  const page = lorebo.pages.get(pageId);

  if (page === undefined) {
    throw new Error(`${pageId} does not exist`);
  }

  return page;
}

function structuredResult(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

export type ScriptedModel = {
  model: MockLanguageModelV4;
  availableTools: () => string[];
};

export function createScriptedModel(
  toolCalls: ScriptedToolCall[],
  report: Record<string, unknown>,
): ScriptedModel {
  let availableTools: string[] = [];
  let step = 0;

  const model = new MockLanguageModelV4({
    doGenerate: (options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> => {
      availableTools = (options.tools ?? []).map((tool) => tool.name).sort();
      const toolCall = toolCalls[step];

      step += 1;

      if (toolCall !== undefined) {
        return Promise.resolve({
          content: [
            {
              type: "tool-call",
              toolCallId: `call-${step}`,
              toolName: toolCall.toolName,
              input: JSON.stringify(toolCall.args),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: EMPTY_USAGE,
          warnings: [],
        });
      }

      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(report) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: EMPTY_USAGE,
        warnings: [],
      });
    },
  });

  return { model, availableTools: () => availableTools };
}

const EMPTY_USAGE: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

export function createMemorySkills(): SkillSource {
  return {
    instructions: (skill: Skill) => Promise.resolve(`Follow the ${skill} workflow.`),
  };
}
