from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RunCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    model: str = Field(default="", max_length=120)
    params: dict = Field(default_factory=dict)
    notes: str = ""


class RunUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["running", "completed", "failed"] | None = None
    notes: str | None = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    model: str
    status: str
    params: dict
    notes: str
    created_at: datetime
    latest: dict[str, float] = Field(default_factory=dict)


class MetricIn(BaseModel):
    step: int = Field(ge=0)
    values: dict[str, float] = Field(min_length=1)


class PaperOut(BaseModel):
    id: int
    title: str
    filename: str
    chunks: int
    created_at: datetime


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    include_runs: bool = True


class Source(BaseModel):
    type: str
    title: str
    snippet: str


class AskOut(BaseModel):
    answer: str
    sources: list[Source]