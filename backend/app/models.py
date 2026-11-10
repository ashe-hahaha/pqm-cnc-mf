from typing import Literal

from pydantic import BaseModel


class Asset(BaseModel):
    id: str
    code: str
    name: str
    level: Literal["enterprise", "plant", "cell", "machine"]
    parentId: str | None = None
    active: bool = True


class Hierarchy(BaseModel):
    assets: list[Asset]
