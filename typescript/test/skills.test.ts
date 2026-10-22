import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { SkillPackageError } from "../src/errors.js";
import { readSkillInstructions } from "../src/skills.js";

function skillPackage(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};

  for (const [path, text] of Object.entries(files)) {
    entries[path] = strToU8(text);
  }

  return zipSync(entries);
}

describe("readSkillInstructions", () => {
  it("starts with the skill and appends its references", () => {
    const skillArchive = skillPackage({
      "lorebo-capture/SKILL.md": "Capture the durable part.",
      "lorebo-capture/references/writeback.md": "Search before creating.",
      "lorebo-capture/agents/openai.yaml": "host metadata",
    });

    const instructions = readSkillInstructions(skillArchive, "lorebo-capture");

    expect(instructions).toBe(
      "Capture the durable part.\n\n# references/writeback.md\n\nSearch before creating.",
    );
  });

  it("rejects a package without a skill document", () => {
    const skillArchive = skillPackage({ "lorebo-capture/references/writeback.md": "Search." });

    expect(() => readSkillInstructions(skillArchive, "lorebo-capture")).toThrow(
      new SkillPackageError("lorebo-capture package has no SKILL.md"),
    );
  });

  it("rejects a path outside the skill", () => {
    const skillArchive = skillPackage({
      "lorebo-capture/SKILL.md": "Capture.",
      "lorebo-capture/../secret.md": "No.",
    });

    expect(() => readSkillInstructions(skillArchive, "lorebo-capture")).toThrow("unexpected path");
  });

  it("rejects a package that is not a zip archive", () => {
    expect(() => readSkillInstructions(strToU8("not a zip"), "lorebo-explore")).toThrow(
      "not a zip archive",
    );
  });
});
