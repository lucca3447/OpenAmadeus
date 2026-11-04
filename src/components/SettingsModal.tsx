import React, { useState, useEffect } from 'react';
import {
  Key,
  Volume2,
  X,
  Check,
  Zap,
  Loader2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Cpu,
  Database,
  Layers,
  Radio,
  Globe,
  Activity,
  Mic,
  Sliders,
  Shield,
} from 'lucide-react';
import {
  VoiceSettings,
  QwenWorkerStatus,
  SettingsSectionId,
  LLMFallbackSettings,
  TtsFallbackEngine,
} from '../types/amadeus';
import { SpeechService } from '../services/speechService';
import { AIService } from '../services/aiService';
import { BackendService } from '../services/backendService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: SettingsSectionId;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
  voiceSettings: VoiceSettings;
  onSaveVoiceSettings: (settings: VoiceSettings) => void;
  llmSettings?: LLMFallbackSettings;
  onSaveLlmSettings?: (settings: LLMFallbackSettings) => void;
  scanlines: boolean;
  onToggleScanlines: (enabled: boolean) => void;
  defaultCamera?: 'auto' | 'closeup' | 'medium' | 'full';
  onSaveDefaultCamera?: (camera: 'auto' | 'closeup' | 'medium' | 'full') => void;
}

const CAPSULE_SECTIONS: { id: SettingsSectionId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'cortex', label: 'CÓRTEX', icon: Cpu },
  { id: 'voice', label: 'VOICE', icon: Volume2 },
  { id: 'whisper', label: 'WHISPER', icon: Mic },
  { id: 'display', label: 'DISPLAY', icon: Sliders },
  { id: 'system', label: 'SYSTEM', icon: Shield },
];

const DEFAULT_FALLBACK_ENGINES: { id: TtsFallbackEngine; label: string }[] = [
  { id: 'qwen_local', label: 'Qwen3 Local (:8005)' },
  { id: 'kokoro', label: 'Kokoro-TTS 82M' },
  { id: 'edge_rvc', label: 'Edge-TTS + RVC v2' },
  { id: 'web_speech', label: 'Web Speech Nativo' },
];

interface PlasmaMeterProps {
  label: string;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
}

