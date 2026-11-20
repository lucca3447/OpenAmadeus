export type CanonicalEmotion = 
  | 'neutral'
  | 'wink'
  | 'annoyed'
  | 'worried'
  | 'sad'
  | 'happy'
  | 'stern'
  | 'blushing'
  | 'thinking'
  | 'eyes_closed'
  | 'surprised'
  | 'holding_back_tears'
  | 'disdain'
  | 'analytical';

export type LegacyEmotion = 
  | 'smile'
  | 'serious'
  | 'tsundere'
  | 'smug'
  | 'flustered'
  | 'puzzled'
  | 'desperate'
  | 'look_side';

export type Emotion = CanonicalEmotion | LegacyEmotion;

export type CharacterPose = 'default' | 'crossed_arms' | 'backview';
export type CameraFraming = 'closeup' | 'medium' | 'full';
export type CameraMode = 'auto' | CameraFraming;

export type MouthState = 'closed' | 'half' | 'open';
export type AppLanguage = 'pt' | 'en' | 'ja';
export type MicMode = 'ptt' | 'hands_free';
export type SttKeyMode = 'unified' | 'separate';
export type TtsFallbackEngine = 'qwen_local' | 'kokoro' | 'edge_rvc' | 'web_speech';
export type SettingsSectionId = 'cortex' | 'voice' | 'whisper' | 'display' | 'system';

export type IdleInitiativeMode = 'off' | 'silent' | 'voice';
export type AutonomousEventType = 'call_greeting' | 'idle_stage_1' | 'idle_stage_2';

export interface LLMFallbackSettings {
  allowModelFallback: boolean;
  allowOfflineSimulatorFallback: boolean;
  idleInitiativeMode?: IdleInitiativeMode;
}

export interface SpriteExpressionFrames {
  mouthClosed: string; // 00: mouth closed / idle
  mouthHalf: string;   // 01: mouth half-open / transition
  mouthOpen: string;   // 02: mouth fully open / apex
  blinkFrame?: string; // Matching closed-eyes frame (slot 'a')
}

export type MemorySource = 'canonical' | 'learned' | 'custom';

export interface MemoryItem {
  id: string;
  category: 'biography' | 'research' | 'relationship' | 'secret' | 'anecdote' | 'user';
  title: string;
  triggerKeywords: string[];
  content: string;
  emotionalWeight?: string;
  source?: MemorySource;
  createdAt?: number;
  distance?: number;
}

export interface PersonaProfile {
  id: string;
  name: string;
  codeName: string;
  title: string;
  description: string;
  affiliation: string;
  avatarPrefix: string;
  systemPrompt: string;
  languageProfiles?: Record<string, string>;
  canonicalVoicePrompt?: string;
  memories: MemoryItem[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'amadeus' | 'system';
  content: string;
  timestamp: number;
  emotion?: Emotion;
  pose?: CharacterPose;
  camera?: CameraFraming;
  recalledMemories?: string[];
  ttsResponse?: string;
}

export interface CallSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  messageCount?: number;
  messages?: ChatMessage[];
}

export interface VoiceSettings {
  enabled: boolean;
  voiceURI: string | null;
  rate: number;
  pitch: number;
  volume: number;
  autoSpeak: boolean;
  lang: string;
  uiLang?: AppLanguage;
  canonicalJpVoice?: boolean;
  engine?: 'qwen3' | 'kokoro' | 'edge_rvc';
  qwenMode?: 'remote' | 'local' | 'auto';
  qwenRemoteUrl?: string;
  stream?: boolean;
  useNeural?: boolean;
  neuralVoice?: string;
  useRvc?: boolean;
  rvcModel?: string;
  rvcPitch?: number;
  rvcIndexRate?: number;
  rvcProtect?: number;
  micMode?: MicMode;
  sttKeyMode?: SttKeyMode;
  separateGroqSttKey?: string;
  allowSttWebSpeechFallback?: boolean;
  vadSensitivity?: number;
  allowTtsFallback?: boolean;
  allowedTtsFallbacks?: TtsFallbackEngine[];
  defaultCameraMode?: CameraMode;
}

export interface QwenWorkerStatus {
  status: 'ready' | 'initializing' | 'offline' | 'error' | string;
  device?: string | null;
  vram_allocated_mb?: number | null;
  ping_ms?: number | null;
  mode: 'remote' | 'local';
  url?: string | null;
  error?: string | null;
}

export interface VoiceEngineStatus {
  qwen_remote: QwenWorkerStatus;
  qwen_local: QwenWorkerStatus;
  kokoro_available: boolean;
  rvc_available: boolean;
  rvc_models: string[];
  active_engine: string;
}

export interface ChatTurnMetrics {
  ts?: number;
  status: 'ok' | 'error' | 'aborted' | string;
  provider: string;
  model: string;
  stream: boolean;
  cold_start: boolean;
  rag_ms: number | null;
  model_discovery_ms: number | null;
  llm_fallback_attempts: number;
  llm_ttft_ms: number | null;
  llm_first_sentence_ms: number | null;
  llm_total_ms: number | null;
  total_ms: number | null;
  sentences_count: number;
  recalled_count: number;
  canonical_ja_tags: number;
  lang: string;
}

export interface AudioTurnMetrics {
  ttsEngine?: string;
  ttsMode?: string;
  ttsFallback?: boolean;
  ttsHandshakeMs?: number | null;
  ttsTtfbMs?: number | null;
  underruns: number;
}

export interface ClientTurnTelemetry {
  timestamp: number;
  e2eTtfaMs: number | null;
  sttMs: number | null;
  backend?: ChatTurnMetrics | null;
  audio?: AudioTurnMetrics | null;
}

export interface MetricSeriesSummary {
  count: number;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
}

export interface BackendMetricsSnapshot {
  uptimeSeconds: number;
  windowSize: number;
  counters: {
    chat_total: number;
    chat_errors: number;
    chat_aborts: number;
    llm_fallbacks: number;
    tts_total: number;
    tts_errors: number;
    tts_aborts: number;
    tts_fallbacks: number;
    chat_error_rate: number;
    tts_fallback_rate: number;
  };
  chat: {
    last: ChatTurnMetrics | null;
    rag_ms: MetricSeriesSummary;
    model_discovery_ms: MetricSeriesSummary;
    llm_ttft_ms: MetricSeriesSummary;
    llm_first_sentence_ms: MetricSeriesSummary;
    llm_total_ms: MetricSeriesSummary;
    total_ms: MetricSeriesSummary;
    cold_vs_warm: {
      cold_count: number;
      cold_avg_total_ms: number | null;
      cold_avg_discovery_ms: number | null;
      warm_count: number;
      warm_avg_total_ms: number | null;
      warm_avg_discovery_ms: number | null;
    };
  };
  tts: {
    last: Record<string, any> | null;
    handshake_ms: MetricSeriesSummary;
    ttfb_ms: MetricSeriesSummary;
    total_ms: MetricSeriesSummary;
    realtime_speed_x: MetricSeriesSummary;
    engines: Record<string, number>;
  };
  recent: {
    chat: ChatTurnMetrics[];
    tts: Record<string, any>[];
  };
}

