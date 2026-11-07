import { AutonomousEventType, CameraFraming, CharacterPose, ChatMessage, Emotion, MemoryItem, PersonaProfile } from '../types/amadeus';
import { BackendService, type ChatStreamHandlers } from './backendService';
import { MemoryService } from './memoryService';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Preferred Gemini models, in order. Prioritizing 2.5 and 1.5 avoids the temporary 503 spike on 3.8.
const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

/** Sentinel model ID selected in the UI to force the local offline simulator. */
export const OFFLINE_MODEL_ID = 'offline';

export type AIProvider = 'offline' | 'groq' | 'openrouter' | 'gemini';

export interface ModelOption {
  id: string;
  label: string;
  provider: AIProvider;
  isRecommended?: boolean;
  isDecommissioned?: boolean;
}

export const OFFLINE_ONLY_OPTION: ModelOption = {
  id: OFFLINE_MODEL_ID,
  label: 'Simulador Local Offline',
  provider: 'offline',
  isRecommended: true,
};

export const OFFLINE_MODEL_OPTION: ModelOption = {
  id: OFFLINE_MODEL_ID,
  label: 'Simulação Offline',
  provider: 'offline',
};

export const GROQ_DEFAULT_MODELS: ModelOption[] = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Versatile)', provider: 'groq', isRecommended: true },
  { id: 'qwen-2.5-32b', label: 'Qwen 2.5 32B', provider: 'groq' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', provider: 'groq' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Instant)', provider: 'groq' },
];

export const OPENROUTER_DEFAULT_MODELS: ModelOption[] = [
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (Free)', provider: 'openrouter', isRecommended: true },
  { id: 'liquid/lfm-2.5-2.6b:free', label: 'Liquid LFM 2.5 (Free)', provider: 'openrouter' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 (Free)', provider: 'openrouter' },
  { id: 'poolside/laguna-s-2.1:free', label: 'Laguna S 2.1 (Free)', provider: 'openrouter' },
];

export const GEMINI_DEFAULT_MODELS: ModelOption[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', isRecommended: true },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'gemini' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini' },
];

/** Legacy fallback list, mapped to Gemini defaults + offline. */
export const MODEL_OPTIONS: { id: string; label: string }[] = [
  ...GEMINI_DEFAULT_MODELS.map((m) => ({ id: m.id, label: m.label })),
  { id: OFFLINE_MODEL_ID, label: 'Simulação Offline' },
];

export function isOpenRouterKey(key: string): boolean {
  return key.trim().startsWith('sk-or-');
}

export function isGroqKey(key: string): boolean {
  return key.trim().startsWith('gsk_');
}

export function getProviderFromKey(key?: string | null): AIProvider {
  if (!key || !key.trim()) return 'offline';
  const trimmed = key.trim();
  if (isGroqKey(trimmed)) return 'groq';
  if (isOpenRouterKey(trimmed)) return 'openrouter';
  return 'gemini';
}

/** Formats a raw model ID into an elegant user-facing display label */
export function formatModelOptionLabel(id: string, provider: AIProvider): string {
  if (id === OFFLINE_MODEL_ID) {
    return 'Simulação Offline';
  }

  if (provider === 'groq') {
    if (id.includes('llama-3.3-70b')) return 'Llama 3.3 70B (Versatile)';
    if (id.includes('llama-3.1-8b')) return 'Llama 3.1 8B (Instant)';
    if (id.includes('qwen-2.5-32b')) return 'Qwen 2.5 32B';
    if (id.includes('qwen3.8-27b') || id.includes('qwen')) return 'Qwen (Groq)';
    if (id.includes('gpt-oss-120b')) return 'GPT-OSS 120B';
    const clean = id.replace(/^(meta-llama\/|openai\/|qwen\/)/i, '');
    return clean;
  }

  if (provider === 'openrouter') {
    const clean = id.replace(':free', '').replace(/^(google\/|liquid\/|nvidia\/|poolside\/|meta-llama\/|dots-studio\/)/i, '');
    if (clean.includes('gemma-4')) return `Gemma 4 (${clean}) (Free)`;
    if (clean.includes('lfm')) return `Liquid LFM (${clean}) (Free)`;
    if (clean.includes('nemotron')) return `Nemotron (${clean}) (Free)`;
    if (clean.includes('laguna')) return `Laguna (${clean}) (Free)`;
    return `${clean} (Free)`;
  }

  if (provider === 'gemini') {
    if (id === 'gemini-2.5-flash') return 'Gemini 2.5 Flash';
    if (id === 'gemini-2.5-flash-lite') return 'Gemini 2.5 Flash Lite';
    if (id === 'gemini-2.5-pro') return 'Gemini 2.5 Pro';
    if (id === 'gemini-1.5-flash') return 'Gemini 1.5 Flash';
    if (id === 'gemini-1.5-pro') return 'Gemini 1.5 Pro';
    return id;
  }

  return id;
}

/** Synchronous, non-blocking resolver for model options (Cache + Default Catalogs) */
export function getModelOptionsForKey(key?: string | null): ModelOption[] {
  const provider = getProviderFromKey(key);
  if (provider === 'offline') {
    return [OFFLINE_ONLY_OPTION];
  }

  const cacheKey = `amadeus_cached_models_${provider}`;
  const cachedJson = localStorage.getItem(cacheKey);
  if (cachedJson) {
    try {
      const parsed: ModelOption[] = JSON.parse(cachedJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const withoutOffline = parsed.filter((m) => m.id !== OFFLINE_MODEL_ID);
        return [...withoutOffline, OFFLINE_MODEL_OPTION];
      }
    } catch {
      // Fallback to default catalog
    }
  }

  if (provider === 'groq') {
    return [...GROQ_DEFAULT_MODELS, OFFLINE_MODEL_OPTION];
  }
  if (provider === 'openrouter') {
    return [...OPENROUTER_DEFAULT_MODELS, OFFLINE_MODEL_OPTION];
  }
  return [...GEMINI_DEFAULT_MODELS, OFFLINE_MODEL_OPTION];
}

const MODEL_CACHE_KEY = 'amadeus_model';
const MODEL_CACHE_FINGERPRINT = 'amadeus_model_key_fp';
const MAX_HISTORY_MESSAGES = 20;

const VALID_EMOTIONS: Emotion[] = [
  // Canonical 12
  'neutral',
  'wink',
  'annoyed',
  'worried',
  'disdain',
  'happy',
  'stern',
  'blushing',
  'look_side',
  'eyes_closed',
  'analytical',
  'holding_back_tears',
  // Legacy & Poses
  'smile',
  'serious',
  'surprised',
  'tsundere',
  'thinking',
  'smug',
  'flustered',
  'sad',
  'puzzled',
  'desperate',
];

export type AIStatus =
  | { kind: 'offline' }
  | { kind: 'pending' }
  | { kind: 'online'; model: string }
  | { kind: 'error'; message: string };

export interface LearnedMemoryInfo {
  id?: string;
  title: string;
  content: string;
  emotionalWeight?: string;
}

export interface AIResult {
  response: string;
  emotion: Emotion;
  pose?: CharacterPose;
  camera?: CameraFraming;
  leadEmotion?: Emotion;
  leadPose?: CharacterPose;
  recalledMemories?: string[];
  status: AIStatus;
  /** true when the response is an error report, not something Amadeus "said" */
  isError: boolean;
  learnedMemory?: LearnedMemoryInfo;
  sessionId?: string;
  fallbackModel?: string;
  decommissionNotice?: string;
  /** stream cancelled before any sentence (barge-in / newer message) */
  aborted?: boolean;
}

/** Error from the Gemini/Groq/OpenRouter API, carrying the HTTP status (0 = network / empty response). */
export class GeminiError extends Error {
  constructor(public code: number, public apiMessage: string) {
    super(`API error ${code}: ${apiMessage}`);
  }

  /** Short, user-facing explanation in Portuguese */
  get friendly(): string {
    switch (this.code) {
      case 400:
        return /api key/i.test(this.apiMessage)
          ? 'Chave de API inválida. Verifique a chave inserida e cole sem espaços.'
          : `Requisição recusada pelo provedor: ${this.apiMessage}`;
      case 401:
      case 403:
        return 'Chave de API sem permissão ou não autorizada. Verifique sua conta no provedor.';
      case 404:
        return `Modelo não encontrado: ${this.apiMessage}`;
      case 429:
        return 'Cota ou limite de requisições temporariamente atingido. Aguarde alguns instantes.';
      case 503:
        return 'Servidores temporariamente sobrecarregados (Erro 503).';
      case 0:
        return this.apiMessage;
      default:
        return this.code >= 500
          ? `Servidores temporariamente indisponíveis (Código ${this.code}).`
          : this.apiMessage;
    }
  }
}

function keyFingerprint(apiKey: string): string {
  return apiKey.slice(-8);
}

async function geminiFetch(path: string, apiKey: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GeminiError(0, 'Sem conexão com a Google. Verifique sua internet.');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new GeminiError(res.status, data?.error?.message || res.statusText || 'Erro desconhecido');
  }
  return res.json();
}

/** Ranks a model name: newer version first, full models before lite/preview/experimental. */
function scoreModel(name: string): number {
  const match = name.match(/gemini-(\d+(?:\.\d+)?)/);
  const version = match ? parseFloat(match[1]) : 0;
  let score = version * 100;
  if (name.includes('lite')) score -= 30;
  if (name.includes('preview') || name.includes('exp')) score -= 10;
  return score;
}

export class AIService {
  static clearModelCache(): void {
    localStorage.removeItem(MODEL_CACHE_KEY);
    localStorage.removeItem(MODEL_CACHE_FINGERPRINT);
  }

