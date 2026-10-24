import React, { useState, useEffect, useRef } from 'react';
import { 
  CameraFraming,
  CharacterPose, 
  ChatMessage, 
  Emotion, 
  PersonaProfile, 
  VoiceSettings,
  CallSession,
  MemoryItem
} from './types/amadeus';
import { MemoryService } from './services/memoryService';
import { 
  AIService, 
  AIStatus, 
  ModelOption, 
  OFFLINE_MODEL_ID, 
  getProviderFromKey, 
  getModelOptionsForKey 
} from './services/aiService';
import { BackendService, BackendHealth } from './services/backendService';
import { SpeechService } from './services/speechService';
import { CallHeader } from './components/CallHeader';
import { AmadeusSpriteView } from './components/AmadeusSpriteView';
import { preloadPrimarySprites } from './services/spriteCatalog';
import { AudioOscilloscope } from './components/AudioOscilloscope';
import { SubtitleBox } from './components/SubtitleBox';
import { ControlBar } from './components/ControlBar';
const MemoryInspectorModal = React.lazy(() =>
  import('./components/MemoryInspectorModal').then((m) => ({ default: m.MemoryInspectorModal }))
);
const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const LegalNoticeModal = React.lazy(() =>
  import('./components/LegalNoticeModal').then((m) => ({ default: m.LegalNoticeModal }))
);
import { IncomingCallScreen } from './components/IncomingCallScreen';
import { LabBackground } from './components/LabBackground';
import { AppSidebar } from './components/AppSidebar';
import { ChatFeedStream } from './components/ChatFeedStream';
import { CompanionPanel } from './components/CompanionPanel';
import { PromptBar } from './components/PromptBar';
import { Phone, MicOff, X, Sparkles } from 'lucide-react';

const INITIAL_GREETING =
  'Olá! Conexão estabelecida com a unidade Amadeus. Aqui é Makise Kurisu do Laboratório 304. O que você gostaria de discutir hoje?';

