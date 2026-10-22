import { z } from "zod";

import { LoreboToolError } from "./errors.js";
import type { Page } from "./records.js";

const CREATING_TOOLS: ReadonlySet<string> = new Set(["create_page"]);
const UPDATING_TOOLS: ReadonlySet<string> = new Set(["update_page", "replace_in_page"]);
const SINGLE_PAGE_TOOLS: ReadonlySet<string> = new Set(["get_page"]);
const PAGE_ITEMS_TOOLS: ReadonlySet<string> = new Set([
  "get_pages",
  "list_pages",
  "search",
  "find_similar_notes",
]);

const pageReferenceSchema = z.object({ id: z.string(), title: z.string() });
const pageItemsSchema = z.object({ items: z.array(pageReferenceSchema) });
const hybridSearchResultsSchema = z.object({ results: z.array(pageReferenceSchema) });
const relevantSubgraphSchema = z.object({ nodes: z.array(pageReferenceSchema) });

type PageReference = z.output<typeof pageReferenceSchema>;

export type RunPages = {
  created: Map<string, Page>;
  updated: Map<string, Page>;
  seen: Map<string, Page>;
};

export function createRunPages(): RunPages {
  return { created: new Map(), updated: new Map(), seen: new Map() };
}

export function recordToolResult(
  pages: RunPages,
  toolName: string,
  baseRef: string,
  payload: unknown,
): void {
  for (const reference of pageReferences(toolName, payload)) {
    const page: Page = { id: reference.id, title: reference.title, baseRef };

    pages.seen.set(page.id, page);

    if (CREATING_TOOLS.has(toolName)) {
      pages.created.set(page.id, page);
    }

    if (UPDATING_TOOLS.has(toolName)) {
      const changedPages = pages.created.has(page.id) ? pages.created : pages.updated;

      changedPages.set(page.id, page);
    }
  }
}

export function citedPages(pages: RunPages, pageIds: readonly string[]): Page[] {
  const cited = new Map<string, Page>();

  for (const pageId of pageIds) {
    const page = pages.seen.get(pageId);

    if (page !== undefined) {
      cited.set(page.id, page);
    }
  }

  return [...cited.values()];
}

function pageReferences(toolName: string, payload: unknown): PageReference[] {
  if (
    CREATING_TOOLS.has(toolName) ||
    UPDATING_TOOLS.has(toolName) ||
    SINGLE_PAGE_TOOLS.has(toolName)
  ) {
    return [parsePagePayload(toolName, pageReferenceSchema, payload)];
  }

  if (PAGE_ITEMS_TOOLS.has(toolName)) {
    return parsePagePayload(toolName, pageItemsSchema, payload).items;
  }

  if (toolName === "hybrid_search") {
    return parsePagePayload(toolName, hybridSearchResultsSchema, payload).results;
  }

  if (toolName === "get_relevant_subgraph") {
    return parsePagePayload(toolName, relevantSubgraphSchema, payload).nodes;
  }

  return [];
}

function parsePagePayload<SCHEMA extends z.ZodType>(
  toolName: string,
  schema: SCHEMA,
  payload: unknown,
): z.output<SCHEMA> {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new LoreboToolError(toolName, "the response does not describe pages", {
      cause: parsed.error,
    });
  }

  return parsed.data;
}
