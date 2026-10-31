import { BackendService, BACKEND_URL } from './backendService';

export type SpeechCallback = (text: string) => void;
export type SpeechStateCallback = (isListening: boolean) => void;
export type LipSyncCallback = (isOpen: boolean, amplitude: number) => void;

// TypeScript declaration for webkitSpeechRecognition
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

export interface SpeakOptions {
  voiceURI?: string | null;
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
  engine?: 'qwen3' | 'kokoro' | 'edge_rvc';
  qwenMode?: 'remote' | 'local' | 'auto';
  qwenRemoteUrl?: string;
  emotion?: string;
  instruct?: string;
  stream?: boolean;
  useNeural?: boolean;
  neuralVoice?: string;
  useRvc?: boolean;
  rvcModel?: string;
  rvcPitch?: number;
  rvcIndexRate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Normalizes text for natural-sounding speech synthesis in Portuguese:
 * - Inserts natural breathing pauses into stutters (tsundere persona)
 * - Transcribes acronyms and Steins;Gate lore terms into fluent phonetic Portuguese
 * - Removes markdown formatting and internal tags
 */
export function normalizeForSpeech(rawText: string): string {
  let text = rawText || '';

  // 1. Remove emotion, remember and pose tags
  text = text.replace(/<!--[\s\S]*?(?:-->|-+>|>+|$)/gi, '');

  // 2. Remove stage directions / asterisk actions (*sorri*, *olha para o lado*)
  text = text.replace(/\*[^*]+\*/g, '');

  // 3. Remove emoticons (:), :-(, :-D, xD, etc.)
  text = text.replace(/[:;]-?[)(DPpOdD]/g, '');

  // 4. Remove robotic narration phrases like "Aqui vai um sorriso para você"
  text = text.replace(/^(?:claro[,. ]+)?aqui vai um sorriso para voc[eê][.,! ]*/i, 'Um sorriso? Se você faz tanta questão... ');
  text = text.replace(/^(?:aqui est[aá] o meu sorriso|aqui vai o meu sorriso)[.,!:]*/i, '');

  // 5. Remove markdown code blocks, bold, italic, quotes
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`.*?`/g, '');
  text = text.replace(/[*_~#]/g, '');
  text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  // 3. Stutter preservation: keep natural hyphenated stutters (e.g. "N-não", "Q-quem", "U-um")
  // without injecting triple dots that trigger early neural TTS speech cutoff.

  // 4. Steins;Gate Lore & Tech Acronym Pronunciations
  text = text.replace(/\bSERN\b/g, 'Sérn');
  text = text.replace(/\bLHC\b/g, 'éle agá cê');
  text = text.replace(/@channel\b/gi, 'at channel');
  text = text.replace(/\bchanneler\b/gi, 'channeler');
  text = text.replace(/\bIBN\s*5100\b/gi, 'I B N cinco mil e cem');
  text = text.replace(/\bDr\b\.?\s*Pepper\b/gi, 'Doutor Pepper');
  text = text.replace(/\bSteins;Gate\b/gi, 'Steins Gate');
  text = text.replace(/\bViktor\s*Chondria\b/gi, 'Víktor Chôndria');
  text = text.replace(/\bNullpo\b/gi, 'Núlpo');
  text = text.replace(/\bNurupo\b/gi, 'Nurúpo');
  text = text.replace(/\bKurigohan\b/gi, 'Kúrigohan');
  text = text.replace(/\bKamehameha\b/gi, 'Kamehamêha');
  text = text.replace(/\bHououin\s*Kyouma\b/gi, 'Houôin Kyouma');
  text = text.replace(/\bLabMem\b/gi, 'Lab Mem');
  text = text.replace(/\bReading\s*Steiner\b/gi, 'Ríding Stáiner');

  // 5. Clean up multiple punctuation and whitespace
  text = text.replace(/\.{4,}/g, '...');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

const WHISPER_PROMPT_BIAS =
  'Makise Kurisu, Okabe Rintaro, Amadeus, Steins;Gate, Viktor Chondria, Daru, Mayuri, SERN, IBN 5100, Nullpo, Gero Froggy, ChromaDB, Qwen3, Python, TypeScript, GitHub';

const WHISPER_HALLUCINATION_RE =
  /^(?:obrigad[oa](?:\s+por\s+assistir)?|legendas?\s+pela\s+comunidade.*|inscreva-se(?:\s+no\s+canal)?|amara\.org.*|subtitles\s+by.*|thank\s+you\s+for\s+watching.*|you|\.+|,|\?+|!+|\s*)$/i;

/**
 * Filters silence hallucinations and fixes phonetic PT-BR STT transcriptions for lore/tech terms
 */
export function normalizeTranscriptLore(rawText: string): string {
  const trimmed = (rawText || '').trim();
  if (!trimmed || WHISPER_HALLUCINATION_RE.test(trimmed.replace(/[.!?,]+$/g, '').trim())) {
    return '';
  }

  return trimmed
    .replace(/\b(?:makise\s+)?(?:curisso|kurisso|curisu|crisu)\b/gi, 'Kurisu')
    .replace(/\b(?:ocabe|okabi|ocabi)\b/gi, 'Okabe')
    .replace(/\b(?:estains?\s*gate|steins?\s*gate|stains?\s*gate|steins\s*gueite)\b/gi, 'Steins;Gate')
    .replace(/\b(?:amadeu)\b/gi, 'Amadeus')
    .replace(/\b(?:nulpo|nurupo|nupo)\b/gi, 'Nullpo')
    .replace(/\b(?:v[ií]ctor\s+c[oô]ndria|viktor\s+condria)\b/gi, 'Viktor Chondria')
    .replace(/\b(?:croma\s*d\s*b|chroma\s*d\s*b)\b/gi, 'ChromaDB')
    .replace(/\s+/g, ' ')
    .trim();
}

export class SpeechService {
  private static recognition: any = null;
  private static isListening = false;
  private static micMode: 'ptt' | 'hands_free' = 'ptt';
  private static groqApiKey = '';

  // Microphone Web Audio & MediaRecorder VAD state
  private static micStream: MediaStream | null = null;
  private static micSource: MediaStreamAudioSourceNode | null = null;
  private static micAnalyser: AnalyserNode | null = null;
  private static mediaRecorder: MediaRecorder | null = null;
  private static recordedChunks: Blob[] = [];
  private static vadAnimFrame: number | null = null;
  private static hasVocalActivity = false;
  private static shouldTranscribeOnStop = false;
  private static isHoldingPtt = false;
  private static pendingWebSpeechInterim = '';
  private static lastVoiceTime = 0;
  private static voiceStartTime = 0;
  private static recordCycleStart = 0;
  private static usingGroqRecorder = false;

  // Callbacks stored from initRecognition
  private static onResultCb: SpeechCallback | null = null;
  private static onStateChangeCb: SpeechStateCallback | null = null;
  private static onErrorCb: ((message: string) => void) | null = null;
  private static onInterimCb: ((text: string) => void) | null = null;

  // Web Audio API singletons for lip-sync, compression, and oscilloscope
  private static audioCtx: AudioContext | null = null;
  private static analyser: AnalyserNode | null = null;
  private static makeUpGain: GainNode | null = null;
  private static compressor: DynamicsCompressorNode | null = null;
  private static masterGain: GainNode | null = null;
  private static activeSources: Set<AudioBufferSourceNode> = new Set();
  private static neuralAudio: HTMLAudioElement | null = null;
  private static audioSourceConnected = false;
  private static isSpeakingAudio = false;
  private static currentAudioUrl: string | null = null;

  // Listeners for acoustic amplitude and lip flap
  private static lipSyncListeners: Set<LipSyncCallback> = new Set();
  private static lipSyncAnimFrame: number | null = null;
  private static simulatedLipSyncTimeout: number | null = null;
  private static activeAbortController: AbortController | null = null;

  static isRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const hasWebSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasMediaRecorder = typeof navigator?.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';
    return hasWebSpeech || hasMediaRecorder;
  }

  /**
   * Updates microphone mode ('ptt' | 'hands_free') and caches Groq key when available
   */
  static setMicConfig(config: { mode?: 'ptt' | 'hands_free'; apiKey?: string }): void {
    const prevMode = this.micMode;
    if (config.mode) {
      this.micMode = config.mode;
    }
    if (config.apiKey !== undefined) {
      const trimmed = config.apiKey.trim();
      if (trimmed.startsWith('gsk_')) {
        this.groqApiKey = trimmed;
        try {
          localStorage.setItem('amadeus_groq_stt_key', trimmed);
        } catch {}
      } else {
        try {
          this.groqApiKey = localStorage.getItem('amadeus_groq_stt_key') || '';
        } catch {
          this.groqApiKey = '';
        }
      }
    }
    if (this.isListening && prevMode !== this.micMode) {
      this.stopListening(true);
      this.startListening();
    }
  }

  private static getEffectiveGroqKey(): string {
    if (this.groqApiKey.startsWith('gsk_')) return this.groqApiKey;
    try {
      const cached = localStorage.getItem('amadeus_groq_stt_key') || localStorage.getItem('amadeus_gemini_key') || '';
      return cached.trim().startsWith('gsk_') ? cached.trim() : '';
    } catch {
      return '';
    }
  }

  static getMicAnalyser(): AnalyserNode | null {
    return this.micAnalyser;
  }

  /**
   * Initializes Speech Recognition (STT - Microphone)
   */
  static initRecognition(
    onResult: SpeechCallback,
    onStateChange: SpeechStateCallback,
    onError?: (message: string) => void,
    onInterim?: (text: string) => void
  ): boolean {
    this.onResultCb = onResult;
    this.onStateChangeCb = onStateChange;
    this.onErrorCb = onError || null;
    this.onInterimCb = onInterim || null;

    const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
    if (SpeechRec) {
      try {
        this.recognition = new SpeechRec();
        this.recognition.lang = 'pt-BR';
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
          if (!this.isListening) {
            this.isListening = true;
            this.onStateChangeCb?.(true);
          }
        };

        this.recognition.onresult = (event: any) => {
          let interim = '';
          let finalTranscript = '';
          for (let i = event.resultIndex || 0; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
              finalTranscript += res[0].transcript;
            } else {
              interim += res[0].transcript;
            }
          }

          if (interim.trim()) {
            this.pendingWebSpeechInterim = interim.trim();
            this.onInterimCb?.(this.pendingWebSpeechInterim);
            if (this.micMode === 'hands_free' && this.isSpeakingAudio && this.pendingWebSpeechInterim.length > 2) {
              this.stopSpeaking();
            }
          }

          if (finalTranscript.trim()) {
            this.pendingWebSpeechInterim = '';
            this.onInterimCb?.('');
            const cleaned = normalizeTranscriptLore(finalTranscript);
            if (cleaned) {
              this.onResultCb?.(cleaned);
            }
          }
        };

        this.recognition.onerror = (event: any) => {
          if (event.error === 'no-speech' || event.error === 'aborted') return;
          console.warn('Speech recognition error:', event.error);
          this.stopListening(true);
          const messages: Record<string, string> = {
            'not-allowed': 'Microfone bloqueado. Permita o uso do microfone nas configurações do navegador.',
            'service-not-allowed': 'Reconhecimento nativo indisponível neste navegador. Configure uma chave Groq (gsk_...) ou use Chrome/Edge.',
            'audio-capture': 'Nenhum microfone encontrado. Verifique se ele está conectado.',
            'network': 'O reconhecimento de voz precisa de conexão com a internet.',
          };
          this.onErrorCb?.(messages[event.error] ?? `Erro no microfone: ${event.error}`);
        };

        this.recognition.onend = () => {
          if (this.isListening && !this.usingGroqRecorder && this.micMode === 'hands_free') {
            try {
              this.recognition.start();
              return;
            } catch {}
          }
          if (!this.usingGroqRecorder) {
            this.stopListening(true);
          }
        };
      } catch (e) {
        console.error('Error initializing Web Speech recognition:', e);
      }
    }

    return this.isRecognitionSupported();
  }

