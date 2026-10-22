import { createHash } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";

import { SkillPackageError } from "./errors.js";

export const SKILLS = ["lorebo-capture", "lorebo-explore"] as const;

export type Skill = (typeof SKILLS)[number];

export type SkillSource = {
  instructions: (skill: Skill) => Promise<string>;
};

const SKILL_VERSION = "0.4.3";
const SKILL_DOWNLOAD_URL = "https://downloads.lorebo.com/lorebo/skills/stable";
const SKILL_DOWNLOAD_TIMEOUT_MS = 30_000;
const SKILL_INSTRUCTIONS_FILE = "SKILL.md";

const SKILL_DIGESTS: Record<Skill, string> = {
  "lorebo-capture": "6b3d47ca5ba8f0511fc6b6ce33a22ed34757cd54fec54e06d7f34d3452d5572d",
  "lorebo-explore": "2310e6ef43d68e79641c0b32a0f2cefab141e07cdf322d8ded5c52b7d71c215b",
};

export function createPublishedSkills(): SkillSource {
  const downloaded = new Map<Skill, string>();

  return {
    async instructions(skill: Skill): Promise<string> {
      const cached = downloaded.get(skill);

      if (cached !== undefined) {
        return cached;
      }

      const skillPackage = await downloadSkillPackage(skill);
      const digest = createHash("sha256").update(skillPackage).digest("hex");

      if (digest !== SKILL_DIGESTS[skill]) {
        throw new SkillPackageError(`${skill} ${SKILL_VERSION} does not match its digest`);
      }

      const instructions = readSkillInstructions(skillPackage, skill);

      downloaded.set(skill, instructions);

      return instructions;
    },
  };
}

export function readSkillInstructions(skillPackage: Uint8Array, skill: Skill): string {
  const prefix = `${skill}/`;
  const documents = new Map<string, string>();

  for (const [path, bytes] of Object.entries(unzipSkillPackage(skillPackage, skill))) {
    if (path.endsWith("/")) {
      continue;
    }

    if (!path.startsWith(prefix) || path.split("/").includes("..") || path.includes("\\")) {
      throw new SkillPackageError(`${skill} package contains an unexpected path: ${path}`);
    }

    if (path.endsWith(".md")) {
      documents.set(path.slice(prefix.length), strFromU8(bytes));
    }
  }

  const skillDocument = documents.get(SKILL_INSTRUCTIONS_FILE);

  if (skillDocument === undefined) {
    throw new SkillPackageError(`${skill} package has no ${SKILL_INSTRUCTIONS_FILE}`);
  }

  const references = [...documents.entries()]
    .filter(([path]) => path !== SKILL_INSTRUCTIONS_FILE)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, text]) => `# ${path}\n\n${text}`);

  return [skillDocument, ...references].join("\n\n");
}

async function downloadSkillPackage(skill: Skill): Promise<Uint8Array> {
  const url = `${SKILL_DOWNLOAD_URL}/${SKILL_VERSION}/${skill}-${SKILL_VERSION}.zip`;

  let response: Response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new SkillPackageError(`could not download ${url}`, { cause: error });
  }

  if (!response.ok) {
    throw new SkillPackageError(`could not download ${url}: HTTP ${response.status}`);
  }

  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new SkillPackageError(`could not download ${url}`, { cause: error });
  }
}

function unzipSkillPackage(skillPackage: Uint8Array, skill: Skill): Record<string, Uint8Array> {
  try {
    return unzipSync(skillPackage);
  } catch (error) {
    throw new SkillPackageError(`${skill} package is not a zip archive`, { cause: error });
  }
}
