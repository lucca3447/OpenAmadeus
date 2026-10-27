from typing import List, Optional
from pydantic import BaseModel, Field

class AddMemoryRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    category: str = Field(default="anecdote", max_length=40)
    content: str = Field(..., min_length=1, max_length=280)
    triggerKeywords: Optional[List[str]] = []
    emotionalWeight: Optional[str] = Field(default="Factual", max_length=80)
    source: Optional[str] = Field(default="custom", max_length=40)