  private static async setupMicAnalyser(): Promise<MediaStream | null> {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    try {
      if (!this.micStream || !this.micStream.active) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }
      const { ctx } = this.ensureAudioContext();
      if (!this.micAnalyser) {
        this.micAnalyser = ctx.createAnalyser();
        this.micAnalyser.fftSize = 256;
        this.micAnalyser.smoothingTimeConstant = 0.5;
      }
      if (this.micSource) {
        try {
          this.micSource.disconnect();
        } catch {}
      }
      // Connect mic stream ONLY to micAnalyser (never to destination, preventing speaker feedback)
      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.micAnalyser);
      return this.micStream;
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        this.onErrorCb?.('Microfone bloqueado. Clique no cadeado da barra de endereços e permita o acesso ao Microfone.');
      }
      return null;
    }
  }

  private static startRecorderCycle(stream: MediaStream): void {
    if (typeof MediaRecorder === 'undefined') return;
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.recordedChunks = [];
      this.hasVocalActivity = false;
      this.shouldTranscribeOnStop = false;
      this.recordCycleStart = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const chunks = this.recordedChunks;
        const shouldSend = this.shouldTranscribeOnStop;
        const durationMs = Date.now() - this.recordCycleStart;
        this.recordedChunks = [];
        this.shouldTranscribeOnStop = false;

        if (shouldSend && chunks.length > 0 && durationMs >= 220) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          this.transcribeWithGroq(blob);
        }

        // If still listening in Hands-Free mode, immediately open next cycle so onset is never clipped
        if (this.isListening && this.usingGroqRecorder && this.micMode === 'hands_free' && this.micStream?.active) {
          this.startRecorderCycle(this.micStream);
        }
      };

      this.mediaRecorder = recorder;
      recorder.start(100);
    } catch (err) {
      console.warn('[SpeechService] MediaRecorder start failed, falling back to Web Speech:', err);
      this.usingGroqRecorder = false;
    }
  }

  private static async transcribeWithGroq(audioBlob: Blob): Promise<void> {
    const key = this.getEffectiveGroqKey();
    if (!key) return;

    this.onInterimCb?.('⏳ Transcrevendo fala (Whisper Turbo)...');
    try {
      const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
      const formData = new FormData();
      formData.append('file', audioBlob, `speech.${ext}`);
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'pt');
      formData.append('temperature', '0');
      formData.append('prompt', WHISPER_PROMPT_BIAS);

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
      });

      this.onInterimCb?.('');
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          this.groqApiKey = '';
          try {
            localStorage.removeItem('amadeus_groq_stt_key');
          } catch {}
        }
        throw new Error(`Groq Whisper HTTP ${res.status}`);
      }

      const data = await res.json();
      const cleaned = normalizeTranscriptLore(data?.text || '');
      if (cleaned) {
        this.onResultCb?.(cleaned);
      }
    } catch (err: any) {
      this.onInterimCb?.('');
      console.warn('[SpeechService] Groq Whisper STT failed:', err);
      this.onErrorCb?.(`Falha na transcrição de voz (${err?.message || 'erro de rede'}).`);
    }
  }

  private static startVadLoop(): void {
    if (this.vadAnimFrame) cancelAnimationFrame(this.vadAnimFrame);
    const timeData = new Uint8Array(this.micAnalyser?.fftSize || 256);
    this.voiceStartTime = 0;
    this.lastVoiceTime = 0;
    let noiseFloor = 0.012;

    const checkVad = () => {
      if (!this.isListening || !this.micAnalyser) {
        this.vadAnimFrame = null;
        return;
      }

      // Linear time-domain RMS amplitude (immune to logarithmic dB floor inflation from AGC)
      this.micAnalyser.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        const sample = (timeData[i] - 128) / 128;
        sumSq += sample * sample;
      }
      const rms = Math.sqrt(sumSq / timeData.length);

      // Adapt ambient noise floor when not actively speaking
      if (rms < noiseFloor) {
        noiseFloor = Math.max(0.004, noiseFloor * 0.90 + rms * 0.10);
      } else if (!this.hasVocalActivity && rms < noiseFloor * 1.7) {
        noiseFloor = Math.min(0.045, noiseFloor * 0.98 + rms * 0.02);
      }

      const onsetThreshold = Math.max(0.020, noiseFloor * 2.1 + 0.009);
      const sustainThreshold = Math.max(0.015, noiseFloor * 1.6 + 0.006);
      const baseThreshold = this.hasVocalActivity ? sustainThreshold : onsetThreshold;
      // Higher threshold while Kurisu is speaking to prevent speaker echo false barge-ins
      const threshold = this.isSpeakingAudio ? Math.max(onsetThreshold * 2.2, 0.075) : baseThreshold;
      const now = Date.now();

      if (rms > threshold) {
        if (!this.voiceStartTime) this.voiceStartTime = now;
        this.lastVoiceTime = now;

        const minHoldMs = this.isSpeakingAudio ? 180 : 85;
        if (now - this.voiceStartTime >= minHoldMs) {
          if (!this.hasVocalActivity) {
            this.hasVocalActivity = true;
            if (this.usingGroqRecorder) {
              this.onInterimCb?.('Captando sua fala...');
            }
          }
          if (this.micMode === 'hands_free' && this.isSpeakingAudio) {
            // Instant acoustic Barge-In: interrupt Kurisu's speech immediately
            this.stopSpeaking();
          }
        }
      } else {
        this.voiceStartTime = 0;

        if (this.hasVocalActivity && this.lastVoiceTime > 0 && now - this.lastVoiceTime > 650) {
          // 650ms of silence after speech: reset flags synchronously and commit utterance
          if (this.micMode === 'ptt' && !this.isHoldingPtt) {
            this.stopListening(false);
            return;
          }
          this.hasVocalActivity = false;
          this.lastVoiceTime = 0;

          if (this.usingGroqRecorder && this.micMode === 'hands_free' && this.mediaRecorder?.state === 'recording') {
            this.shouldTranscribeOnStop = true;
            try {
              this.mediaRecorder.stop();
            } catch {}
          } else if (!this.usingGroqRecorder && this.micMode === 'hands_free' && this.pendingWebSpeechInterim) {
            try {
              this.recognition?.stop();
            } catch {}
          }
        }
      }

      this.vadAnimFrame = requestAnimationFrame(checkVad);
    };

    this.vadAnimFrame = requestAnimationFrame(checkVad);
  }

  static async startListening(): Promise<boolean> {
    if (this.isListening) return true;

    if (this.micMode === 'ptt' && this.isSpeakingAudio) {
      this.stopSpeaking();
    }

    const groqKey = this.getEffectiveGroqKey();
    const canUseGroq = Boolean(groqKey && typeof MediaRecorder !== 'undefined' && typeof navigator?.mediaDevices?.getUserMedia === 'function');

    const stream = await this.setupMicAnalyser();
    if (!stream && !this.recognition) {
      this.onErrorCb?.('Microfone indisponível neste navegador.');
      return false;
    }

    this.isListening = true;
    this.onStateChangeCb?.(true);

    if (canUseGroq && stream) {
      this.usingGroqRecorder = true;
      this.startRecorderCycle(stream);
      this.startVadLoop();
      return true;
    }

    this.usingGroqRecorder = false;
    if (stream) {
      this.startVadLoop();
    }

    if (this.recognition) {
      try {
        // Use single-utterance mode with auto-restart in onend so Chrome finalizes sentences immediately on pause
        this.recognition.continuous = false;
        this.recognition.start();
        return true;
      } catch (e) {
        console.error('Failed to start Web Speech recognition:', e);
      }
    }

    this.stopListening(true);
    return false;
  }

  static stopListening(discard = false): void {
    const wasListening = this.isListening;
    this.isListening = false;
    this.isHoldingPtt = false;

    if (this.vadAnimFrame) {
      cancelAnimationFrame(this.vadAnimFrame);
      this.vadAnimFrame = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.shouldTranscribeOnStop = !discard && (this.micMode === 'ptt' || this.hasVocalActivity);
      this.hasVocalActivity = false;
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.mediaRecorder = null;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (wasListening) {
      this.onStateChangeCb?.(false);
    }
  }

  /**
   * Toggles listening on/off
   */
  static toggleListening(): boolean {
    if (this.isListening) {
      this.stopListening(false);
      return false;
    }
    this.startListening();
    return true;
  }

  static startPushToTalk(): void {
    if (this.isListening) return;
    this.isHoldingPtt = true;
    this.startListening();
  }

  static stopPushToTalk(): void {
    this.isHoldingPtt = false;
    if (!this.isListening || this.micMode !== 'ptt') return;
    this.stopListening(false);
  }

  /**
   * Returns list of available browser synthesis voices
   */
  static getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve([]);
        return;
      }

      let voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        resolve(voices);
        return;
      }

      window.speechSynthesis.onvoiceschanged = () => {
        voices = window.speechSynthesis.getVoices();
        resolve(voices);
      };
    });
  }

  /**
   * Ensures Web Audio API context and processing chain (makeUpGain -> compressor -> masterGain -> analyser -> destination)
   */
  private static ensureAudioContext(): {
    ctx: AudioContext;
    analyser: AnalyserNode;
    makeUpGain: GainNode;
    compressor: DynamicsCompressorNode;
    masterGain: GainNode;
  } {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      // Make-up gain (1.65x / +4.3 dB) to elevate quieter speech segments (RMS ~0.035) before compression
      this.makeUpGain = this.audioCtx.createGain();
      this.makeUpGain.gain.value = 1.65;

      // Dynamics compressor calibrated to the character's empirical dynamic range (RMS 0.033 to 0.215)
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-20, this.audioCtx.currentTime);
      this.compressor.knee.setValueAtTime(14, this.audioCtx.currentTime);
      this.compressor.ratio.setValueAtTime(3.5, this.audioCtx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);

      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 1.0;

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.65;

      // Audio Graph routing
      this.makeUpGain.connect(this.compressor);
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return {
      ctx: this.audioCtx,
      analyser: this.analyser!,
      makeUpGain: this.makeUpGain!,
      compressor: this.compressor!,
      masterGain: this.masterGain!,
    };
  }

  /**
   * Returns the global AnalyserNode for audio visualization (oscilloscope)
   */
  static getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Registers a subscriber for real-time lip-sync events (mouth open / close + amplitude)
   */
  static addLipSyncListener(cb: LipSyncCallback): () => void {
    this.lipSyncListeners.add(cb);
    return () => {
      this.lipSyncListeners.delete(cb);
    };
  }

  private static notifyLipSync(isOpen: boolean, amplitude: number): void {
    this.lipSyncListeners.forEach((cb) => {
      try {
        cb(isOpen, amplitude);
      } catch {}
    });
  }

  /**
   * Monitors real acoustic audio amplitude via FFT and drives lip-sync mouth frames
   */
  private static startLipSyncMonitoring(): void {
    if (this.lipSyncAnimFrame) return;

    const dataArray = new Uint8Array(this.analyser?.frequencyBinCount || 128);

    const checkFrame = () => {
      if (!this.isSpeakingAudio) {
        this.notifyLipSync(false, 0);
        this.lipSyncAnimFrame = null;
        return;
      }

      if (this.analyser) {
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        // Check vocal frequency bins (approx 300Hz - 3500Hz)
        const maxBins = Math.min(dataArray.length, 64);
        for (let i = 2; i < maxBins; i++) {
          sum += dataArray[i];
        }
        const avg = sum / (maxBins - 2);
        const normalized = Math.min(1.0, avg / 85.0);
        const isOpen = normalized > 0.16;
        this.notifyLipSync(isOpen, normalized);
      }

      this.lipSyncAnimFrame = requestAnimationFrame(checkFrame);
    };

    this.lipSyncAnimFrame = requestAnimationFrame(checkFrame);
  }

  /**
   * Main speech function:
   * 1. Tries neural Edge-TTS (FranciscaNeural / ThalitaNeural) via Python backend
   * 2. Falls back seamlessly to browser SpeechSynthesisUtterance if backend offline
   */
  static async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const cleanText = normalizeForSpeech(text);
    if (!cleanText) return;

    this.stopSpeaking();

    // Check if neural TTS should be used (default true if backend online and edge-tts available)
    const health = await BackendService.checkHealth().catch(() => null);
    const useNeural = options.useNeural !== false && Boolean(health && health.edgeTtsAvailable !== false);

    if (useNeural || options.engine === 'qwen3') {
      try {
        await this.speakNeural(cleanText, options);
        return;
      } catch (err: any) {
        // If aborted or interrupted cleanly, do not fall back to robotic browser voice
        if (err?.name === 'AbortError' || String(err?.message || '').includes('interrupted')) {
          return;
        }
        console.warn('[SpeechService] Neural TTS playback failed:', err);
        // Only fall back to browser Web Speech if user specifically enabled browser voice
        if (options.engine !== 'qwen3' && options.useNeural === false) {
          this.speakWebSpeech(cleanText, options);
        }
        return;
      }
    }

    // Fallback to browser Web Speech API only if explicitly configured
    this.speakWebSpeech(cleanText, options);
  }

  /**
   * Streams and plays Microsoft Edge-TTS neural speech through Web Audio API
   */
  private static async speakNeural(cleanText: string, options: SpeakOptions): Promise<void> {
    const { ctx, analyser } = this.ensureAudioContext();

    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    const abortCtrl = new AbortController();
    this.activeAbortController = abortCtrl;

    const voice = options.neuralVoice || 'pt-BR-FranciscaNeural';
    const rate = options.rate ? `${Math.round((options.rate - 1) * 100)}%` : '+4%';
    const pitch = options.pitch ? `${Math.round((options.pitch - 1) * 20)}Hz` : '+10Hz';

    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          text: cleanText,
          engine: options.engine || 'qwen3',
          qwenMode: options.qwenMode || 'remote',
          qwenRemoteUrl: options.qwenRemoteUrl,
          emotion: options.emotion,
          instruct: options.instruct,
          stream: options.stream ?? false,
          voice,
          rate: rate.startsWith('-') || rate.startsWith('+') ? rate : `+${rate}`,
          pitch: pitch.startsWith('-') || pitch.startsWith('+') ? pitch : `+${pitch}`,
          useRvc: Boolean(options.useRvc),
          rvcModel: options.rvcModel || 'KurisuRVCv147',
          rvcPitch: options.rvcPitch ?? 0,
          rvcIndexRate: options.rvcIndexRate ?? 0.75,
        }),
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || abortCtrl.signal.aborted) {
        return;
      }
      throw err;
    }

    if (!res.ok) {
      throw new Error(`TTS endpoint returned ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const audioFormat = res.headers.get('x-audio-format') || '';
    const isPcmStream = contentType.includes('audio/L16') || audioFormat === 'pcm_s16le';

    if (isPcmStream && res.body) {
      return this.playPcmStream(res.body, options, abortCtrl.signal);
    }

    const blob = await res.blob();
    if (abortCtrl.signal.aborted) return;
    const audioUrl = URL.createObjectURL(blob);
    this.currentAudioUrl = audioUrl;

    if (!this.neuralAudio) {
      this.neuralAudio = new Audio();
      this.neuralAudio.crossOrigin = 'anonymous';
    }

    const audio = this.neuralAudio;
    audio.src = audioUrl;
    audio.volume = 1.0;
    const { makeUpGain, masterGain } = this.ensureAudioContext();
    masterGain.gain.setValueAtTime(options.volume ?? 1.0, ctx.currentTime);

    if (!this.audioSourceConnected) {
      try {
        const sourceNode = ctx.createMediaElementSource(audio);
        sourceNode.connect(makeUpGain);
        this.audioSourceConnected = true;
      } catch (e) {
        console.warn('[SpeechService] Audio source connection note:', e);
      }
    }

    return new Promise((resolve, reject) => {
      audio.onplay = () => {
        this.isSpeakingAudio = true;
        this.startLipSyncMonitoring();
        options.onStart?.();
      };

      audio.onended = () => {
        this.isSpeakingAudio = false;
        this.notifyLipSync(false, 0);
        URL.revokeObjectURL(audioUrl);
        if (this.currentAudioUrl === audioUrl) this.currentAudioUrl = null;
        options.onEnd?.();
        resolve();
      };

      audio.onerror = (e) => {
        this.isSpeakingAudio = false;
        this.notifyLipSync(false, 0);
        URL.revokeObjectURL(audioUrl);
        if (this.currentAudioUrl === audioUrl) this.currentAudioUrl = null;
        options.onEnd?.();
        reject(e);
      };

      audio.play().catch((err) => {
        URL.revokeObjectURL(audioUrl);
        if (this.currentAudioUrl === audioUrl) this.currentAudioUrl = null;
        reject(err);
      });
    });
  }

  /**
   * Streams raw PCM 16-bit 24kHz audio via Web Audio API AudioBufferSourceNodes.
   * Features:
   * - Remainder byte buffer handling for odd-sized network chunks
   * - 120ms initial jitter buffer to prevent network underrun
   * - GainNode (1.5x) + DynamicsCompressorNode volume normalization
   * - Continuous C0 lip-sync monitoring and exact onStart/onEnd lifecycle
   */
  private static async playPcmStream(
    body: ReadableStream<Uint8Array>,
    options: SpeakOptions,
    signal: AbortSignal
  ): Promise<void> {
    const { ctx, makeUpGain, masterGain } = this.ensureAudioContext();
    masterGain.gain.setValueAtTime(options.volume ?? 1.0, ctx.currentTime);

    const reader = body.getReader();
    let remainder: Uint8Array | null = null;
    let nextStartTime = 0;
    const JITTER_BUFFER_SEC = 0.48; // 480ms jitter buffer to protect against remote tunnel packet latency spikes
    let hasStarted = false;

    try {
      while (true) {
        if (signal.aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        // 1. Concatenate leftover byte from previous chunk if present
        let chunk: Uint8Array;
        if (remainder && remainder.length > 0) {
          chunk = new Uint8Array(remainder.length + value.length);
          chunk.set(remainder, 0);
          chunk.set(value, remainder.length);
          remainder = null;
        } else {
          chunk = value;
        }

        // 2. Handle odd byte boundary: preserve 1 remainder byte for next network read
        if (chunk.length % 2 !== 0) {
          remainder = chunk.slice(chunk.length - 1);
          chunk = chunk.subarray(0, chunk.length - 1);
        }

        if (chunk.length === 0) continue;

        // 3. Convert PCM16 LE to Float32 [-1.0, 1.0] using DataView to bypass alignment restrictions
        const numSamples = chunk.length / 2;
        const float32 = new Float32Array(numSamples);
        const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.length);
        for (let i = 0; i < numSamples; i++) {
          const sample = dataView.getInt16(i * 2, true);
          float32[i] = sample < 0 ? sample / 32768 : sample / 32767;
        }

        // 4. Create AudioBuffer (24kHz Mono)
        const audioBuffer = ctx.createBuffer(1, numSamples, 24000);
        audioBuffer.copyToChannel(float32, 0);

        // 5. Schedule source node seamlessly
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(makeUpGain);

        const now = ctx.currentTime;
        if (nextStartTime <= now) {
          nextStartTime = now + JITTER_BUFFER_SEC;
        }

        source.start(nextStartTime);
        this.activeSources.add(source);

        source.onended = () => {
          this.activeSources.delete(source);
        };

        if (!hasStarted) {
          hasStarted = true;
          this.isSpeakingAudio = true;
          this.startLipSyncMonitoring();
          options.onStart?.();
        }

        nextStartTime += audioBuffer.duration;
      }

      // Wait until all scheduled audio buffers have finished playing
      if (hasStarted) {
        const remainingSec = Math.max(0, nextStartTime - ctx.currentTime);
        if (remainingSec > 0 && !signal.aborted) {
          await new Promise<void>((resolve) => {
            const timeoutId = window.setTimeout(resolve, remainingSec * 1000);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timeoutId);
                resolve();
              },
              { once: true }
            );
          });
        }
      }
    } finally {
      reader.releaseLock();
      if (hasStarted) {
        this.isSpeakingAudio = false;
        this.notifyLipSync(false, 0);
        options.onEnd?.();
      }
    }
  }

  /**
   * Browser-native SpeechSynthesisUtterance with word-boundary syllable lip-sync
   */
  private static speakWebSpeech(cleanText: string, options: SpeakOptions): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = options.rate ?? 1.05;
    utterance.pitch = options.pitch ?? 1.15;
    utterance.volume = options.volume ?? 1.0;
    utterance.lang = options.lang ?? 'pt-BR';

    if (options.voiceURI) {
      const voices = window.speechSynthesis.getVoices();
      const selected = voices.find((v) => v.voiceURI === options.voiceURI);
      if (selected) {
        utterance.voice = selected;
      }
    }

    utterance.onstart = () => {
      this.isSpeakingAudio = true;
      options.onStart?.();
    };

    // Word boundary event for syllable-accurate mouth movements
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        this.notifyLipSync(true, 0.7);
        if (this.simulatedLipSyncTimeout) clearTimeout(this.simulatedLipSyncTimeout);
        this.simulatedLipSyncTimeout = window.setTimeout(() => {
          this.notifyLipSync(false, 0);
        }, 125);
      }
    };

    utterance.onend = () => {
      this.isSpeakingAudio = false;
      this.notifyLipSync(false, 0);
      options.onEnd?.();
    };

    utterance.onerror = (e) => {
      this.isSpeakingAudio = false;
      this.notifyLipSync(false, 0);
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('Speech synthesis error:', e.error);
      }
      options.onEnd?.();
    };

    window.speechSynthesis.speak(utterance);
  }

  /**
   * Stops any ongoing speech synthesis (neural or browser)
   */
  static stopSpeaking(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    this.isSpeakingAudio = false;
    this.notifyLipSync(false, 0);

    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources.clear();

    if (this.simulatedLipSyncTimeout) {
      clearTimeout(this.simulatedLipSyncTimeout);
      this.simulatedLipSyncTimeout = null;
    }

    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    if (this.neuralAudio) {
      try {
        this.neuralAudio.pause();
        this.neuralAudio.currentTime = 0;
      } catch {}
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
}
