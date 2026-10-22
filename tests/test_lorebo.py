from typing import Any

import pytest
from fastmcp import Client

from lorebo_sdk.client import Lorebo
from lorebo_sdk.errors import LockedBaseError, LoreboToolError
from lorebo_sdk.records import Base, Page
from tests.lorebo_fakes import FakeBase, FakeLorebo, FakePage, MemorySkills, ScriptedModel

LOCKED_BASE = "local:notes"


def fake_lorebo() -> FakeLorebo:
    return FakeLorebo(
        pages=[
            FakePage(id="page-ports", title="Port policy", content="Ports stay on loopback."),
            FakePage(id="page-backups", title="Backups", content="Backups run nightly."),
        ],
        bases=[
            FakeBase(base_ref=LOCKED_BASE, label="notes", kind="local", entry_id="notes"),
            FakeBase(
                base_ref="managed:ggl", label="Graph Governance", kind="managed", entry_id="ggl"
            ),
        ],
    )


def lorebo_client(
    lorebo: FakeLorebo,
    tool_calls: list[tuple[str, dict[str, Any]]],
    report: dict[str, Any],
    base_ref: str | None,
) -> tuple[Lorebo, ScriptedModel]:
    model = ScriptedModel(tool_calls, report)
    client = Lorebo(
        mcp_client=Client(lorebo.server),
        model=model.model,
        skills=MemorySkills(),
        base_ref=base_ref,
    )

    return client, model


async def test_capture_reports_each_created_and_updated_page_once() -> None:
    lorebo = fake_lorebo()
    client, _ = lorebo_client(
        lorebo,
        [
            ("search", {"query": "loopback", "base_ref": LOCKED_BASE}),
            (
                "create_page",
                {"title": "HTTP port", "content": "Port 8757.", "base_ref": LOCKED_BASE},
            ),
            (
                "update_page",
                {"page_id": "page-3", "content": "Port 8758.", "base_ref": LOCKED_BASE},
            ),
            (
                "update_page",
                {"page_id": "page-ports", "content": "Loopback.", "base_ref": LOCKED_BASE},
            ),
            (
                "update_page",
                {"page_id": "page-ports", "content": "Loopback!", "base_ref": LOCKED_BASE},
            ),
        ],
        {"summary": "Saved the HTTP port and refined the port policy."},
        LOCKED_BASE,
    )

    result = await client.capture("The HTTP port is 8758 and stays on loopback.")

    assert result.summary == "Saved the HTTP port and refined the port policy."
    assert result.created == [Page(id="page-3", title="HTTP port", base_ref=LOCKED_BASE)]
    assert result.updated == [Page(id="page-ports", title="Port policy", base_ref=LOCKED_BASE)]


async def test_locked_capture_sends_the_locked_base_when_the_model_omits_it() -> None:
    lorebo = fake_lorebo()
    client, _ = lorebo_client(
        lorebo,
        [("create_page", {"title": "HTTP port", "content": "Port 8758."})],
        {"summary": "Saved the HTTP port."},
        LOCKED_BASE,
    )

    result = await client.capture("The HTTP port is 8758.")

    assert lorebo.received_base_refs == [LOCKED_BASE]
    assert result.created == [Page(id="page-3", title="HTTP port", base_ref=LOCKED_BASE)]


async def test_locked_capture_stops_when_the_model_targets_another_base() -> None:
    lorebo = fake_lorebo()
    client, _ = lorebo_client(
        lorebo,
        [("create_page", {"title": "Elsewhere", "content": "No.", "base_ref": "local:other"})],
        {"summary": "Saved."},
        LOCKED_BASE,
    )

    with pytest.raises(LockedBaseError):
        await client.capture("Save this somewhere else.")

    assert lorebo.received_base_refs == []


async def test_explore_returns_only_cited_pages_that_the_run_read() -> None:
    lorebo = fake_lorebo()
    client, _ = lorebo_client(
        lorebo,
        [
            ("search", {"query": "o", "base_ref": LOCKED_BASE}),
            ("get_page", {"identifier": "page-ports", "base_ref": LOCKED_BASE}),
        ],
        {
            "answer": "Ports stay on loopback.",
            "source_page_ids": ["page-ports", "page-invented", "page-ports"],
        },
        LOCKED_BASE,
    )

    result = await client.explore("Where do ports listen?")

    assert result.answer == "Ports stay on loopback."
    assert result.sources == [Page(id="page-ports", title="Port policy", base_ref=LOCKED_BASE)]


async def test_locked_explore_sees_only_reading_tools() -> None:
    client, model = lorebo_client(
        fake_lorebo(), [], {"answer": "", "source_page_ids": []}, LOCKED_BASE
    )

    await client.explore("Anything?")

    assert model.available_tools == ["get_page", "search"]


async def test_unlocked_capture_can_choose_and_create_a_base_but_not_delete_one() -> None:
    client, model = lorebo_client(fake_lorebo(), [], {"summary": "Nothing to save."}, None)

    await client.capture("Nothing durable.")

    assert model.available_tools == [
        "base_create_base",
        "create_page",
        "get_page",
        "search",
        "update_page",
        "working_base_list_bases",
    ]


async def test_list_bases_returns_every_base() -> None:
    client, _ = lorebo_client(fake_lorebo(), [], {}, None)

    bases = await client.list_bases()

    assert bases == [
        Base(base_ref=LOCKED_BASE, label="notes", kind="local"),
        Base(base_ref="managed:ggl", label="Graph Governance", kind="managed"),
    ]


async def test_create_base_returns_the_listed_base() -> None:
    client, _ = lorebo_client(fake_lorebo(), [], {}, None)

    base = await client.create_base("research", "/data/research.db", False)

    assert base == Base(base_ref="local:entry-3", label="research", kind="local")


async def test_create_base_reports_a_lorebo_tool_error() -> None:
    client, _ = lorebo_client(fake_lorebo(), [], {}, None)

    with pytest.raises(LoreboToolError, match="not a database path"):
        await client.create_base("research", "/data/research", False)


async def test_locked_client_refuses_to_create_a_base() -> None:
    client, _ = lorebo_client(fake_lorebo(), [], {}, LOCKED_BASE)

    with pytest.raises(LockedBaseError):
        await client.create_base("research", "/data/research.db", False)
