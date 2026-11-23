import React, { useState, useEffect, useRef } from 'react';
import {
  Key,
  Volume2,
  X,
  Check,
  Zap,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Cpu,
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
  AppLanguage,
  ClientTurnTelemetry,
  BackendMetricsSnapshot,
  VoiceEngineStatus,
} from '../types/amadeus';
import { SpeechService } from '../services/speechService';
import { AIService } from '../services/aiService';
import { BackendService, BackendHealth } from '../services/backendService';
import { getBcp47Lang, getUiText, normalizeAppLang } from '../i18n';

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
  lang?: string;
  uiLang?: AppLanguage;
  onChangeUiLang?: (lang: AppLanguage) => void;
  lastTurnTelemetry?: ClientTurnTelemetry | null;
  turnTelemetryHistory?: ClientTurnTelemetry[];
  serverLlmProvider?: 'offline' | 'groq' | 'openrouter' | 'gemini';
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
  lang,
  uiLang,
  onChangeUiLang,
  lastTurnTelemetry,
  turnTelemetryHistory = [],
  serverLlmProvider = 'offline',
}) => {
  const ui = getUiText(uiLang || lang);
  const t = ui.settingsModal;
  const currentUiLang = normalizeAppLang(uiLang || lang);
  const currentConvLang = normalizeAppLang(voiceSettings.lang || lang);
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
  const [backendMetrics, setBackendMetrics] = useState<BackendMetricsSnapshot | null>(null);
  const [diagHealth, setDiagHealth] = useState<BackendHealth | null>(null);
  const effectiveServerProvider = diagHealth?.activeLlmProvider || serverLlmProvider;
  const [diagVoice, setDiagVoice] = useState<VoiceEngineStatus | null>(null);
  const [isRunningDiag, setIsRunningDiag] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const handleRunDiagnostics = async () => {
    setIsRunningDiag(true);
    const remoteUrl = voiceSettings.qwenMode === 'local' ? undefined : voiceSettings.qwenRemoteUrl;
    const [m, h, v] = await Promise.all([
      BackendService.getMetrics(),
      BackendService.checkHealth(),
      BackendService.getVoiceStatus(remoteUrl),
    ]);
    setBackendMetrics(m);
    setDiagHealth(h);
    setDiagVoice(v);
    setIsRunningDiag(false);
  };

  const handleResetMetrics = async () => {
    await BackendService.resetMetrics();
    const m = await BackendService.getMetrics();
    setBackendMetrics(m);
  };

  useEffect(() => {
    if (isOpen && activeSection === 'system') {
      void handleRunDiagnostics();
    }
  }, [isOpen, activeSection]);

  useEffect(() => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback light-dismiss for browsers without <dialog closedby="any"> (e.g. Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen || 'closedBy' in HTMLDialogElement.prototype) return;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e) && dialog.open) {
        dialog.close();
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

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

  const commitKeysRef = useRef(commitKeys);
  commitKeysRef.current = commitKeys;

  if (!isOpen) return null;

  const handleDialogClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setSavedSuccess(false);
    if (dialogRef.current) {
      dialogRef.current.returnValue = '';
    }
    commitKeysRef.current();
    onClose();
  };

  const handleApplyAndClose = () => {
    commitKeys();
    setSavedSuccess(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setSavedSuccess(false);
      if (dialogRef.current?.open) {
        dialogRef.current.close();
      } else {
        onClose();
      }
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
        ? t.voiceSec.testPhraseQwen
        : voiceSettings.engine === 'kokoro'
          ? t.voiceSec.testPhraseKokoro
          : voiceSettings.neuralVoice?.startsWith('ja-JP')
            ? 'こんにちは！神経接続および音声合成テスト完了。'
            : t.voiceSec.testPhraseDefault;

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
    <dialog
      ref={dialogRef}
      aria-labelledby="amadeus-setup-title"
      onClose={handleDialogClose}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="amadeus-modal-dialog animate-fadeIn select-none"
    >
      {/* Main Technical Workbench Frame */}
      <div className="relative w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-3rem)] max-w-5xl max-h-[90vh] flex flex-col md:flex-row chalkboard-grid border border-orange-500/40 shadow-[0_0_50px_rgba(0,0,0,0.95)] overflow-hidden">
        {/* Subtle Radial Amber Spotlight */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_25%,rgba(234,88,12,0.09),transparent_65%)] pointer-events-none" />

        {/* ================= LEFT COLUMN: COPPER PCB CAPSULES + VERTICAL POWER BUS ================= */}
        <aside className="relative md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-amber-900/40 bg-black/45 p-4 flex flex-col justify-between z-10">
          {/* Vertical Glowing Conductor Line */}
          <div className="hidden md:block absolute left-9 top-6 bottom-16 bus-line-vertical z-0" />

          {/* Capsule Tab List */}
          <div
            role="tablist"
            aria-label={t.footer.sectionAria}
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
                    {(t.capsules as Record<string, string>)[sec.id] || sec.label}
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
                {(t.sectionHeaders as Record<string, { title: string; sub: string }>)[activeSection]?.title}
              </h2>
              <p className="text-[11px] font-mono text-orange-400/80 tracking-wider uppercase mt-0.5">
                {(t.sectionHeaders as Record<string, { title: string; sub: string }>)[activeSection]?.sub}
              </p>
            </div>

            <button
              type="button"
              onClick={handleApplyAndClose}
              title={t.footer.applyCloseTitle}
              aria-label={t.footer.applyCloseTitle}
              className="w-8 h-8 rounded-full border border-amber-900/60 bg-black/60 flex items-center justify-center text-zinc-400 hover:text-amber-200 hover:border-orange-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Section Body */}
          <div ref={bodyScrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-6 font-mono text-xs">
            {/* ==================== SECTION 1: CÓRTEX LLM ==================== */}
            {activeSection === 'cortex' && (
              <div className="space-y-6">
                {/* Main API Key Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="engraved-label flex items-center gap-2">
                      <Key className="w-4 h-4 text-orange-400" />
                      <span>{t.cortexSec.primaryKeyLabel}</span>
                    </span>
                    <span className="text-[10px] font-mono text-orange-400 uppercase">
                      {tempApiKey.trim().startsWith('gsk_')
                        ? 'GROQ CLOUD LPU'
                        : tempApiKey.trim().startsWith('AIza')
                          ? 'GOOGLE GEMINI'
                          : tempApiKey.trim().startsWith('sk-or-')
                            ? 'OPENROUTER'
                            : effectiveServerProvider !== 'offline'
                              ? `SERVER .ENV (${effectiveServerProvider.toUpperCase()})`
                              : 'MODO OFFLINE'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                    {t.cortexSec.keyProvidersDesc}
                  </p>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                    <input
                      type="password"
                      placeholder={t.cortexSec.keyPlaceholder}
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
                        {isTesting ? t.cortexSec.testingBtn : t.cortexSec.testConnBtn}
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
                    <span className="engraved-label">{t.cortexSec.strictModelLabel}</span>
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
                    {t.cortexSec.strictModelDesc}
                  </p>
                </div>

                {/* Engraved Toggle 2: Block Silent Offline Simulator */}
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-baseline">
                    <span className="engraved-label">{t.cortexSec.blockOfflineSimLabel}</span>
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
                    {t.cortexSec.blockOfflineSimDesc}
                  </p>
                </div>

                {/* Spontaneous Initiative & Impatience Mode */}
                <div className="space-y-2 pt-3 border-t border-amber-900/30">
                  <span className="engraved-label block">
                    {t.cortexSec.idleInitiativeLabel}
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'off', label: t.cortexSec.idleModes.off },
                        { id: 'silent', label: t.cortexSec.idleModes.silent },
                        { id: 'voice', label: t.cortexSec.idleModes.voice },
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
                    {t.cortexSec.idleInitiativeDesc}
                  </p>
                </div>
              </div>
            )}

            {/* ==================== SECTION 2: VOICE (TTS) ==================== */}
            {activeSection === 'voice' && (
              <div className="space-y-6">
                {/* Trilingual & Canonical Voice Settings */}
                <div className="p-4 border border-amber-900/60 bg-black/60 space-y-4">
                  <div className="flex items-center justify-between border-b border-amber-900/40 pb-2">
                    <span className="engraved-serif text-xs font-bold text-orange-400 tracking-wider">
                      {t.langSectionTitle}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400 uppercase">
                      TRILINGUAL ENGINE
                    </span>
                  </div>

                  {/* 1. Interface Language (UI) */}
                  <div className="space-y-2">
                    <div>
                      <label className="engraved-label block text-xs">
                        {t.uiLangLabel}
                      </label>
                      <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                        {t.uiLangDesc}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['pt', 'en', 'ja'] as AppLanguage[]).map((lCode) => {
                        const isSelected = currentUiLang === lCode;
                        return (
                          <button
                            key={`ui-${lCode}`}
                            type="button"
                            onClick={() => {
                              onChangeUiLang?.(lCode);
                              onSaveVoiceSettings({
                                ...voiceSettings,
                                uiLang: lCode,
                              });
                            }}
                            className={`py-2 px-3 border text-left font-mono text-xs transition-all ${
                              isSelected
                                ? 'border-amber-400 bg-amber-500/20 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                : 'border-amber-900/40 bg-black/50 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <div className="font-bold text-amber-300 uppercase">{lCode.toUpperCase()}</div>
                            <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                              {t.langOptions[lCode]}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Conversation Language (Dialogue, Voice, STT) */}
                  <div className="pt-3 border-t border-amber-900/40 space-y-2">
                    <div>
                      <label className="engraved-label block text-xs">
                        {t.convLangLabel}
                      </label>
                      <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                        {t.convLangDesc}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['pt', 'en', 'ja'] as AppLanguage[]).map((lCode) => {
                        const isSelected = currentConvLang === lCode;
                        return (
                          <button
                            key={`conv-${lCode}`}
                            type="button"
                            onClick={() =>
                              onSaveVoiceSettings({
                                ...voiceSettings,
                                lang: getBcp47Lang(lCode),
                              })
                            }
                            className={`py-2 px-3 border text-left font-mono text-xs transition-all ${
                              isSelected
                                ? 'border-orange-400 bg-orange-500/20 text-amber-100 shadow-[0_0_12px_rgba(249,115,22,0.3)]'
                                : 'border-amber-900/40 bg-black/50 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <div className="font-bold text-orange-400 uppercase">{lCode.toUpperCase()}</div>
                            <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                              {t.langOptions[lCode]}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3. Canonical Voice Toggle (only when conversation language is not Japanese) */}
                  {currentConvLang !== 'ja' && (
                    <div className="pt-3 border-t border-amber-900/40 space-y-2">
                      <div className="flex items-baseline justify-between">
                        <span className="engraved-label text-xs">
                          {t.canonicalJpTitle}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            className="engraved-toggle"
                            data-active={Boolean(voiceSettings.canonicalJpVoice)}
                            onClick={() =>
                              onSaveVoiceSettings({
                                ...voiceSettings,
                                canonicalJpVoice: true,
                              })
                            }
                          >
                            ON
                          </button>
                          <span className="text-zinc-600 font-serif">/</span>
                          <button
                            type="button"
                            className="engraved-toggle"
                            data-active={!voiceSettings.canonicalJpVoice}
                            onClick={() =>
                              onSaveVoiceSettings({
                                ...voiceSettings,
                                canonicalJpVoice: false,
                              })
                            }
                          >
                            OFF
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                        {t.canonicalJpDesc}
                      </p>
                    </div>
                  )}
                </div>

                {/* Primary Engine Row */}
                <div className="space-y-2">
                  <span className="engraved-label block">{t.voiceSec.primaryEngineLabel}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      {
                        id: 'qwen3' as const,
                        title: t.voiceSec.engineQwenTitle,
                        sub: t.voiceSec.engineQwenSub,
                      },
                      {
                        id: 'kokoro' as const,
                        title: t.voiceSec.engineKokoroTitle,
                        sub: t.voiceSec.engineKokoroSub,
                      },
                      {
                        id: 'edge_rvc' as const,
                        title: t.voiceSec.engineEdgeTitle,
                        sub: t.voiceSec.engineEdgeSub,
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
                      <span className="engraved-label">{t.voiceSec.qwenTopologyLabel}</span>
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
                          {t.voiceSec.qwenColabToggle}
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
                          {t.voiceSec.qwenCudaToggle}
                        </button>
                      </div>
                    </div>

                    {/* Audio Delivery: Streaming vs Complete WAV */}
                    <div className="flex items-baseline">
                      <span className="engraved-label">{t.voiceSec.deliveryProtocolLabel}</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={Boolean(voiceSettings.stream)}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, stream: true })}
                        >
                          {t.voiceSec.streamToggle}
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={!voiceSettings.stream}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, stream: false })}
                        >
                          {t.voiceSec.wavToggle}
                        </button>
                      </div>
                    </div>

                    {/* Remote Cloudflare Tunnel URL or Local Loopback */}
                    {(voiceSettings.qwenMode || 'remote') === 'remote' ? (
                      <div className="space-y-2 pt-2 border-t border-amber-900/30">
                        <label className="text-[11px] text-amber-200/90 flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-orange-400" />
                          <span>{t.voiceSec.endpointLabel}</span>
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
                            <span className="engraved-serif text-[11px] font-bold">{t.voiceSec.pingBtn}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-2 border-t border-amber-900/30 text-[11px]">
                        <span className="text-zinc-400">{t.voiceSec.loopbackLabel} <code className="text-amber-300">http://127.0.0.1:8005</code></span>
                        <button
                          type="button"
                          onClick={() => handlePingWorker('http://127.0.0.1:8005')}
                          className="text-orange-400 hover:underline flex items-center gap-1"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          <span>{t.voiceSec.checkLocalWorkerBtn}</span>
                        </button>
                      </div>
                    )}

                    {/* Live Worker Telemetry Bar */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-black/80 border border-zinc-800 text-[11px]">
                      <span className="text-zinc-400">{t.voiceSec.telemetryLabel}</span>
                      {qwenPingStatus ? (
                        qwenPingStatus.status === 'ready' ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            {t.voiceSec.statusReady} • {qwenPingStatus.device || 'GPU'} ({qwenPingStatus.ping_ms}ms)
                          </span>
                        ) : qwenPingStatus.status === 'initializing' ? (
                          <span className="text-amber-400 font-bold flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {t.voiceSec.statusLoading} ({qwenPingStatus.ping_ms}ms)
                          </span>
                        ) : (
                          <span className="text-rose-400 font-bold">
                            {t.voiceSec.statusOffline} ({qwenPingStatus.error ? t.voiceSec.statusUnreachable : t.voiceSec.statusDisconnected})
                          </span>
                        )
                      ) : (
                        <span className="text-zinc-500">{t.voiceSec.statusUnchecked}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* KOKORO-TTS SPECIFIC WORKBENCH */}
                {voiceSettings.engine === 'kokoro' && (
                  <div className="p-4 border border-amber-900/50 bg-black/55 space-y-4">
                    <div className="flex items-baseline">
                      <span className="engraved-label">{t.voiceSec.kokoroRvcLabel}</span>
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
                        <span className="text-zinc-300">{t.voiceSec.rvcModelLabel}</span>
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
                      <span className="engraved-label">{t.voiceSec.baseVoiceSourceLabel}</span>
                      <div className="dotted-leader" />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={voiceSettings.useNeural !== false}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useNeural: true })}
                        >
                          {t.voiceSec.edgeNeuralToggle}
                        </button>
                        <span className="text-zinc-600 font-serif">/</span>
                        <button
                          type="button"
                          className="engraved-toggle"
                          data-active={voiceSettings.useNeural === false}
                          onClick={() => onSaveVoiceSettings({ ...voiceSettings, useNeural: false })}
                        >
                          {t.voiceSec.browserVoiceToggle}
                        </button>
                      </div>
                    </div>

                    {voiceSettings.useNeural !== false ? (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-zinc-300">{t.voiceSec.neuralVoiceBaseLabel}</span>
                        <select
                          value={voiceSettings.neuralVoice || 'pt-BR-FranciscaNeural'}
                          onChange={(e) =>
                            onSaveVoiceSettings({ ...voiceSettings, neuralVoice: e.target.value })
                          }
                          className="h-8 px-3 bg-black border border-amber-900/60 text-amber-100 text-xs outline-none focus:border-orange-400"
                        >
                          <option value="pt-BR-FranciscaNeural">Francisca Neural (pt-BR)</option>
                          <option value="pt-BR-ThalitaNeural">Thalita Neural (pt-BR)</option>
                          <option value="pt-BR-ElzaNeural">Elza Neural (pt-BR)</option>
                          <option value="ja-JP-NanamiNeural">Nanami Neural (ja-JP)</option>
                          <option value="ja-JP-AoiNeural">Aoi Neural (ja-JP)</option>
                          <option value="en-US-JennyNeural">Jenny Neural (en-US)</option>
                        </select>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-zinc-300">{t.voiceSec.osVoiceLabel}</span>
                        <select
                          value={voiceSettings.voiceURI || ''}
                          onChange={(e) =>
                            onSaveVoiceSettings({ ...voiceSettings, voiceURI: e.target.value })
                          }
                          className="h-8 px-3 bg-black border border-amber-900/60 text-amber-100 text-xs outline-none focus:border-orange-400"
                        >
                          <option value="">{t.voiceSec.osVoiceDefault}</option>
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
                      <span className="engraved-label">{t.voiceSec.rvcCloningLabel}</span>
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
                          <span className="text-zinc-300">{t.voiceSec.rvcModelLabel}</span>
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
                            label={t.voiceSec.rvcPitchLabel}
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
                            label={t.voiceSec.rvcIndexLabel}
                            displayValue={`${Math.round((voiceSettings.rvcIndexRate ?? 0.75) * 100)}%`}
                            min={0.2}
                            max={1.0}
                            step={0.05}
                            value={voiceSettings.rvcIndexRate ?? 0.75}
                            onChange={(val) =>
                              onSaveVoiceSettings({ ...voiceSettings, rvcIndexRate: val })
                            }
                          />
                          <PlasmaMeter
                            label="RVC Protect"
                            displayValue={`${(voiceSettings.rvcProtect ?? 0.33).toFixed(2)}`}
                            min={0.0}
                            max={0.5}
                            step={0.05}
                            value={voiceSettings.rvcProtect ?? 0.33}
                            onChange={(val) =>
                              onSaveVoiceSettings({ ...voiceSettings, rvcProtect: val })
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
                    <span className="engraved-label">{t.voiceSec.strictTtsLabel}</span>
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
                    {t.voiceSec.strictTtsDesc}
                  </p>

                  {/* Allowed Fallback Queue when Cascade is permitted */}
                  {voiceSettings.allowTtsFallback !== false && (
                    <div className="p-3 bg-black/50 border border-zinc-800 space-y-2">
                      <span className="text-[10px] font-mono text-orange-400 uppercase tracking-wider block">
                        {t.voiceSec.fallbackQueueLabel}
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
                              <span>{(t.voiceSec.fallbackEngines as Record<string, string>)[item.id] || item.label}</span>
                              <span className="font-bold text-[10px]">
                                {isAllowed ? t.voiceSec.engineActive : t.voiceSec.engineBlocked}
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
                  <span className="engraved-label">{t.voiceSec.autoSpeakLabel}</span>
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
                    label={t.voiceSec.prosodyRateLabel}
                    displayValue={`${voiceSettings.rate.toFixed(2)}x`}
                    min={0.8}
                    max={1.4}
                    step={0.05}
                    value={voiceSettings.rate}
                    onChange={(val) => onSaveVoiceSettings({ ...voiceSettings, rate: val })}
                  />
                  <PlasmaMeter
                    label={t.voiceSec.prosodyPitchLabel}
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
                      {isTestingVoice ? t.voiceSec.testingSampleBtn : t.voiceSec.testSampleBtn}
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
                    <span className="engraved-label">{t.whisperSec.whisperKeyLabel}</span>
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
                    {t.whisperSec.whisperKeyDesc}
                  </p>

                  {sttMode === 'unified' && !isMainKeyGroq && (
                    <div className="flex items-start gap-2 p-2.5 border border-amber-500/50 bg-amber-950/30 text-amber-200 text-[11px] font-sans">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        {t.whisperSec.whisperKeyWarning}
                      </span>
                    </div>
                  )}
                </div>

                {/* Dedicated Groq STT Key Input */}
                {sttMode === 'separate' && (
                  <div className="space-y-2 pt-2 border-t border-amber-900/30">
                    <label className="engraved-label block">
                      {t.whisperSec.dedicatedKeyLabel}
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
                  <span className="engraved-label">{t.whisperSec.micOperationLabel}</span>
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
                  label={t.whisperSec.vadSensitivityLabel}
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
                    <span className="engraved-label">{t.whisperSec.webSpeechFallbackLabel}</span>
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
                    {t.whisperSec.webSpeechFallbackDesc}
                  </p>
                </div>
              </div>
            )}

            {/* ==================== SECTION 4: DISPLAY ==================== */}
            {activeSection === 'display' && (
              <div className="space-y-6">
                {/* CRT Scanlines Toggle */}
                <div className="flex items-baseline">
                  <span className="engraved-label">{t.displaySec.scanlinesLabel}</span>
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
                    <span className="engraved-label block">{t.displaySec.defaultFramingLabel}</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          { id: 'auto', label: t.displaySec.framingOptions.auto },
                          { id: 'closeup', label: t.displaySec.framingOptions.closeup },
                          { id: 'medium', label: t.displaySec.framingOptions.medium },
                          { id: 'full', label: t.displaySec.framingOptions.full },
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
                {/* Live Latency Telemetry & Diagnostics */}
                <div className="p-4 border border-orange-500/40 bg-black/75 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-orange-400 shrink-0" />
                      <h3 className="engraved-serif text-xs font-bold text-amber-100">
                        {t.systemSec.telemetryTitle}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRunDiagnostics}
                        disabled={isRunningDiag}
                        className="copper-capsule px-2.5 py-1 flex items-center gap-1.5 text-[10px] font-bold text-amber-200 hover:text-white disabled:opacity-50"
                      >
                        {isRunningDiag ? <Loader2 className="w-3 h-3 animate-spin text-orange-400" /> : <Zap className="w-3 h-3 text-orange-400" />}
                        <span>{isRunningDiag ? t.systemSec.runningDiagBtn : t.systemSec.runDiagBtn}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleResetMetrics}
                        className="px-2 py-1 border border-zinc-700 bg-zinc-900 text-[10px] font-mono text-zinc-300 hover:text-white hover:border-orange-500/50"
                      >
                        {t.systemSec.resetMetricsBtn}
                      </button>
                    </div>
                  </div>

                  {/* Last Turn Waterfall */}
                  {lastTurnTelemetry ? (() => {
                    const b = lastTurnTelemetry.backend;
                    const a = lastTurnTelemetry.audio;
                    const total = lastTurnTelemetry.e2eTtfaMs ?? b?.total_ms ?? 0;
                    const stages = [
                      { label: 'STT (Whisper)', ms: lastTurnTelemetry.sttMs, color: 'bg-sky-400' },
                      { label: 'RAG / ChromaDB', ms: b?.rag_ms ?? null, color: 'bg-emerald-400' },
                      { label: 'Model Discovery', ms: b?.model_discovery_ms ?? null, color: 'bg-amber-400' },
                      { label: 'LLM TTFT', ms: b?.llm_ttft_ms ?? null, color: 'bg-orange-400' },
                      { label: t.systemSec.firstSentenceLabel, ms: b?.llm_first_sentence_ms ?? null, color: 'bg-orange-500' },
                      { label: 'TTS TTFB', ms: a?.ttsTtfbMs ?? null, color: 'bg-purple-400' },
                    ].filter((s) => s.ms != null);
                    const scaleMax = Math.max(total || 1, ...stages.map((s) => s.ms || 0), 100);
                    return (
                      <div className="space-y-2 pt-1 border-t border-amber-900/30">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-amber-200 font-bold">E2E TTFA: {lastTurnTelemetry.e2eTtfaMs ?? '-'}ms</span>
                            {b && (
                              <span className={`px-1.5 py-0.5 text-[9px] border ${b.cold_start ? 'border-amber-500/60 bg-amber-500/15 text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
                                {b.cold_start ? t.systemSec.coldBadge : t.systemSec.warmBadge}
                              </span>
                            )}
                            {((b?.llm_fallback_attempts || 0) > 0 || a?.ttsFallback) && (
                              <span className="px-1.5 py-0.5 text-[9px] border border-rose-500/50 bg-rose-500/15 text-rose-300">
                                {t.systemSec.fallbackBadge}
                              </span>
                            )}
                          </div>
                          <span className="text-zinc-400 text-[10px]">
                            {b?.model || 'local'} • {a?.ttsEngine || voiceSettings.engine || 'qwen3'} • {t.systemSec.underrunsLabel}: <strong className={a?.underruns ? 'text-rose-400' : 'text-emerald-400'}>{a?.underruns ?? 0}</strong>
                          </span>
                        </div>
                        <div className="space-y-1">
                          {stages.map((s) => (
                            <div key={s.label} className="grid grid-cols-[112px_1fr_52px] items-center gap-2 text-[10px] font-mono">
                              <span className="text-zinc-400 truncate">{s.label}</span>
                              <div className="h-2 bg-zinc-900 border border-zinc-800 overflow-hidden">
                                <div className={`h-full ${s.color}`} style={{ width: `${Math.min(100, Math.max(2, ((s.ms || 0) / scaleMax) * 100))}%` }} />
                              </div>
                              <span className="text-right text-zinc-200">{Math.round(s.ms || 0)}ms</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })() : (
                    <p className="text-[11px] text-zinc-400 font-mono">{t.systemSec.noTurnsYet}</p>
                  )}

                  {/* Aggregated Backend p50/p95 & Cold vs Warm */}
                  {backendMetrics && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-amber-900/30 text-[10px] font-mono">
                      <div className="p-2 bg-black/80 border border-zinc-800">
                        <div className="text-zinc-500">RAG p50 / p95</div>
                        <div className="text-emerald-300 font-bold">
                          {backendMetrics.chat.rag_ms.p50 ?? '-'} / {backendMetrics.chat.rag_ms.p95 ?? '-'} ms
                        </div>
                      </div>
                      <div className="p-2 bg-black/80 border border-zinc-800">
                        <div className="text-zinc-500">Discovery p50 / p95</div>
                        <div className="text-amber-300 font-bold">
                          {backendMetrics.chat.model_discovery_ms.p50 ?? '-'} / {backendMetrics.chat.model_discovery_ms.p95 ?? '-'} ms
                        </div>
                      </div>
                      <div className="p-2 bg-black/80 border border-zinc-800">
                        <div className="text-zinc-500">{t.systemSec.firstSentenceLabel} p50/p95</div>
                        <div className="text-orange-300 font-bold">
                          {backendMetrics.chat.llm_first_sentence_ms.p50 ?? '-'} / {backendMetrics.chat.llm_first_sentence_ms.p95 ?? '-'} ms
                        </div>
                      </div>
                      <div className="p-2 bg-black/80 border border-zinc-800">
                        <div className="text-zinc-500">TTS TTFB / Speed</div>
                        <div className="text-purple-300 font-bold">
                          {backendMetrics.tts.ttfb_ms.p50 ?? '-'}ms / {backendMetrics.tts.realtime_speed_x.p50 ?? '-'}x
                        </div>
                      </div>
                      <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 bg-zinc-950/90 border border-zinc-800 text-[10px]">
                        <span className="text-zinc-400">
                          {t.systemSec.coldVsWarmLabel}:{' '}
                          <strong className="text-amber-300">{backendMetrics.chat.cold_vs_warm.cold_avg_total_ms ?? '-'}ms</strong>
                          {' '}vs{' '}
                          <strong className="text-emerald-300">{backendMetrics.chat.cold_vs_warm.warm_avg_total_ms ?? '-'}ms</strong>
                          {' '}(Discovery cold: {backendMetrics.chat.cold_vs_warm.cold_avg_discovery_ms ?? '-'}ms)
                        </span>
                        <span className="text-zinc-400">
                          {t.systemSec.turnsLabel}: {backendMetrics.counters.chat_total} ({turnTelemetryHistory.length} UI) • {t.systemSec.errorsLabel}: {backendMetrics.counters.chat_errors} • Fallbacks LLM/TTS: {backendMetrics.counters.llm_fallbacks}/{backendMetrics.counters.tts_fallbacks} • Aborts: {backendMetrics.counters.chat_aborts + backendMetrics.counters.tts_aborts}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Quick Diagnostics Output */}
                  {(diagHealth || diagVoice) && (
                    <div className="p-2 bg-zinc-950 border border-amber-900/40 text-[10px] font-mono text-zinc-300 space-y-1">
                      {diagHealth && (
                        <div>
                          Backend: <span className="text-emerald-400 font-bold">{diagHealth.status}</span> ({diagHealth.system}) • ChromaDB: {diagHealth.chromaCount} • {t.systemSec.sessionsLabel}: {diagHealth.totalSessions}
                        </div>
                      )}
                      {diagVoice && (
                        <div>
                          {t.systemSec.qwenRemoteLabel}: <span className={diagVoice.qwen_remote.status === 'ready' ? 'text-emerald-400 font-bold' : 'text-rose-400'}>{diagVoice.qwen_remote.status}</span>
                          {diagVoice.qwen_remote.ping_ms != null ? ` (${diagVoice.qwen_remote.ping_ms}ms` : ''}
                          {diagVoice.qwen_remote.vram_allocated_mb != null ? `, ${diagVoice.qwen_remote.vram_allocated_mb}MB VRAM)` : diagVoice.qwen_remote.ping_ms != null ? ')' : ''}
                          {' '}• {t.systemSec.qwenLocalLabel}: <span className={diagVoice.qwen_local.status === 'ready' ? 'text-emerald-400' : 'text-zinc-500'}>{diagVoice.qwen_local.status}</span>
                          {' '}• Kokoro: {diagVoice.kokoro_available ? 'OK' : 'OFF'} • RVC: {diagVoice.rvc_available ? diagVoice.rvc_models.join(', ') : 'OFF'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Active Runtime Architecture Spec Ledger */}
                {(() => {
                  const isOnlineBackend = diagHealth?.status === 'online';
                  const qwenReady =
                    diagVoice?.qwen_remote.status === 'ready' || diagVoice?.qwen_local.status === 'ready';
                  const hasGroqStt = tempSttKey.trim().startsWith('gsk_') || tempApiKey.trim().startsWith('gsk_');
                  const stackRows: {
                    id: string;
                    title: string;
                    spec: string;
                    desc: string;
                    dotClass: string;
                    targetTab: SettingsSectionId;
                    links: { label: string; href: string }[];
                  }[] = [
                    {
                      id: 'voice-stack',
                      title: t.systemSec.voiceStackTitle,
                      spec: 'lucca3447/Makise_Kurisu_Qwen3_TTS_PTBR_added • faster-qwen3-tts (CUDA Graphs)',
                      desc: t.systemSec.voiceStackDesc,
                      dotClass: qwenReady
                        ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                        : diagVoice
                          ? 'bg-amber-400'
                          : 'bg-zinc-500',
                      targetTab: 'voice',
                      links: [
                        {
                          label: 'HuggingFace',
                          href: 'https://huggingface.co/lucca3447/Makise_Kurisu_Qwen3_TTS_PTBR_added',
                        },
                      ],
                    },
                    {
                      id: 'timbre-stack',
                      title: t.systemSec.timbreStackTitle,
                      spec: 'FrancescoCaracciolo/Kurisu-RVC • yky-h/japanese-hubert-base • hexgrad/Kokoro-82M',
                      desc: t.systemSec.timbreStackDesc,
                      dotClass:
                        diagVoice?.rvc_available || diagVoice?.kokoro_available
                          ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                          : diagVoice
                            ? 'bg-zinc-500'
                            : 'bg-amber-400/60',
                      targetTab: 'voice',
                      links: [
                        { label: 'Kurisu-RVC', href: 'https://huggingface.co/FrancescoCaracciolo/Kurisu-RVC' },
                        { label: 'Kokoro-82M', href: 'https://huggingface.co/hexgrad/Kokoro-82M' },
                      ],
                    },
                    {
                      id: 'input-sync',
                      title: t.systemSec.inputSyncTitle,
                      spec: 'Silero VAD v5 (ONNX Web) • whisper-large-v3-turbo • F1/F2 Formants • 174 VN Sprites',
                      desc: t.systemSec.inputSyncDesc,
                      dotClass: hasGroqStt ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-amber-400',
                      targetTab: 'whisper',
                      links: [],
                    },
                    {
                      id: 'memory-cortex',
                      title: t.systemSec.memoryCortexTitle,
                      spec: `FastAPI + ChromaDB (${diagHealth?.chromaCount ?? 36}+) + SQLite WAL • Groq / Gemini / OpenRouter`,
                      desc: t.systemSec.memoryCortexDesc,
                      dotClass:
                        isOnlineBackend && (Boolean(tempApiKey.trim()) || effectiveServerProvider !== 'offline')
                          ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                          : isOnlineBackend
                            ? 'bg-amber-400'
                            : 'bg-zinc-500',
                      targetTab: 'cortex',
                      links: [],
                    },
                  ];

                  return (
                    <div className="border border-amber-900/45 bg-black/65 divide-y divide-amber-900/30">
                      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-black/45">
                        <div className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                          <h3 className="engraved-serif text-xs font-bold text-amber-100">
                            {t.systemSec.stackHeading}
                          </h3>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-mono">
                          <span className="px-2 py-0.5 border border-amber-900/50 bg-zinc-950 text-amber-200">
                            {diagHealth?.system || 'AMADEUS OS v0.3.3'}
                          </span>
                          <a
                            href="https://github.com/lucca3447/OpenAmadeus"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-zinc-400 hover:text-amber-200 transition-colors"
                          >
                            <span>GitHub</span>
                            <ExternalLink className="w-3 h-3 text-orange-400" />
                          </a>
                        </div>
                      </div>

                      {stackRows.map((row) => (
                        <div
                          key={row.id}
                          className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5"
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${row.dotClass}`} />
                            <div className="space-y-1 min-w-0">
                              <div className="text-xs font-semibold text-amber-100 font-sans">
                                {row.title}
                              </div>
                              <div className="text-[10px] font-mono text-orange-300/80 break-words">
                                {row.spec}
                              </div>
                              <p className="text-[11px] text-zinc-300 font-sans leading-relaxed max-w-[74ch]">
                                {row.desc}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 sm:shrink-0 pl-4 sm:pl-0 pt-0.5">
                            {row.links.map((lnk) => (
                              <a
                                key={lnk.href}
                                href={lnk.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 border border-amber-900/50 bg-black/70 text-[10px] font-mono text-amber-200/90 hover:text-white hover:border-orange-400/70 inline-flex items-center gap-1 transition-colors"
                              >
                                <span>{lnk.label}</span>
                                <ExternalLink className="w-2.5 h-2.5 text-orange-400" />
                              </a>
                            ))}
                            <button
                              type="button"
                              onClick={() => setActiveSection(row.targetTab)}
                              className="px-2 py-1 border border-zinc-700 bg-zinc-900/90 text-[10px] font-mono text-zinc-200 hover:text-white hover:border-orange-500/60 transition-colors"
                            >
                              {t.systemSec.configureAction}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Bottom Action Bar */}
          <div className="px-6 py-3.5 border-t border-amber-900/40 bg-black/75 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
              <Layers className="w-3.5 h-3.5 text-orange-400" />
              <span>{t.footer.busPersistence}</span>
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
                {savedSuccess ? t.footer.calibratedBtn : t.footer.applyCloseBtn}
              </span>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
};
