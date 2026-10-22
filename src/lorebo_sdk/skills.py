import hashlib
import io
import zipfile
from enum import StrEnum
from typing import Protocol

import httpx

from lorebo_sdk.errors import SkillPackageError


class Skill(StrEnum):
    CAPTURE = "lorebo-capture"
    EXPLORE = "lorebo-explore"


class SkillSource(Protocol):
    async def instructions(self, skill: Skill) -> str: ...


class PublishedSkills:
    VERSION = "0.4.3"
    DOWNLOAD_URL = "https://downloads.lorebo.com/lorebo/skills/stable"
    DOWNLOAD_TIMEOUT_SECONDS = 30
    DIGESTS = {
        Skill.CAPTURE: "6b3d47ca5ba8f0511fc6b6ce33a22ed34757cd54fec54e06d7f34d3452d5572d",
        Skill.EXPLORE: "2310e6ef43d68e79641c0b32a0f2cefab141e07cdf322d8ded5c52b7d71c215b",
    }

    def __init__(self) -> None:
        self._instructions: dict[Skill, str] = {}

    async def instructions(self, skill: Skill) -> str:
        cached = self._instructions.get(skill)

        if cached is not None:
            return cached

        package = await self._download(skill)
        digest = hashlib.sha256(package).hexdigest()

        if digest != PublishedSkills.DIGESTS[skill]:
            raise SkillPackageError(f"{skill} {PublishedSkills.VERSION} does not match its digest")

        instructions = SkillPackage.read_instructions(package, skill)
        self._instructions[skill] = instructions

        return instructions

    async def _download(self, skill: Skill) -> bytes:
        version = PublishedSkills.VERSION
        url = f"{PublishedSkills.DOWNLOAD_URL}/{version}/{skill}-{version}.zip"

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=PublishedSkills.DOWNLOAD_TIMEOUT_SECONDS,
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SkillPackageError(f"could not download {url}") from error

        return response.content


class SkillPackage:
    INSTRUCTIONS_FILE = "SKILL.md"

    @staticmethod
    def read_instructions(package: bytes, skill: Skill) -> str:
        prefix = f"{skill}/"

        try:
            archive = zipfile.ZipFile(io.BytesIO(package))
        except zipfile.BadZipFile as error:
            raise SkillPackageError(f"{skill} package is not a zip archive") from error

        documents: dict[str, str] = {}

        with archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue

                path = entry.filename

                if not path.startswith(prefix) or ".." in path.split("/") or "\\" in path:
                    raise SkillPackageError(f"{skill} package contains an unexpected path: {path}")

                if path.endswith(".md"):
                    documents[path.removeprefix(prefix)] = archive.read(entry).decode("utf-8")

        skill_document = documents.pop(SkillPackage.INSTRUCTIONS_FILE, None)

        if skill_document is None:
            raise SkillPackageError(f"{skill} package has no {SkillPackage.INSTRUCTIONS_FILE}")

        references = [f"# {path}\n\n{text}" for path, text in sorted(documents.items())]

        return "\n\n".join([skill_document, *references])
