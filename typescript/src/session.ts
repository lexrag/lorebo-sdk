import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONSchema7 } from "ai";
import { z } from "zod";

import { LoreboError, LoreboToolError } from "./errors.js";

export type LoreboTool = {
  name: string;
  description: string | undefined;
  inputSchema: JSONSchema7;
};

export type LoreboSession = {
  listTools: () => Promise<readonly LoreboTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

export type ConnectLorebo = () => Promise<LoreboSession>;

const CLIENT_INFO = { name: "lorebo-sdk", version: "0.1.1" };

const toolInputSchema = z.looseObject({ type: z.literal("object") });

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
});

export function connectOverHttp(url: URL, token: string | null): ConnectLorebo {
  const headers: Record<string, string> =
    token === null ? {} : { Authorization: `Bearer ${token}` };

  return () =>
    openLoreboSession(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
}

export async function openLoreboSession(transport: Transport): Promise<LoreboSession> {
  const client = new Client(CLIENT_INFO);

  try {
    await client.connect(transport);
  } catch (error) {
    await client.close();

    throw new LoreboError("could not connect to Lorebo", { cause: error });
  }

  return {
    listTools: () => listTools(client),
    callTool: (name, args) => callTool(client, name, args),
    close: () => client.close(),
  };
}

async function listTools(client: Client): Promise<readonly LoreboTool[]> {
  const tools: LoreboTool[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.listTools({ cursor });

    for (const listed of page.tools) {
      tools.push({
        name: listed.name,
        description: listed.description,
        inputSchema: toolInputSchema.parse(listed.inputSchema),
      });
    }

    cursor = page.nextCursor;
  } while (cursor !== undefined);

  return tools;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let response: unknown;

  try {
    response = await client.callTool({ name, arguments: args });
  } catch (error) {
    throw new LoreboToolError(name, "the call did not complete", { cause: error });
  }

  const result = toolResultSchema.safeParse(response);

  if (!result.success) {
    throw new LoreboToolError(name, "the response is not a tool result", { cause: result.error });
  }

  if (result.data.isError === true) {
    const text = result.data.content.flatMap((block) =>
      block.text === undefined ? [] : [block.text],
    );

    throw new LoreboToolError(name, text.join("\n"));
  }

  return result.data.structuredContent ?? result.data.content;
}
