from pydantic import BaseModel, Field
from typing import List, Optional

class AssetItem(BaseModel):
    id: str
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    session_title: Optional[str] = None
    name: str
    url: str
    file_type: str  # "image" | "document"
    mime_type: Optional[str] = None
    size_bytes: int = 0
    origin: str  # "upload" | "generated"
    prompt: Optional[str] = None
    created_at: str

class PaginatedAssetsResponse(BaseModel):
    items: List[AssetItem]
    total: int
    has_more: bool
    limit: int
    offset: int

class AssetDeleteResponse(BaseModel):
    message: str
    id: str
