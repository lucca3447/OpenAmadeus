import { AutonomousEventType, CameraFraming, CharacterPose, ChatMessage, Emotion, MemoryItem, CallSession, QwenWorkerStatus, VoiceEngineStatus } from '../types/amadeus';

export const BACKEND_URL =
  ((import.meta as any).env?.VITE_API_URL as string) || 'http://localhost:8000';

export interface BackendHealth {
  status: string;
  system: string;
  database: string;
  vectorStore: string;
  chromaCount: number;
  totalMemories: number;
  totalSessions: number;
  edgeTtsAvailable: boolean;
}

export interface BackendChatResponse {
  response: string;
  emotion: Emotion;
  pose?: CharacterPose;
  camera?: CameraFraming;
  leadEmotion?: Emotion;
  leadPose?: CharacterPose;
  recalledMemories: string[];
  sessionId?: string;
  model?: string;
  learnedMemory?: {
    id?: string;
    title: string;
    content: string;
    emotionalWeight?: string;
  };
  error?: string;
  /** true when the stream was cancelled (barge-in / new message) before any sentence arrived */
  aborted?: boolean;
}

export interface ChatStreamHandlers {
  onMeta?: (meta: { emotion: Emotion; pose?: CharacterPose; camera?: CameraFraming }) => void;
  onSentence?: (
    text: string,
    index: number,
    visual?: { emotion: Emotion; pose?: CharacterPose; camera?: CameraFraming }
  ) => void;
}

export class BackendService {
  private static chatStreamCtrl: AbortController | null = null;
  private static isAvailable: boolean | null = null;
  private static lastCheckTime = 0;
  private static CHECK_INTERVAL_MS = 15000; // Check health every 15s

  /**
   * Probes if the local FastAPI Python backend (SQLite + ChromaDB) is running
   */
  static async checkHealth(): Promise<BackendHealth | null> {
    const now = Date.now();
    if (this.isAvailable !== null && now - this.lastCheckTime < this.CHECK_INTERVAL_MS) {
      if (!this.isAvailable) return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${BACKEND_URL}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        this.isAvailable = true;
        this.lastCheckTime = now;
        return data as BackendHealth;
      }
    } catch {
      // Backend not running
    }

