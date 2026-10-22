from dataclasses import dataclass
from typing import Any

import pydantic_ai
from fastmcp import Client
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.mcp import CallToolFunc, MCPToolset, ToolResult
from pydantic_ai.models import Model
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.usage import UsageLimits

from lorebo_sdk.errors import RunLimitError
from lorebo_sdk.pages import RunPages
from lorebo_sdk.skills import Skill, SkillSource
from lorebo_sdk.tools import SkillToolPolicy


class CaptureReport(BaseModel):
    summary: str = Field(
        description=(
            "One or two plain sentences for the application's user: "
            "what was saved, or why nothing was saved."
        )
    )


class ExploreReport(BaseModel):
    answer: str = Field(
        description="The answer to the prompt in plain text, based on the Lorebo pages read."
    )
    source_page_ids: list[str] = Field(description="IDs of the Lorebo pages the answer relies on.")


class BaseScopedArguments(BaseModel):
    base_ref: str


@dataclass(frozen=True)
class SkillRun[ReportT: BaseModel]:
    report: ReportT
    pages: RunPages


class SkillRunner:
    REQUEST_LIMIT = 24

    def __init__(
        self,
        model: Model,
        skills: SkillSource,
        mcp_client: Client[Any],
        base_ref: str | None,
    ) -> None:
        self._model = model
        self._skills = skills
        self._mcp_client = mcp_client
        self._base_ref = base_ref

        pydantic_ai.BANNER_ENABLED = False

    async def run[ReportT: BaseModel](
        self,
        skill: Skill,
        prompt: str,
        report_type: type[ReportT],
    ) -> SkillRun[ReportT]:
        skill_instructions = await self._skills.instructions(skill)
        policy = SkillToolPolicy(skill, self._base_ref)
        pages = RunPages()

        async def call_lorebo_tool(
            context: RunContext[None],
            call_tool: CallToolFunc,
            tool_name: str,
            arguments: dict[str, Any],
        ) -> ToolResult:
            prepared_arguments = policy.prepare_arguments(tool_name, arguments)
            result = await call_tool(tool_name, prepared_arguments)

            if SkillToolPolicy.is_base_scoped(tool_name):
                base_ref = BaseScopedArguments.model_validate(prepared_arguments).base_ref
                pages.record(tool_name, base_ref, result)

            return result

        def is_available(context: RunContext[None], tool: ToolDefinition) -> bool:
            return policy.allows(tool.name)

        toolset: MCPToolset[None] = MCPToolset(
            self._mcp_client,
            process_tool_call=call_lorebo_tool,
        )
        agent = Agent(
            self._model,
            instructions=SkillRunner.instructions(skill, skill_instructions, self._base_ref),
            output_type=report_type,
            deps_type=type(None),
            toolsets=[toolset.filtered(is_available)],
        )

        try:
            result = await agent.run(
                prompt,
                usage_limits=UsageLimits(request_limit=SkillRunner.REQUEST_LIMIT),
            )
        except UsageLimitExceeded as error:
            raise RunLimitError(SkillRunner.REQUEST_LIMIT) from error

        return SkillRun(report=result.output, pages=pages)

    @staticmethod
    def instructions(skill: Skill, skill_instructions: str, base_ref: str | None) -> str:
        if base_ref is not None:
            base_rule = (
                f"This run is locked to the base {base_ref}. "
                "Pass that base_ref on every call that takes one. Other bases are not available."
            )
        elif skill is Skill.CAPTURE:
            base_rule = (
                "No base is preselected. List the bases and choose the one this knowledge "
                "belongs to, or create one when none fits. Pass its base_ref on every call "
                "that takes one."
            )
        else:
            base_rule = (
                "No base is preselected. List the bases and choose the one that holds this "
                "knowledge. Pass its base_ref on every call that takes one."
            )

        if skill is Skill.CAPTURE:
            final_report_rule = (
                "Its summary is shown to the application's user. State what was saved, or why "
                "nothing was saved."
            )
        else:
            final_report_rule = (
                "Its answer is shown to the application's user. Answer the prompt directly from "
                "the pages you read, and put the IDs of the pages it relies on in "
                "source_page_ids instead of listing sources in the answer."
            )

        return "\n\n".join(
            [
                skill_instructions,
                "# Lorebo SDK run",
                (
                    f"You are running the {skill} skill for an application through the Lorebo "
                    "SDK. The run is unattended: nobody can answer questions or confirm steps. "
                    "The application's prompt is the whole task and its only source material."
                ),
                base_rule,
                (
                    "Governance tools read Lorebo's managed governance base. "
                    "They do not change the target base."
                ),
                (
                    f"When the work is done, return the final report. {final_report_rule} "
                    "Write that text plainly, without Markdown, page IDs, tool names, or a "
                    "description of your reasoning and steps."
                ),
            ]
        )
