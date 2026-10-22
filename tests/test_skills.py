import io
import zipfile

import pytest

from lorebo_sdk.errors import SkillPackageError
from lorebo_sdk.skills import Skill, SkillPackage


def skill_package(files: dict[str, str]) -> bytes:
    payload = io.BytesIO()

    with zipfile.ZipFile(payload, "w") as archive:
        for path, text in files.items():
            archive.writestr(path, text)

    return payload.getvalue()


def test_instructions_start_with_the_skill_and_append_its_references() -> None:
    package = skill_package(
        {
            "lorebo-capture/SKILL.md": "Capture the durable part.",
            "lorebo-capture/references/writeback.md": "Search before creating.",
            "lorebo-capture/agents/openai.yaml": "host metadata",
        }
    )

    instructions = SkillPackage.read_instructions(package, Skill.CAPTURE)

    assert instructions == (
        "Capture the durable part.\n\n# references/writeback.md\n\nSearch before creating."
    )


def test_package_without_skill_document_is_rejected() -> None:
    package = skill_package({"lorebo-capture/references/writeback.md": "Search."})

    with pytest.raises(SkillPackageError, match="has no SKILL.md"):
        SkillPackage.read_instructions(package, Skill.CAPTURE)


def test_package_with_a_path_outside_the_skill_is_rejected() -> None:
    package = skill_package(
        {
            "lorebo-capture/SKILL.md": "Capture.",
            "lorebo-capture/../secret.md": "No.",
        }
    )

    with pytest.raises(SkillPackageError, match="unexpected path"):
        SkillPackage.read_instructions(package, Skill.CAPTURE)


def test_package_that_is_not_a_zip_archive_is_rejected() -> None:
    with pytest.raises(SkillPackageError, match="not a zip archive"):
        SkillPackage.read_instructions(b"not a zip", Skill.EXPLORE)
