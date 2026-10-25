import React, { useState, useEffect } from 'react';
import {
  Settings,
  Key,
  Volume2,
  Monitor,
  HelpCircle,
  X,
  Check,
  Zap,
  Loader2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Cpu,
  Database,
  Heart,
  Layers,
  Radio,
  Wifi,
  Globe,
  Activity,
} from 'lucide-react';
import { VoiceSettings, QwenWorkerStatus } from '../types/amadeus';
import { SpeechService } from '../services/speechService';
import { AIService } from '../services/aiService';
import { BackendService } from '../services/backendService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
  voiceSettings: VoiceSettings;
  onSaveVoiceSettings: (settings: VoiceSettings) => void;
  scanlines: boolean;
  onToggleScanlines: (enabled: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onSaveApiKey,
  voiceSettings,
  onSaveVoiceSettings,
  scanlines,
  onToggleScanlines,
}) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'credits'>('settings');
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [showRvcAdvanced, setShowRvcAdvanced] = useState(false);
  const [qwenPingStatus, setQwenPingStatus] = useState<QwenWorkerStatus | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [availableRvcModels, setAvailableRvcModels] = useState<string[]>(['KurisuRVCv147']);

  const handlePingWorker = async (targetUrl?: string) => {
    setIsPinging(true);
    const url = targetUrl !== undefined ? targetUrl : (voiceSettings.qwenMode === 'local' ? 'http://127.0.0.1:8005' : voiceSettings.qwenRemoteUrl);
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
      if (voiceSettings.engine === 'qwen3') {
        handlePingWorker();
      }
    }
  }, [isOpen, voiceSettings.engine, voiceSettings.qwenMode]);

  const handleTestVoice = async () => {
    setIsTestingVoice(true);
    const sampleText = voiceSettings.engine === 'qwen3'
      ? 'Não precisa me envergonhar assim! Seu idiota!'
      : voiceSettings.engine === 'kokoro'
        ? 'Olá, este é o motor neural Kokoro ultrarrápido em português!'
        : voiceSettings.neuralVoice?.startsWith('ja-JP')
          ? 'こんにちは！アマデウス紅莉栖です。神経接続完了！'
          : voiceSettings.useRvc
            ? 'Olá! Conexão neural RVC estabelecida. Este é o timbre digitalizado de Makise Kurisu!'
            : 'Olá! Conexão Amadeus estabelecida. Teste de voz e sincronia labial em cem por cento!';
    await SpeechService.speak(sampleText, {
      voiceURI: voiceSettings.voiceURI,
      rate: voiceSettings.rate,
      pitch: voiceSettings.pitch,
      volume: voiceSettings.volume,
      engine: voiceSettings.engine || 'qwen3',
      qwenMode: voiceSettings.qwenMode || 'remote',
      qwenRemoteUrl: voiceSettings.qwenRemoteUrl,
      emotion: 'tsundere',
      stream: voiceSettings.engine === 'qwen3' ? Boolean(voiceSettings.stream) : false,
      useNeural: voiceSettings.useNeural !== false,
      neuralVoice: voiceSettings.neuralVoice || 'pt-BR-FranciscaNeural',
      useRvc: Boolean(voiceSettings.useRvc),
      rvcModel: voiceSettings.rvcModel || 'KurisuRVCv147',
      rvcPitch: voiceSettings.rvcPitch ?? 0,
      rvcIndexRate: voiceSettings.rvcIndexRate ?? 0.75,
      onEnd: () => setIsTestingVoice(false),
    });
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await AIService.testConnection(tempApiKey);
    setTestResult(result);
    setIsTesting(false);
  };

  useEffect(() => {
    setTempApiKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    SpeechService.getAvailableVoices().then((voices) => {
      setAvailableVoices(voices);
    });
  }, []);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveApiKey(tempApiKey.trim());
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-xl bg-amadeus-panel border border-amadeus-border shadow-[0_0_40px_rgba(0,0,0,0.9)] overflow-hidden font-mono text-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-amadeus-border bg-amadeus-card">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-amadeus-accent" />
            <h2 className="text-sm font-bold text-amadeus-accent tracking-wider text-glow-nixie">
              CONFIGURAÇÕES DO SISTEMA // AMADEUS
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-amadeus-muted hover:text-white hover:bg-amadeus-border/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-amadeus-border bg-amadeus-card/60 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2.5 px-4 font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'settings'
                ? 'border-amadeus-accent text-amadeus-accent bg-amadeus-accent/10'
                : 'border-transparent text-amadeus-muted hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>CONFIGURAÇÃO</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('credits')}
            className={`flex-1 py-2.5 px-4 font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'credits'
                ? 'border-amadeus-accent text-amadeus-accent bg-amadeus-accent/10'
                : 'border-transparent text-amadeus-muted hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>CRÉDITOS & MODELOS</span>
          </button>
        </div>

        {activeTab === 'settings' ? (
          /* Content */
          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Section: Groq, Gemini & OpenRouter API Key */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Key className="w-3.5 h-3.5 text-amadeus-accent" />
              <span>CHAVE DE API (GROQ, GEMINI OU OPENROUTER)</span>
            </div>
            <p className="text-[11px] text-amadeus-muted leading-relaxed font-sans">
              Recomendado: <strong>Groq Cloud</strong> (<code className="text-amadeus-accent">gsk_...</code> com LPU ultra-rápida e Llama 3.3 70B), <strong>Google Gemini</strong> (<code className="text-amadeus-accent">AIzaSy...</code>) ou <strong>OpenRouter</strong> (<code className="text-amadeus-accent">sk-or-...</code>).
            </p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Cole sua API Key aqui (gsk_... / AIzaSy... / sk-or-...)"
                value={tempApiKey}
                onChange={(e) => {
                  setTempApiKey(e.target.value);
                  setTestResult(null);
                }}
                className="flex-1 h-9 px-3 rounded bg-amadeus-card border border-amadeus-border text-xs text-white placeholder-amadeus-muted/50 focus:outline-none focus:border-amadeus-accent"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting || !tempApiKey.trim()}
                className="h-9 px-3 rounded border border-amadeus-accent/60 text-amadeus-accent text-xs flex items-center gap-1.5 hover:bg-amadeus-accent hover:text-black transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-amadeus-accent shrink-0"
              >
                {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                <span>{isTesting ? 'Testando...' : 'Testar Conexão'}</span>
              </button>
            </div>
            {testResult && (
              <div
                className={`flex items-start gap-1.5 text-[11px] p-2 rounded border font-sans ${
                  testResult.ok
                    ? 'text-amadeus-accent border-amadeus-accent/40 bg-amadeus-accent/10'
                    : 'text-amadeus-red border-amadeus-red/40 bg-amadeus-red/10'
                }`}
              >
                {testResult.ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                <span>
                  {testResult.message}
                  {testResult.ok && ' — clique em "Salvar Alterações" para usar.'}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1 text-[10px] text-amadeus-muted pt-1">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-3 h-3 text-amadeus-accent shrink-0" />
                <span>Pegar chave grátis: <strong>Groq Cloud</strong> (console.groq.com), <strong>Google AI Studio</strong> (aistudio.google.com) ou <strong>OpenRouter</strong> (openrouter.ai).</span>
              </div>
              <span className="text-[10px] text-amadeus-muted/80 pl-4">Deixe em branco para usar o <strong>Simulador Offline Autônomo</strong>.</span>
            </div>
          </div>

          {/* Section: Voice & Speech Settings */}
          <div className="space-y-3 pt-3 border-t border-amadeus-border/60">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Volume2 className="w-3.5 h-3.5 text-amadeus-accent" />
              <span>CONFIGURAÇÃO DE VOZ (SPEECH SYNTHESIS)</span>
            </div>

            {/* Engine Selection: Qwen3-TTS vs Kokoro-TTS vs Edge-TTS + RVC */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-amadeus-muted block">Motor de Síntese Vocal:</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onSaveVoiceSettings({ ...voiceSettings, engine: 'qwen3' })}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    (voiceSettings.engine || 'qwen3') === 'qwen3'
                      ? 'border-amadeus-accent bg-amadeus-accent/15 text-white shadow-sm shadow-amadeus-accent/20'
                      : 'border-amadeus-border bg-amadeus-card/60 text-amadeus-muted hover:border-amadeus-muted'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amadeus-accent">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Kurisu Qwen3</span>
                  </div>
                  <p className="text-[9px] mt-0.5 text-amadeus-muted line-clamp-2">
                    Neural 1.7B (Colab ou GPU | Emoções)
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onSaveVoiceSettings({ ...voiceSettings, engine: 'kokoro' })}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    voiceSettings.engine === 'kokoro'
                      ? 'border-amadeus-accent bg-amadeus-accent/15 text-white shadow-sm shadow-amadeus-accent/20'
                      : 'border-amadeus-border bg-amadeus-card/60 text-amadeus-muted hover:border-amadeus-muted'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amadeus-accent">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Kokoro-TTS</span>
                  </div>
                  <p className="text-[9px] mt-0.5 text-amadeus-muted line-clamp-2">
                    Motor Leve 82M (100% Offline & ~100ms)
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onSaveVoiceSettings({ ...voiceSettings, engine: 'edge_rvc' })}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    voiceSettings.engine === 'edge_rvc'
                      ? 'border-amadeus-accent bg-amadeus-accent/15 text-white shadow-sm shadow-amadeus-accent/20'
                      : 'border-amadeus-border bg-amadeus-card/60 text-amadeus-muted hover:border-amadeus-muted'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amadeus-accent">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Edge-TTS + RVC</span>
                  </div>
                  <p className="text-[9px] mt-0.5 text-amadeus-muted line-clamp-2">
                    Nuvem Gratuita + Timbre RVC
                  </p>
                </button>
              </div>
            </div>

            {/* ENGINE 1: QWEN3-TTS KURISU (REMOTE / LOCAL) */}
            {(voiceSettings.engine || 'qwen3') === 'qwen3' && (
              <div className="p-3 rounded-lg border border-amadeus-accent/30 bg-amadeus-card/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amadeus-accent">
                    <Sparkles className="w-3.5 h-3.5 text-amadeus-accent" />
                    <span>KURISU QWEN3-TTS 1.7B (PROSÓDIA & EMOÇÕES)</span>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amadeus-accent/10 border border-amadeus-accent/30 text-amadeus-accent">
                    {(voiceSettings.qwenMode || 'remote') === 'remote' ? 'Colab / Cloudflare' : 'Local CUDA BF16'}
                  </span>
                </div>

                {/* Sub-mode Toggle: Remote vs Local */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-amadeus-muted block font-medium">Modo de Execução do Modelo:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSaveVoiceSettings({ ...voiceSettings, qwenMode: 'remote' });
                        handlePingWorker(voiceSettings.qwenRemoteUrl);
                      }}
                      className={`h-7 px-2 rounded text-[11px] font-medium border flex items-center justify-center gap-1.5 transition-all ${
                        (voiceSettings.qwenMode || 'remote') === 'remote'
                          ? 'border-amadeus-accent bg-amadeus-accent/20 text-white'
                          : 'border-amadeus-border bg-black/40 text-amadeus-muted hover:text-white'
                      }`}
                    >
                      <Globe className="w-3 h-3 text-amadeus-accent" />
                      <span>Remoto (Google Colab Pro)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onSaveVoiceSettings({ ...voiceSettings, qwenMode: 'local' });
                        handlePingWorker('http://127.0.0.1:8005');
                      }}
                      className={`h-7 px-2 rounded text-[11px] font-medium border flex items-center justify-center gap-1.5 transition-all ${
                        voiceSettings.qwenMode === 'local'
                          ? 'border-amadeus-accent bg-amadeus-accent/20 text-white'
                          : 'border-amadeus-border bg-black/40 text-amadeus-muted hover:text-white'
                      }`}
                    >
                      <Cpu className="w-3 h-3 text-amadeus-accent" />
                      <span>Local (GPU 8GB+ VRAM)</span>
                    </button>
                  </div>
                </div>

                                {/* Sub-mode Toggle: Delivery Mode (Streaming vs WAV) */}
                <div className="space-y-1.5 pt-1 border-t border-amadeus-border/40">
                  <label className="text-[10px] text-amadeus-muted block font-medium">Modo de Entrega de Áudio:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onSaveVoiceSettings({ ...voiceSettings, stream: true })}
                      className={`h-7 px-2 rounded text-[11px] font-medium border flex items-center justify-center gap-1.5 transition-all ${
                        voiceSettings.stream
                          ? 'border-amadeus-accent bg-amadeus-accent/20 text-white'
                          : 'border-amadeus-border bg-black/40 text-amadeus-muted hover:text-white'
                      }`}
                    >
                      <Zap className="w-3 h-3 text-amadeus-accent" />
                      <span>⚡ Streaming Real (~500ms)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSaveVoiceSettings({ ...voiceSettings, stream: false })}
                      className={`h-7 px-2 rounded text-[11px] font-medium border flex items-center justify-center gap-1.5 transition-all ${
                        !voiceSettings.stream
                          ? 'border-amadeus-accent bg-amadeus-accent/20 text-white'
                          : 'border-amadeus-border bg-black/40 text-amadeus-muted hover:text-white'
                      }`}
                    >
                      <Radio className="w-3 h-3 text-amadeus-accent" />
                      <span>🛡️ WAV Completo (Estável)</span>
                    </button>
                  </div>
                </div>

                {/* Remote URL Configuration */}
                {(voiceSettings.qwenMode || 'remote') === 'remote' ? (
                  <div className="space-y-2 pt-1 border-t border-amadeus-border/40">
                    <label className="text-[10px] text-amadeus-muted block">
                      URL Pública do Colab (Cloudflare Tunnel):
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://seu-tunel.trycloudflare.com"
                        value={voiceSettings.qwenRemoteUrl || ''}
                        onChange={(e) =>
                          onSaveVoiceSettings({ ...voiceSettings, qwenRemoteUrl: e.target.value.trim() })
                        }
                        className="flex-1 h-8 px-2.5 rounded bg-amadeus-bg border border-amadeus-border text-xs text-white placeholder-amadeus-muted/50 focus:outline-none focus:border-amadeus-accent"
                      />
                      <button
                        type="button"
                        onClick={() => handlePingWorker(voiceSettings.qwenRemoteUrl)}
                        disabled={isPinging}
                        className="h-8 px-3 rounded border border-amadeus-accent/50 bg-amadeus-accent/15 hover:bg-amadeus-accent/30 text-amadeus-accent text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {isPinging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                        <span>Testar Ping</span>
                      </button>
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-black/40 border border-amadeus-border/40">
                      <span className="text-amadeus-muted">Status do Worker Remoto:</span>
                      {qwenPingStatus ? (
                        <div className="flex items-center gap-1.5">
                          {qwenPingStatus.status === 'ready' ? (
                            <span className="text-emerald-400 font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Online • {qwenPingStatus.device || 'GPU'} ({qwenPingStatus.ping_ms}ms)
                            </span>
                          ) : qwenPingStatus.status === 'initializing' ? (
                            <span className="text-amber-400 font-medium flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              Carregando Pesos na GPU... ({qwenPingStatus.ping_ms}ms)
                            </span>
                          ) : (
                            <span className="text-rose-400 font-medium">
                              Offline ({qwenPingStatus.error ? 'Inacessível' : 'Desconectado'})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-amadeus-muted">Não verificado</span>
                      )}
                    </div>

                    {/* Pro Plan Colab Guidance */}
                    <div className="p-2 rounded bg-amadeus-accent/5 border border-amadeus-accent/20 text-[10px] text-amadeus-muted leading-relaxed">
                      💡 <strong>Dica Google AI Pro:</strong> Você possui o <strong>Colab Pro com 200 compute units/mês</strong>! Execute o notebook <code className="text-amadeus-accent font-mono px-1 py-0.5 bg-black/40 rounded">notebooks/Amadeus_Qwen3_TTS_Colab.ipynb</code> no Colab, copie a URL gerada e cole aqui. Zero consumo de VRAM local e máxima fidelidade!
                    </div>
                  </div>
                ) : (
                  /* Local Execution Notice */
                  <div className="space-y-2 pt-1 border-t border-amadeus-border/40">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-amadeus-muted">Endpoint Loopback:</span>
                      <code className="text-white font-mono bg-black/40 px-1.5 py-0.5 rounded">http://127.0.0.1:8005</code>
                    </div>
                    <div className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-black/40 border border-amadeus-border/40">
                      <span className="text-amadeus-muted">Status do Worker Local:</span>
                      <button
                        type="button"
                        onClick={() => handlePingWorker('http://127.0.0.1:8005')}
                        className="text-amadeus-accent hover:underline flex items-center gap-1 text-[10px]"
                      >
                        {isPinging ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
                        <span>{qwenPingStatus?.status === 'ready' ? '🟢 Online' : '🔴 Offline / Verificar'}</span>
                      </button>
                    </div>
                    <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-200/90 leading-relaxed">
                      ⚠️ <strong>Aviso de Hardware:</strong> O Qwen3-TTS 1.7B consome ~5.4GB de VRAM. Em GPUs com 6GB ou menos (ex: RTX 3050 Laptop), pode causar paginação e lentidão do Windows. Se notar lentidão, use o modo Remoto via Colab Pro!
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ENGINE 2: KOKORO-TTS (LIGHTWEIGHT LOCAL) */}
            {voiceSettings.engine === 'kokoro' && (
              <div className="p-3 rounded-lg border border-amadeus-accent/30 bg-amadeus-card/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amadeus-accent">
                    <Zap className="w-3.5 h-3.5 text-amadeus-accent" />
                    <span>KOKORO-TTS (MOTOR LOCAL LEVE 82M)</span>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    100% Offline • ~100ms
                  </span>
                </div>
                <p className="text-[10px] text-amadeus-muted leading-relaxed">
                  Síntese neural ultrarrápida em Português Brasileiro (voz <em>pf_dora</em>). Roda diretamente em CPU ou GPU consumindo apenas ~350MB de memória.
                </p>

                {/* RVC on Kokoro option */}
                <div className="pt-2 border-t border-amadeus-border/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-white font-medium block">Aplicar Timbre RVC de Makise Kurisu</span>
                      <span className="text-[10px] text-amadeus-muted">Converte a voz base Kokoro para o timbre autêntico</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(voiceSettings.useRvc)}
                      onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, useRvc: e.target.checked })}
                      className="accent-amadeus-accent w-4 h-4 cursor-pointer"
                    />
                  </div>

                  {voiceSettings.useRvc && (
                    <div className="space-y-2 pt-1">
                      <div className="space-y-1">
                        <label className="text-[10px] text-amadeus-muted block">Modelo RVC (.pth):</label>
                        <select
                          value={voiceSettings.rvcModel || 'KurisuRVCv147'}
                          onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, rvcModel: e.target.value })}
                          className="w-full h-8 px-2 rounded bg-amadeus-card border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                        >
                          {availableRvcModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ENGINE 3: EDGE-TTS + RVC */}
            {voiceSettings.engine === 'edge_rvc' && (
              <>
                {/* Neural vs System Voice selector */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-white font-medium block">Voz Neural de Alta Definição (Edge-TTS)</span>
                      <span className="text-[10px] text-amadeus-muted">Voz humana com sincronia labial acústica</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={voiceSettings.useNeural !== false}
                      onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, useNeural: e.target.checked })}
                      className="accent-amadeus-accent w-4 h-4 cursor-pointer"
                    />
                  </div>

                  {voiceSettings.useNeural !== false ? (
                    <div className="space-y-1">
                      <label className="text-[10px] text-amadeus-muted block">Voz Neural (IA):</label>
                      <select
                        value={voiceSettings.neuralVoice || 'pt-BR-FranciscaNeural'}
                        onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, neuralVoice: e.target.value })}
                        className="w-full h-8 px-2 rounded bg-amadeus-card border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                      >
                        <option value="pt-BR-FranciscaNeural">Francisca Neural (Português BR - Natural & Expressiva)</option>
                        <option value="pt-BR-ThalitaNeural">Thalita Neural (Português BR - Jovem & Rápida)</option>
                        <option value="pt-BR-ElzaNeural">Elza Neural (Português BR - Calma & Séria)</option>
                        <option value="ja-JP-NanamiNeural">Nanami Neural (Japonês - Anime Original)</option>
                        <option value="ja-JP-AoiNeural">Aoi Neural (Japonês - Calma)</option>
                        <option value="en-US-JennyNeural">Jenny Neural (Inglês - Cientista Viktor Chondria)</option>
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-[10px] text-amadeus-muted block">Voz do Sistema (Navegador):</label>
                      <select
                        value={voiceSettings.voiceURI || ''}
                        onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, voiceURI: e.target.value })}
                        className="w-full h-8 px-2 rounded bg-amadeus-card border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
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
                </div>

                {/* RVC Neural Voice Card (RTX 3050 GPU Acceleration) */}
                <div className="p-3 rounded-lg border border-amadeus-accent/30 bg-amadeus-card/90 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amadeus-accent">
                        <Sparkles className="w-3.5 h-3.5 text-amadeus-accent" />
                        <span>CLONAGEM DE VOZ RVC (KURISU)</span>
                      </div>
                      <p className="text-[10px] text-amadeus-muted mt-0.5">
                        Timbre da dubladora original acelerado por GPU (CUDA FP16)
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(voiceSettings.useRvc)}
                      onChange={(e) =>
                        onSaveVoiceSettings({
                          ...voiceSettings,
                          useRvc: e.target.checked,
                          useNeural: true,
                        })
                      }
                      className="accent-amadeus-accent w-4 h-4 cursor-pointer"
                    />
                  </div>

                  {voiceSettings.useRvc && (
                    <div className="space-y-2 pt-1 border-t border-amadeus-border/40">
                      <div className="space-y-1">
                        <label className="text-[10px] text-amadeus-muted block">Modelo RVC (.pth):</label>
                        <select
                          value={voiceSettings.rvcModel || 'KurisuRVCv147'}
                          onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, rvcModel: e.target.value })}
                          className="w-full h-8 px-2 rounded bg-amadeus-card border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                        >
                          {availableRvcModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => setShowRvcAdvanced((prev) => !prev)}
                          className="text-[10px] text-amadeus-accent hover:underline flex items-center gap-1"
                        >
                          <span>{showRvcAdvanced ? '▼ Ocultar Ajustes Finos RVC' : '▶ Ajustes Finos de Tom & Timbre (Opcional)'}</span>
                        </button>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amadeus-accent/10 border border-amadeus-accent/30 text-amadeus-accent">
                          CUDA FP16
                        </span>
                      </div>

                      {showRvcAdvanced && (
                        <div className="grid grid-cols-2 gap-3 pt-2 text-[10px]">
                          <div>
                            <label className="text-amadeus-muted block mb-1">
                              Afinação / Pitch ({voiceSettings.rvcPitch ?? 0} semitons):
                            </label>
                            <input
                              type="range"
                              min="-6"
                              max="6"
                              step="1"
                              value={voiceSettings.rvcPitch ?? 0}
                              onChange={(e) =>
                                onSaveVoiceSettings({
                                  ...voiceSettings,
                                  rvcPitch: parseInt(e.target.value, 10),
                                })
                              }
                              className="w-full accent-amadeus-accent cursor-pointer"
                            />
                          </div>
                          <div>
                            <label className="text-amadeus-muted block mb-1">
                              Fidelidade de Timbre ({Math.round((voiceSettings.rvcIndexRate ?? 0.75) * 100)}%):
                            </label>
                            <input
                              type="range"
                              min="0.2"
                              max="1.0"
                              step="0.05"
                              value={voiceSettings.rvcIndexRate ?? 0.75}
                              onChange={(e) =>
                                onSaveVoiceSettings({
                                  ...voiceSettings,
                                  rvcIndexRate: parseFloat(e.target.value),
                                })
                              }
                              className="w-full accent-amadeus-accent cursor-pointer"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Sample audio preview button */}
            <button
              type="button"
              onClick={handleTestVoice}
              disabled={isTestingVoice}
              className="w-full h-8 rounded border border-amadeus-accent/40 bg-amadeus-accent/10 hover:bg-amadeus-accent hover:text-black text-amadeus-accent text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {isTestingVoice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span>{isTestingVoice ? 'Reproduzindo Amostra...' : 'Ouvir Amostra de Voz'}</span>
            </button>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-amadeus-muted">Falar Resposta Automaticamente:</span>
              <input
                type="checkbox"
                checked={voiceSettings.autoSpeak}
                onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, autoSpeak: e.target.checked })}
                className="accent-amadeus-accent w-4 h-4 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[10px] text-amadeus-muted block mb-1">Velocidade ({voiceSettings.rate}x):</label>
                <input
                  type="range"
                  min="0.8"
                  max="1.4"
                  step="0.05"
                  value={voiceSettings.rate}
                  onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, rate: parseFloat(e.target.value) })}
                  className="w-full accent-amadeus-accent cursor-pointer"
                />
              </div>
              <div>
                <label className="text-[10px] text-amadeus-muted block mb-1">Tom / Pitch ({voiceSettings.pitch}):</label>
                <input
                  type="range"
                  min="0.8"
                  max="1.6"
                  step="0.05"
                  value={voiceSettings.pitch}
                  onChange={(e) => onSaveVoiceSettings({ ...voiceSettings, pitch: parseFloat(e.target.value) })}
                  className="w-full accent-amadeus-accent cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Section: Display Settings */}
          <div className="space-y-3 pt-3 border-t border-amadeus-border/60">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Monitor className="w-3.5 h-3.5 text-amadeus-accent" />
              <span>VISUAL & EFEITOS CRT</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amadeus-muted">Linhas de Varredura CRT (Scanlines):</span>
              <input
                type="checkbox"
                checked={scanlines}
                onChange={(e) => onToggleScanlines(e.target.checked)}
                className="accent-amadeus-accent w-4 h-4 cursor-pointer"
              />
            </div>
          </div>
          </div>
        ) : (
          /* Credits & Models Tab */
          <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Header info */}
            <div className="p-3.5 rounded-lg border border-amadeus-accent/30 bg-amadeus-card/90 space-y-1.5 font-mono">
              <div className="flex items-center gap-2 text-xs font-bold text-amadeus-accent">
                <Cpu className="w-4 h-4 text-amadeus-accent" />
                <span>RECONHECIMENTOS & INFRAESTRUTURA NEURAL</span>
              </div>
              <p className="text-[11px] text-amadeus-muted leading-relaxed font-sans">
                O Amadeus System opera através da integração de modelos neurais de ponta, pesos especializados da comunidade open-source e motores de voz de estúdio.
              </p>
            </div>

            {/* Model 1: Kurisu Qwen3-TTS */}
            <div className="p-4 rounded-xl border border-amadeus-accent/40 bg-amadeus-card hover:border-amadeus-accent transition-colors space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amadeus-accent shrink-0" />
                    <h3 className="text-xs font-bold font-mono text-white tracking-wide">
                      Kurisu Qwen3-TTS (Novo Motor de Voz)
                    </h3>
                  </div>
                  <p className="text-[10px] text-amadeus-muted font-mono mt-0.5">
                    starrydark / Kurisu_Qwen3_TTS • Alibaba Qwen3-TTS 1.7B
                  </p>
                </div>
                <a
                  href="https://huggingface.co/starrydark/Kurisu_Qwen3_TTS"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-amadeus-accent/10 border border-amadeus-accent/40 text-[10px] text-amadeus-accent font-mono hover:bg-amadeus-accent hover:text-black transition-colors shrink-0"
                >
                  <span>HuggingFace</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed font-sans">
                Motor neural <em>end-to-end</em> baseado na arquitetura Alibaba Qwen3-TTS (1.7 Bilhões de parâmetros), com pesos treinados especificamente na voz, entonações emocionais, suspiros e reações <em>tsundere</em> de Makise Kurisu. Executa inferência local em GPU via PyTorch 2.6 CUDA com acústica de estúdio seco.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-accent">
                  Alibaba Qwen3-TTS
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-muted">
                  PyTorch 2.6 cu124 BF16
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-muted">
                  Resident Worker :8002
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-muted">
                  150ms Breath Pauses
                </span>
              </div>
            </div>

            {/* Model 2: Kurisu RVC v2 */}
            <div className="p-4 rounded-xl border border-amadeus-border bg-amadeus-card hover:border-amadeus-accent/60 transition-colors space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-amadeus-accent shrink-0" />
                    <h3 className="text-xs font-bold font-mono text-white">
                      Kurisu RVC v2 (Conversão de Timbre)
                    </h3>
                  </div>
                  <p className="text-[10px] text-amadeus-muted font-mono mt-0.5">
                    FrancescoCaracciolo / Kurisu-RVC • Modelo de Voz RVC v2
                  </p>
                </div>
                <a
                  href="https://huggingface.co/FrancescoCaracciolo/Kurisu-RVC/tree/main"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-amadeus-accent/10 border border-amadeus-accent/40 text-[10px] text-amadeus-accent font-mono hover:bg-amadeus-accent hover:text-black transition-colors shrink-0"
                >
                  <span>HuggingFace</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed font-sans">
                Clonagem e conversão acústica de timbre em tempo real treinada sobre a voz oficial da dubladora japonesa de Makise Kurisu. Utiliza os pesos <code className="text-amadeus-accent font-mono text-[10px]">KurisuRVCv147.pth</code> e índice <code className="text-amadeus-accent font-mono text-[10px]">KurisuRVCv147.index</code> com extração harmônica RMVPE e HuBERT.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-accent">
                  RVC v2
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-muted">
                  CUDA FP16
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/40 border border-amadeus-border text-amadeus-muted">
                  Worker :8001
                </span>
              </div>
            </div>

            {/* Model 3: Microsoft Edge-TTS */}
            <div className="p-4 rounded-xl border border-amadeus-border bg-amadeus-card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amadeus-accent shrink-0" />
                    <h3 className="text-xs font-bold font-mono text-white">
                      Microsoft Edge Neural TTS
                    </h3>
                  </div>
                  <p className="text-[10px] text-amadeus-muted font-mono mt-0.5">
                    Azure Cognitive Services
                  </p>
                </div>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-amadeus-card border border-amadeus-border text-amadeus-muted">
                  Cloud Neural
                </span>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed font-sans">
                Geração de áudio neural de alta fluidez em Português do Brasil (<code className="text-amadeus-accent font-mono text-[10px]">FranciscaNeural</code>, <code className="text-amadeus-accent font-mono text-[10px]">ThalitaNeural</code>) e Japonês (<code className="text-amadeus-accent font-mono text-[10px]">NanamiNeural</code>), servindo como base acústica e fallback automático instantâneo.
              </p>
            </div>

            {/* Model 4: Memória & LLMs */}
            <div className="p-4 rounded-xl border border-amadeus-border bg-amadeus-card space-y-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-amadeus-accent shrink-0" />
                <h3 className="text-xs font-bold font-mono text-white">
                  Memória Semântica & Modelos de Linguagem
                </h3>
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed font-sans">
                <strong>ChromaDB + SQLite:</strong> Armazenamento vetorial local para recuperação de memórias semânticas (RAG) e contexto de longo prazo.<br />
                <strong>LLMs Suportadas:</strong> Groq Cloud LPU (Llama 3.3 70B Versatile), Google Gemini 2.5 Flash / Pro, e OpenRouter.
              </p>
            </div>

            {/* Disclaimer / Steins;Gate Lore */}
            <div className="p-3.5 rounded-lg border border-amadeus-border/60 bg-black/40 space-y-1.5 text-[10px] text-amadeus-muted leading-relaxed font-sans">
              <div className="flex items-center gap-1.5 font-bold text-amadeus-muted font-mono">
                <Heart className="w-3.5 h-3.5 text-amadeus-red shrink-0" />
                <span>DIREITOS & UNIVERSO ORIGINAL</span>
              </div>
              <p>
                Makise Kurisu e o projeto Amadeus pertencem ao universo de <strong>Steins;Gate</strong> e <strong>Steins;Gate 0</strong>, criações originais de <strong>Chiyomaru Shikura</strong>, <strong>MAGES. / 5pb.</strong>, <strong>Nitroplus</strong> e <strong>White Fox</strong>.
              </p>
              <p>
                Este software é um projeto conceitual e experimental desenvolvido para fins de pesquisa, estudo em inteligência artificial e homenagem de fã.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-amadeus-border bg-amadeus-card flex items-center justify-between">
          <span className="text-[11px] text-amadeus-muted">
            {activeTab === 'settings'
              ? 'Configurações salvas localmente'
              : 'Amadeus System // Viktor Chondria Lab 304'}
          </span>
          <div className="flex items-center gap-2">
            {activeTab === 'settings' ? (
              <>
                <button
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded bg-amadeus-border/60 hover:bg-amadeus-border text-white text-xs transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 rounded bg-amadeus-accent text-black font-bold text-xs flex items-center gap-1.5 hover:bg-[#00e676] transition-colors"
                >
                  {savedSuccess ? <Check className="w-3.5 h-3.5" /> : null}
                  <span>{savedSuccess ? 'Salvo!' : 'Salvar Alterações'}</span>
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-amadeus-accent text-black font-bold text-xs hover:bg-[#00e676] transition-colors"
              >
                Fechar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