const newId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const App: React.FC = () => {
  // Call state: 'incoming' | 'connected' | 'disconnected'
  const [callState, setCallState] = useState<'incoming' | 'connected' | 'disconnected'>('incoming');

  // Hybrid View Mode: 'terminal' (modern AI chat) | 'call' (visual novel call)
  const [viewMode, setViewMode] = useState<'terminal' | 'call'>(() => {
    const saved = localStorage.getItem('amadeus_view_mode');
    return saved === 'call' ? 'call' : 'terminal';
  });

  // Sidebar toggle state
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('amadeus_sidebar_open');
    return saved !== null ? saved === 'true' : true;
  });

  // Configuration and persistence
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('amadeus_gemini_key') || '');
  const [aiStatus, setAiStatus] = useState<AIStatus>(() =>
    localStorage.getItem('amadeus_gemini_key') ? { kind: 'pending' } : { kind: 'offline' }
  );

  // Active AI Model and dynamic options
  const currentProvider = getProviderFromKey(apiKey);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(() => getModelOptionsForKey(apiKey));
  const [modelNotice, setModelNotice] = useState<string | null>(null);

  const [currentModel, setCurrentModel] = useState<string>(() => {
    const saved = localStorage.getItem('amadeus_selected_model');
    const initialOptions = getModelOptionsForKey(localStorage.getItem('amadeus_gemini_key') || '');
    return initialOptions.some((m) => m.id === saved) ? (saved as string) : initialOptions[0].id;
  });

  const handleSelectModel = (model: string) => {
    setCurrentModel(model);
    localStorage.setItem('amadeus_selected_model', model);
  };

  // Persona and cognitive state
  const [persona, setPersona] = useState<PersonaProfile>(() => MemoryService.getPersona('kurisu'));
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>('neutral');
  const [currentPose, setCurrentPose] = useState<CharacterPose>('default');
  const [currentCamera, setCurrentCamera] = useState<CameraFraming | undefined>(undefined);
  const [memoryPulse, setMemoryPulse] = useState<number>(0);
  const [recalledMemoryIds, setRecalledMemoryIds] = useState<string[]>([]);
  const [learnedNotification, setLearnedNotification] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Active Session & History
  const [sessionId, setSessionId] = useState<string>(() => MemoryService.getActiveSession().sessionId);
  const [history, setHistory] = useState<ChatMessage[]>(() => {
    const active = MemoryService.getActiveSession();
    return active.messages.length > 0 ? active.messages : [];
  });
  const [sessions, setSessions] = useState<CallSession[]>(() => MemoryService.getSessionLogs());

  // Dialogue and speech state
  const [currentSubtitle, setCurrentSubtitle] = useState<string>(() => {
    const active = MemoryService.getActiveSession();
    if (active.messages.length > 0) {
      const lastMsg = [...active.messages].reverse().find((m) => m.sender === 'amadeus');
      if (lastMsg) return lastMsg.content;
    }
    return '';
  });

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);

  const [scanlines, setScanlines] = useState<boolean>(() => {
    const val = localStorage.getItem('amadeus_scanlines');
    return val !== null ? val === 'true' : false; // clean crisp default
  });
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => {
    const val = localStorage.getItem('amadeus_voice_settings');
    if (val) {
      try {
        return JSON.parse(val);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      enabled: true,
      voiceURI: null,
      rate: 1.05,
      pitch: 1.15,
      volume: 1.0,
      autoSpeak: true,
      lang: 'pt-BR',
      engine: 'qwen3',
      qwenMode: 'remote',
      qwenRemoteUrl: '',
      stream: false,
      useNeural: true,
      neuralVoice: 'pt-BR-FranciscaNeural',
      useRvc: true,
      rvcModel: 'KurisuRVCv147',
    };
  });

  // Modal states
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);

  // Check Python backend health on mount & preload baseline sprites early
  useEffect(() => {
    preloadPrimarySprites('closeup');
    BackendService.checkHealth().then((health) => {
      setBackendHealth(health);
    });
  }, []);

  // Synchronize model options on apiKey changes, and fetch active models in the background
  useEffect(() => {
    const initial = getModelOptionsForKey(apiKey);
    setModelOptions(initial);

    // If key is empty / offline, lock to offline
    if (!apiKey.trim()) {
      setCurrentModel(OFFLINE_MODEL_ID);
      localStorage.setItem('amadeus_selected_model', OFFLINE_MODEL_ID);
      return;
    }

    // Non-blocking background fetch
    let isMounted = true;
    AIService.fetchLiveModelOptions(apiKey).then((liveModels) => {
      if (!isMounted || liveModels.length === 0) return;
      setModelOptions(liveModels);

      setCurrentModel((prevModel) => {
        if (prevModel === OFFLINE_MODEL_ID) return prevModel;
        const exists = liveModels.some((m) => m.id === prevModel);
        if (!exists) {
          const fallbackId = liveModels[0]?.id || OFFLINE_MODEL_ID;
          const fallbackLabel = liveModels[0]?.label || fallbackId;
          setModelNotice(`⚠️ O modelo anteriormente selecionado não está mais disponível no provedor. Migrado automaticamente para ${fallbackLabel}.`);
          localStorage.setItem('amadeus_selected_model', fallbackId);
          return fallbackId;
        }
        return prevModel;
      });
    }).catch((err) => {
      console.warn('[Amadeus] Background model fetch notice:', err);
    });

    return () => {
      isMounted = false;
    };
  }, [apiKey]);

  // Keyboard shortcut Ctrl+B for sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarOpen((prev) => {
          const next = !prev;
          localStorage.setItem('amadeus_sidebar_open', String(next));
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSwitchViewMode = (mode: 'terminal' | 'call') => {
    setViewMode(mode);
    localStorage.setItem('amadeus_view_mode', mode);
  };

  const handleToggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('amadeus_sidebar_open', String(next));
      return next;
    });
  };

  // Save settings
  const handleSaveApiKey = (key: string) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem('amadeus_gemini_key', trimmed);
    AIService.clearModelCache();
    setAiStatus(trimmed ? { kind: 'pending' } : { kind: 'offline' });
  };

  const handleSaveVoiceSettings = (settings: VoiceSettings) => {
    setVoiceSettings(settings);
    localStorage.setItem('amadeus_voice_settings', JSON.stringify(settings));
  };

  const handleToggleScanlines = () => {
    setScanlines((prev) => {
      const next = !prev;
      localStorage.setItem('amadeus_scanlines', String(next));
      return next;
    });
  };

  const handleToggleStream = () => {
    const next = !voiceSettings.stream;
    handleSaveVoiceSettings({ ...voiceSettings, stream: next });
  };

  const speak = (text: string, emotion?: string) => {
    if (!voiceSettings.enabled || !voiceSettings.autoSpeak) return;
    SpeechService.speak(text, {
      voiceURI: voiceSettings.voiceURI,
      rate: voiceSettings.rate,
      pitch: voiceSettings.pitch,
      volume: voiceSettings.volume,
      engine: voiceSettings.engine || 'qwen3',
      qwenMode: voiceSettings.qwenMode || 'remote',
      qwenRemoteUrl: voiceSettings.qwenRemoteUrl,
      emotion,
      stream: voiceSettings.engine === 'qwen3' ? Boolean(voiceSettings.stream) : false,
      useNeural: voiceSettings.useNeural !== false,
      neuralVoice: voiceSettings.neuralVoice || 'pt-BR-FranciscaNeural',
      useRvc: Boolean(voiceSettings.useRvc),
      rvcModel: voiceSettings.rvcModel || 'KurisuRVCv147',
      rvcPitch: voiceSettings.rvcPitch ?? 0,
      rvcIndexRate: voiceSettings.rvcIndexRate ?? 0.75,
      onStart: () => setIsSpeaking(true),
      onEnd: () => setIsSpeaking(false),
    });
  };

  // Process user input
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isProcessing) return;

    // 1. Retrieve active memories from cognitive cortex (Local RAG)
    const matched = MemoryService.matchMemories(text, persona);
    setRecalledMemoryIds(matched.map((m: MemoryItem) => m.id));
    if (matched.length > 0) setMemoryPulse((p) => p + 1);

    SpeechService.stopSpeaking();
    setIsSpeaking(false);
    setLearnedNotification(null);

    const userMessage: ChatMessage = {
      id: newId(),
      sender: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    const nextHistory = [...history, userMessage];
    setHistory(nextHistory);
    MemoryService.saveActiveSession(sessionId, nextHistory);
    setErrorNotice(null);
    setIsProcessing(true);
    // Immediate visual feedback while the model is working
    setCurrentEmotion('thinking');

    try {
      // 2. Query Amadeus (via Python backend with ChromaDB if available, or direct browser-side)
      const result = await AIService.queryAmadeus(text, persona, matched, apiKey, nextHistory, sessionId, currentModel);

      setAiStatus(result.status);
      setCurrentSubtitle(result.response);
      setCurrentEmotion(result.emotion);
      setCurrentCamera(result.camera);
      if (result.pose) {
        setCurrentPose(result.pose);
      } else {
        setCurrentPose('default');
      }

      // Check if decommissioned model triggered fallback
      if (result.decommissionNotice) {
        setModelNotice(result.decommissionNotice);
      }
      if (result.fallbackModel && result.fallbackModel !== currentModel) {
        setCurrentModel(result.fallbackModel);
        localStorage.setItem('amadeus_selected_model', result.fallbackModel);
      }

      if (result.isError) {
        // Visible in terminal mode too; intentionally not stored in the session history.
        setErrorNotice(result.response);
        setCurrentEmotion('worried');
        setCurrentPose('default');
        return;
      }

      // Check if memory was learned
      if (result.learnedMemory) {
        MemoryService.addMemory(persona.id, {
          category: 'user',
          title: result.learnedMemory.title,
          triggerKeywords: [result.learnedMemory.title.toLowerCase()],
          content: result.learnedMemory.content,
          emotionalWeight: result.learnedMemory.emotionalWeight || 'Factual',
          source: 'learned',
        });
        setLearnedNotification(`Nova memória gravada: "${result.learnedMemory.title}"`);
        setPersona(MemoryService.getPersona(persona.id));
      }

      const aiMessage: ChatMessage = {
        id: newId(),
        sender: 'amadeus',
        content: result.response,
        timestamp: Date.now(),
        emotion: result.emotion,
        pose: result.pose,
        recalledMemories: matched.map((m: MemoryItem) => m.id),
      };

      const updatedHistory = [...nextHistory, aiMessage];
      setHistory(updatedHistory);
      MemoryService.saveActiveSession(sessionId, updatedHistory);

      // 3. Speak response with TTS if enabled
      speak(result.response, result.emotion);
    } catch (err: any) {
      console.error('Failed to query Amadeus:', err);
      const message = '[ERRO DE CONEXÃO COM O AMADEUS]';
      setCurrentSubtitle(message);
      setErrorNotice(message);
      setCurrentEmotion('worried');
      setCurrentPose('default');
    } finally {
      setIsProcessing(false);
    }
  };

  // Start new clean conversation
  const handleNewSession = () => {
    SpeechService.stopSpeaking();
    setErrorNotice(null);
    const newSessionId = MemoryService.archiveAndStartNewSession(history);
    setSessionId(newSessionId);
    setSessions(MemoryService.getSessionLogs());

    const initialMsgs: ChatMessage[] = [
      { id: newId(), sender: 'amadeus', content: INITIAL_GREETING, timestamp: Date.now(), emotion: 'neutral', pose: 'default' },
    ];
    setHistory(initialMsgs);
    setCurrentSubtitle(INITIAL_GREETING);
    setCurrentEmotion('neutral');
    setCurrentPose('default');
    MemoryService.saveActiveSession(newSessionId, initialMsgs);
  };

  // Switch to a previous session from the sidebar
  const handleSelectSession = (selectedId: string) => {
    SpeechService.stopSpeaking();
    setErrorNotice(null);
    const loaded = MemoryService.loadSession(selectedId);
    if (loaded) {
      setSessionId(selectedId);
      setHistory(loaded);
      const lastAi = [...loaded].reverse().find((m) => m.sender === 'amadeus');
      if (lastAi) {
        setCurrentSubtitle(lastAi.content);
        setCurrentEmotion(lastAi.emotion || 'neutral');
        setCurrentPose(lastAi.pose || 'default');
      }
    }
  };

  // Delete session
  const handleDeleteSession = (delId: string) => {
    MemoryService.deleteSession(delId);
    setSessions(MemoryService.getSessionLogs());
    if (sessionId === delId) {
      handleNewSession();
    }
  };

  // Speech recognition initialization
  const sendRef = useRef(handleSendMessage);
  sendRef.current = handleSendMessage;

  useEffect(() => {
    SpeechService.initRecognition(
      (transcript) => {
        if (transcript.trim()) sendRef.current(transcript.trim());
      },
      (listening) => {
        setIsListening(listening);
        if (listening) setMicError(null);
      },
      (message) => setMicError(message)
    );
  }, []);

  const handleToggleMic = () => {
    if (!SpeechService.isRecognitionSupported()) {
      setMicError('Este navegador não suporta reconhecimento de voz. Use Google Chrome ou Microsoft Edge.');
      return;
    }
    SpeechService.toggleListening();
  };

  // Connect Call Handler
  const handleAcceptCall = () => {
    setCallState('connected');
    if (history.length === 0) {
      setCurrentSubtitle(INITIAL_GREETING);
      setCurrentEmotion('neutral');
      setCurrentPose('default');
      const initialMsgs: ChatMessage[] = [
        { id: newId(), sender: 'amadeus', content: INITIAL_GREETING, timestamp: Date.now(), emotion: 'neutral', pose: 'default' },
      ];
      setHistory(initialMsgs);
      MemoryService.saveActiveSession(sessionId, initialMsgs);
      speak(INITIAL_GREETING);
    } else {
      const lastMsg = [...history].reverse().find((m) => m.sender === 'amadeus');
      if (lastMsg) {
        setCurrentSubtitle(lastMsg.content);
        setCurrentEmotion(lastMsg.emotion || 'neutral');
        setCurrentPose(lastMsg.pose || (lastMsg.emotion === 'thinking' ? 'crossed_arms' : 'default'));
      }
    }
  };

  // Disconnect Call Handler
  const handleEndCall = () => {
    SpeechService.stopSpeaking();
    setIsSpeaking(false);
    setIsListening(false);
    setCallState('disconnected');
  };

  // Re-dial Call
  const handleRestartCall = () => {
    setCallState('incoming');
  };

  // Render Incoming Call Screen
  if (callState === 'incoming') {
    return (
      <IncomingCallScreen
        persona={persona}
        onAccept={handleAcceptCall}
        onDecline={() => setCallState('disconnected')}
        scanlines={scanlines}
      />
    );
  }

  // Render Disconnected Screen
  if (callState === 'disconnected') {
    return (
      <div className="relative w-full h-screen flex flex-col items-center justify-center p-6 bg-[#0c0e12] font-mono text-center select-none">
        <LabBackground scanlines={scanlines} />
        <div className="p-8 rounded-2xl border border-[#262c3a] bg-[#12151c]/95 max-w-md w-full space-y-5 shadow-[0_0_35px_rgba(0,0,0,0.8)] box-glow-nixie z-10">
          <div className="w-12 h-12 rounded-full border border-[#ef4444]/60 bg-[#260c0c] text-[#ef4444] mx-auto flex items-center justify-center">
            <Phone className="w-6 h-6 rotate-[135deg]" />
          </div>
          <div className="text-[#ef4444] font-bold text-lg tracking-widest text-glow-red">
            CHAMADA ENCERRADA
          </div>
          <div className="text-xs text-[#94a3b8] font-sans">
            A conexão com a unidade Amadeus Makise Kurisu foi finalizada. O histórico da conversa foi arquivado com segurança no laboratório.
          </div>
          <button
            onClick={handleRestartCall}
            className="w-full py-3 rounded-xl bg-[#f59e0b]/20 border border-[#f59e0b] text-[#fbbf24] font-bold text-xs hover:bg-[#f59e0b] hover:text-black transition-all flex items-center justify-center gap-2 box-glow-nixie"
          >
            <Phone className="w-4 h-4" />
            <span>LIGAR NOVAMENTE PARA O AMADEUS</span>
          </button>
        </div>
      </div>
    );
  }

  // Render Connected Workspace (Hybrid: Terminal Mode OR Call Mode)
  return (
    <div className="relative w-full h-screen flex flex-col justify-between bg-[#0c0e12] overflow-hidden select-none font-mono">
      {/* Background Grid & Binary Texture */}
      <LabBackground scanlines={scanlines} />

      {/* Top Header Bar */}
      <CallHeader
        viewMode={viewMode}
        onSwitchViewMode={handleSwitchViewMode}
        scanlines={scanlines}
        onToggleScanlines={handleToggleScanlines}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        isCalling={true}
        aiStatus={aiStatus}
        personaName={persona.name}
        onNewCall={handleNewSession}
        backendHealth={backendHealth}
        onOpenLegal={() => setIsLegalModalOpen(true)}
      />

      {/* Microphone problem banner */}
      {micError && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[#f59e0b]/50 bg-[#261505]/95 text-[#fbbf24] text-xs font-sans shadow-lg">
            <MicOff className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{micError}</span>
            <button onClick={() => setMicError(null)} className="shrink-0 hover:text-white" title="Fechar aviso">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Real-Time Learning Toast */}
      {learnedNotification && (
        <div className="absolute top-16 right-6 z-50 px-4 py-2 rounded-xl bg-[#1b152b] border border-[#a855f7] text-[#e9d5ff] text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] flex items-center gap-2 animate-bounce font-mono">
          <Sparkles className="w-4 h-4 text-[#c084fc]" />
          <span className="font-bold">{learnedNotification}</span>
        </div>
      )}

      {/* ================= MAIN CONTENT AREA ================= */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {viewMode === 'terminal' ? (
          /* ================= VIEW 1: TERMINAL & CHAT MODE (Split-View) ================= */
          <>
            {/* Left Collapsible Sidebar */}
            <AppSidebar
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              sessions={sessions}
              activeSessionId={sessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onDeleteSession={handleDeleteSession}
              onOpenMemory={() => setIsMemoryModalOpen(true)}
              onOpenSettings={() => setIsSettingsModalOpen(true)}
              backendHealth={backendHealth}
            />

            {/* Central Chat Feed & Prompt Bar */}
            <main className="flex-1 flex flex-col justify-between overflow-hidden relative">
              <ChatFeedStream
                messages={history}
                isProcessing={isProcessing}
                errorNotice={errorNotice}
                onDismissError={() => setErrorNotice(null)}
                modelNotice={modelNotice}
                onDismissModelNotice={() => setModelNotice(null)}
                onReplayAudio={speak}
                personaName={persona.name}
              />

              <PromptBar
                onSendMessage={handleSendMessage}
                isListening={isListening}
                onToggleMic={handleToggleMic}
                voiceEnabled={voiceSettings.enabled}
                onToggleVoice={() => {
                  const next = !voiceSettings.enabled;
                  if (!next) SpeechService.stopSpeaking();
                  handleSaveVoiceSettings({ ...voiceSettings, enabled: next });
                }}
                streamEnabled={Boolean(voiceSettings.stream)}
                onToggleStream={handleToggleStream}
                isQwen={(voiceSettings.engine || 'qwen3') === 'qwen3'}
                currentModel={currentModel}
                onSelectModel={handleSelectModel}
                modelOptions={modelOptions}
                currentProvider={currentProvider}
                disabled={isProcessing}
              />
            </main>

            {/* Right Companion Panel: Kurisu Live Stage */}
            <CompanionPanel
              emotion={currentEmotion}
              pose={currentPose}
              camera={currentCamera}
              isProcessing={isProcessing}
              memoryPulse={memoryPulse}
              isSpeaking={isSpeaking}
              isListening={isListening}
              scanlines={scanlines}
              personaName={persona.name}
            />
          </>
        ) : (
          /* ================= VIEW 2: VISUAL NOVEL CALL MODE (Cinematic Fullscreen) ================= */
          <main className="flex-1 flex flex-col justify-between items-center relative overflow-hidden">
            {/* Center Character Stage */}
            <div className="relative flex-1 w-full min-h-0 overflow-hidden flex items-center justify-center">
              <AmadeusSpriteView
                emotion={currentEmotion}
                pose={currentPose}
                camera={currentCamera}
                isListening={isListening}
                isProcessing={isProcessing}
                memoryPulse={memoryPulse}
                isSpeaking={isSpeaking}
                scanlines={scanlines}
                className="h-full w-full"
              />
            </div>

            {/* Bottom Section: Voice Oscilloscope, Subtitles & Control Bar */}
            <div className="w-full bg-gradient-to-t from-[#08090d] via-[#0c0e12]/95 to-transparent px-4 pb-2 z-20 space-y-2">
              {/* Atmospheric Voice Oscilloscope prominently above subtitles in Call Mode */}
              <div className="w-full max-w-4xl mx-auto">
                <AudioOscilloscope
                  isActive={isSpeaking}
                  isListening={isListening}
                  className="h-12 w-full"
                />
              </div>

              {/* Subtitle Dialogue Box */}
              <SubtitleBox
                speakerName={persona.name}
                text={currentSubtitle}
                emotion={currentEmotion}
                isProcessing={isProcessing}
                onTopicClick={handleSendMessage}
              />

              {/* 100% Iconic Call Control Bar */}
              <ControlBar
                onSendMessage={handleSendMessage}
                isListening={isListening}
                onToggleMic={handleToggleMic}
                voiceEnabled={voiceSettings.enabled}
                onToggleVoice={() => {
                  const next = !voiceSettings.enabled;
                  if (!next) SpeechService.stopSpeaking();
                  handleSaveVoiceSettings({ ...voiceSettings, enabled: next });
                }}
                streamEnabled={Boolean(voiceSettings.stream)}
                onToggleStream={handleToggleStream}
                isQwen={(voiceSettings.engine || 'qwen3') === 'qwen3'}
                onOpenMemory={() => setIsMemoryModalOpen(true)}
                onOpenSettings={() => setIsSettingsModalOpen(true)}
                onEndCall={handleEndCall}
                disabled={isProcessing}
              />
            </div>
          </main>
        )}
      </div>

      {/* Modais Carregados Sob Demanda (Lazy Loaded) */}
      <React.Suspense fallback={null}>
        {isMemoryModalOpen && (
          <MemoryInspectorModal
            isOpen={isMemoryModalOpen}
            onClose={() => setIsMemoryModalOpen(false)}
            persona={persona}
            recalledMemoryIds={recalledMemoryIds}
            onMemoryAdded={() => setPersona(MemoryService.getPersona(persona.id))}
          />
        )}

        {isSettingsModalOpen && (
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            apiKey={apiKey}
            onSaveApiKey={handleSaveApiKey}
            voiceSettings={voiceSettings}
            onSaveVoiceSettings={handleSaveVoiceSettings}
            scanlines={scanlines}
            onToggleScanlines={handleToggleScanlines}
          />
        )}

        {isLegalModalOpen && (
          <LegalNoticeModal
            isOpen={isLegalModalOpen}
            onClose={() => setIsLegalModalOpen(false)}
          />
        )}
      </React.Suspense>
    </div>
  );
};
