import type { LanguageModel } from "ai";
import { z } from "zod";

import { LockedBaseError, LoreboError, LoreboToolError } from "./errors.js";
import { citedPages } from "./pages.js";
import type { Base, CaptureResult, ExploreResult } from "./records.js";
import { captureReportSchema, exploreReportSchema, runSkill } from "./run.js";
import { connectOverHttp, type ConnectLorebo, type LoreboSession } from "./session.js";
import { createPublishedSkills, type SkillSource } from "./skills.js";

export type LoreboClient = {
  capture: (prompt: string) => Promise<CaptureResult>;
  explore: (prompt: string) => Promise<ExploreResult>;
  listBases: () => Promise<Base[]>;
  createBase: (base: { label: string; path: string; activate: boolean }) => Promise<Base>;
};

const listedBaseSchema = z.object({
  base_ref: z.string(),
  label: z.string(),
  kind: z.string(),
  entry_id: z.string(),
});

const baseListSchema = z.object({ items: z.array(listedBaseSchema) });

const createdBaseSchema = z.object({ entry_id: z.string() });

type ListedBase = z.output<typeof listedBaseSchema>;

export function createLorebo(options: {
  url: string;
  token: string | null;
  model: LanguageModel;
  baseRef: string | null;
}): LoreboClient {
  if (!URL.canParse(options.url)) {
    throw new LoreboError(`${options.url} is not a valid Lorebo MCP URL`);
  }

  return createLoreboClient({
    connect: connectOverHttp(new URL(options.url), options.token),
    model: options.model,
    skills: createPublishedSkills(),
    baseRef: options.baseRef,
  });
}

export function createLoreboClient(options: {
  connect: ConnectLorebo;
  model: LanguageModel;
  skills: SkillSource;
  baseRef: string | null;
}): LoreboClient {
  const { connect, model, skills, baseRef } = options;

  async function withSession<RESULT>(
    work: (session: LoreboSession) => Promise<RESULT>,
  ): Promise<RESULT> {
    const session = await connect();

    try {
      return await work(session);
    } finally {
      await session.close();
    }
  }

  async function listedBases(session: LoreboSession): Promise<ListedBase[]> {
    const payload = await session.callTool("working_base_list_bases", {});

    return parseResponse("working_base_list_bases", baseListSchema, payload).items;
  }

  return {
    capture: (prompt) =>
      withSession(async (session) => {
        const run = await runSkill({
          model,
          skills,
          session,
          baseRef,
          skill: "lorebo-capture",
          prompt,
          reportSchema: captureReportSchema,
        });

        return {
          summary: run.report.summary,
          created: [...run.pages.created.values()],
          updated: [...run.pages.updated.values()],
        };
      }),

    explore: (prompt) =>
      withSession(async (session) => {
        const run = await runSkill({
          model,
          skills,
          session,
          baseRef,
          skill: "lorebo-explore",
          prompt,
          reportSchema: exploreReportSchema,
        });

        return {
          answer: run.report.answer,
          sources: citedPages(run.pages, run.report.source_page_ids),
        };
      }),

    listBases: () =>
      withSession(async (session) => {
        const bases = await listedBases(session);

        return bases.map(toBase);
      }),

    createBase: async ({ label, path, activate }) => {
      if (baseRef !== null) {
        throw new LockedBaseError("base_create_base", baseRef);
      }

      return withSession(async (session) => {
        const payload = await session.callTool("base_create_base", {
          display_name: label,
          path,
          activate,
        });
        const created = parseResponse("base_create_base", createdBaseSchema, payload);
        const listed = (await listedBases(session)).find(
          (base) => base.entry_id === created.entry_id,
        );

        if (listed === undefined) {
          throw new LoreboToolError("base_create_base", `base ${created.entry_id} is not listed`);
        }

        return toBase(listed);
      });
    },
  };
}

function toBase(listed: ListedBase): Base {
  return { baseRef: listed.base_ref, label: listed.label, kind: listed.kind };
}

function parseResponse<SCHEMA extends z.ZodType>(
  toolName: string,
  schema: SCHEMA,
  payload: unknown,
): z.output<SCHEMA> {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new LoreboToolError(toolName, "the response has an unexpected shape", {
      cause: parsed.error,
    });
  }

  return parsed.data;
}