const PlasmaMeter: React.FC<PlasmaMeterProps> = ({
  label,
  displayValue,
  min,
  max,
  step,
  value,
  onChange,
}) => {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = Math.round(((clamped - min) / (max - min || 1)) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="engraved-label">{label}</span>
        <span className="font-mono text-xs text-amber-300">{displayValue}</span>
      </div>
      <div className="bg-black/90 border border-zinc-800 p-1 relative">
        <div className="flex items-center justify-between px-2 py-0.5 text-[10px] font-mono text-zinc-300 tracking-widest uppercase">
          <span>MIN</span>
          <div className="flex-1 mx-3 h-[1px] bg-zinc-700 relative">
            <div className="absolute -top-1 left-1/2 w-[1px] h-2 bg-zinc-500" />
          </div>
          <span>MAX</span>
        </div>
        <div className="plasma-meter-track">
          <div className="plasma-meter-fill transition-all duration-75" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={label}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialSection = 'cortex',
  apiKey,
  onSaveApiKey,
  voiceSettings,
  onSaveVoiceSettings,
  llmSettings = { allowModelFallback: true, allowOfflineSimulatorFallback: true },
  onSaveLlmSettings,
  scanlines,
  onToggleScanlines,
  defaultCamera = 'auto',
  onSaveDefaultCamera,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [tempSttKey, setTempSttKey] = useState<string>(
    () => voiceSettings.separateGroqSttKey || localStorage.getItem('amadeus_groq_stt_key') || ''
  );
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceTestError, setVoiceTestError] = useState<string | null>(null);
  const [qwenPingStatus, setQwenPingStatus] = useState<QwenWorkerStatus | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [availableRvcModels, setAvailableRvcModels] = useState<string[]>(['KurisuRVCv147']);

  useEffect(() => {
    if (isOpen && initialSection) {
      setActiveSection(initialSection);
    }
  }, [isOpen, initialSection]);

  useEffect(() => {
    setTempApiKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    setTempSttKey(voiceSettings.separateGroqSttKey || localStorage.getItem('amadeus_groq_stt_key') || '');
  }, [voiceSettings.separateGroqSttKey]);

  const handlePingWorker = async (targetUrl?: string) => {
    setIsPinging(true);
    const url =
      targetUrl !== undefined
        ? targetUrl
        : voiceSettings.qwenMode === 'local'
          ? 'http://127.0.0.1:8005'
          : voiceSettings.qwenRemoteUrl;
    const res = await BackendService.pingQwenWorker(url);
    setQwenPingStatus(res);
    setIsPinging(false);
  };

  useEffect(() => {
    if (isOpen) {
      BackendService.getVoiceModels().then((data) => {
        if (data?.rvc_models && data.rvc_models.length > 0) {
          setAvailableRvcModels(data.rvc_models);
        }
      });
      if ((voiceSettings.engine || 'qwen3') === 'qwen3') {
        handlePingWorker();
      }
    }
  }, [isOpen, voiceSettings.engine, voiceSettings.qwenMode]);

  useEffect(() => {
    SpeechService.getAvailableVoices().then((voices) => {
      setAvailableVoices(voices);
    });
  }, []);

  if (!isOpen) return null;

  const commitKeys = () => {
    const trimmedMain = tempApiKey.trim();
    const trimmedStt = tempSttKey.trim();
    if (trimmedMain !== apiKey) {
      onSaveApiKey(trimmedMain);
    }
    localStorage.setItem('amadeus_groq_stt_key', trimmedStt);
    if (trimmedStt !== (voiceSettings.separateGroqSttKey || '')) {
      onSaveVoiceSettings({ ...voiceSettings, separateGroqSttKey: trimmedStt });
    }
  };

  const handleApplyAndClose = () => {
    commitKeys();
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 350);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await AIService.testConnection(tempApiKey);
    setTestResult(result);
    if (result.ok) {
      onSaveApiKey(tempApiKey.trim());
    }
    setIsTesting(false);
  };

  const handleTestVoice = async () => {
    setIsTestingVoice(true);
    setVoiceTestError(null);
    const sampleText =
      (voiceSettings.engine || 'qwen3') === 'qwen3'
        ? 'Teste de calibração acústica do motor Qwen3 concluído. Sincronia neural ativa.'
        : voiceSettings.engine === 'kokoro'
          ? 'Olá, este é o motor neural Kokoro operando localmente com baixa latência.'
          : voiceSettings.neuralVoice?.startsWith('ja-JP')
            ? 'こんにちは！神経接続および音声合成テスト完了。'
            : 'Conexão estabelecida. Teste de síntese vocal e sincronia labial concluído.';

    await SpeechService.speak(sampleText, {
      voiceURI: voiceSettings.voiceURI,
      rate: voiceSettings.rate,
      pitch: voiceSettings.pitch,
      volume: voiceSettings.volume,
      engine: voiceSettings.engine || 'qwen3',
      qwenMode: voiceSettings.qwenMode || 'remote',
      qwenRemoteUrl: voiceSettings.qwenRemoteUrl,
      emotion: 'neutral',
      stream: (voiceSettings.engine || 'qwen3') === 'qwen3' ? Boolean(voiceSettings.stream) : false,
      useNeural: voiceSettings.useNeural !== false,
      neuralVoice: voiceSettings.neuralVoice || 'pt-BR-FranciscaNeural',
      useRvc: Boolean(voiceSettings.useRvc),
      rvcModel: voiceSettings.rvcModel || 'KurisuRVCv147',
      rvcPitch: voiceSettings.rvcPitch ?? 0,
      rvcIndexRate: voiceSettings.rvcIndexRate ?? 0.75,
      allowTtsFallback: voiceSettings.allowTtsFallback !== false,
      allowedTtsFallbacks: voiceSettings.allowedTtsFallbacks || ['qwen_local', 'kokoro', 'edge_rvc', 'web_speech'],
      onEnd: () => setIsTestingVoice(false),
      onError: (err) => {
        setIsTestingVoice(false);
        setVoiceTestError(err);
      },
    });
  };

  const toggleFallbackEngine = (engineId: TtsFallbackEngine) => {
    const current = voiceSettings.allowedTtsFallbacks || ['qwen_local', 'kokoro', 'edge_rvc', 'web_speech'];
    const exists = current.includes(engineId);
    const next = exists ? current.filter((item) => item !== engineId) : [...current, engineId];
    onSaveVoiceSettings({ ...voiceSettings, allowedTtsFallbacks: next });
  };

  const handleCapsuleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = CAPSULE_SECTIONS[(idx + 1) % CAPSULE_SECTIONS.length];
      setActiveSection(next.id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = CAPSULE_SECTIONS[(idx - 1 + CAPSULE_SECTIONS.length) % CAPSULE_SECTIONS.length];
      setActiveSection(prev.id);
    }
  };

  const isMainKeyGroq = tempApiKey.trim().startsWith('gsk_');
  const sttMode = voiceSettings.sttKeyMode || 'unified';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fadeIn select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="amadeus-setup-title"
    >
      {/* Main Technical Workbench Frame */}
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col md:flex-row chalkboard-grid border border-orange-500/40 shadow-[0_0_50px_rgba(0,0,0,0.95)] overflow-hidden">
        {/* Subtle Radial Amber Spotlight */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_25%,rgba(234,88,12,0.09),transparent_65%)] pointer-events-none" />

        {/* ================= LEFT COLUMN: COPPER PCB CAPSULES + VERTICAL POWER BUS ================= */}
        <aside className="relative md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-amber-900/40 bg-black/45 p-4 flex flex-col justify-between z-10">
          {/* Vertical Glowing Conductor Line */}
          <div className="hidden md:block absolute left-9 top-6 bottom-16 bus-line-vertical z-0" />

          {/* Capsule Tab List */}
          <div
            role="tablist"
            aria-label="Seções de Configuração"
            className="relative z-10 flex md:flex-col gap-2.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0"
          >
            {CAPSULE_SECTIONS.map((sec, idx) => {
              const Icon = sec.icon;
              const selected = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-selected={selected}
                  onClick={() => setActiveSection(sec.id)}
                  onKeyDown={(e) => handleCapsuleKeyDown(e, idx)}
                  className="copper-capsule px-4 py-2.5 flex items-center gap-3 text-left shrink-0 md:w-full"
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${
                      selected
                        ? 'bg-orange-400 shadow-[0_0_8px_#fb923c]'
                        : 'bg-amber-900/70'
                    }`}
                  />
                  <Icon className={`w-4 h-4 shrink-0 ${selected ? 'text-orange-400' : 'text-amber-200/70'}`} />
                  <span
                    className={`engraved-serif font-bold text-xs md:text-sm tracking-widest ${
                      selected ? 'text-amber-100' : 'text-amber-200/70'
                    }`}
                  >
                    {sec.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Bottom SETUP MENU Rectangular Plate + Horizontal Bus Line */}
          <div className="hidden md:block relative z-10 pt-6">
            <div className="bg-black/95 border border-orange-500/60 px-3 py-2 shadow-[0_0_20px_rgba(249,115,22,0.2)]">
              <div className="engraved-serif text-sm font-bold tracking-widest text-amber-100">
                SETUP MENU
              </div>
              <div className="text-[9px] font-mono text-orange-400/80 tracking-widest uppercase">
                OPENAMADEUS WORKBENCH
              </div>
            </div>
            <div className="bus-line-horizontal w-full mt-1" />
          </div>
        </aside>

        {/* ================= RIGHT COLUMN: ENGRAVED TECHNICAL WORKSPACE ================= */}
        <div className="relative z-10 flex-1 flex flex-col min-h-0">
          {/* Top Section Header Bar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-amber-900/40 bg-black/50">
            <div>
              <h2 id="amadeus-setup-title" className="engraved-heading text-lg md:text-xl font-bold uppercase">
                {activeSection === 'cortex' && 'Córtex LLM & Credenciais'}
                {activeSection === 'voice' && 'Síntese Vocal & Prosódia Neural'}
                {activeSection === 'whisper' && 'Whisper STT & Detecção de Voz (VAD)'}
                {activeSection === 'display' && 'Calibração Óptica & Enquadramento'}
                {activeSection === 'system' && 'Arquitetura Neural & Modelos Open-Source'}
              </h2>
              <p className="text-[11px] font-mono text-orange-400/80 tracking-wider uppercase mt-0.5">
                {activeSection === 'cortex' && 'Chave Primária e Controle Estrito de Modelos'}
                {activeSection === 'voice' && 'Motores Qwen3 1.7B, Kokoro 82M, Edge+RVC e Cascata TTS'}
                {activeSection === 'whisper' && 'Credencial Groq Dedicada, Gate Acústico e Fallback STT'}
                {activeSection === 'display' && 'Varredura CRT e Geometria de Palco'}
                {activeSection === 'system' && 'Infraestrutura Local e Pesos Neurais'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleApplyAndClose}
              title="Aplicar e Fechar (Esc)"
              className="w-8 h-8 rounded-full border border-amber-900/60 bg-black/60 flex items-center justify-center text-zinc-400 hover:text-amber-200 hover:border-orange-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Section Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 font-mono text-xs">
            {/* ==================== SECTION 1: CÓRTEX LLM ==================== */}
            {activeSection === 'cortex' && (
              <div className="space-y-6">
                {/* Main API Key Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="engraved-label flex items-center gap-2">
                      <Key className="w-4 h-4 text-orange-400" />
                      <span>Chave Primária do Córtex (Groq / Gemini / OpenRouter)</span>
                    </span>
                    <span className="text-[10px] font-mono text-orange-400 uppercase">
                      {tempApiKey.trim().startsWith('gsk_')
                        ? 'GROQ CLOUD LPU'
                        : tempApiKey.trim().startsWith('AIza')
                          ? 'GOOGLE GEMINI'
                          : tempApiKey.trim().startsWith('sk-or-')
                            ? 'OPENROUTER'
                            : 'MODO OFFLINE'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                    Suporta chaves <strong>Groq Cloud</strong> (<code className="text-amber-300">gsk_...</code>),{' '}
                    <strong>Google Gemini</strong> (<code className="text-amber-300">AIzaSy...</code>) ou{' '}
                    <strong>OpenRouter</strong> (<code className="text-amber-300">sk-or-...</code>).
                  </p>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                    <input
                      type="password"
                      placeholder="Insira sua chave (gsk_... / AIzaSy... / sk-or-...)"
                      value={tempApiKey}
                      onChange={(e) => {
                        setTempApiKey(e.target.value);
                        setTestResult(null);
                      }}
                      onBlur={commitKeys}
                      className="flex-1 h-9 bg-black/85 border border-amber-900/60 focus:border-orange-400 px-3 text-amber-100 font-mono text-xs outline-none shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting || !tempApiKey.trim()}
                      className="copper-capsule h-9 px-4 flex items-center justify-center gap-1.5 text-amber-200 hover:text-white disabled:opacity-40 shrink-0"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                      ) : (
                        <Zap className="w-3.5 h-3.5 text-orange-400" />
                      )}
                      <span className="engraved-serif text-[11px] font-bold tracking-wider">
                        {isTesting ? 'TESTANDO...' : 'TESTAR CONEXÃO'}
                      </span>
                    </button>
                  </div>

                  {testResult && (
                    <div
                      className={`flex items-start gap-2 text-[11px] p-2.5 border font-sans ${
                        testResult.ok
                          ? 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30'
                          : 'text-rose-300 border-rose-500/40 bg-rose-950/30'
                      }`}
                    >
                      {testResult.ok ? (
                        <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                      )}
                      <span>{testResult.message}</span>
                    </div>
                  )}
                </div>

                {/* Engraved Toggle 1: Strict Model Lock */}
                <div className="space-y-1.5 pt-3 border-t border-amber-900/30">
                  <div className="flex items-baseline">
                    <span className="engraved-label">Travar Modelo Selecionado (Sem Cascata LLM)</span>
                    <div className="dotted-leader" />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={llmSettings.allowModelFallback === false}
                        onClick={() =>
                          onSaveLlmSettings?.({ ...llmSettings, allowModelFallback: false })
                        }
                      >
                        ON
                      </button>
                      <span className="text-zinc-600 font-serif">/</span>
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={llmSettings.allowModelFallback !== false}
                        onClick={() =>
                          onSaveLlmSettings?.({ ...llmSettings, allowModelFallback: true })
                        }
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans">
                    Quando <strong>ON</strong>, impede que erros de cota (HTTP 429/503) troquem silenciosamente seu modelo por outro da fila, exibindo o erro real do provedor.
                  </p>
                </div>

                {/* Engraved Toggle 2: Block Silent Offline Simulator */}
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-baseline">
                    <span className="engraved-label">Bloquear Simulador Offline em Falhas de Rede</span>
                    <div className="dotted-leader" />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={llmSettings.allowOfflineSimulatorFallback === false}
                        onClick={() =>
                          onSaveLlmSettings?.({
                            ...llmSettings,
                            allowOfflineSimulatorFallback: false,
                          })
                        }
                      >
                        ON
                      </button>
                      <span className="text-zinc-600 font-serif">/</span>
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={llmSettings.allowOfflineSimulatorFallback !== false}
                        onClick={() =>
                          onSaveLlmSettings?.({
                            ...llmSettings,
                            allowOfflineSimulatorFallback: true,
                          })
                        }
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans">
                    Quando <strong>ON</strong>, nunca responde com frases pré-programadas do simulador caso a API falhe.
                  </p>
                </div>

                {/* Spontaneous Initiative & Impatience Mode */}
                <div className="space-y-2 pt-3 border-t border-amber-900/30">
                  <span className="engraved-label block">
                    Iniciativa Espontânea & Impaciência em Silêncio
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'off', label: 'OFF (DESATIVADO)' },
                        { id: 'silent', label: 'SILENCIOSO (TEXTO + SPRITE)' },
                        { id: 'voice', label: 'VOZ ATIVA (TEXTO + TTS)' },
                      ] as const
                    ).map((opt) => {
                      const activeMode = llmSettings.idleInitiativeMode || 'voice';
                      const isSelected = activeMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onSaveLlmSettings?.({
                              ...llmSettings,
                              idleInitiativeMode: opt.id,
                            })
                          }
                          className={`py-2 px-3 border text-center font-bold text-[11px] transition-all ${
                            isSelected
                              ? 'border-orange-400 bg-orange-500/20 text-amber-100'
                              : 'border-amber-900/40 bg-black/50 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans">
                    Quando ativa, a Kurisu puxa assunto se você parar de responder no meio da conversa (em 2 estágios) e comenta seu tempo de ausência ao atender.
                  </p>
                </div>
              </div>
            )}

            {/* ==================== SECTION 2: VOICE (TTS) ==================== */}
            {activeSection === 'voice' && (
              <div className="space-y-6">
                {/* Primary Engine Row */}
                <div className="space-y-2">
                  <span className="engraved-label block">Motor Primário de Síntese Vocal</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      {
                        id: 'qwen3' as const,
                        title: 'QWEN3-TTS 1.7B',
                        sub: 'Prosódia & Emoções (Colab / CUDA)',
                      },
                      {
                        id: 'kokoro' as const,
                        title: 'KOKORO-TTS 82M',
                        sub: 'Motor Local Ultrarrápido (~100ms)',
                      },
                      {
                        id: 'edge_rvc' as const,
                        title: 'EDGE-TTS + RVC',
                        sub: 'Voz Neural Cloud + Timbre RVC v2',
                      },
                    ].map((eng) => {
                      const active = (voiceSettings.engine || 'qwen3') === eng.id;
                      return (
                        <button
                          key={eng.id}
                          type="button"
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, engine: eng.id })}
                          className={`p-3 border text-left transition-all ${
                            active
                              ? 'border-orange-400 bg-orange-500/15 text-amber-100 shadow-[0_0_16px_rgba(249,115,22,0.25)]'
                              : 'border-amber-900/40 bg-black/50 text-zinc-400 hover:border-orange-500/50 hover:text-zinc-200'
                          }`}
                        >
                          <div className="engraved-serif font-bold text-xs text-orange-400 tracking-wider">
                            {eng.title}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-sans mt-1">{eng.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* QWEN3-TTS SPECIFIC WORKBENCH */}
                {(voiceSettings.engine || 'qwen3') === 'qwen3' && (
                  <div className="p-4 border border-amber-900/50 bg-black/55 space-y-4">
                    {/* Execution Mode: Remote vs Local */}
                    <div className="flex items-baseline">
                      <span className="engraved-label">Topologia de Execução Qwen3</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={(voiceSettings.qwenMode || 'remote') === 'remote'}
                          onClick={() => {
                            onSaveVoiceSettings({ ...voiceSettings, qwenMode: 'remote' });
                            handlePingWorker(voiceSettings.qwenRemoteUrl);
                          }}
                        >
                          COLAB REMOTO
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={voiceSettings.qwenMode === 'local'}
                          onClick={() => {
                            onSaveVoiceSettings({ ...voiceSettings, qwenMode: 'local' });
                            handlePingWorker('http://127.0.0.1:8005');
                          }}
                        >
                          CUDA LOCAL
                        </button>
                      </div>
                    </div>

                    {/* Audio Delivery: Streaming vs Complete WAV */}
                    <div className="flex items-baseline">
                      <span className="engraved-label">Protocolo de Entrega Acústica</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={Boolean(voiceSettings.stream)}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, stream: true })}
                        >
                          STREAM (~500MS)
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={!voiceSettings.stream}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, stream: false })}
                        >
                          WAV COMPLETO
                        </button>
                      </div>
                    </div>

                    {/* Remote Cloudflare Tunnel URL or Local Loopback */}
                    {(voiceSettings.qwenMode || 'remote') === 'remote' ? (
                      <div className="space-y-2 pt-2 border-t border-amber-900/30">
                        <label className="text-[11px] text-amber-200/90 flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-orange-400" />
                          <span>Endpoint Público do Worker (Cloudflare Tunnel):</span>
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="url"
                            placeholder="https://seu-tunel.trycloudflare.com"
                            value={voiceSettings.qwenRemoteUrl || ''}
                            onChange={(e) =>
                              onSaveVoiceSettings({
                                ...voiceSettings,
                                qwenRemoteUrl: e.target.value.trim(),
                              })
                            }
                            className="flex-1 h-9 px-3 bg-black/85 border border-amber-900/60 focus:border-orange-400 text-amber-100 font-mono text-xs outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handlePingWorker(voiceSettings.qwenRemoteUrl)}
                            disabled={isPinging}
                            className="copper-capsule h-9 px-4 flex items-center justify-center gap-1.5 text-amber-200 hover:text-white disabled:opacity-50 shrink-0"
                          >
                            {isPinging ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                            ) : (
                              <Activity className="w-3.5 h-3.5 text-orange-400" />
                            )}
                            <span className="engraved-serif text-[11px] font-bold">TESTAR PING</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-2 border-t border-amber-900/30 text-[11px]">
                        <span className="text-zinc-400">Loopback Local Qwen3: <code className="text-amber-300">http://127.0.0.1:8005</code></span>
                        <button
                          type="button"
                          onClick={() => handlePingWorker('http://127.0.0.1:8005')}
                          className="text-orange-400 hover:underline flex items-center gap-1"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          <span>Verificar Worker Local</span>
                        </button>
                      </div>
                    )}

                    {/* Live Worker Telemetry Bar */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-black/80 border border-zinc-800 text-[11px]">
                      <span className="text-zinc-400">Telemetria do Worker Qwen3:</span>
                      {qwenPingStatus ? (
                        qwenPingStatus.status === 'ready' ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            ONLINE • {qwenPingStatus.device || 'GPU'} ({qwenPingStatus.ping_ms}ms)
                          </span>
                        ) : qwenPingStatus.status === 'initializing' ? (
                          <span className="text-amber-400 font-bold flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            CARREGANDO PESOS ({qwenPingStatus.ping_ms}ms)
                          </span>
                        ) : (
                          <span className="text-rose-400 font-bold">
                            OFFLINE ({qwenPingStatus.error ? 'Inacessível' : 'Desconectado'})
                          </span>
                        )
                      ) : (
                        <span className="text-zinc-500">Não verificado</span>
                      )}
                    </div>
                  </div>
                )}

                {/* KOKORO-TTS SPECIFIC WORKBENCH */}
                {voiceSettings.engine === 'kokoro' && (
                  <div className="p-4 border border-amber-900/50 bg-black/55 space-y-4">
                    <div className="flex items-baseline">
                      <span className="engraved-label">Conversão de Timbre RVC sobre Kokoro</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={Boolean(voiceSettings.useRvc)}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useRvc: true })}
                        >
                          ON
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={!voiceSettings.useRvc}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useRvc: false })}
                        >
                          OFF
                        </button>
                      </div>
                    </div>

                    {voiceSettings.useRvc && (
                      <div className="flex items-center justify-between gap-4 pt-2 border-t border-amber-900/30">
                        <span className="text-zinc-300">Modelo RVC (.pth):</span>
                        <select
                          value={voiceSettings.rvcModel || 'KurisuRVCv147'}
                          onChange={(e) =>
                            onSaveVoiceSettings({ ...voiceSettings, rvcModel: e.target.value })
                          }
                          className="h-8 px-3 bg-black border border-amber-900/60 text-amber-100 text-xs outline-none focus:border-orange-400"
                        >
                          {availableRvcModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* EDGE-TTS + RVC SPECIFIC WORKBENCH */}
                {voiceSettings.engine === 'edge_rvc' && (
                  <div className="p-4 border border-amber-900/50 bg-black/55 space-y-4">
                    <div className="flex items-baseline">
                      <span className="engraved-label">Fonte Vocal Base</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={voiceSettings.useNeural !== false}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useNeural: true })}
                        >
                          EDGE NEURAL
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={voiceSettings.useNeural === false}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useNeural: false })}
                        >
                          NAVEGADOR
                        </button>
                      </div>
                    </div>

                    {voiceSettings.useNeural !== false ? (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-zinc-300">Timbre Neural Base:</span>
                        <select
                          value={voiceSettings.neuralVoice || 'pt-BR-FranciscaNeural'}
                          onChange={(e) =>
                            onSaveVoiceSettings({ ...voiceSettings, neuralVoice: e.target.value })
                          }
                          className="h-8 px-3 bg-black border border-amber-900/60 text-amber-100 text-xs outline-none focus:border-orange-400"
                        >
                          <option value="pt-BR-FranciscaNeural">Francisca Neural (pt-BR - Expressiva)</option>
                          <option value="pt-BR-ThalitaNeural">Thalita Neural (pt-BR - Ágil)</option>
                          <option value="pt-BR-ElzaNeural">Elza Neural (pt-BR - Analítica)</option>
                          <option value="ja-JP-NanamiNeural">Nanami Neural (ja-JP - Nativa)</option>
                          <option value="ja-JP-AoiNeural">Aoi Neural (ja-JP - Suave)</option>
                          <option value="en-US-JennyNeural">Jenny Neural (en-US - Estúdio)</option>
                        </select>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-zinc-300">Voz do Sistema Operacional:</span>
                        <select
                          value={voiceSettings.voiceURI || ''}
                          onChange={(e) =>
                            onSaveVoiceSettings({ ...voiceSettings, voiceURI: e.target.value })
                          }
                          className="h-8 px-3 bg-black border border-amber-900/60 text-amber-100 text-xs outline-none focus:border-orange-400"
                        >
                          <option value="">Padrão do Sistema</option>
                          {availableVoices.map((v) => (
                            <option key={v.voiceURI} value={v.voiceURI}>
                              {v.name} ({v.lang})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* RVC Toggle */}
                    <div className="flex items-baseline pt-2 border-t border-amber-900/30">
                      <span className="engraved-label">Clonagem Acústica RVC v2 (CUDA FP16)</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={Boolean(voiceSettings.useRvc)}
                          onClick={() =>
                            onSaveVoiceSettings({ ...voiceSettings, useRvc: true, useNeural: true })
                          }
                        >
                          ON
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={!voiceSettings.useRvc}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useRvc: false })}
                        >
                          OFF
                        </button>
                      </div>
                    </div>

                    {voiceSettings.useRvc && (
                      <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-300">Modelo RVC (.pth):</span>
                          <select
                            value={voiceSettings.rvcModel || 'KurisuRVCv147'}
                            onChange={(e) =>
                              onSaveVoiceSettings({ ...voiceSettings, rvcModel: e.target.value })
                            }
                            className="h-8 px-3 bg-black border border-amber-900/60 text-amber-100 text-xs outline-none focus:border-orange-400"
                          >
                            {availableRvcModels.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <PlasmaMeter
                            label="Transposição Harmônica RVC"
                            displayValue={`${voiceSettings.rvcPitch ?? 0} st`}
                            min={-6}
                            max={6}
                            step={1}
                            value={voiceSettings.rvcPitch ?? 0}
                            onChange={(val) =>
                              onSaveVoiceSettings({ ...voiceSettings, rvcPitch: Math.round(val) })
                            }
                          />
                          <PlasmaMeter
                            label="Fidelidade de Índice RVC"
                            displayValue={`${Math.round((voiceSettings.rvcIndexRate ?? 0.75) * 100)}%`}
                            min={0.2}
                            max={1.0}
                            step={0.05}
                            value={voiceSettings.rvcIndexRate ?? 0.75}
                            onChange={(val) =>
                              onSaveVoiceSettings({ ...voiceSettings, rvcIndexRate: val })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STRICT TTS FALLBACK CONTROL */}
                <div className="space-y-3 pt-3 border-t border-amber-900/40">
                  <div className="flex items-baseline">
                    <span className="engraved-label">Modo Estrito de Voz (Bloquear Cascata TTS)</span>
                    <div className="dotted-leader" />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={voiceSettings.allowTtsFallback === false}
                        onClick={() =>
                          onSaveVoiceSettings({ ...voiceSettings, allowTtsFallback: false })
                        }
                      >
                        ON
                      </button>
                      <span className="text-zinc-600 font-serif">/</span>
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={voiceSettings.allowTtsFallback !== false}
                        onClick={() =>
                          onSaveVoiceSettings({ ...voiceSettings, allowTtsFallback: true })
                        }
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans">
                    Quando <strong>ON</strong>, se o motor primário selecionado estiver offline, o sistema <strong>não</strong> troca para vozes genéricas e exibe o erro imediatamente.
                  </p>

                  {/* Allowed Fallback Queue when Cascade is permitted */}
                  {voiceSettings.allowTtsFallback !== false && (
                    <div className="p-3 bg-black/50 border border-zinc-800 space-y-2">
                      <span className="text-[10px] font-mono text-orange-400 uppercase tracking-wider block">
                        Motores Autorizados na Fila de Contingência:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {DEFAULT_FALLBACK_ENGINES.map((item) => {
                          const currentList = voiceSettings.allowedTtsFallbacks || [
                            'qwen_local',
                            'kokoro',
                            'edge_rvc',
                            'web_speech',
                          ];
                          const isAllowed = currentList.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => toggleFallbackEngine(item.id)}
                              className={`px-3 py-1.5 border text-left flex items-center justify-between transition-colors ${
                                isAllowed
                                  ? 'border-orange-500/50 bg-orange-500/10 text-amber-100'
                                  : 'border-zinc-800 bg-black/40 text-zinc-500'
                              }`}
                            >
                              <span>{item.label}</span>
                              <span className="font-bold text-[10px]">
                                {isAllowed ? 'ATIVO' : 'BLOQUEADO'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Auto-Speak Engraved Toggle */}
                <div className="flex items-baseline pt-2 border-t border-amber-900/30">
                  <span className="engraved-label">Vocalizar Respostas Automaticamente</span>
                  <div className="dotted-leader" />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="engraved-toggle"
                      data-active={voiceSettings.autoSpeak}
                      onClick={() => onSaveVoiceSettings({ ...voiceSettings, autoSpeak: true })}
                    >
                      ON
                    </button>
                    <span className="text-zinc-600 font-serif">/</span>
                    <button
                      type="button"
                      className="engraved-toggle"
                      data-active={!voiceSettings.autoSpeak}
                      onClick={() => onSaveVoiceSettings({ ...voiceSettings, autoSpeak: false })}
                    >
                      OFF
                    </button>
                  </div>
                </div>

                {/* Prosody Plasma Meters: Rate & Pitch */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
                  <PlasmaMeter
                    label="Velocidade de Prosódia"
                    displayValue={`${voiceSettings.rate.toFixed(2)}x`}
                    min={0.8}
                    max={1.4}
                    step={0.05}
                    value={voiceSettings.rate}
                    onChange={(val) => onSaveVoiceSettings({ ...voiceSettings, rate: val })}
                  />
                  <PlasmaMeter
                    label="Frequência / Pitch Base"
                    displayValue={`${voiceSettings.pitch.toFixed(2)}`}
                    min={0.8}
                    max={1.6}
                    step={0.05}
                    value={voiceSettings.pitch}
                    onChange={(val) => onSaveVoiceSettings({ ...voiceSettings, pitch: val })}
                  />
                </div>

                {/* Sample Audio Test Button */}
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={handleTestVoice}
                    disabled={isTestingVoice}
                    className="copper-capsule w-full py-2.5 flex items-center justify-center gap-2 text-amber-200 hover:text-white disabled:opacity-50"
                  >
                    {isTestingVoice ? (
                      <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                    ) : (
                      <Radio className="w-4 h-4 text-orange-400" />
                    )}
                    <span className="engraved-serif text-xs font-bold tracking-widest">
                      {isTestingVoice ? 'EMITINDO SINAL DE TESTE...' : 'EMITIR AMOSTRA ACÚSTICA'}
                    </span>
                  </button>

                  {voiceTestError && (
                    <div className="flex items-start gap-2 p-2.5 border border-rose-500/50 bg-rose-950/30 text-rose-200 text-[11px] font-sans">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{voiceTestError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ==================== SECTION 3: WHISPER STT & VAD ==================== */}
            {activeSection === 'whisper' && (
              <div className="space-y-6">
                {/* Whisper Key Mode: Unified vs Separate */}
                <div className="space-y-2">
                  <div className="flex items-baseline">
                    <span className="engraved-label">Credencial Groq Whisper Large-v3</span>
                    <div className="dotted-leader" />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={sttMode === 'unified'}
                        onClick={() =>
                          onSaveVoiceSettings({ ...voiceSettings, sttKeyMode: 'unified' })
                        }
                      >
                        UNIFIED
                      </button>
                      <span className="text-zinc-600 font-serif">/</span>
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={sttMode === 'separate'}
                        onClick={() =>
                          onSaveVoiceSettings({ ...voiceSettings, sttKeyMode: 'separate' })
                        }
                      >
                        DEDICATED
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans">
                    Use <strong>DEDICATED</strong> para manter uma chave Groq (<code className="text-amber-300">gsk_...</code>) exclusiva para transcrição Whisper quando seu LLM principal for Google Gemini ou OpenRouter.
                  </p>

                  {sttMode === 'unified' && !isMainKeyGroq && (
                    <div className="flex items-start gap-2 p-2.5 border border-amber-500/50 bg-amber-950/30 text-amber-200 text-[11px] font-sans">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Sua chave primária atual não é uma chave Groq (<code className="text-amber-300">gsk_...</code>). Mude para <strong>DEDICATED</strong> e insira uma chave Groq abaixo para usar o Whisper Large-v3.
                      </span>
                    </div>
                  )}
                </div>

                {/* Dedicated Groq STT Key Input */}
                {sttMode === 'separate' && (
                  <div className="space-y-2 pt-2 border-t border-amber-900/30">
                    <label className="engraved-label block">
                      Chave Groq Dedicada ao Whisper (<code className="text-orange-400 text-xs">gsk_...</code>)
                    </label>
                    <input
                      type="password"
                      placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={tempSttKey}
                      onChange={(e) => {
                        setTempSttKey(e.target.value);
                        localStorage.setItem('amadeus_groq_stt_key', e.target.value.trim());
                        onSaveVoiceSettings({
                          ...voiceSettings,
                          separateGroqSttKey: e.target.value.trim(),
                        });
                      }}
                      className="w-full h-9 bg-black/85 border border-amber-900/60 focus:border-orange-400 px-3 text-amber-100 font-mono text-xs outline-none shadow-inner"
                    />
                  </div>
                )}

                {/* Capture Mode: PTT vs Hands-Free VAD */}
                <div className="flex items-baseline pt-3 border-t border-amber-900/30">
                  <span className="engraved-label">Operação do Microfone</span>
                  <div className="dotted-leader" />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="engraved-toggle"
                      data-active={(voiceSettings.micMode || 'ptt') === 'ptt'}
                      onClick={() => onSaveVoiceSettings({ ...voiceSettings, micMode: 'ptt' })}
                    >
                      PUSH-TO-TALK
                    </button>
                    <span className="text-zinc-600 font-serif">/</span>
                    <button
                      type="button"
                      className="engraved-toggle"
                      data-active={voiceSettings.micMode === 'hands_free'}
                      onClick={() =>
                        onSaveVoiceSettings({ ...voiceSettings, micMode: 'hands_free' })
                      }
                    >
                      HANDS-FREE (VAD)
                    </button>
                  </div>
                </div>

                {/* VAD Gate Sensitivity Plasma Meter */}
                <PlasmaMeter
                  label="Sensibilidade do Gate Acústico (VAD)"
                  displayValue={`${(voiceSettings.vadSensitivity ?? 1.0).toFixed(2)}x`}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={voiceSettings.vadSensitivity ?? 1.0}
                  onChange={(val) =>
                    onSaveVoiceSettings({ ...voiceSettings, vadSensitivity: val })
                  }
                />

                {/* Web Speech Fallback Toggle */}
                <div className="space-y-1.5 pt-3 border-t border-amber-900/30">
                  <div className="flex items-baseline">
                    <span className="engraved-label">Permitir Fallback p/ Web Speech do Navegador</span>
                    <div className="dotted-leader" />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={voiceSettings.allowSttWebSpeechFallback !== false}
                        onClick={() =>
                          onSaveVoiceSettings({
                            ...voiceSettings,
                            allowSttWebSpeechFallback: true,
                          })
                        }
                      >
                        ON
                      </button>
                      <span className="text-zinc-600 font-serif">/</span>
                      <button
                        type="button"
                        className="engraved-toggle"
                        data-active={voiceSettings.allowSttWebSpeechFallback === false}
                        onClick={() =>
                          onSaveVoiceSettings({
                            ...voiceSettings,
                            allowSttWebSpeechFallback: false,
                          })
                        }
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans">
                    Quando <strong>OFF</strong>, opera exclusivamente via Groq Whisper Large-v3 e exibe alerta imediato se a chave Groq estiver ausente.
                  </p>
                </div>
              </div>
            )}

            {/* ==================== SECTION 4: DISPLAY ==================== */}
            {activeSection === 'display' && (
              <div className="space-y-6">
                {/* CRT Scanlines Toggle */}
                <div className="flex items-baseline">
                  <span className="engraved-label">Linhas de Varredura de Tubo (CRT Scanlines)</span>
                  <div className="dotted-leader" />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="engraved-toggle"
                      data-active={scanlines}
                      onClick={() => !scanlines && onToggleScanlines(true)}
                    >
                      ON
                    </button>
                    <span className="text-zinc-600 font-serif">/</span>
                    <button
                      type="button"
                      className="engraved-toggle"
                      data-active={!scanlines}
                      onClick={() => scanlines && onToggleScanlines(false)}
                    >
                      OFF
                    </button>
                  </div>
                </div>

                {/* Default Camera Framing */}
                {onSaveDefaultCamera && (
                  <div className="space-y-2 pt-3 border-t border-amber-900/30">
                    <span className="engraved-label block">Enquadramento Óptico Padrão</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          { id: 'auto', label: 'DINÂMICO (IA)' },
                          { id: 'closeup', label: 'CLOSE-UP' },
                          { id: 'medium', label: 'PLANO MÉDIO' },
                          { id: 'full', label: 'CORPO INTEIRO' },
                        ] as const
                      ).map((cam) => (
                        <button
                          key={cam.id}
                          type="button"
                          onClick={() => onSaveDefaultCamera(cam.id)}
                          className={`py-2 px-3 border text-center font-bold transition-all ${
                            defaultCamera === cam.id
                              ? 'border-orange-400 bg-orange-500/20 text-amber-100'
                              : 'border-amber-900/40 bg-black/50 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {cam.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== SECTION 5: SYSTEM & ARCHITECTURE ==================== */}
            {activeSection === 'system' && (
              <div className="space-y-4">
                <div className="p-4 border border-amber-900/50 bg-black/60 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-orange-400 shrink-0" />
                        <h3 className="engraved-serif text-xs font-bold text-amber-100">
                          Kurisu Qwen3-TTS 1.7B (Síntese Neural Expressiva)
                        </h3>
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        starrydark / Kurisu_Qwen3_TTS • Alibaba Qwen3-TTS 1.7B
                      </p>
                    </div>
                    <a
                      href="https://huggingface.co/starrydark/Kurisu_Qwen3_TTS"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="copper-capsule px-3 py-1 flex items-center gap-1 text-[10px] text-amber-200 hover:text-white shrink-0"
                    >
                      <span>HuggingFace</span>
                      <ExternalLink className="w-3 h-3 text-orange-400" />
                    </a>
                  </div>
                  <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
                    Motor neural <em>end-to-end</em> de 1.7B parâmetros para síntese vocal expressiva em tempo real via CUDA BF16 ou túnel remoto Google Colab.
                  </p>
                </div>

                <div className="p-4 border border-amber-900/50 bg-black/60 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-orange-400 shrink-0" />
                        <h3 className="engraved-serif text-xs font-bold text-amber-100">
                          Kurisu RVC v2 (Conversão Harmônica de Timbre)
                        </h3>
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        FrancescoCaracciolo / Kurisu-RVC • Extração RMVPE + HuBERT
                      </p>
                    </div>
                    <a
                      href="https://huggingface.co/FrancescoCaracciolo/Kurisu-RVC/tree/main"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="copper-capsule px-3 py-1 flex items-center gap-1 text-[10px] text-amber-200 hover:text-white shrink-0"
                    >
                      <span>HuggingFace</span>
                      <ExternalLink className="w-3 h-3 text-orange-400" />
                    </a>
                  </div>
                  <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
                    Conversão acústica em GPU local sobre modelos base Kokoro-TTS 82M e Microsoft Edge Neural TTS.
                  </p>
                </div>

                <div className="p-4 border border-amber-900/50 bg-black/60 space-y-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-orange-400 shrink-0" />
                    <h3 className="engraved-serif text-xs font-bold text-amber-100">
                      Memória Vetorial RAG & Orquestrador Multi-LLM
                    </h3>
                  </div>
                  <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
                    Persistência híbrida em <strong>ChromaDB + SQLite</strong> com busca semântica vetorial e suporte a <strong>Groq LPU</strong>, <strong>Google Gemini</strong> e <strong>OpenRouter</strong>.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="px-2 py-0.5 bg-black border border-amber-900/50 text-[10px] text-orange-300">
                      FastAPI + ChromaDB
                    </span>
                    <span className="px-2 py-0.5 bg-black border border-amber-900/50 text-[10px] text-zinc-300">
                      Groq Whisper Large-v3
                    </span>
                    <span className="px-2 py-0.5 bg-black border border-amber-900/50 text-[10px] text-zinc-300">
                      WebAudio Lip-Sync
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Bar */}
          <div className="px-6 py-3.5 border-t border-amber-900/40 bg-black/75 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
              <Layers className="w-3.5 h-3.5 text-orange-400" />
              <span>Persistência Imediata no Barramento Local</span>
            </div>
            <button
              type="button"
              onClick={handleApplyAndClose}
              className="copper-capsule px-5 py-2 flex items-center gap-2 text-amber-100 hover:text-white"
            >
              {savedSuccess ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Check className="w-4 h-4 text-orange-400" />
              )}
              <span className="engraved-serif text-xs font-bold tracking-widest">
                {savedSuccess ? 'CALIBRADO' : 'APLICAR E FECHAR'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
