import { LockedBaseError } from "./errors.js";
import type { Skill } from "./skills.js";

const GOVERNANCE_TOOLS = ["get_governance_scenario", "get_governance_scenarios_for_tool"] as const;

const BASE_DISCOVERY_TOOLS = ["working_base_list_bases", "working_base_get_current_base"] as const;

const BASE_CREATION_TOOLS = ["base_create_base"] as const;

const READ_TOOLS = [
  "get_page",
  "get_pages",
  "list_pages",
  "search",
  "hybrid_search",
  "get_relevant_subgraph",
  "find_similar_notes",
  "get_page_ancestry",
  "get_inline_link",
  "get_graph_counts",
  "search_capability_status",
  "get_note_authoring_preferences",
] as const;

const WRITE_TOOLS = [
  "create_page",
  "update_page",
  "replace_in_page",
  "link_pages",
  "batch_link",
  "set_parent",
] as const;

const BASE_SCOPED_TOOLS: ReadonlySet<string> = new Set([...READ_TOOLS, ...WRITE_TOOLS]);

export type PreparedToolCall =
  { kind: "allowed"; args: Record<string, unknown> } | { kind: "refused"; error: LockedBaseError };

export function availableTools(skill: Skill, baseRef: string | null): ReadonlySet<string> {
  const tools: string[] = [...GOVERNANCE_TOOLS, ...READ_TOOLS];

  if (skill === "lorebo-capture") {
    tools.push(...WRITE_TOOLS);
  }

  if (baseRef === null) {
    tools.push(...BASE_DISCOVERY_TOOLS);
  }

  if (baseRef === null && skill === "lorebo-capture") {
    tools.push(...BASE_CREATION_TOOLS);
  }

  return new Set(tools);
}

export function isBaseScopedTool(toolName: string): boolean {
  return BASE_SCOPED_TOOLS.has(toolName);
}

export function prepareToolCall(
  toolName: string,
  args: Record<string, unknown>,
  baseRef: string | null,
): PreparedToolCall {
  if (baseRef === null || !isBaseScopedTool(toolName)) {
    return { kind: "allowed", args };
  }

  const requestedBaseRef = args["base_ref"];

  if (requestedBaseRef !== undefined && requestedBaseRef !== null && requestedBaseRef !== baseRef) {
    return { kind: "refused", error: new LockedBaseError(toolName, baseRef) };
  }

  return { kind: "allowed", args: { ...args, base_ref: baseRef } };
}