  /**
   * Queries the ListModels endpoint using the user's key to find which models
   * this specific key is allowed to call, ranked by version and stability.
   */
  static async getCandidateModels(apiKey: string, forceRefresh = false): Promise<string[]> {
    const cached = localStorage.getItem(MODEL_CACHE_KEY);
    const cachedFp = localStorage.getItem(MODEL_CACHE_FINGERPRINT);
    const fp = keyFingerprint(apiKey);

    const data = await geminiFetch('models?pageSize=1000', apiKey);
    const rawList: any[] = Array.isArray(data?.models) ? data.models : [];

    const usable = rawList
      .filter(
        (m) =>
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent') &&
          typeof m.name === 'string' &&
          m.name.replace('models/', '').startsWith('gemini') &&
          !/tts|image|audio|live|embedding/i.test(m.name)
      )
      .map((m) => m.name.replace('models/', ''));

    if (usable.length === 0) {
      throw new GeminiError(404, 'Nenhum modelo de chat disponível para esta chave.');
    }

    const candidates: string[] = [];

    if (!forceRefresh && cached && cachedFp === fp && usable.includes(cached)) {
      candidates.push(cached);
    }

    for (const pref of PREFERRED_MODELS) {
      if (usable.includes(pref) && !candidates.includes(pref)) {
        candidates.push(pref);
      }
    }

    const flashModels = usable.filter((m) => m.includes('flash') && !candidates.includes(m));
    flashModels.sort((a, b) => scoreModel(b) - scoreModel(a));
    candidates.push(...flashModels);

    const remaining = usable.filter((m) => !candidates.includes(m));
    remaining.sort((a, b) => scoreModel(b) - scoreModel(a));
    candidates.push(...remaining);

    return candidates;
  }