    this.isAvailable = false;
    this.lastCheckTime = now;
    return null;
  }

  static getIsAvailableCached(): boolean {
    return this.isAvailable === true;
  }

  /**
   * Queries OpenAmadeus via the Python backend (with ChromaDB semantic retrieval & SQLite persistence)
   */
  private static chatBody(
    message: string,
    sessionId: string | null,
    apiKey: string,
    history: ChatMessage[],
    selectedModel: string | undefined,
    allowModelFallback: boolean,
    allowOfflineSimulatorFallback: boolean,
    systemEvent?: AutonomousEventType
  ): string {
    const formattedHistory = history.slice(-20).map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      content:
        msg.sender !== 'user' && msg.emotion
          ? `<!--emotion:${msg.emotion},pose:${msg.pose || 'default'},camera:${msg.camera || 'closeup'}--> ${msg.content}`
          : msg.content,
    }));

    return JSON.stringify({
      message,
      sessionId,
      personaId: 'kurisu',
      systemEvent: systemEvent || null,
      apiKey: apiKey || null,
      history: formattedHistory,
      selectedModel: selectedModel || null,
      allowModelFallback,
      allowOfflineSimulatorFallback,
    });
  }

  static async queryChat(
    message: string,
    sessionId: string | null,
    apiKey: string,
    history: ChatMessage[],
    selectedModel?: string,
    allowModelFallback: boolean = true,
    allowOfflineSimulatorFallback: boolean = true,
    systemEvent?: AutonomousEventType
  ): Promise<BackendChatResponse> {
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this.chatBody(message, sessionId, apiKey, history, selectedModel, allowModelFallback, allowOfflineSimulatorFallback, systemEvent),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Erro no servidor Python');
      throw new Error(`[Backend ${res.status}] ${errorText}`);
    }

    return (await res.json()) as BackendChatResponse;
  }

  /** Aborts the in-flight /chat/stream (barge-in or a newer message); the backend stops the LLM on disconnect. */
  static cancelChatStream(): void {
    this.chatStreamCtrl?.abort();
    this.chatStreamCtrl = null;
  }

  /**
   * SSE variant of queryChat (v0.2.2). Throws only when nothing was received (caller falls back to queryChat);
   * a stream cut after the first sentence resolves with the sentences already delivered.
   */
  static async queryChatStream(
    message: string,
    sessionId: string | null,
    apiKey: string,
    history: ChatMessage[],
    selectedModel: string | undefined,
    allowModelFallback: boolean,
    allowOfflineSimulatorFallback: boolean,
    systemEvent: AutonomousEventType | undefined,
    handlers: ChatStreamHandlers
  ): Promise<BackendChatResponse> {
    this.cancelChatStream();
    const ctrl = new AbortController();
    this.chatStreamCtrl = ctrl;

    const spoken: string[] = [];
    let lastMeta: { emotion: Emotion; pose?: CharacterPose; camera?: CameraFraming } | null = null;
    let finalResponse: BackendChatResponse | null = null;

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: this.chatBody(message, sessionId, apiKey, history, selectedModel, allowModelFallback, allowOfflineSimulatorFallback, systemEvent),
      });
      if (!res.ok || !res.body) {
        const errorText = await res.text().catch(() => 'Erro no servidor Python');
        throw new Error(`[Backend ${res.status}] ${errorText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.event === 'meta') {
            lastMeta = { emotion: ev.emotion, pose: ev.pose ?? undefined, camera: ev.camera ?? undefined };
            handlers.onMeta?.(lastMeta);
          } else if (ev.event === 'sentence') {
            spoken.push(ev.text);
            const visual: { emotion: Emotion; pose?: CharacterPose; camera?: CameraFraming } | undefined = ev.emotion
              ? { emotion: ev.emotion as Emotion, pose: (ev.pose ?? undefined) as CharacterPose | undefined, camera: (ev.camera ?? undefined) as CameraFraming | undefined }
              : lastMeta ?? undefined;
            if (visual) lastMeta = visual;
            handlers.onSentence?.(ev.text, ev.index, visual);
          } else if (ev.event === 'done') {
            finalResponse = ev.response as BackendChatResponse;
          } else if (ev.event === 'error') {
            console.warn('[OpenAmadeus] Chat stream cut by provider:', ev.message);
          }
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted && spoken.length === 0) throw err;
      if (!ctrl.signal.aborted) console.warn('[OpenAmadeus] Chat stream interrupted:', err);
    } finally {
      if (this.chatStreamCtrl === ctrl) this.chatStreamCtrl = null;
    }

    if (finalResponse) return finalResponse;
    if (spoken.length === 0) {
      if (ctrl.signal.aborted) return { response: '', emotion: 'neutral', recalledMemories: [], aborted: true };
      throw new Error('[Backend] Stream de chat vazio');
    }
    return {
      response: spoken.join(' '),
      emotion: lastMeta?.emotion ?? 'neutral',
      pose: lastMeta?.pose,
      camera: lastMeta?.camera,
      recalledMemories: [],
    };
  }

  /**
   * Retrieves all memories from ChromaDB + SQLite
   */
  static async getMemories(): Promise<MemoryItem[]> {
    const res = await fetch(`${BACKEND_URL}/api/memories`);
    if (!res.ok) throw new Error('Falha ao buscar memórias do servidor');
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map((m: any) => ({
      ...m,
      triggerKeywords: Array.isArray(m.triggerKeywords) ? m.triggerKeywords : [],
    }));
  }

  /**
   * Adds a new memory to ChromaDB + SQLite
   */
  static async addMemory(memory: {
    category: string;
    title: string;
    content: string;
    emotionalWeight?: string;
    source?: string;
  }): Promise<MemoryItem> {
    const res = await fetch(`${BACKEND_URL}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memory),
    });
    if (!res.ok) throw new Error('Falha ao adicionar memória no servidor');
    return res.json();
  }

  /**
   * Deletes a memory from ChromaDB + SQLite
   */
  static async deleteMemory(memoryId: string): Promise<boolean> {
    const res = await fetch(`${BACKEND_URL}/api/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  /**
   * Clears all learned memories from ChromaDB + SQLite
   */
  static async clearLearnedMemories(): Promise<boolean> {
    const res = await fetch(`${BACKEND_URL}/api/memories`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  /**
   * Lists all sessions from SQLite
   */
  static async listSessions(): Promise<CallSession[]> {
    const res = await fetch(`${BACKEND_URL}/api/sessions`);
    if (!res.ok) return [];
    return res.json();
  }

  /**
   * Creates a new session in SQLite
   */
  static async createSession(): Promise<string> {
    const res = await fetch(`${BACKEND_URL}/api/sessions/new`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao criar sessão');
    const data = await res.json();
    return data.sessionId;
  }

  /**
   * Retrieves messages for a specific session from SQLite
   */
  static async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const res = await fetch(`${BACKEND_URL}/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    if (!res.ok) return [];
    return res.json();
  }

  /**
   * Deletes a session from SQLite
   */
  static async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      return res.ok;
    } catch {}
    return false;
  }

  /**
   * Pings Qwen-TTS worker (remote or local) via backend proxy
   */
  static async pingQwenWorker(remoteUrl?: string): Promise<QwenWorkerStatus> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/voice/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteUrl }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return {
      status: 'offline',
      mode: remoteUrl ? 'remote' : 'local',
      error: 'Backend proxy unreachable',
    };
  }

  /**
   * Checks full modular voice engine status
   */
  static async getVoiceStatus(remoteUrl?: string): Promise<VoiceEngineStatus | null> {
    try {
      const q = remoteUrl ? `?remote_url=${encodeURIComponent(remoteUrl)}` : '';
      const res = await fetch(`${BACKEND_URL}/api/voice/status${q}`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Discovers available RVC and engine voice models
   */
  static async getVoiceModels(): Promise<{ rvc_models: string[]; kokoro_voices: string[]; edge_voices: string[] } | null> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/voice/models`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return null;
  }
}
