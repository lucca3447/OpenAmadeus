export type CanonicalEmotion = 
  | 'neutral'
  | 'wink'
  | 'annoyed'
  | 'worried'
  | 'disdain'
  | 'happy'
  | 'stern'
  | 'blushing'
  | 'look_side'
  | 'eyes_closed'
  | 'analytical'
  | 'holding_back_tears';

export type LegacyEmotion = 
  | 'smile'
  | 'serious'
  | 'surprised'
  | 'tsundere'
  | 'thinking'
  | 'smug'
  | 'flustered'
  | 'sad'
  | 'puzzled'
  | 'desperate';

export type Emotion = CanonicalEmotion | LegacyEmotion;

export type CharacterPose = 'default' | 'crossed_arms' | 'backview';

export type MouthState = 'closed' | 'half' | 'open';

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
  memories: MemoryItem[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'amadeus' | 'system';
  content: string;
  timestamp: number;
  emotion?: Emotion;
  pose?: CharacterPose;
  recalledMemories?: string[];
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