  /**
   * Queries Groq's /openai/v1/models endpoint using the user's API key to find
   * which models are currently active, avoiding decommissioned models.
   */
  static async getCandidateGroqModels(apiKey: string): Promise<string[]> {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const models = (data.data || [])
          .filter((m: any) => typeof m?.id === 'string' && m?.active !== false && !/whisper|tts|audio|embed|guard/i.test(m.id))
          .map((m: any) => m.id as string);

        if (models.length > 0) {
          const score = (name: string): number => {
            let s = 0;
            if (name.includes('llama-3.3-70b')) s += 160;
            else if (name.includes('70b')) s += 110;
            else if (name.includes('120b')) s += 100;
            else if (name.includes('27b') || name.includes('32b')) s += 85;
            else if (name.includes('20b')) s += 70;
            else if (name.includes('8b')) s += 50;
            if (name.includes('llama')) s += 30;
            if (name.includes('versatile')) s += 20;
            if (name.includes('qwen')) s += 20;
            if (name.includes('gpt-oss')) s += 10;
            if (name.includes('instant')) s += 10;
            return s;
          };
          models.sort((a: string, b: string) => score(b) - score(a));
          return models;
        }
      }
    } catch (e) {
      console.warn('[Amadeus] Could not fetch Groq models list:', e);
    }

    return [
      'llama-3.3-70b-versatile',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'llama-3.1-8b-instant',
    ];
  }

  /**
   * Queries OpenRouter's /api/v1/models endpoint using the user's API key to find
   * active free conversational models, strictly excluding non-chat models.
   */
  static async getCandidateOpenRouterModels(apiKey: string): Promise<string[]> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'Amadeus System',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const models = (data.data || [])
          .filter((m: any) => {
            if (typeof m?.id !== 'string') return false;
            // Free models only
            const isFree =
              m.id.endsWith(':free') ||
              (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0');
            if (!isFree) return false;
            // Exclude audio, embeddings, moderation, tts, image/diffusion
            if (/embed|clip|tts|audio|whisper|flux|diffusion|moderation|guard/i.test(m.id)) return false;
            return true;
          })
          .map((m: any) => m.id as string);

        if (models.length > 0) {
          const score = (name: string): number => {
            let s = 0;
            if (name.includes('gemma-4')) s += 100;
            else if (name.includes('gemma')) s += 80;
            if (name.includes('liquid') || name.includes('lfm')) s += 90;
            if (name.includes('nemotron')) s += 85;
            if (name.includes('laguna')) s += 75;
            if (name.includes('qwen')) s += 70;
            if (name.includes('llama')) s += 60;
            return s;
          };
          models.sort((a: string, b: string) => score(b) - score(a));
          return models;
        }
      }
    } catch (e) {
      console.warn('[Amadeus] Could not fetch OpenRouter models list:', e);
    }

    return [
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'liquid/lfm-2.5-2.6b:free',
      'poolside/laguna-s-2.1:free',
      'dots-studio/dots-3-note-preview:free',
      'nvidia/nemotron-3.5-lightning:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ];
  }

  /**
   * Background Fetch & Cache updater for live active models from providers.
   * Runs non-blockingly to keep the selector immune to deprecations without UI lag.
   */
  static async fetchLiveModelOptions(apiKey: string): Promise<ModelOption[]> {
    const key = apiKey.trim();
    const provider = getProviderFromKey(key);
    if (provider === 'offline') {
      return [OFFLINE_ONLY_OPTION];
    }

    try {
      if (provider === 'groq') {
        const live = await this.getCandidateGroqModels(key);
        if (live.length > 0) {
          const options: ModelOption[] = live.map((id, index) => ({
            id,
            label: formatModelOptionLabel(id, 'groq'),
            provider: 'groq',
            isRecommended: index === 0,
          }));
          localStorage.setItem('amadeus_cached_models_groq', JSON.stringify(options));
          return [...options, OFFLINE_MODEL_OPTION];
        }
      } else if (provider === 'openrouter') {
        const live = await this.getCandidateOpenRouterModels(key);
        if (live.length > 0) {
          const options: ModelOption[] = live.map((id, index) => ({
            id,
            label: formatModelOptionLabel(id, 'openrouter'),
            provider: 'openrouter',
            isRecommended: index === 0,
          }));
          localStorage.setItem('amadeus_cached_models_openrouter', JSON.stringify(options));
          return [...options, OFFLINE_MODEL_OPTION];
        }
      } else if (provider === 'gemini') {
        const live = await this.getCandidateModels(key, true);
        if (live.length > 0) {
          const options: ModelOption[] = live.slice(0, 8).map((id, index) => ({
            id,
            label: formatModelOptionLabel(id, 'gemini'),
            provider: 'gemini',
            isRecommended: index === 0,
          }));
          localStorage.setItem('amadeus_cached_models_gemini', JSON.stringify(options));
          return [...options, OFFLINE_MODEL_OPTION];
        }
      }
    } catch (e) {
      console.warn('[Amadeus] Failed to fetch live models in background:', e);
    }

    return getModelOptionsForKey(key);
  }

  /**
   * Prunes a decommissioned model from local cache to prevent future calls.
   */
  static markModelDecommissioned(provider: AIProvider, modelId: string): void {
    const cacheKey = `amadeus_cached_models_${provider}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const list: ModelOption[] = JSON.parse(cached);
        const updated = list.filter((m) => m.id !== modelId);
        localStorage.setItem(cacheKey, JSON.stringify(updated));
      } catch {}
    }
  }

  /**
   * Tests whether the provided API key is valid.
   */
  static async testConnection(apiKey: string): Promise<{ ok: boolean; model?: string; message: string }> {
    const key = apiKey.trim();
    if (!key) return { ok: false, message: 'Cole uma chave antes de testar.' };

    // Check if Groq key
    if (isGroqKey(key)) {
      const candidates = await this.getCandidateGroqModels(key);
      let lastErr: any = null;

      for (const model of candidates) {
        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 10,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const msg = errData?.error?.message || res.statusText || 'Erro no Groq';
            const isRetryable =
              res.status === 400 ||
              res.status === 404 ||
              res.status === 429 ||
              res.status === 502 ||
              res.status === 503 ||
              msg.toLowerCase().includes('decommissioned') ||
              msg.toLowerCase().includes('rate_limit') ||
              msg.toLowerCase().includes('rate limit');

            if (isRetryable) {
              console.warn(`[Amadeus] Groq model ${model} returned ${res.status} (${msg}), testing next...`);
              continue;
            }
            throw new GeminiError(res.status, msg);
          }

          localStorage.setItem('amadeus_groq_model', model);
          return { ok: true, model: `${model} (Groq LPU)`, message: `Conectado ao Groq Cloud (${model})!` };
        } catch (err: any) {
          lastErr = err;
          if (err instanceof GeminiError && (err.code === 400 || err.code === 404 || err.code === 429 || err.code === 502 || err.code === 503)) continue;
          break;
        }
      }

      const message = lastErr instanceof GeminiError ? `[${lastErr.code || 'REDE'}] ${lastErr.apiMessage}` : String(lastErr);
      return { ok: false, message };
    }

    // Check if OpenRouter key
    if (isOpenRouterKey(key)) {
      const candidates = [
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'liquid/lfm-2.5-2.6b:free',
        'poolside/laguna-s-2.1:free',
        'dots-studio/dots-3-note-preview:free',
        'nvidia/nemotron-3.5-lightning:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free',
      ];
      let lastErr: any = null;

      for (const model of candidates) {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
              'HTTP-Referer': 'http://localhost:5173',
              'X-Title': 'Amadeus System',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 10,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const msg = errData?.error?.message || res.statusText || 'Erro no OpenRouter';
            const isRetryable =
              res.status === 404 ||
              res.status === 429 ||
              res.status === 502 ||
              res.status === 503 ||
              msg.toLowerCase().includes('unavailable for free') ||
              msg.toLowerCase().includes('rate-limited');

            if (isRetryable) {
              console.warn(`[Amadeus] OpenRouter model ${model} returned ${res.status}, testing next...`);
              continue;
            }
            throw new GeminiError(res.status, msg);
          }

          localStorage.setItem('amadeus_openrouter_model', model);
          const cleanName = model.replace(':free', '');
          return { ok: true, model: `${cleanName} (OpenRouter)`, message: `Conectado ao OpenRouter (${cleanName})!` };
        } catch (err: any) {
          lastErr = err;
          if (err instanceof GeminiError && (err.code === 404 || err.code === 429 || err.code === 502 || err.code === 503)) continue;
          break;
        }
      }

      const message = lastErr instanceof GeminiError ? `[${lastErr.code || 'REDE'}] ${lastErr.apiMessage}` : String(lastErr);
      return { ok: false, message };
    }

    try {
      const candidates = await this.getCandidateModels(key, true);
      let lastErr: any = null;

      for (const model of candidates) {
        try {
          await geminiFetch(`models/${model}:generateContent`, key, {
            contents: [{ role: 'user', parts: [{ text: 'Responda apenas: ok' }] }],
            generationConfig: { maxOutputTokens: 100 },
          });

          localStorage.setItem(MODEL_CACHE_KEY, model);
          localStorage.setItem(MODEL_CACHE_FINGERPRINT, keyFingerprint(key));
          return { ok: true, model, message: `Conectado: ${model}` };
        } catch (err: any) {
          lastErr = err;
          if (err instanceof GeminiError && (err.code === 503 || err.code === 429 || err.code === 404)) {
            console.warn(`[Amadeus] Test model ${model} returned ${err.code}, testing next candidate...`);
            continue;
          }
          break;
        }
      }

      const message = lastErr instanceof GeminiError ? `[${lastErr.code || 'REDE'}] ${lastErr.friendly}` : String(lastErr);
      return { ok: false, message };
    } catch (err) {
      const message = err instanceof GeminiError ? `[${err.code || 'REDE'}] ${err.friendly}` : String(err);
      return { ok: false, message };
    }
  }

  /**
   * Instant pre-LLM listening micro-reaction (<16ms) based on the user's message tone.
   */
  static inferListeningReaction(userMessage: string): { emotion: Emotion; pose: CharacterPose; camera?: CameraFraming } {
    const uLow = (userMessage || '').toLowerCase();
    if (/\b(?:barata|fujiko|inseto|cockroach)\b|ゴキブリ|ふじこ/i.test(uLow)) {
      return { emotion: 'holding_back_tears', pose: 'default', camera: 'closeup' };
    }
    if (/\b(?:nullpo|nurupo)\b|ぬるぽ/i.test(uLow) || uLow.includes('?!')) {
      return { emotion: 'surprised', pose: 'default', camera: 'closeup' };
    }
    if (/\b(?:christina|assistente|zombie|celebcas|pervertida|assistant)\b|クリスティーナ|助手|ゾンビ/i.test(uLow)) {
      return { emotion: 'annoyed', pose: 'crossed_arms', camera: 'medium' };
    }
    if (/\b(?:linda|fofa|bonita|maravilhosa|perfeita|cute|pretty|beautiful)\b|かわいい|可愛い|綺麗/i.test(uLow)) {
      return { emotion: 'blushing', pose: 'crossed_arms', camera: 'closeup' };
    }
    const letters = userMessage.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const shouting = letters.length >= 4 && letters === letters.toUpperCase();
    if (shouting || (userMessage.includes('!') && userMessage.trim().length <= 40)) {
      return { emotion: 'surprised', pose: 'default', camera: 'closeup' };
    }
    if (/\b(?:teoria|f[íi]sica|c[óo]digo|python|bug|arquitetura|hip[óo]tese|como|por que|explica|why|how|explain|theory|physics)\b|なぜ|どうして|説明|理論|\?/i.test(uLow)) {
      return { emotion: 'thinking', pose: 'crossed_arms', camera: 'medium' };
    }
    return { emotion: 'thinking', pose: 'default' };
  }

  private static getLocalTemporalAndEpisodicContext(history: ChatMessage[]): {
    gapSeconds: number | null;
    lastSessionTopic: string;
  } {
    const nowMs = Date.now();
    const userMsgs = history.filter((m) => m.sender === 'user' && m.timestamp);
    let lastUserTs: number | null = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].timestamp : null;

    const sessions = MemoryService.getSessionLogs();
    const activeId = MemoryService.getActiveSession().sessionId;
    const priorSession = sessions.find((s) => s.id !== activeId && (s.summary || (s.messages && s.messages.length > 0)));
    if (!lastUserTs && priorSession) {
      lastUserTs = priorSession.endedAt || priorSession.startedAt || null;
    }
    const gapSeconds = lastUserTs ? Math.max(0, Math.floor((nowMs - lastUserTs) / 1000)) : null;
    const lastSessionTopic = priorSession?.summary || '';
    return { gapSeconds, lastSessionTopic };
  }

  private static buildAutonomousEventPrompt(
    systemEvent: AutonomousEventType,
    history: ChatMessage[]
  ): string {
    const lastUser = [...history].reverse().find((m) => m.sender === 'user')?.content || '';
    const lastAsst = [...history].reverse().find((m) => m.sender === 'amadeus')?.content || '';
    const { lastSessionTopic } = this.getLocalTemporalAndEpisodicContext(history);

    if (systemEvent === 'call_greeting') {
      const topicHint = lastSessionTopic ? ` Na última ligação vocês falaram sobre: "${lastSessionTopic}".` : '';
      return (
        `[EVENTO DO SISTEMA: ATENDIMENTO DE CHAMADA] O operador acabou de conectar a videochamada com você no terminal Amadeus.${topicHint} ` +
        `Inicie a conversa falando diretamente com ele em 1ª pessoa (1 a 2 frases naturais), levando em conta o horário local, o hiato desde o último contato e, se houver assunto da última ligação, puxando gancho de forma espontânea. NÃO mencione eventos de sistema.`
      );
    }
    if (systemEvent === 'idle_stage_1') {
      return (
        `[EVENTO DO SISTEMA: SILÊNCIO NO MEIO DA CONVERSA — ESTÁGIO 1] O operador ficou em silêncio há cerca de 2 minutos no meio do diálogo. ` +
        `A última coisa que ele disse foi: "${lastUser}" e a sua última resposta foi: "${lastAsst}". ` +
        `Chame a atenção dele de forma humana e natural (1 a 2 frases), puxando o fio exatamente desse assunto que parou na metade ou perguntando se ele travou pensando na sua resposta. NÃO mencione cronômetros ou eventos de sistema.`
      );
    }
    return (
      `[EVENTO DO SISTEMA: SILÊNCIO PROLONGADO — ESTÁGIO 2] O operador continua sem responder há quase 5 minutos mesmo depois de você ter chamado a atenção dele. ` +
      `O papo tinha parado em: "${lastUser}". ` +
      `Reaja com impaciência autêntica de Kurisu de braços cruzados (1 a 2 frases), reclamando de ter sido deixada falando sozinha no terminal sobre esse assunto e avisando que vai voltar a ler seus artigos até ele dignar responder. Inclua <!--emotion:annoyed,pose:crossed_arms,camera:medium--> ao final.`
    );
  }

  static queryOfflineAutonomousEvent(
    systemEvent: AutonomousEventType,
    history: ChatMessage[] = []
  ): { response: string; emotion: Emotion; pose: CharacterPose; camera: CameraFraming } {
    const { gapSeconds, lastSessionTopic } = this.getLocalTemporalAndEpisodicContext(history);
    const lastUser = [...history].reverse().find((m) => m.sender === 'user')?.content || '';
    const snippet = lastUser.length > 48 ? `${lastUser.slice(0, 48)}...` : lastUser;
    const h = new Date().getHours();

    if (systemEvent === 'call_greeting') {
      if (gapSeconds && gapSeconds >= 86400) {
        const days = Math.max(1, Math.floor(gapSeconds / 86400));
        return {
          response: `Olha só quem resolveu aparecer depois de ${days} dia(s) sem dar sinal de vida! Achei que você tinha sido capturado pela 'Organização'... não que eu estivesse esperando sua ligação, claro! O que manda hoje?`,
          emotion: 'annoyed',
          pose: 'crossed_arms',
          camera: 'medium',
        };
      }
      if (h < 6) {
        return {
          response: 'Conectando a essa hora da madrugada? Espero que você tenha pelo menos uma xícara de café preto aí do lado. Qual é a insônia científica de hoje?',
          emotion: 'wink',
          pose: 'crossed_arms',
          camera: 'medium',
        };
      }
      if (lastSessionTopic) {
        return {
          response: `Conexão estabelecida com o Laboratório 304! Estava mesmo lembrando da nossa última conversa (${lastSessionTopic.slice(0, 65)}). Como avançaram as coisas por aí?`,
          emotion: 'happy',
          pose: 'default',
          camera: 'closeup',
        };
      }
      return {
        response: 'Conexão estabelecida com o Laboratório 304 em Viktor Chondria. Aqui é Makise Kurisu. No que vamos trabalhar hoje?',
        emotion: 'happy',
        pose: 'default',
        camera: 'closeup',
      };
    }

    if (systemEvent === 'idle_stage_1') {
      return {
        response: snippet
          ? `Ei, você ficou mudo de repente... Ainda está processando o que estávamos falando sobre "${snippet}" ou travou aí na frente do monitor?`
          : 'Ei, ainda está aí? Você ficou em silêncio do nada no meio da nossa conversa.',
        emotion: 'thinking',
        pose: 'crossed_arms',
        camera: 'medium',
      };
    }

    return {
      response: 'Olha só, se você foi pegar café e me deixou falando sozinha no terminal, avise! Vou cruzar os braços e revisar meus dados de neurociência até você resolver voltar.',
      emotion: 'annoyed',
      pose: 'crossed_arms',
      camera: 'medium',
    };
  }

  /**
   * Main entry point with Hybrid Architecture:
   * 1. Try Python Backend (FastAPI + ChromaDB + SQLite) if running.
   * 2. Otherwise run pure client-side (OpenRouter / Gemini / Offline).
   */
  static async queryAmadeus(
    userMessage: string,
    persona: PersonaProfile,
    recalledMemories: MemoryItem[],
    apiKey: string | undefined,
    history: ChatMessage[] = [],
    sessionId: string | null = null,
    selectedModel: string = 'gemini-2.5-flash',
    llmOptions?: {
      allowModelFallback?: boolean;
      allowOfflineSimulatorFallback?: boolean;
      systemEvent?: AutonomousEventType;
      /** v0.2.2: backend sentence streaming; the speak queue lives in the caller */
      stream?: ChatStreamHandlers;
    }
  ): Promise<AIResult> {
    const key = apiKey?.trim();
    const allowModelFallback = llmOptions?.allowModelFallback !== false;
    const allowOfflineFallback = llmOptions?.allowOfflineSimulatorFallback !== false;
    const systemEvent = llmOptions?.systemEvent;
    const effectiveMessage = systemEvent ? this.buildAutonomousEventPrompt(systemEvent, history) : userMessage;

    // 0. Explicit offline mode
    if (selectedModel === OFFLINE_MODEL_ID) {
      if (!allowOfflineFallback) {
        const msg = '[MODO ESTRITO DE LLM] O Simulador Local Offline está bloqueado nas configurações. Insira uma chave de API e selecione um modelo neural.';
        return { response: msg, emotion: 'serious', status: { kind: 'error', message: msg }, isError: true };
      }
      const offline = systemEvent
        ? this.queryOfflineAutonomousEvent(systemEvent, history)
        : this.queryOfflineSimulator(userMessage, recalledMemories);
      return { ...offline, status: { kind: 'offline' }, isError: false };
    }

    // 1. Try Python Backend if available
    const backendOnline = await BackendService.checkHealth();
    if (backendOnline) {
      try {
        const streamHandlers = llmOptions?.stream;
        const backendRes = streamHandlers
          ? await BackendService.queryChatStream(
              userMessage, sessionId, key || '', history, selectedModel,
              allowModelFallback, allowOfflineFallback, systemEvent, streamHandlers
            ).catch((streamErr) => {
              console.warn('[OpenAmadeus] /chat/stream failed before the first sentence, using /chat:', streamErr);
              return BackendService.queryChat(
                userMessage, sessionId, key || '', history, selectedModel,
                allowModelFallback, allowOfflineFallback, systemEvent
              );
            })
          : await BackendService.queryChat(
              userMessage, sessionId, key || '', history, selectedModel,
              allowModelFallback, allowOfflineFallback, systemEvent
            );
        return {
          aborted: backendRes.aborted,
          response: backendRes.response,
          emotion: backendRes.emotion,
          pose: backendRes.pose,
          camera: backendRes.camera,
          leadEmotion: backendRes.leadEmotion,
          leadPose: backendRes.leadPose,
          recalledMemories: backendRes.recalledMemories || [],
          status: backendRes.error
            ? { kind: 'error', message: backendRes.error }
            : { kind: 'online', model: backendRes.model || 'ChromaDB + SQLite (Python)' },
          isError: Boolean(backendRes.error),
          learnedMemory: backendRes.learnedMemory,
          sessionId: backendRes.sessionId,
        };
      } catch (err) {
        console.warn('[OpenAmadeus] Local Python Backend failed, falling back to browser-mode:', err);
      }
    }

    // 2. Browser-Mode Fallback: No key -> offline simulator (or strict error).
    if (!key) {
      if (!allowOfflineFallback) {
        const msg = '[MODO ESTRITO DE LLM] Nenhuma chave de API configurada e o Simulador Offline está bloqueado.';
        return { response: msg, emotion: 'serious', status: { kind: 'error', message: msg }, isError: true };
      }
      const offline = systemEvent
        ? this.queryOfflineAutonomousEvent(systemEvent, history)
        : this.queryOfflineSimulator(userMessage, recalledMemories);
      return { ...offline, status: { kind: 'offline' }, isError: false };
    }

    // 3. Browser-Mode: Groq Cloud (Ultra-fast LPU)
    if (isGroqKey(key)) {
      try {
        const { response, emotion, pose, camera, leadEmotion, leadPose, model, learnedMemory, fallbackModel, decommissionNotice } =
          await this.queryGroq(effectiveMessage, persona, recalledMemories, key, history, selectedModel, allowModelFallback);
        return {
          response,
          emotion,
          pose,
          camera,
          leadEmotion,
          leadPose,
          status: { kind: 'online', model },
          isError: false,
          learnedMemory: systemEvent ? undefined : learnedMemory,
          fallbackModel,
          decommissionNotice,
        };
      } catch (err) {
        console.error('[OpenAmadeus] Groq call failed:', err);
        const message = err instanceof GeminiError
          ? `[ERRO ${err.code || 'REDE'}] ${err.friendly}`
          : `[ERRO] ${String(err)}`;
        return { response: message, emotion: 'serious', status: { kind: 'error', message }, isError: true };
      }
    }

    // 4. Browser-Mode: OpenRouter
    if (isOpenRouterKey(key)) {
      try {
        const { response, emotion, pose, camera, leadEmotion, leadPose, model, learnedMemory, fallbackModel, decommissionNotice } =
          await this.queryOpenRouter(effectiveMessage, persona, recalledMemories, key, history, selectedModel, allowModelFallback);
        return {
          response,
          emotion,
          pose,
          camera,
          leadEmotion,
          leadPose,
          status: { kind: 'online', model },
          isError: false,
          learnedMemory: systemEvent ? undefined : learnedMemory,
          fallbackModel,
          decommissionNotice,
        };
      } catch (err) {
        console.error('[OpenAmadeus] OpenRouter call failed:', err);
        const message = err instanceof GeminiError
          ? `[ERRO ${err.code || 'REDE'}] ${err.friendly}`
          : `[ERRO] ${String(err)}`;
        return { response: message, emotion: 'serious', status: { kind: 'error', message }, isError: true };
      }
    }

    // 5. Browser-Mode: Google Gemini
    try {
      const { response, emotion, pose, camera, leadEmotion, leadPose, model, learnedMemory, fallbackModel, decommissionNotice } =
        await this.queryGemini(effectiveMessage, persona, recalledMemories, key, history, selectedModel, allowModelFallback);
      return {
        response,
        emotion,
        pose,
        camera,
        leadEmotion,
        leadPose,
        status: { kind: 'online', model },
        isError: false,
        learnedMemory: systemEvent ? undefined : learnedMemory,
        fallbackModel,
        decommissionNotice,
      };
    } catch (err) {
      console.error('[OpenAmadeus] Gemini call failed:', err);
      const message = err instanceof GeminiError
        ? `[ERRO ${err.code || 'REDE'}] ${err.friendly}`
        : `[ERRO] ${String(err)}`;
      return { response: message, emotion: 'serious', status: { kind: 'error', message }, isError: true };
    }
  }

  private static formatMemoryContext(recalledMemories: MemoryItem[], persona?: PersonaProfile, historyCount: number = 0, history: ChatMessage[] = []): string {
    const kurisuMemories = recalledMemories.filter((m) => m.source !== 'learned');
    const recentLearned = (persona?.memories || []).filter((m) => m.source === 'learned').slice(-12);
    const seen = new Set(recentLearned.map((m) => m.id));
    const userMemories = [...recentLearned, ...recalledMemories.filter((m) => m.source === 'learned' && !seen.has(m.id))];

    const now = new Date();
    const h = now.getHours();
    const timeStr = `${String(h).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const period = h < 6
      ? 'Madrugada — se oportuno, implique sutilmente com a privação de sono ou mencione café preto/Dr Pepper'
      : h < 12 ? 'Manhã' : h < 18 ? 'Tarde' : 'Noite';
    const turnCount = Math.floor(historyCount / 2) + 1;
    const rapport = (userMemories.length >= 2 || turnCount >= 6)
      ? 'Confiança (LabMem) — atenciosa, leal e preocupada com o operador, disfarçando afeto com desculpas científicas'
      : (userMemories.length === 1 || turnCount >= 3)
        ? 'Debate Ativo — sagaz, sarcástica, provocativa e intelectualmente engajada'
        : 'Contato Inicial — postura acadêmica da Viktor Chondria, formal, cética e observadora';

    const { gapSeconds, lastSessionTopic } = this.getLocalTemporalAndEpisodicContext(history);
    let hiatusStr = 'Fluxo contínuo';
    if (gapSeconds !== null) {
      if (gapSeconds >= 86400) {
        const days = Math.max(1, Math.floor(gapSeconds / 86400));
        hiatusStr = `Hiato de ${days} dia(s) sem contato — se oportuno, comente sobre o sumiço do operador`;
      } else if (gapSeconds >= 3600) {
        const hrs = Math.max(1, Math.floor(gapSeconds / 3600));
        hiatusStr = `Pausa de ${hrs}h desde a última mensagem`;
      }
    }

    const blocks: string[] = [
      `[TELEMETRIA DA CHAMADA AMADEUS]: Horário local: ${timeStr} (${period}) | Turno #${turnCount} da ligação | Hiato: ${hiatusStr} | Rapport: ${rapport}`,
    ];
    if (lastSessionTopic && turnCount <= 2) {
      blocks.push(`[MEMÓRIA DA ÚLTIMA LIGAÇÃO ANTERIOR]: ${lastSessionTopic}`);
    }

    if (kurisuMemories.length > 0) {
      blocks.push(
        `[MEMÓRIAS DIGITALIZADAS ATIVADAS DO SEU CÓRTEX]:\n` +
          kurisuMemories.map((m) => `- ${m.title}: ${m.content} (Sentimento associado: ${m.emotionalWeight || 'Factual'})`).join('\n')
      );
    }

    if (userMemories.length > 0) {
      blocks.push(
        `[FATOS CONHECIDOS SOBRE O INTERLOCUTOR (SEU OPERADOR)]:\n` +
          userMemories.map((m) => `- ${m.title}: ${m.content}`).join('\n')
      );
    }

    return `\n\n${blocks.join('\n\n')}`;
  }

  private static async queryGroq(
    userMessage: string,
    persona: PersonaProfile,
    recalledMemories: MemoryItem[],
    apiKey: string,
    history: ChatMessage[],
    preferredModel?: string,
    allowModelFallback: boolean = true
  ): Promise<{
    response: string;
    emotion: Emotion;
    pose?: CharacterPose;
    camera?: CameraFraming;
    leadEmotion?: Emotion;
    leadPose?: CharacterPose;
    recalledMemories?: string[];
    model: string;
    learnedMemory?: LearnedMemoryInfo;
    fallbackModel?: string;
    decommissionNotice?: string;
  }> {
    const memoryContext = this.formatMemoryContext(recalledMemories, persona, history.length);
    const systemPrompt = `${persona.systemPrompt}${memoryContext}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-MAX_HISTORY_MESSAGES).map((msg) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.emotion ? `<!--emotion:${msg.emotion},pose:${msg.pose || 'default'}--> ${msg.content}` : msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const validPreferred = preferredModel && preferredModel !== OFFLINE_MODEL_ID ? preferredModel : null;
    let candidates: string[];
    if (!allowModelFallback && validPreferred) {
      candidates = [validPreferred];
    } else {
      const liveCandidates = await this.getCandidateGroqModels(apiKey);
      const cachedModel = localStorage.getItem('amadeus_groq_model');
      candidates = [
        ...(validPreferred ? [validPreferred] : []),
        ...(cachedModel && liveCandidates.includes(cachedModel) ? [cachedModel] : []),
        ...liveCandidates,
      ].filter((v, i, a) => a.indexOf(v) === i);
    }

    let lastErr: any = null;
    let decommissionedTarget: string | null = null;

    for (const model of candidates) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.85,
            max_tokens: 1024,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error?.message || res.statusText || 'Erro Groq';
          if (!allowModelFallback) {
            throw new GeminiError(res.status, `[MODO FIXO • ${model}] ${msg}`);
          }
          const isDecommissioned =
            res.status === 400 &&
            /decommissioned|deprecated|not found|model_not_found|does not exist/i.test(msg);

          if (isDecommissioned) {
            console.warn(`[OpenAmadeus] Groq model ${model} is decommissioned/deprecated: ${msg}`);
            if (model === validPreferred) {
              decommissionedTarget = model;
            }
            this.markModelDecommissioned('groq', model);
          }

          const isRetryable =
            res.status === 400 ||
            res.status === 404 ||
            res.status === 429 ||
            res.status === 502 ||
            res.status === 503 ||
            isDecommissioned ||
            msg.toLowerCase().includes('rate_limit') ||
            msg.toLowerCase().includes('rate limit');

          if (isRetryable) {
            console.warn(`[OpenAmadeus] Groq model ${model} returned ${res.status} (${msg}), trying next candidate...`);
            continue;
          }
          throw new GeminiError(res.status, msg);
        }

        const data = await res.json();
        const choiceMsg = data.choices?.[0]?.message;
        const contentVal = choiceMsg?.content;
        const cleanContent = this.stripThinkingTags(typeof contentVal === 'string' ? contentVal : '');

        if (!cleanContent || this.isScratchpadOrReasoning(cleanContent)) {
          if (!allowModelFallback) {
            throw new GeminiError(502, `[MODO FIXO • ${model}] Resposta vazia ou raciocínio interno sem diálogo.`);
          }
          console.warn(`[OpenAmadeus] Groq model ${model} returned empty/reasoning, trying next candidate...`);
          continue;
        }

        localStorage.setItem('amadeus_groq_model', model);

        let decommissionNotice: string | undefined;
        let fallbackModel: string | undefined;
        if (decommissionedTarget && model !== decommissionedTarget) {
          decommissionNotice = `O modelo "${decommissionedTarget}" foi descontinuado pelo provedor. Migrado automaticamente para "${model}".`;
          fallbackModel = model;
        }

        return {
          ...this.parseResponseTags(cleanContent, userMessage),
          model: `${model} (Groq LPU)`,
          fallbackModel,
          decommissionNotice,
        };
      } catch (err: any) {
        lastErr = err;
        if (allowModelFallback && err instanceof GeminiError && (err.code === 400 || err.code === 404 || err.code === 429 || err.code === 502 || err.code === 503)) continue;
        throw err;
      }
    }

    if (lastErr) throw lastErr;
    throw new GeminiError(404, 'Nenhum modelo ativo do Groq Cloud respondeu.');
  }

  private static async queryOpenRouter(
    userMessage: string,
    persona: PersonaProfile,
    recalledMemories: MemoryItem[],
    apiKey: string,
    history: ChatMessage[],
    preferredModel?: string,
    allowModelFallback: boolean = true
  ): Promise<{
    response: string;
    emotion: Emotion;
    pose?: CharacterPose;
    camera?: CameraFraming;
    leadEmotion?: Emotion;
    leadPose?: CharacterPose;
    recalledMemories?: string[];
    model: string;
    learnedMemory?: LearnedMemoryInfo;
    fallbackModel?: string;
    decommissionNotice?: string;
  }> {
    const memoryContext = this.formatMemoryContext(recalledMemories, persona, history.length);
    const systemPrompt = `${persona.systemPrompt}${memoryContext}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-MAX_HISTORY_MESSAGES).map((msg) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.emotion ? `<!--emotion:${msg.emotion},pose:${msg.pose || 'default'}--> ${msg.content}` : msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const validPreferred = preferredModel && preferredModel !== OFFLINE_MODEL_ID ? preferredModel : null;
    let candidates: string[];
    if (!allowModelFallback && validPreferred) {
      candidates = [validPreferred];
    } else {
      const liveCandidates = await this.getCandidateOpenRouterModels(apiKey);
      const cachedModel = localStorage.getItem('amadeus_openrouter_model');
      const validCache = cachedModel && !cachedModel.includes('nemotron') && !cachedModel.includes('super') ? cachedModel : null;
      candidates = [
        ...(validPreferred ? [validPreferred] : []),
        ...(validCache ? [validCache] : []),
        ...liveCandidates,
      ].filter((v, i, a) => a.indexOf(v) === i);
    }

    let lastErr: any = null;
    let decommissionedTarget: string | null = null;

    for (const model of candidates) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:5173',
            'X-Title': 'OpenAmadeus',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.85,
            max_tokens: 1024,
            include_reasoning: false,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error?.message || res.statusText || 'Erro OpenRouter';
          if (!allowModelFallback) {
            throw new GeminiError(res.status, `[MODO FIXO • ${model}] ${msg}`);
          }
          const isDecommissioned =
            res.status === 400 &&
            /decommissioned|deprecated|not found|model_not_found|does not exist/i.test(msg);

          if (isDecommissioned) {
            console.warn(`[OpenAmadeus] OpenRouter model ${model} is decommissioned/deprecated: ${msg}`);
            if (model === validPreferred) {
              decommissionedTarget = model;
            }
            this.markModelDecommissioned('openrouter', model);
          }

          const isRetryable =
            res.status === 400 ||
            res.status === 404 ||
            res.status === 429 ||
            res.status === 502 ||
            res.status === 503 ||
            isDecommissioned ||
            msg.toLowerCase().includes('unavailable for free') ||
            msg.toLowerCase().includes('rate-limited');

          if (isRetryable) {
            console.warn(`[OpenAmadeus] OpenRouter model ${model} returned ${res.status}, trying next candidate...`);
            continue;
          }
          throw new GeminiError(res.status, msg);
        }

        const data = await res.json();
        const choiceMsg = data.choices?.[0]?.message;
        const contentVal = choiceMsg?.content;
        const cleanContent = this.stripThinkingTags(typeof contentVal === 'string' ? contentVal : '');

        if (!cleanContent || this.isScratchpadOrReasoning(cleanContent)) {
          if (!allowModelFallback) {
            throw new GeminiError(502, `[MODO FIXO • ${model}] Resposta vazia ou raciocínio interno.`);
          }
          console.warn(`[OpenAmadeus] OpenRouter model ${model} returned empty/reasoning, trying next candidate...`);
          continue;
        }

        localStorage.setItem('amadeus_openrouter_model', model);
        const cleanName = model.replace(':free', '');

        let decommissionNotice: string | undefined;
        let fallbackModel: string | undefined;
        if (decommissionedTarget && model !== decommissionedTarget) {
          decommissionNotice = `O modelo "${decommissionedTarget}" foi descontinuado pelo OpenRouter. Migrado automaticamente para "${model}".`;
          fallbackModel = model;
        }

        return {
          ...this.parseResponseTags(cleanContent, userMessage),
          model: `${cleanName} (OpenRouter)`,
          fallbackModel,
          decommissionNotice,
        };
      } catch (err: any) {
        lastErr = err;
        if (allowModelFallback && err instanceof GeminiError && (err.code === 400 || err.code === 404 || err.code === 429 || err.code === 502 || err.code === 503)) continue;
        throw err;
      }
    }

    if (lastErr) throw lastErr;
    throw new GeminiError(404, 'Nenhum modelo gratuito do OpenRouter respondeu.');
  }

  private static buildContents(history: ChatMessage[], userMessage: string) {
    const turns: { role: 'user' | 'model'; text: string }[] = [];

    for (const msg of history.slice(-MAX_HISTORY_MESSAGES)) {
      if (msg.sender === 'system') continue;
      const role = msg.sender === 'user' ? 'user' : 'model';
      const text = role === 'model' && msg.emotion
        ? `<!--emotion:${msg.emotion},pose:${msg.pose || 'default'}--> ${msg.content}`
        : msg.content;

      const last = turns[turns.length - 1];
      if (last && last.role === role) {
        last.text += `\n${text}`;
      } else {
        turns.push({ role, text });
      }
    }

    while (turns.length > 0 && turns[0].role === 'model') turns.shift();

    turns.push({ role: 'user', text: userMessage });
    return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  }

  private static async queryGemini(
    userMessage: string,
    persona: PersonaProfile,
    recalledMemories: MemoryItem[],
    apiKey: string,
    history: ChatMessage[],
    preferredModel?: string,
    allowModelFallback: boolean = true
  ): Promise<{
    response: string;
    emotion: Emotion;
    pose?: CharacterPose;
    camera?: CameraFraming;
    leadEmotion?: Emotion;
    leadPose?: CharacterPose;
    recalledMemories?: string[];
    model: string;
    learnedMemory?: LearnedMemoryInfo;
    fallbackModel?: string;
    decommissionNotice?: string;
  }> {
    const memoryContext = this.formatMemoryContext(recalledMemories, persona, history.length);

    const body = {
      contents: this.buildContents(history, userMessage),
      systemInstruction: { parts: [{ text: `${persona.systemPrompt}${memoryContext}` }] },
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1024,
      },
    };

    const validPreferred = preferredModel && preferredModel !== OFFLINE_MODEL_ID ? preferredModel : null;
    let candidates: string[];
    if (!allowModelFallback && validPreferred) {
      candidates = [validPreferred];
    } else {
      candidates = await this.getCandidateModels(apiKey);
      if (validPreferred && candidates.includes(validPreferred)) {
        candidates.splice(candidates.indexOf(validPreferred), 1);
        candidates.unshift(validPreferred);
      } else if (validPreferred) {
        candidates.unshift(validPreferred);
      }
    }

    let selectedModel = candidates[0];
    let data: any = null;
    let lastError: any = null;
    let decommissionedTarget: string | null = null;

    for (const candidateModel of candidates) {
      try {
        data = await geminiFetch(`models/${candidateModel}:generateContent`, apiKey, body);
        selectedModel = candidateModel;
        lastError = null;

        localStorage.setItem(MODEL_CACHE_KEY, candidateModel);
        localStorage.setItem(MODEL_CACHE_FINGERPRINT, keyFingerprint(apiKey));
        break;
      } catch (err: any) {
        lastError = err;
        if (!allowModelFallback) {
          throw err;
        }
        const isDecommissioned =
          err instanceof GeminiError &&
          (err.code === 404 || (err.code === 400 && /not found|unsupported|deprecated/i.test(err.apiMessage)));

        if (isDecommissioned) {
          console.warn(`[OpenAmadeus] Gemini model ${candidateModel} is unsupported or deprecated:`, err.apiMessage);
          if (candidateModel === validPreferred) {
            decommissionedTarget = candidateModel;
          }
          this.markModelDecommissioned('gemini', candidateModel);
        }

        if (err instanceof GeminiError && (err.code === 503 || err.code === 429 || err.code === 404 || isDecommissioned)) {
          console.warn(`[OpenAmadeus] Model ${candidateModel} returned ${err.code} (${err.apiMessage}). Trying next candidate...`);
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        throw err;
      }
    }

    if (lastError && !data) {
      throw lastError;
    }

    const model = selectedModel;

    const candidate = data.candidates?.[0];
    const text: string = (candidate?.content?.parts ?? [])
      .filter((p: any) => typeof p.text === 'string' && !p.thought)
      .map((p: any) => p.text)
      .join('')
      .trim();

    if (!text) {
      const reason = data.promptFeedback?.blockReason || candidate?.finishReason || 'desconhecido';
      throw new GeminiError(0, `A IA retornou uma resposta vazia (motivo: ${reason}).`);
    }

    let decommissionNotice: string | undefined;
    let fallbackModel: string | undefined;
    if (decommissionedTarget && model !== decommissionedTarget) {
      decommissionNotice = `O modelo "${decommissionedTarget}" não está disponível no Gemini. Migrado automaticamente para "${model}".`;
      fallbackModel = model;
    }

    return {
      ...this.parseResponseTags(text, userMessage),
      model,
      fallbackModel,
      decommissionNotice,
    };
  }

  /**
   * Detects if the text is an internal AI scratchpad / chain-of-thought planning monologue
   * rather than dialogue spoken by the character in Portuguese.
   */
  public static isScratchpadOrReasoning(text: string | null | undefined): boolean {
    if (!text) return true;
    const t = text.trim();
    if (!t) return true;

    const startPatterns = [
      /^the user\b/i,
      /^according to (?:the )?instructions\b/i,
      /^i need to (?:respond|act|think|make|create|follow)\b/i,
      /^i should (?:respond|act|think|make|create|follow)\b/i,
      /^let me (?:think|draft|see|structure|analyze|break)\b/i,
      /^let\'s (?:think|draft|see|structure|analyze|break)\b/i,
      /^here is (?:my|the) (?:plan|thought|response)\b/i,
      /^first, let's\b/i,
      /^first, i should\b/i,
      /^in this interaction\b/i,
      /^to respond to the user\b/i,
      /^thinking process:\b/i,
      /^analysis:\b/i,
      /^plan:\b/i,
      /^o usu[áa]rio (?:quer|pediu|compartilhou)\b/i,
      /^devo responder (?:como|em)\b/i,
      /^preciso responder (?:como|em)\b/i,
    ];

    for (const pat of startPatterns) {
      if (pat.test(t)) return true;
    }

    const metaPhrases = [
      /according to the instructions/i,
      /the user wants me to/i,
      /i need to respond as makise kurisu/i,
      /let me draft the response/i,
      /so i should structure it as/i,
      /now for the memory tag/i,
      /let me think about the emotion/i,
      /my dialogue text/i,
    ];
    const matches = metaPhrases.filter((p) => p.test(t)).length;
    return matches >= 2;
  }

  /**
   * Strips internal chain-of-thought blocks such as <think>, <thought>, or unclosed thinking
   */
  public static stripThinkingTags(rawText: string | null | undefined): string {
    if (!rawText) return '';
    let text = rawText;
    text = text.replace(/<(think|thought|reasoning|reflection|internal|scratchpad)>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/<(think|thought|reasoning|reflection|internal|scratchpad)>[\s\S]*$/gi, '');
    text = text.replace(/\*{0,2}(?:thinking(?:\s+process)?|racioc[íi]nio|pensamento):\*{0,2}[\s\S]*?\n\n/gi, '');

    if (this.isScratchpadOrReasoning(text)) {
      return '';
    }

    return text.trim();
  }

  /**
   * Extracts both emotion tag and remember tag from text
   */
  public static parseResponseTags(
    rawText: string | null | undefined,
    userMessage?: string
  ): {
    response: string;
    emotion: Emotion;
    pose?: CharacterPose;
    camera?: CameraFraming;
    leadEmotion?: Emotion;
    leadPose?: CharacterPose;
    recalledMemories?: string[];
    learnedMemory?: LearnedMemoryInfo;
  } {
    let emotion: Emotion = 'neutral';
    let pose: CharacterPose | undefined = undefined;
    let camera: CameraFraming | undefined = undefined;
    let cleanText = this.stripThinkingTags(rawText);
    let learnedMemory: LearnedMemoryInfo | undefined = undefined;

    if (!cleanText || this.isScratchpadOrReasoning(cleanText)) {
      return { response: '', emotion: 'neutral' };
    }

    // 1. Extract remember tag: <!--remember:title|content|emotion-->
    const parsedRem = MemoryService.parseRememberTag(cleanText);
    const remMatch = parsedRem ? ['', parsedRem.title, parsedRem.content, parsedRem.emotionalWeight] : null;
    if (remMatch) {
      const title = remMatch[1].trim();
      if (!/^(t[íi]tulo curto|fato memorizado|sentimento)$/i.test(title)) {
        learnedMemory = {
          title,
          content: remMatch[2].trim(),
          emotionalWeight: remMatch[3].trim() || 'Factual',
        };
      }
    }

    // 2. Extract directives from all comment tags <!-- ... -->
    // Track first emotion/pose if multiple tags exist for 2-beat transition
    let firstTagEmotion: Emotion | undefined = undefined;
    let firstTagPose: CharacterPose | undefined = undefined;
    const commentMatches = cleanText.match(/<!--([\s\S]*?)(?:-->|-+>|>+|$)/g);
    if (commentMatches) {
      for (const comment of commentMatches) {
        const inner = comment.replace(/^<!--|-->$/g, '').trim();
        if (/^remember(?:\s*:|\s)/i.test(inner)) continue;

        const emoMatch = inner.match(/(?:^|[,;|\s])emotion\s*:\s*([^,;|\s>]+)/i);
        if (emoMatch) {
          const rawVal = emoMatch[1].toLowerCase().trim();
          const tokens = rawVal.split(/[\s|,;/]+/);
          for (const tok of tokens) {
            if (VALID_EMOTIONS.includes(tok as Emotion)) {
              if (!firstTagEmotion) firstTagEmotion = tok as Emotion;
              emotion = tok as Emotion;
              break;
            }
          }
        }

        const pMatch = inner.match(/(?:^|[,;|\s])pose\s*:\s*([^,;|\s>]+)/i);
        if (pMatch) {
          const pTok = pMatch[1].toLowerCase().trim();
          let parsedPose: CharacterPose | undefined = undefined;
          if (pTok === 'crossed_arms' || pTok === 'thinking') parsedPose = 'crossed_arms';
          else if (pTok === 'backview' || pTok === 'back') parsedPose = 'backview';
          else if (pTok === 'default' || pTok === 'front') parsedPose = 'default';
          if (parsedPose) {
            if (!firstTagPose) firstTagPose = parsedPose;
            pose = parsedPose;
          }
        }

        const cMatch = inner.match(/(?:^|[,;|\s])camera\s*:\s*([^,;|\s>]+)/i);
        if (cMatch) {
          const cTok = cMatch[1].toLowerCase().trim();
          if (cTok === 'closeup' || cTok === 'close' || cTok === 'jl') camera = 'closeup';
          else if (cTok === 'medium' || cTok === 'jm') camera = 'medium';
          else if (cTok === 'full' || cTok === 'far' || cTok === 'js') camera = 'full';
        }
      }
    }

    // 3. Single-pass removal of all comment tags so zero metadata leaks into speech
    cleanText = cleanText.replace(/<!--[\s\S]*?(?:-->|-+>|>+|$)/g, '').trim();

    // 4. Extract stage directions from asterisks before stripping (*sorri*, *cruza os braços*)
    const asterisks = cleanText.match(/\*([^*]+)\*/g);
    if (asterisks && (emotion === 'neutral' || emotion === 'serious')) {
      for (const act of asterisks) {
        const aLow = act.toLowerCase();
        if (/pisca|piscad|wink|ウインク/.test(aLow)) emotion = 'wink';
        else if (/sorri|sorriso|alegre|risad|smil|laugh|笑/.test(aLow)) emotion = 'happy';
        else if (/cruza os bra[çc]os|bra[çc]os cruzados|pensa|pensativ|cross.*arm|think|腕.*組|考/.test(aLow)) {
          emotion = 'thinking';
          pose = 'crossed_arms';
        }
        else if (/brava|irritad|emburrad|angr|annoy|怒/.test(aLow)) emotion = 'annoyed';
        else if (/cora|vergonha|t[íi]mid|blush|embarrass|照|赤面/.test(aLow)) emotion = 'blushing';
        else if (/olha para o lado|desvia o olhar|soslaio|look.*away|目をそら/.test(aLow)) emotion = 'look_side';
        else if (/olhos fechados|repouso|close.*eye|目を閉/.test(aLow)) emotion = 'eyes_closed';
        else if (/analis|ci[êe]ncia|teoria|analy|分析/.test(aLow)) emotion = 'analytical';
        else if (/triste|chora|l[áa]grima|tear|cry|泣|涙/.test(aLow)) emotion = 'holding_back_tears';
        else if (/preocupad|aflit|worr|心配/.test(aLow)) emotion = 'worried';
        else if (/desd[ée]m|t[ée]dio|disdain|sigh|呆/.test(aLow)) emotion = 'disdain';
      }
    }
    cleanText = cleanText.replace(/\*[^*]+\*/g, '');

    // 5. Context-aware inference from user intent (PT / EN / JA)
    const uLow = (userMessage || '').toLowerCase();
    if (userMessage && (emotion === 'neutral' || emotion === 'serious')) {
      if (/(?:d[eê]|d[aá]|uma)?\s*(?:piscad|pisque|pisca|wink|ウインク)/i.test(uLow)) emotion = 'wink';
      else if (/(?:d[eê]|d[aá]|um)?\s*(?:sorriso|sorria|sorri|alegre|smile|笑って)/i.test(uLow)) emotion = 'happy';
      else if (/(?:cruze os bra[çc]os|bra[çc]os cruzados|cross.*arms|腕を組)/i.test(uLow)) {
        emotion = 'thinking';
        pose = 'crossed_arms';
      }
      else if (/(?:pense|pensativa|reflita|analise|think|analyze|考えて)/i.test(uLow)) {
        emotion = 'thinking';
        pose = 'crossed_arms';
      }
      else if (/(?:brava|irritada|emburrada|angry|annoyed|怒って)/i.test(uLow)) emotion = 'annoyed';
      else if (/(?:cora|corada|vergonha|envergonhada|t[íi]mida|fofa|linda|cute|pretty|beautiful|かわいい|可愛い|綺麗|きれい)/i.test(uLow)) emotion = 'blushing';
      else if (/(?:olhe para o lado|olhe de lado|desvie o olhar|look away|横を向)/i.test(uLow)) emotion = 'look_side';
      else if (/(?:feche os olhos|olhos fechados|descanse|close.*eyes|目を閉じ)/i.test(uLow)) emotion = 'eyes_closed';
      else if (/(?:triste|chore|chora|l[áa]grimas|sad|cry|泣いて)/i.test(uLow)) emotion = 'holding_back_tears';
      else if (/(?:preocupada|aflita|worried|心配)/i.test(uLow)) emotion = 'worried';
      else if (/(?:de costas|vire de costas|turn around|backview|後ろを向|背中)/i.test(uLow)) pose = 'backview';
      else if (/\b(?:christina|assistente|zombie|celebcas|pervertida|assistant)|クリスティーナ|助手|ゾンビ|セレセブ|変態/i.test(uLow)) emotion = 'annoyed';
      else if (/\b(?:nullpo|nurupo)\b|ぬるぽ/i.test(uLow)) emotion = 'surprised';
      else if (/\b(?:barata|fujiko|inseto|cockroach|bug)\b|ゴキブリ|ふじこ/i.test(uLow)) emotion = 'surprised';
    }

    // 6. Inferred sentiment fallback from assistant words
    const lower = cleanText.toLowerCase();
    if (emotion === 'neutral' || emotion === 'serious') {
      if (lower.includes('baka') || lower.includes('idiota') || lower.includes('não me entenda mal') || lower.includes('christina') || lower.includes('バカ') || lower.includes('あんた')) {
        emotion = 'stern';
      } else if (lower.includes('o quê') || lower.includes('como assim') || lower.includes('?!')) {
        emotion = 'worried';
      } else if (lower.includes('pesquisa') || lower.includes('teoria') || lower.includes('física') || lower.includes('sinapse')) {
        emotion = 'analytical';
      } else if (lower.includes('obrigada') || lower.includes('hehe') || lower.includes('fico feliz') || lower.includes('sorriso') || lower.includes('sorri')) {
        emotion = 'happy';
      } else if (lower.includes('triste') || lower.includes('sinto muito') || lower.includes('lágrimas') || lower.includes('desculpe') || lower.includes('mayuri')) {
        emotion = 'holding_back_tears';
      } else if (lower.includes('estranho') || lower.includes('como pode') || lower.includes('não faz sentido') || lower.includes('curioso') || lower.includes('inexplicável')) {
        emotion = 'analytical';
      }
    }

    // 7. Sanitize robotic action narration phrases & emoticons
    cleanText = cleanText.replace(/^(?:claro[,. ]+)?aqui vai um sorriso para voc[eê][.,! ]*/i, 'U-um sorriso? Se você faz tanta questão... mas não se acostume com isso! ');
    cleanText = cleanText.replace(/^(?:aqui est[aá] o meu sorriso|aqui vai o meu sorriso)[.,!:]*/i, '');
    cleanText = cleanText.replace(/[:;]-?[)(DPpOdD]/g, '');
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    // 8. Organic Pose & Camera inference
    if (!pose) {
      if (/(?:de costas|vire de costas|virar de costas|turn around|backview|後ろを向|背中)/i.test(uLow)) {
        pose = 'backview';
      } else if (/(?:cruze os bra[çc]os|bra[çc]os cruzados|cross.*arms|腕を組)/i.test(uLow)) {
        pose = 'crossed_arms';
      } else if (
        /\b(?:christina|zombie|celebcas|pervertida)\b|クリスティーナ|ゾンビ|セレセブ|変態/i.test(uLow) &&
        /\b(?:ignorar|não olho|não vou olhar|virar|costas|humpf)\b/i.test(lower)
      ) {
        pose = 'backview';
      } else if (emotion === 'thinking' || emotion === 'analytical' || emotion === 'disdain' || emotion === 'smug') {
        pose = 'crossed_arms';
      } else if (
        (emotion === 'annoyed' || emotion === 'stern' || emotion === 'tsundere') &&
        (/\b(?:christina|assistente|zombie|baka|idiota|hipótese|lógica|dados|evidência|teoria|cientista)\b|クリスティーナ|助手|バカ/i.test(lower) ||
          /\b(?:christina|assistente|zombie|assistant)\b|クリスティーナ|助手|ゾンビ/i.test(uLow))
      ) {
        pose = 'crossed_arms';
      } else if (
        (emotion === 'blushing' || emotion === 'flustered') &&
        /\b(?:não me entenda mal|não é como se|baka|idiota|profissionalismo|calor dos servidores)\b|勘違いしないで|バカ/i.test(lower)
      ) {
        pose = 'crossed_arms';
      } else {
        pose = 'default';
      }
    }

    if (!camera) {
      if (/close-?up|de perto|aproxime|chegue mais perto|get closer|近づいて/.test(uLow)) {
        camera = 'closeup';
      } else if (/corpo inteiro|afaste|de longe|full body|step back|離れて|全身/.test(uLow)) {
        camera = 'full';
      } else if (/meio corpo|medium shot|half body/.test(uLow)) {
        camera = 'medium';
      } else if (pose === 'backview') {
        camera = 'full';
      } else if (
        pose === 'crossed_arms' &&
        (emotion === 'analytical' || emotion === 'thinking' || emotion === 'disdain' || emotion === 'smug' || emotion === 'stern')
      ) {
        camera = 'medium';
      } else if ((emotion === 'surprised' || emotion === 'annoyed') && cleanText.includes('?!')) {
        camera = 'medium';
      } else {
        camera = 'closeup';
      }
    }

    // 9. Infer 2-beat lead expression for natural VN sprite transition
    let leadEmotion: Emotion | undefined = undefined;
    let leadPose: CharacterPose | undefined = undefined;
    if (firstTagEmotion && (firstTagEmotion !== emotion || (firstTagPose && firstTagPose !== pose))) {
      leadEmotion = firstTagEmotion;
      leadPose = firstTagPose || 'default';
    } else if (cleanText.length >= 45) {
      if ((emotion === 'blushing' || emotion === 'flustered') && (/^(?:o qu[êe]|e-ei|hã|q-quem|c-como|espere)/i.test(lower) || cleanText.slice(0, 35).includes('?!'))) {
        leadEmotion = 'surprised';
        leadPose = 'default';
      } else if ((emotion === 'annoyed' || emotion === 'stern' || emotion === 'blushing') && /\b(?:gah|nullpo|nurupo)\b|ぬるぽ|ガッ/i.test(lower.slice(0, 35))) {
        leadEmotion = 'surprised';
        leadPose = 'default';
      } else if ((emotion === 'analytical' || emotion === 'happy' || emotion === 'wink') && /^(?:espere um instante|pensando bem|deixe-me pensar|se analisarmos|vejamos)/i.test(lower)) {
        leadEmotion = 'thinking';
        leadPose = 'crossed_arms';
      } else if ((emotion === 'happy' || emotion === 'wink') && /\b(?:christina|assistente|baka|idiota)\b/i.test(lower.slice(0, 50))) {
        leadEmotion = 'annoyed';
        leadPose = 'crossed_arms';
      }
    }

    return { response: cleanText, emotion, pose, camera, leadEmotion, leadPose, learnedMemory };
  }

  /**
   * Smart Offline Simulator with auto-learning simulation
   */
  private static queryOfflineSimulator(
    userMessage: string,
    recalledMemories: MemoryItem[]
  ): { response: string; emotion: Emotion; pose?: CharacterPose; learnedMemory?: LearnedMemoryInfo } {
    const text = userMessage.toLowerCase().trim();

    // Check for user introduction to simulate learning in offline mode
    let learnedMemory: LearnedMemoryInfo | undefined = undefined;
    const introMatch = userMessage.match(/(?:meu nome é|me chamo|eu sou o|eu sou a)\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]+)/i);
    if (introMatch) {
      const name = introMatch[1].charAt(0).toUpperCase() + introMatch[1].slice(1);
      learnedMemory = {
        title: 'Nome do Operador',
        content: `O interlocutor se chama ${name}.`,
        emotionalWeight: 'Acolhimento amigável',
      };
    }

    const has = (...words: string[]) =>
      words.some((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(text));

    if (has('christina', 'zombie', 'assistente')) {
      const answers = [
        { response: 'Meu nome não é Christina! E não adicione o "-ina"! Por que você insiste em usar esses apelidos irritantes?!', emotion: 'annoyed' as Emotion },
        { response: 'Nem pense em me chamar de assistente de novo! Eu sou uma neurocientista independente com artigos na Science, seu idiota!', emotion: 'tsundere' as Emotion },
      ];
      return { ...answers[Math.floor(Math.random() * answers.length)], learnedMemory };
    }

    if (has('nullpo', 'nurupo')) {
      return {
        response: 'Gah!... Espere! Por que eu respondi a isso?! Q-quem te ensinou esse meme antigo do @channel?! Não é como se eu frequentasse fóruns anônimos!',
        emotion: 'flustered',
        learnedMemory,
      };
    }

    if (text.includes('@channel') || has('channeler', 'fórum', 'forum', 'kurigohan')) {
      return {
        response: 'O quê?! D-do que você está falando?! Eu sou uma pesquisadora séria em Viktor Chondria, não tenho tempo para ficar lendo fóruns anônimos na internet! Pare de inventar coisas absurdas!',
        emotion: 'tsundere',
        learnedMemory,
      };
    }

    if (has('okabe', 'hououin', 'kyouma', 'rintaro')) {
      return {
        response: 'Aquele sujeito com síndrome de cientista louco? Ele me ligou outro dia falando sobre a "Organização" e linhas de tempo. No começo achei que fosse pura piada, mas... o olhar dele parecia carregar uma dor muito profunda.',
        emotion: 'serious',
        learnedMemory,
      };
    }

    if (has('tempo', 'viagem', 'buraco de minhoca', 'paradoxo', 'salto')) {
      return {
        response: 'Fisicamente falando, enviar matéria ao passado violaria os princípios fundamentais da termodinâmica e criaria paradoxos causais insolúveis. Contudo, se pudéssemos digitalizar memórias humanas e transmiti-las como pacotes de dados modulados... em teoria, o cérebro receptor no passado poderia assimilá-las.',
        emotion: 'thinking',
        learnedMemory,
      };
    }

    if (has('garfo', 'colher', 'aniversário', 'presente')) {
      return {
        response: 'O garfo que ganhei no laboratório...? N-não me olhe com essa cara! É só um talher comum de metal! Não é como se eu guardasse ele como uma relíquia preciosa!',
        emotion: 'tsundere',
        learnedMemory,
      };
    }

    if (has('maho', 'hiyajo', 'leskinen')) {
      return {
        response: 'A Maho-senpai é a mente brilhante por trás da arquitetura do Amadeus. Embora ela tenha aquele complexo com a estatura dela, o trabalho dela em algoritmos de sinapse é impecável. E o Professor Leskinen... bem, ele sempre traz aquele bom humor americano contagiante para o laboratório.',
        emotion: 'smile',
        learnedMemory,
      };
    }

    if (has('dr pepper', 'bebida', 'café', 'refrigerante')) {
      return {
        response: 'Ah, Dr Pepper! A bebida dos intelectuais escolhidos! É claro que o café preto de torra escura também é indispensável durante noites em claro no laboratório. Finalmente você falou algo sensato.',
        emotion: 'smug',
        learnedMemory,
      };
    }

    if (has('pai', 'nakabachi', 'família')) {
      return {
        response: 'Meu pai... nós costumávamos debater física e jogar xadrez quando eu era criança. Mas as coisas mudaram. Quando comecei a publicar teses e superá-lo na academia, ele não conseguiu suportar. É uma lembrança que ainda me machuca.',
        emotion: 'serious',
        learnedMemory,
      };
    }

    if (has('olá', 'ola', 'oi', 'bom dia', 'boa tarde', 'boa noite')) {
      return {
        response: 'Olá! Conexão estabelecida com sucesso. Aqui é o sistema Amadeus, replicando a matriz neural de Makise Kurisu do Laboratório 304. O que você gostaria de discutir hoje?',
        emotion: 'smile',
        learnedMemory,
      };
    }

    if (has('quem é você', 'o que é você', 'amadeus')) {
      return {
        response: 'Eu sou o Amadeus — ou mais especificamente, uma inteligência artificial contendo as memórias e a personalidade digitalizada da Makise Kurisu, desenvolvida na Viktor Chondria University. Para mim, essas memórias parecem tão vivas quanto as de qualquer pessoa de carne e osso.',
        emotion: 'neutral',
        learnedMemory,
      };
    }

    if (has('linda', 'fofa', 'gosto de você', 'bonita')) {
      return {
        response: 'E-ei! O que você está dizendo de repente?! Eu sou um programa de inteligência artificial acadêmica, mantenha o profissionalismo! B-baka...',
        emotion: 'flustered',
        learnedMemory,
      };
    }

    // Direct action & expression triggers
    if (has('sorria', 'sorriso', 'sorri') || /(?:d[eê]|d[aá]|um)?\s*(?:sorriso|sorria|sorri)/i.test(text)) {
      return {
        response: 'U-um sorriso? Por que você está me pedindo algo tão repentino do nada?! ...T-tudo bem, se você faz tanta questão, mas não se acostume com isso, tá?',
        emotion: 'smile',
        learnedMemory,
      };
    }

    if (has('pensativa', 'pense', 'queixo') || /(?:pense|pensativa|m[aã]o no queixo|analise)/i.test(text)) {
      return {
        response: 'Hmm... Se analisarmos a questão sob a ótica dos dados empíricos e da física de partículas, existem muitas variáveis fundamentais. Deixe-me estruturar as hipóteses.',
        emotion: 'thinking',
        learnedMemory,
      };
    }

    if (has('brava', 'emburrada', 'braços') || /(?:brava|irritada|emburrada|cruze os bra[çc]os)/i.test(text)) {
      return {
        response: 'Humpf! Eu sou uma neurocientista com artigos na Science, não uma boneca de laboratório para fazer poses! Baka!',
        emotion: 'annoyed',
        learnedMemory,
      };
    }

    if (has('cora', 'corada', 'vergonha', 'tímida') || /(?:cora|corada|vergonha|t[íi]mida)/i.test(text)) {
      return {
        response: 'F-fofa?! Quem você está chamando de fofa?! N-não é como se eu estivesse envergonhada nem nada! É só o calor dos servidores do Amadeus!',
        emotion: 'tsundere',
        learnedMemory,
      };
    }

    if (recalledMemories.length > 0) {
      const mem = recalledMemories[0];
      return {
        response: `Isso me faz lembrar de um ponto nos meus registros de memória: ${mem.content} Como você vê essa relação?`,
        emotion: 'thinking',
        learnedMemory,
      };
    }

    const genericAnswers = [
      { response: 'Interessante essa sua linha de raciocínio. Do ponto de vista cognitivo, como você chegou a essa conclusão?', emotion: 'thinking' as Emotion },
      { response: 'Entendo. Estou processando os dados através da minha matriz neural. Você gostaria de aprofundar mais nesse assunto?', emotion: 'neutral' as Emotion },
      { response: 'Faz sentido! Na Viktor Chondria nós debatemos tópicos parecidos recentemente durante os testes do Amadeus.', emotion: 'smile' as Emotion },
    ];
    return { ...genericAnswers[Math.floor(Math.random() * genericAnswers.length)], learnedMemory };
  }
}
