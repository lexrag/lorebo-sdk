from typing import Any, Self

from fastmcp import Client
from fastmcp.exceptions import ToolError
from pydantic import BaseModel, ValidationError
from pydantic_ai.models import Model, infer_model

from lorebo_sdk.errors import LockedBaseError, LoreboToolError
from lorebo_sdk.records import Base, CaptureResult, ExploreResult
from lorebo_sdk.runs import CaptureReport, ExploreReport, SkillRunner
from lorebo_sdk.skills import PublishedSkills, Skill, SkillSource


class ListedBase(BaseModel):
    base_ref: str
    label: str
    kind: str
    entry_id: str


class BaseList(BaseModel):
    items: list[ListedBase]


class CreatedBase(BaseModel):
    entry_id: str


class Lorebo:
    def __init__(
        self,
        mcp_client: Client[Any],
        model: Model,
        skills: SkillSource,
        base_ref: str | None,
    ) -> None:
        self._mcp_client = mcp_client
        self._base_ref = base_ref
        self._runner = SkillRunner(model, skills, mcp_client, base_ref)

    @classmethod
    def from_url(
        cls,
        *,
        url: str,
        token: str | None,
        model: Model | str,
        base_ref: str | None,
    ) -> Self:
        return cls(
            mcp_client=Client(url, auth=token),
            model=infer_model(model),
            skills=PublishedSkills(),
            base_ref=base_ref,
        )

    async def capture(self, prompt: str) -> CaptureResult:
        run = await self._runner.run(Skill.CAPTURE, prompt, CaptureReport)

        return CaptureResult(
            summary=run.report.summary,
            created=run.pages.created,
            updated=run.pages.updated,
        )

    async def explore(self, prompt: str) -> ExploreResult:
        run = await self._runner.run(Skill.EXPLORE, prompt, ExploreReport)

        return ExploreResult(
            answer=run.report.answer,
            sources=run.pages.cited(run.report.source_page_ids),
        )

    async def list_bases(self) -> list[Base]:
        listed_bases = await self._list_bases()

        return [
            Base(base_ref=listed.base_ref, label=listed.label, kind=listed.kind)
            for listed in listed_bases
        ]

    async def create_base(self, label: str, path: str, activate: bool) -> Base:
        if self._base_ref is not None:
            raise LockedBaseError("base_create_base", self._base_ref)

        created = await self._call_tool(
            "base_create_base",
            {"display_name": label, "path": path, "activate": activate},
            CreatedBase,
        )
        listed_bases = await self._list_bases()

        for listed in listed_bases:
            if listed.entry_id == created.entry_id:
                return Base(base_ref=listed.base_ref, label=listed.label, kind=listed.kind)

        raise LoreboToolError("base_create_base", f"base {created.entry_id} is not listed")

    async def _list_bases(self) -> list[ListedBase]:
        base_list = await self._call_tool("working_base_list_bases", {}, BaseList)

        return base_list.items

    async def _call_tool[ResponseT: BaseModel](
        self,
        tool_name: str,
        arguments: dict[str, Any],
        response_type: type[ResponseT],
    ) -> ResponseT:
        try:
            async with self._mcp_client:
                result = await self._mcp_client.call_tool(tool_name, arguments)
        except ToolError as error:
            raise LoreboToolError(tool_name, str(error)) from error

        try:
            return response_type.model_validate(result.structured_content)
        except ValidationError as error:
            raise LoreboToolError(tool_name, "the response has an unexpected shape") from error
