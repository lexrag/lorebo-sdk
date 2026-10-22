from pydantic import BaseModel, ConfigDict


class Page(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    title: str
    base_ref: str


class Base(BaseModel):
    model_config = ConfigDict(frozen=True)

    base_ref: str
    label: str
    kind: str


class CaptureResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    summary: str
    created: list[Page]
    updated: list[Page]


class ExploreResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    answer: str
    sources: list[Page]
