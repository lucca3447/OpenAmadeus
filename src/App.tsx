import React, { useState, useEffect, useRef } from 'react';
import {
  CameraFraming,
  CharacterPose,
  ChatMessage,
  Emotion,
  PersonaProfile,
  VoiceSettings,
  CallSession,
  MemoryItem,
  LLMFallbackSettings,
  SettingsSectionId,
} from './types/amadeus';
import { MemoryService } from './services/memoryService';
import {
  AIService,
  AIStatus,
  ModelOption,
  OFFLINE_MODEL_ID,
  getProviderFromKey,
  getModelOptionsForKey,
} from './services/aiService';
import { BackendService, BackendHealth } from './services/backendService';
import { SpeechService } from './services/speechService';
import { CallHeader } from './components/CallHeader';
import { AmadeusSpriteView } from './components/AmadeusSpriteView';
import { preloadPrimarySprites, preloadEmotionSprites } from './services/spriteCatalog';
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
  'Olá! Conexão neural estabelecida com o OpenAmadeus. Aqui é Makise Kurisu. O que você gostaria de analisar ou discutir hoje?';

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

  const [llmSettings, setLlmSettings] = useState<LLMFallbackSettings>(() => {
    const raw = localStorage.getItem('amadeus_llm_settings');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      allowModelFallback: true,
      allowOfflineSimulatorFallback: true,
    };
  });

  const handleSaveLlmSettings = (next: LLMFallbackSettings) => {
    setLlmSettings(next);
    localStorage.setItem('amadeus_llm_settings', JSON.stringify(next));
  };

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
  const leadTransitionTimerRef = useRef<number | null>(null);
  const [defaultCamera, setDefaultCamera] = useState<'auto' | 'closeup' | 'medium' | 'full'>(() => {
    const saved = localStorage.getItem('amadeus_default_camera');
    return saved === 'closeup' || saved === 'medium' || saved === 'full' ? saved : 'auto';
  });

  const handleSaveDefaultCamera = (cam: 'auto' | 'closeup' | 'medium' | 'full') => {
    setDefaultCamera(cam);
    localStorage.setItem('amadeus_default_camera', cam);
  };

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
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [micError, setMicError] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);

  const [scanlines, setScanlines] = useState<boolean>(() => {
    const val = localStorage.getItem('amadeus_scanlines');
    return val !== null ? val === 'true' : false;
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
      micMode: 'ptt',
      sttKeyMode: 'unified',
      separateGroqSttKey: localStorage.getItem('amadeus_groq_stt_key') || '',
      allowSttWebSpeechFallback: true,
      vadSensitivity: 1.0,
      allowTtsFallback: true,
      allowedTtsFallbacks: ['qwen_local', 'kokoro', 'edge_rvc', 'web_speech'],
    };
  });

  // Modal states
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('cortex');
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);

  const handleOpenSettingsWithSection = (section: SettingsSectionId = 'cortex') => {
    setSettingsSection(section);
    setIsSettingsModalOpen(true);
  };

  // Sync memories from Python backend when online, fallback to LocalStorage when offline
  const refreshPersonaMemories = async () => {
    const health = await BackendService.checkHealth();
    setBackendHealth(health);
    if (health) {
      const remoteMemories = await BackendService.getMemories();
      if (remoteMemories.length > 0) {
        const localCanonical = new Map(
          MemoryService.getPersona('kurisu').memories.map((m) => [m.id, m.triggerKeywords])
        );
        const hydrated = remoteMemories.map((m) => ({
          ...m,
          triggerKeywords:
            m.triggerKeywords && m.triggerKeywords.length > 0
              ? m.triggerKeywords
              : localCanonical.get(m.id) || [],
        }));
        setPersona((prev) => ({ ...prev, memories: hydrated }));
        return;
      }
    }
    setPersona(MemoryService.getPersona('kurisu'));
  };

  // Check Python backend health on mount & preload baseline sprites early
  useEffect(() => {
    preloadPrimarySprites('closeup');
    BackendService.checkHealth().then((health) => {
      setBackendHealth(health);
      if (health) {
        refreshPersonaMemories();
        BackendService.listSessions().then((remoteSessions) => {
          if (remoteSessions && remoteSessions.length > 0) {
            const localLogs = MemoryService.getSessionLogs();
            const mergedMap = new Map<string, CallSession>();
            remoteSessions.forEach((s) => mergedMap.set(s.id, s));
            localLogs.forEach((s) => mergedMap.set(s.id, s));
            const merged = Array.from(mergedMap.values()).sort(
              (a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0)
            );
            localStorage.setItem('amadeus_sessions_log', JSON.stringify(merged.slice(0, 30)));
            setSessions(merged.slice(0, 30));
          }
        });
      }
    });
  }, []);

  // Synchronize model options on apiKey changes, and fetch active models in the background
  useEffect(() => {
    const initial = getModelOptionsForKey(apiKey);
    setModelOptions(initial);

    if (!apiKey.trim()) {
      setCurrentModel(OFFLINE_MODEL_ID);
      localStorage.setItem('amadeus_selected_model', OFFLINE_MODEL_ID);
      return;
    }

    let isMounted = true;
    AIService.fetchLiveModelOptions(apiKey)
      .then((liveModels) => {
        if (!isMounted || liveModels.length === 0) return;
        setModelOptions(liveModels);

        setCurrentModel((prevModel) => {
          if (prevModel === OFFLINE_MODEL_ID) return prevModel;
          const exists = liveModels.some((m) => m.id === prevModel);
          if (!exists) {
            const fallbackId = liveModels[0]?.id || OFFLINE_MODEL_ID;
            const fallbackLabel = liveModels[0]?.label || fallbackId;
            setModelNotice(
              `[Aviso de Provedor] O modelo anteriormente selecionado não está mais disponível. Migrado para ${fallbackLabel}.`
            );
            localStorage.setItem('amadeus_selected_model', fallbackId);
            return fallbackId;
          }
          return prevModel;
        });
      })
      .catch((err) => {
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

  const handleToggleMicMode = () => {
    const next = (voiceSettings.micMode || 'ptt') === 'ptt' ? 'hands_free' : 'ptt';
    handleSaveVoiceSettings({ ...voiceSettings, micMode: next });
  };

  const handleStopSpeaking = () => {
    SpeechService.stopSpeaking();
    setIsSpeaking(false);
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
      allowTtsFallback: voiceSettings.allowTtsFallback !== false,
      allowedTtsFallbacks: voiceSettings.allowedTtsFallbacks || [
        'qwen_local',
        'kokoro',
        'edge_rvc',
        'web_speech',
      ],
      onStart: () => setIsSpeaking(true),
      onEnd: () => setIsSpeaking(false),
      onError: (msg) => {
        setIsSpeaking(false);
        setErrorNotice(msg);
      },
    });
  };

  // Process user input
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isProcessing) return;

    const matched = MemoryService.matchMemories(text, persona);

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
    setSessions(MemoryService.getSessionLogs());
    setErrorNotice(null);
    setIsProcessing(true);
    setCurrentEmotion('thinking');

    try {
      const result = await AIService.queryAmadeus(
        text,
        persona,
        matched,
        apiKey,
        nextHistory,
        sessionId,
        currentModel,
        llmSettings
      );

      const finalRecalledIds = result.recalledMemories ?? matched.map((m: MemoryItem) => m.id);
      setRecalledMemoryIds(finalRecalledIds);
      if (finalRecalledIds.length > 0) setMemoryPulse((p) => p + 1);

      setAiStatus(result.status);
      setCurrentSubtitle(result.response);
      if (leadTransitionTimerRef.current !== null) {
        window.clearTimeout(leadTransitionTimerRef.current);
        leadTransitionTimerRef.current = null;
      }

      const finalPose = result.pose || 'default';
      if (result.leadEmotion && (result.leadEmotion !== result.emotion || (result.leadPose && result.leadPose !== finalPose))) {
        const initialPose = result.leadPose || 'default';
        preloadEmotionSprites(result.leadEmotion, initialPose, result.camera);
        preloadEmotionSprites(result.emotion, finalPose, result.camera);
        setCurrentEmotion(result.leadEmotion);
        setCurrentPose(initialPose);
        setCurrentCamera(result.camera);
        leadTransitionTimerRef.current = window.setTimeout(() => {
          setCurrentEmotion(result.emotion);
          setCurrentPose(finalPose);
          setCurrentCamera(result.camera);
          leadTransitionTimerRef.current = null;
        }, 1500);
      } else {
        setCurrentEmotion(result.emotion);
        setCurrentPose(finalPose);
        setCurrentCamera(result.camera);
      }

      if (result.decommissionNotice) {
        setModelNotice(result.decommissionNotice);
      }
      if (result.fallbackModel && result.fallbackModel !== currentModel) {
        setCurrentModel(result.fallbackModel);
        localStorage.setItem('amadeus_selected_model', result.fallbackModel);
      }

      if (result.isError) {
        setErrorNotice(result.response);
        setCurrentEmotion('worried');
        setCurrentPose('default');
        return;
      }

      if (result.learnedMemory) {
        if (result.learnedMemory.id) {
          await refreshPersonaMemories();
        } else {
          MemoryService.addMemory(persona.id, {
            category: 'user',
            title: result.learnedMemory.title,
            triggerKeywords: [result.learnedMemory.title.toLowerCase()],
            content: result.learnedMemory.content,
            emotionalWeight: result.learnedMemory.emotionalWeight || 'Factual',
            source: 'learned',
          });
          setPersona(MemoryService.getPersona(persona.id));
        }
        setLearnedNotification(`Nova memória gravada: "${result.learnedMemory.title}"`);
      }

      const aiMessage: ChatMessage = {
        id: newId(),
        sender: 'amadeus',
        content: result.response,
        timestamp: Date.now(),
        emotion: result.emotion,
        pose: result.pose,
        camera: result.camera,
        recalledMemories: finalRecalledIds,
      };

      const updatedHistory = [...nextHistory, aiMessage];
      setHistory(updatedHistory);
      MemoryService.saveActiveSession(sessionId, updatedHistory);
      setSessions(MemoryService.getSessionLogs());

      preloadEmotionSprites(result.emotion, result.pose, result.camera);

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
    if (leadTransitionTimerRef.current !== null) {
      window.clearTimeout(leadTransitionTimerRef.current);
      leadTransitionTimerRef.current = null;
    }
    SpeechService.stopSpeaking();
    setIsSpeaking(false);
    setErrorNotice(null);
    if (history.length > 0) {
      MemoryService.saveActiveSession(sessionId, history, false);
    }
    const newSessionId = MemoryService.archiveAndStartNewSession(history);
    setSessionId(newSessionId);

    const initialMsgs: ChatMessage[] = [
      {
        id: newId(),
        sender: 'amadeus',
        content: INITIAL_GREETING,
        timestamp: Date.now(),
        emotion: 'neutral',
        pose: 'default',
      },
    ];
    setHistory(initialMsgs);
    setCurrentSubtitle(INITIAL_GREETING);
    setCurrentEmotion('neutral');
    setCurrentPose('default');
    MemoryService.saveActiveSession(newSessionId, initialMsgs, true);
    setSessions(MemoryService.getSessionLogs());
  };

  // Switch to a previous session from the sidebar (without altering list order)
  const handleSelectSession = async (selectedId: string) => {
    if (selectedId === sessionId) return;
    SpeechService.stopSpeaking();
    setIsSpeaking(false);
    setErrorNotice(null);

    if (history.length > 0) {
      MemoryService.saveActiveSession(sessionId, history, false);
    }

    let loaded = MemoryService.loadSession(selectedId);
    if (!loaded || loaded.length === 0) {
      loaded = await BackendService.getSessionMessages(selectedId);
      if (loaded && loaded.length > 0) {
        MemoryService.saveActiveSession(selectedId, loaded, false);
      }
    }

    if (loaded && loaded.length > 0) {
      setSessionId(selectedId);
      setHistory(loaded);
      setSessions(MemoryService.getSessionLogs());
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
    BackendService.deleteSession(delId);
    setSessions(MemoryService.getSessionLogs());
    if (sessionId === delId) {
      handleNewSession();
    }
  };

  // Speech recognition initialization & mic config sync
  const sendRef = useRef(handleSendMessage);
  sendRef.current = handleSendMessage;

  useEffect(() => {
    SpeechService.setMicConfig({
      mode: voiceSettings.micMode || 'ptt',
      apiKey,
      sttKeyMode: voiceSettings.sttKeyMode || 'unified',
      separateGroqSttKey: voiceSettings.separateGroqSttKey || localStorage.getItem('amadeus_groq_stt_key') || '',
      allowSttWebSpeechFallback: voiceSettings.allowSttWebSpeechFallback !== false,
      vadSensitivity: voiceSettings.vadSensitivity ?? 1.0,
    });
  }, [
    voiceSettings.micMode,
    voiceSettings.sttKeyMode,
    voiceSettings.separateGroqSttKey,
    voiceSettings.allowSttWebSpeechFallback,
    voiceSettings.vadSensitivity,
    apiKey,
  ]);

  useEffect(() => {
    SpeechService.initRecognition(
      (transcript) => {
        setInterimTranscript('');
        if (transcript.trim()) sendRef.current(transcript.trim());
      },
      (listening) => {
        setIsListening(listening);
        if (listening) setMicError(null);
        else setInterimTranscript('');
      },
      (message) => setMicError(message),
      (interim) => setInterimTranscript(interim)
    );
  }, []);

  // Spacebar Push-to-Talk shortcut when focus is outside inputs and modals
  useEffect(() => {
    if (callState !== 'connected' || isMemoryModalOpen || isSettingsModalOpen || isLegalModalOpen)
      return;

    const isInteractiveElement = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((voiceSettings.micMode || 'ptt') !== 'ptt' || isProcessing) return;
      if (isInteractiveElement(e.target)) return;
      e.preventDefault();
      SpeechService.startPushToTalk();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if ((voiceSettings.micMode || 'ptt') !== 'ptt') return;
      if (isInteractiveElement(e.target)) return;
      e.preventDefault();
      SpeechService.stopPushToTalk();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [callState, voiceSettings.micMode, isProcessing, isMemoryModalOpen, isSettingsModalOpen, isLegalModalOpen]);

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
        {
          id: newId(),
          sender: 'amadeus',
          content: INITIAL_GREETING,
          timestamp: Date.now(),
          emotion: 'neutral',
          pose: 'default',
        },
      ];
      setHistory(initialMsgs);
      MemoryService.saveActiveSession(sessionId, initialMsgs);
      setSessions(MemoryService.getSessionLogs());
      speak(INITIAL_GREETING);
    } else {
      const lastMsg = [...history].reverse().find((m) => m.sender === 'amadeus');
      if (lastMsg) {
        setCurrentSubtitle(lastMsg.content);
        setCurrentEmotion(lastMsg.emotion || 'neutral');
        setCurrentPose(
          lastMsg.pose || (lastMsg.emotion === 'thinking' ? 'crossed_arms' : 'default')
        );
      }
    }
  };

  // Disconnect Call Handler
  const handleEndCall = () => {
    SpeechService.stopSpeaking();
    SpeechService.stopListening(true);
    setIsSpeaking(false);
    setIsListening(false);
    setInterimTranscript('');
    setCallState('disconnected');
  };

  // Re-dial Call
  const handleRestartCall = () => {
    setCallState('incoming');
  };

  const effectiveCamera = defaultCamera === 'auto' ? currentCamera : defaultCamera;

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
      <div className="relative w-full h-screen flex flex-col items-center justify-center p-6 bg-[#09090b] font-mono text-center select-none">
        <LabBackground scanlines={scanlines} />
        <div className="p-8 border border-amber-900/60 bg-[#0d0c0e]/95 max-w-md w-full space-y-5 shadow-[0_0_35px_rgba(0,0,0,0.9)] z-10">
          <div className="w-12 h-12 rounded-full border border-rose-500/60 bg-rose-950/50 text-rose-400 mx-auto flex items-center justify-center">
            <Phone className="w-6 h-6 rotate-[135deg]" />
          </div>
          <div className="engraved-heading text-rose-400 font-bold text-lg tracking-widest">
            SESSÃO ENCERRADA
          </div>
          <div className="text-xs text-zinc-400 font-sans">
            A sessão neural com Makise Kurisu foi finalizada. O histórico e os vetores sinápticos foram arquivados localmente.
          </div>
          <button
            onClick={handleRestartCall}
            className="copper-capsule w-full py-3 text-amber-200 font-bold text-xs hover:text-white transition-all flex items-center justify-center gap-2"
          >
            <Phone className="w-4 h-4 text-orange-400" />
            <span className="engraved-serif tracking-widest">RECONECTAR AO OPENAMADEUS</span>
          </button>
        </div>
      </div>
    );
  }

  // Render Connected Workspace (Hybrid: Terminal Mode OR Call Mode)
  return (
    <div className="relative w-full h-screen flex flex-col justify-between bg-[#09090b] overflow-hidden select-none font-mono">
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
        voiceSettings={voiceSettings}
        llmSettings={llmSettings}
        onOpenSettingsWithSection={handleOpenSettingsWithSection}
      />

      {/* Microphone problem banner */}
      {micError && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
          <div className="flex items-start gap-2 p-2.5 rounded border border-orange-500/50 bg-[#261505]/95 text-amber-200 text-xs font-sans shadow-lg">
            <MicOff className="w-4 h-4 shrink-0 mt-0.5 text-orange-400" />
            <span className="flex-1">{micError}</span>
            <button
              onClick={() => setMicError(null)}
              className="shrink-0 hover:text-white"
              title="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Real-Time Learning Toast */}
      {learnedNotification && (
        <div className="absolute top-16 right-6 z-50 px-4 py-2 rounded bg-[#1b152b] border border-purple-500 text-purple-200 text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] flex items-center gap-2 animate-bounce font-mono">
          <Sparkles className="w-4 h-4 text-purple-400" />
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
              onOpenSettings={() => handleOpenSettingsWithSection('cortex')}
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
                micMode={voiceSettings.micMode || 'ptt'}
                onToggleMicMode={handleToggleMicMode}
                interimTranscript={interimTranscript}
                voiceEnabled={voiceSettings.enabled}
                onToggleVoice={() => {
                  const next = !voiceSettings.enabled;
                  if (!next) handleStopSpeaking();
                  handleSaveVoiceSettings({ ...voiceSettings, enabled: next });
                }}
                isSpeaking={isSpeaking}
                onStopSpeaking={handleStopSpeaking}
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
              camera={effectiveCamera}
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
                camera={effectiveCamera}
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
              <div className="w-full max-w-5xl mx-auto">
                <AudioOscilloscope
                  isActive={isSpeaking}
                  isListening={isListening}
                  className="h-12 w-full"
                />
              </div>

              {/* Widescreen Brushed Steel Deck Subtitle Box */}
              <SubtitleBox
                speakerName={persona.name}
                text={currentSubtitle}
                emotion={currentEmotion}
                isProcessing={isProcessing}
                onTopicClick={handleSendMessage}
              />

              {/* Clockwork Astrolabe & Metallic Pill Call Control Bar */}
              <ControlBar
                onSendMessage={handleSendMessage}
                isListening={isListening}
                onToggleMic={handleToggleMic}
                micMode={voiceSettings.micMode || 'ptt'}
                onToggleMicMode={handleToggleMicMode}
                interimTranscript={interimTranscript}
                voiceEnabled={voiceSettings.enabled}
                onToggleVoice={() => {
                  const next = !voiceSettings.enabled;
                  if (!next) handleStopSpeaking();
                  handleSaveVoiceSettings({ ...voiceSettings, enabled: next });
                }}
                isSpeaking={isSpeaking}
                onStopSpeaking={handleStopSpeaking}
                streamEnabled={Boolean(voiceSettings.stream)}
                onToggleStream={handleToggleStream}
                isQwen={(voiceSettings.engine || 'qwen3') === 'qwen3'}
                onOpenMemory={() => setIsMemoryModalOpen(true)}
                onOpenSettings={() => handleOpenSettingsWithSection('cortex')}
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
            onMemoryAdded={refreshPersonaMemories}
          />
        )}

        {isSettingsModalOpen && (
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            initialSection={settingsSection}
            apiKey={apiKey}
            onSaveApiKey={handleSaveApiKey}
            voiceSettings={voiceSettings}
            onSaveVoiceSettings={handleSaveVoiceSettings}
            llmSettings={llmSettings}
            onSaveLlmSettings={handleSaveLlmSettings}
            scanlines={scanlines}
            onToggleScanlines={handleToggleScanlines}
            defaultCamera={defaultCamera}
            onSaveDefaultCamera={handleSaveDefaultCamera}
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
