from typing import Any

from lorebo_sdk.errors import LockedBaseError
from lorebo_sdk.skills import Skill


class SkillToolPolicy:
    GOVERNANCE_TOOLS = frozenset(
        {
            "get_governance_scenario",
            "get_governance_scenarios_for_tool",
        }
    )
    BASE_DISCOVERY_TOOLS = frozenset(
        {
            "working_base_list_bases",
            "working_base_get_current_base",
        }
    )
    BASE_CREATION_TOOLS = frozenset(
        {
            "base_create_base",
        }
    )
    READ_TOOLS = frozenset(
        {
            "get_page",
            "get_pages",
            "list_pages",
            "search",
            "hybrid_search",
            "get_relevant_subgraph",
            "find_similar_notes",
            "get_page_ancestry",
            "get_inline_link",
            "get_graph_counts",
            "search_capability_status",
            "get_note_authoring_preferences",
        }
    )
    WRITE_TOOLS = frozenset(
        {
            "create_page",
            "update_page",
            "replace_in_page",
            "link_pages",
            "batch_link",
            "set_parent",
        }
    )

    def __init__(self, skill: Skill, base_ref: str | None) -> None:
        self._base_ref = base_ref
        self._available_tools = SkillToolPolicy.available_tools(skill, base_ref)

    def allows(self, tool_name: str) -> bool:
        return tool_name in self._available_tools

    def prepare_arguments(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if self._base_ref is None or not SkillToolPolicy.is_base_scoped(tool_name):
            return arguments

        requested_base_ref = arguments.get("base_ref")

        if requested_base_ref is not None and requested_base_ref != self._base_ref:
            raise LockedBaseError(tool_name, self._base_ref)

        return {**arguments, "base_ref": self._base_ref}

    @staticmethod
    def is_base_scoped(tool_name: str) -> bool:
        return tool_name in SkillToolPolicy.READ_TOOLS or tool_name in SkillToolPolicy.WRITE_TOOLS

    @staticmethod
    def available_tools(skill: Skill, base_ref: str | None) -> frozenset[str]:
        tools = SkillToolPolicy.GOVERNANCE_TOOLS | SkillToolPolicy.READ_TOOLS

        if skill is Skill.CAPTURE:
            tools |= SkillToolPolicy.WRITE_TOOLS

        if base_ref is None:
            tools |= SkillToolPolicy.BASE_DISCOVERY_TOOLS

        if base_ref is None and skill is Skill.CAPTURE:
            tools |= SkillToolPolicy.BASE_CREATION_TOOLS

        return tools
