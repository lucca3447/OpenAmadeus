from typing import List, Optional
from pydantic import BaseModel

class HistoryTurn(BaseModel):
    role: str  # "user" or "model" / "assistant"
    content: str

class LearnedMemoryInfo(BaseModel):
    id: Optional[str] = None
    title: str
    content: str
    emotionalWeight: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    sessionId: Optional[str] = None
    personaId: Optional[str] = "kurisu"
    lang: Optional[str] = "pt"
    systemEvent: Optional[str] = None
    apiKey: Optional[str] = None
    history: List[HistoryTurn] = []
    selectedModel: Optional[str] = None
    allowModelFallback: Optional[bool] = True
    allowOfflineSimulatorFallback: Optional[bool] = True

class ChatResponse(BaseModel):
    response: str
    emotion: str
    pose: Optional[str] = None
    camera: Optional[str] = None
    leadEmotion: Optional[str] = None
    leadPose: Optional[str] = None
    recalledMemories: List[str]
    sessionId: Optional[str] = None
    model: Optional[str] = None
    learnedMemory: Optional[LearnedMemoryInfo] = None
    error: Optional[str] = None
