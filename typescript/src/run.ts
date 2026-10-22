import {
  dynamicTool,
  generateText,
  jsonSchema,
  Output,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";
import { z } from "zod";

import { LoreboToolError, RunLimitError, type LockedBaseError } from "./errors.js";
import { createRunPages, recordToolResult, type RunPages } from "./pages.js";
import type { LoreboSession } from "./session.js";
import type { Skill, SkillSource } from "./skills.js";
import { availableTools, isBaseScopedTool, prepareToolCall } from "./tools.js";

const MAX_MODEL_STEPS = 24;

export const captureReportSchema = z.object({
  summary: z
    .string()
    .describe(
      "One or two plain sentences for the application's user: what was saved, or why nothing was saved.",
    ),
});

export const exploreReportSchema = z.object({
  answer: z
    .string()
    .describe("The answer to the prompt in plain text, based on the Lorebo pages read."),
  source_page_ids: z.array(z.string()).describe("IDs of the Lorebo pages the answer relies on."),
});

const toolArgumentsSchema = z.record(z.string(), z.unknown());

const baseScopedArgumentsSchema = z.looseObject({ base_ref: z.string() });

export type SkillRun<REPORT> = {
  report: REPORT;
  pages: RunPages;
};

export async function runSkill<REPORT>(input: {
  model: LanguageModel;
  skills: SkillSource;
  session: LoreboSession;
  baseRef: string | null;
  skill: Skill;
  prompt: string;
  reportSchema: z.ZodType<REPORT>;
}): Promise<SkillRun<REPORT>> {
  const skillInstructions = await input.skills.instructions(input.skill);
  const available = availableTools(input.skill, input.baseRef);
  const listedTools = await input.session.listTools();
  const pages = createRunPages();
  const abortController = new AbortController();
  const tools: ToolSet = {};
  let refusal: LockedBaseError | undefined;

  for (const listed of listedTools.filter((tool) => available.has(tool.name))) {
    tools[listed.name] = dynamicTool({
      description: listed.description,
      inputSchema: jsonSchema(listed.inputSchema),
      execute: async (toolInput) => {
        const prepared = prepareToolCall(
          listed.name,
          parseToolArguments(listed.name, toolInput),
          input.baseRef,
        );

        if (prepared.kind === "refused") {
          refusal = prepared.error;
          abortController.abort(prepared.error);

          throw prepared.error;
        }

        const payload = await input.session.callTool(listed.name, prepared.args);

        if (isBaseScopedTool(listed.name)) {
          const { base_ref: baseRef } = baseScopedArgumentsSchema.parse(prepared.args);

          recordToolResult(pages, listed.name, baseRef, payload);
        }

        return payload;
      },
    });
  }

  let result;

  try {
    result = await generateText({
      model: input.model,
      instructions: runInstructions(input.skill, skillInstructions, input.baseRef),
      prompt: input.prompt,
      tools,
      output: Output.object({ schema: input.reportSchema }),
      stopWhen: stepCountIs(MAX_MODEL_STEPS),
      abortSignal: abortController.signal,
    });
  } catch (error) {
    if (refusal !== undefined) {
      throw refusal;
    }

    throw error;
  }

  if (result.finishReason === "tool-calls") {
    throw new RunLimitError(MAX_MODEL_STEPS);
  }

  return { report: result.output, pages };
}

function parseToolArguments(toolName: string, toolInput: unknown): Record<string, unknown> {
  const parsed = toolArgumentsSchema.safeParse(toolInput);

  if (!parsed.success) {
    throw new LoreboToolError(toolName, "the tool arguments are not an object", {
      cause: parsed.error,
    });
  }

  return parsed.data;
}

function runInstructions(skill: Skill, skillInstructions: string, baseRef: string | null): string {
  const baseRule =
    baseRef !== null
      ? `This run is locked to the base ${baseRef}. Pass that base_ref on every call that takes one. Other bases are not available.`
      : skill === "lorebo-capture"
        ? "No base is preselected. List the bases and choose the one this knowledge belongs to, or create one when none fits. Pass its base_ref on every call that takes one."
        : "No base is preselected. List the bases and choose the one that holds this knowledge. Pass its base_ref on every call that takes one.";

  const finalReportRule =
    skill === "lorebo-capture"
      ? "Its summary is shown to the application's user. State what was saved, or why nothing was saved."
      : "Its answer is shown to the application's user. Answer the prompt directly from the pages you read, and put the IDs of the pages it relies on in source_page_ids instead of listing sources in the answer.";

  return [
    skillInstructions,
    "# Lorebo SDK run",
    `You are running the ${skill} skill for an application through the Lorebo SDK. The run is unattended: nobody can answer questions or confirm steps. The application's prompt is the whole task and its only source material.`,
    baseRule,
    "Governance tools read Lorebo's managed governance base. They do not change the target base.",
    `When the work is done, return the final report. ${finalReportRule} Write that text plainly, without Markdown, page IDs, tool names, or a description of your reasoning and steps.`,
  ].join("\n\n");
}
