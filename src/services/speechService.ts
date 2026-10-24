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
  text = text.replace(/<!--\s*(?:emotion|remember|pose|camera):[^>]*-->/gi, '');

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

export class SpeechService {
  private static recognition: any = null;
  private static isListening = false;

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
    return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Initializes Speech Recognition (STT - Microphone)
   */
  static initRecognition(
    onResult: SpeechCallback,
    onStateChange: SpeechStateCallback,
    onError?: (message: string) => void
  ): boolean {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('Web Speech API (SpeechRecognition) is not supported in this browser.');
      return false;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'pt-BR';

      this.recognition.onstart = () => {
        this.isListening = true;
        onStateChange(true);
      };

      this.recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          onResult(transcript);
        }
      };

      this.recognition.onerror = (event: any) => {
        this.isListening = false;
        onStateChange(false);

        // Silence or user cancel are not real failures
        if (event.error === 'no-speech' || event.error === 'aborted') return;

        console.warn('Speech recognition error:', event.error);
        const messages: Record<string, string> = {
          'not-allowed': 'Microfone bloqueado. Clique no cadeado ao lado do endereço (localhost:5173), permita o Microfone e recarregue a página.',
          'service-not-allowed': 'O navegador não permite reconhecimento de voz aqui. Use Chrome ou Edge.',
          'audio-capture': 'Nenhum microfone encontrado. Verifique se ele está conectado.',
          'network': 'O reconhecimento de voz precisa de internet (o navegador usa um serviço online).',
        };
        onError?.(messages[event.error] ?? `Erro no microfone: ${event.error}`);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        onStateChange(false);
      };

      return true;
    } catch (e) {
      console.error('Error initializing speech recognition:', e);
      return false;
    }
  }

  /**
   * Toggles listening on/off
   */
  static toggleListening(): boolean {
    if (!this.recognition) return false;

    if (this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.error(e);
      }
      this.isListening = false;
      return false;
    }

    try {
      this.recognition.start();
      return true;
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      return false;
    }
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

      // Dynamics compressor calibrated to Asami Imai's empirical dynamic range (RMS 0.033 to 0.215)
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
