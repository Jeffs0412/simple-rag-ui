"""Request and response models."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=20)

    @field_validator("question")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question must not be blank")
        return v


class SourceOut(BaseModel):
    heading: str
    text: str
    distance: float


class HealthOut(BaseModel):
    status: str
    chunks: int
    embed_model: str
    chat_model: str


class SourcesOut(BaseModel):
    headings: list[str]
    examples: list[str]
