"""Settings, loaded from the environment / .env. The API key never leaves this process."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    openai_api_key: str

    # corpus + index
    docs_path: Path = REPO_DIR / "docs" / "sample_docs.md"
    chroma_path: Path = BACKEND_DIR / ".chroma"

    # models
    embed_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"
    top_k: int = 2

    # Local-only app: the origin is the Vite dev server. Sane caps are kept
    # because a runaway loop in the UI would spend real money, not because of abuse.
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_history_turns: int = 6
    max_output_tokens: int = 500

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
