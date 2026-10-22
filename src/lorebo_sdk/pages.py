from pydantic import BaseModel, ValidationError

from lorebo_sdk.errors import LoreboToolError
from lorebo_sdk.records import Page


class PageReference(BaseModel):
    id: str
    title: str


class PageItems(BaseModel):
    items: list[PageReference]


class HybridSearchResults(BaseModel):
    results: list[PageReference]


class RelevantSubgraph(BaseModel):
    nodes: list[PageReference]


class RunPages:
    CREATING_TOOLS = frozenset({"create_page"})
    UPDATING_TOOLS = frozenset({"update_page", "replace_in_page"})
    SINGLE_PAGE_TOOLS = frozenset({"get_page"})
    PAGE_ITEMS_TOOLS = frozenset({"get_pages", "list_pages", "search", "find_similar_notes"})

    def __init__(self) -> None:
        self._created: dict[str, Page] = {}
        self._updated: dict[str, Page] = {}
        self._seen: dict[str, Page] = {}

    @property
    def created(self) -> list[Page]:
        return list(self._created.values())

    @property
    def updated(self) -> list[Page]:
        return list(self._updated.values())

    def cited(self, page_ids: list[str]) -> list[Page]:
        pages: dict[str, Page] = {}

        for page_id in page_ids:
            page = self._seen.get(page_id)

            if page is not None:
                pages[page.id] = page

        return list(pages.values())

    def record(self, tool_name: str, base_ref: str, payload: object) -> None:
        references = RunPages.page_references(tool_name, payload)
        pages = [
            Page(id=reference.id, title=reference.title, base_ref=base_ref)
            for reference in references
        ]

        for page in pages:
            self._seen[page.id] = page

            if tool_name in RunPages.CREATING_TOOLS:
                self._created[page.id] = page

            if tool_name in RunPages.UPDATING_TOOLS:
                changed_pages = self._created if page.id in self._created else self._updated
                changed_pages[page.id] = page

    @staticmethod
    def page_references(tool_name: str, payload: object) -> list[PageReference]:
        try:
            if (
                tool_name in RunPages.CREATING_TOOLS
                or tool_name in RunPages.UPDATING_TOOLS
                or tool_name in RunPages.SINGLE_PAGE_TOOLS
            ):
                return [PageReference.model_validate(payload)]

            if tool_name in RunPages.PAGE_ITEMS_TOOLS:
                return PageItems.model_validate(payload).items

            if tool_name == "hybrid_search":
                return HybridSearchResults.model_validate(payload).results

            if tool_name == "get_relevant_subgraph":
                return RelevantSubgraph.model_validate(payload).nodes
        except ValidationError as error:
            raise LoreboToolError(tool_name, "the response does not describe pages") from error

        return []
