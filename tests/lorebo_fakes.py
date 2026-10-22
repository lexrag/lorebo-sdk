from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import BaseModel
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from lorebo_sdk.skills import Skill


class FakePage(BaseModel):
    id: str
    title: str
    content: str


class FakePageItems(BaseModel):
    items: list[FakePage]


class FakeBase(BaseModel):
    base_ref: str
    label: str
    kind: str
    entry_id: str


class FakeBaseList(BaseModel):
    items: list[FakeBase]


class FakeCreatedBase(BaseModel):
    entry_id: str
    display_name: str
    path: str


class FakeLorebo:
    def __init__(self, pages: list[FakePage], bases: list[FakeBase]) -> None:
        self.pages = {page.id: page for page in pages}
        self.bases = bases
        self.received_base_refs: list[str] = []
        self.server = FastMCP("fake-lorebo")

        self.server.tool(self.create_page)
        self.server.tool(self.update_page)
        self.server.tool(self.get_page)
        self.server.tool(self.search)
        self.server.tool(self.working_base_list_bases)
        self.server.tool(self.base_create_base)
        self.server.tool(self.base_delete_base)

    def create_page(self, title: str, content: str, base_ref: str) -> FakePage:
        self.received_base_refs.append(base_ref)
        page = FakePage(id=f"page-{len(self.pages) + 1}", title=title, content=content)
        self.pages[page.id] = page

        return page

    def update_page(self, page_id: str, content: str, base_ref: str) -> FakePage:
        self.received_base_refs.append(base_ref)
        page = self.pages[page_id].model_copy(update={"content": content})
        self.pages[page.id] = page

        return page

    def get_page(self, identifier: str, base_ref: str) -> FakePage:
        self.received_base_refs.append(base_ref)

        return self.pages[identifier]

    def search(self, query: str, base_ref: str) -> FakePageItems:
        self.received_base_refs.append(base_ref)
        matches = [page for page in self.pages.values() if query in page.content]

        return FakePageItems(items=matches)

    def working_base_list_bases(self) -> FakeBaseList:
        return FakeBaseList(items=self.bases)

    def base_create_base(self, display_name: str, path: str, activate: bool) -> FakeCreatedBase:
        if not path.endswith(".db"):
            raise ToolError(f"{path} is not a database path")

        entry_id = f"entry-{len(self.bases) + 1}"
        self.bases.append(
            FakeBase(
                base_ref=f"local:{entry_id}",
                label=display_name,
                kind="local",
                entry_id=entry_id,
            )
        )

        return FakeCreatedBase(entry_id=entry_id, display_name=display_name, path=path)

    def base_delete_base(self, entry_id: str) -> FakeBaseList:
        return FakeBaseList(items=self.bases)


class ScriptedModel:
    def __init__(
        self, tool_calls: list[tuple[str, dict[str, Any]]], report: dict[str, Any]
    ) -> None:
        self._tool_calls = tool_calls
        self._report = report
        self.available_tools: list[str] = []
        self.model = FunctionModel(self.respond)

    def respond(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        self.available_tools = sorted(tool.name for tool in info.function_tools)
        step = len([message for message in messages if message.kind == "response"])

        if step < len(self._tool_calls):
            tool_name, arguments = self._tool_calls[step]

            return ModelResponse(
                parts=[
                    ToolCallPart(tool_name=tool_name, args=arguments, tool_call_id=f"call-{step}")
                ]
            )

        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name=info.output_tools[0].name,
                    args=self._report,
                    tool_call_id="report",
                )
            ]
        )


class MemorySkills:
    async def instructions(self, skill: Skill) -> str:
        return f"Follow the {skill} workflow."
