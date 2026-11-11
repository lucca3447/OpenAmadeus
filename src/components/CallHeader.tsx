import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Video,
  Tv,
  Menu,
  Cpu,
  Database,
  RefreshCw,
  Scale,
  Volume2,
  Mic,
  Sliders,
} from 'lucide-react';
import { AIStatus } from '../services/aiService';
import { BackendHealth } from '../services/backendService';
import { AppLanguage, LLMFallbackSettings, SettingsSectionId, VoiceSettings } from '../types/amadeus';
import { getUiText, normalizeAppLang } from '../i18n';

interface CallHeaderProps {
  viewMode?: 'terminal' | 'call';
  onSwitchViewMode?: (mode: 'terminal' | 'call') => void;
  scanlines?: boolean;
  onToggleScanlines?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isCalling: boolean;
  aiStatus: AIStatus;
  personaName: string;
  onNewCall?: () => void;
  backendHealth?: BackendHealth | null;
  onOpenLegal?: () => void;
  voiceSettings?: VoiceSettings;
  llmSettings?: LLMFallbackSettings;
  onOpenSettingsWithSection?: (section: SettingsSectionId) => void;
  ttfaMs?: number | null;
  lang?: string;
  uiLang?: AppLanguage;
  convLang?: AppLanguage;
  onChangeLang?: (lang: AppLanguage) => void;
  onChangeUiLang?: (lang: AppLanguage) => void;
  onChangeConvLang?: (lang: AppLanguage) => void;
  onToggleCanonicalJp?: () => void;
}

export const CallHeader: React.FC<CallHeaderProps> = ({
  viewMode = 'terminal',
  onSwitchViewMode,
  scanlines = false,
  onToggleScanlines,
  isSidebarOpen = true,
  onToggleSidebar,
  isCalling,
  aiStatus,
  personaName,
  onNewCall,
  backendHealth,
  onOpenLegal,
  voiceSettings,
  llmSettings,
  onOpenSettingsWithSection,
  ttfaMs,
  lang,
  uiLang,
  convLang,
  onChangeLang,
  onChangeUiLang,
  onChangeConvLang,
  onToggleCanonicalJp,
}) => {
  const effectiveUiLang = uiLang ? normalizeAppLang(uiLang) : normalizeAppLang(lang);
  const effectiveConvLang = convLang ? normalizeAppLang(convLang) : normalizeAppLang(voiceSettings?.lang || lang);
  const t = getUiText(effectiveUiLang).header;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isCalling) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isCalling]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const activeEngineLabel =
    voiceSettings?.engine === 'kokoro'
      ? 'Kokoro 82M'
      : voiceSettings?.engine === 'edge_rvc'
        ? 'Edge + RVC'
        : 'Qwen3 1.7B';

  const isTtsStrict = voiceSettings?.allowTtsFallback === false;
  const isLlmStrict = llmSettings?.allowModelFallback === false;
  const isSttDedicated = voiceSettings?.sttKeyMode === 'separate';

  const aiLabel =
    aiStatus.kind === 'online'
      ? aiStatus.model.split('/').pop()?.slice(0, 16) || 'ONLINE'
      : aiStatus.kind === 'pending'
        ? t.pendingBadge
        : aiStatus.kind === 'error'
          ? t.errorBadge
          : 'OFFLINE';

  return (
    <header className="relative z-30 h-14 border-b border-orange-500/30 bg-[#0d0c0e]/95 backdrop-blur-md px-4 flex items-center justify-between font-mono select-none">
      {/* Left: Sidebar Toggle & OpenAmadeus Clockwork Brand */}
      <div className="flex items-center gap-3">
        {onToggleSidebar && viewMode === 'terminal' && (
          <button
            onClick={onToggleSidebar}
            title={t.sidebarToggleTitle}
            className="p-1.5 rounded border border-zinc-800 bg-zinc-900/90 text-orange-400 hover:text-white hover:border-orange-500 transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2.5">
          {/* Clockwork Orbital Gear Emblem */}
          <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
            <svg className="w-9 h-9 spin-cw-slow" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#f97316" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.75" />
              <circle cx="32" cy="32" r="21" fill="none" stroke="#fbbf24" strokeWidth="1" opacity="0.45" />
              <path d="M32 2 L32 9 M32 55 L32 62 M2 32 L9 32 M55 32 L62 32" stroke="#f97316" strokeWidth="2" />
            </svg>
            <span className="absolute engraved-serif font-bold text-orange-400 text-xs tracking-tighter">OA</span>
          </div>
          <div className="flex flex-col">
            <span className="engraved-serif font-bold text-sm tracking-widest text-amber-100 leading-none">
              OPEN<span className="text-orange-400">AMADEUS</span>
            </span>
            <span className="text-[9px] text-zinc-400 font-mono leading-tight mt-0.5 uppercase tracking-widest">
              {isCalling ? `NEURAL WORKBENCH • ${personaName.toUpperCase()} (${formatTimer(elapsedSeconds)})` : 'NEURAL COMPANION ARCHITECTURE'}
            </span>
          </div>
        </div>
      </div>

      {/* Center: View Mode Switcher */}
      <div className="flex items-center gap-3">
        {onSwitchViewMode && (
          <div className="flex items-center p-0.5 rounded border border-amber-900/50 bg-[#080706]">
            <button
              onClick={() => onSwitchViewMode('terminal')}
              title={t.viewTerminalTitle}
              className={`px-2.5 py-1 rounded-sm text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                viewMode === 'terminal'
                  ? 'bg-orange-500 text-black shadow-[0_0_12px_rgba(249,115,22,0.5)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.viewTerminal}</span>
            </button>
            <button
              onClick={() => onSwitchViewMode('call')}
              title={t.viewCallTitle}
              className={`px-2.5 py-1 rounded-sm text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                viewMode === 'call'
                  ? 'bg-orange-500 text-black shadow-[0_0_12px_rgba(249,115,22,0.5)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.viewCall}</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: Interactive Subsystem Status Pills & Workbench Controls */}
      <div className="flex items-center gap-1.5 text-xs">
        {/* LLM Subsystem Pill */}
        <button
          type="button"
          onClick={() => onOpenSettingsWithSection?.('cortex')}
          title={t.openCortexTitle}
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 hover:border-orange-500/50 transition-colors"
        >
          <Cpu className={`w-3.5 h-3.5 ${aiStatus.kind === 'error' ? 'text-rose-400' : 'text-orange-400'}`} />
          <span className="text-[11px] text-zinc-200 font-medium">{aiLabel}</span>
          <span
            className={`text-[9px] px-1.5 py-0.2 rounded border uppercase ${
              isLlmStrict
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            {isLlmStrict ? 'Fixo' : 'Cascata'}
          </span>
        </button>

        {/* TTS Subsystem Pill */}
        <button
          type="button"
          onClick={() => onOpenSettingsWithSection?.('voice')}
          title={t.openAudioTitle}
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 hover:border-orange-500/50 transition-colors"
        >
          <Volume2 className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] text-zinc-200 font-medium">{activeEngineLabel}</span>
          <span
            className={`text-[9px] px-1.5 py-0.2 rounded border uppercase ${
              isTtsStrict
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            {isTtsStrict ? 'Estrito' : 'Cascata'}
          </span>
          {ttfaMs != null && (
            <span
              title={t.ttfaTitle}
              className="text-[9px] px-1.5 py-0.2 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            >
              {ttfaMs}ms
            </span>
          )}
        </button>

        {/* Whisper STT Subsystem Pill */}
        <button
          type="button"
          onClick={() => onOpenSettingsWithSection?.('whisper')}
          title="Configurar Whisper STT, Chave Dedicada e VAD"
          className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 hover:border-orange-500/50 transition-colors"
        >
          <Mic className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] text-zinc-200 font-medium">Whisper</span>
          <span
            className={`text-[9px] px-1.5 py-0.2 rounded border uppercase ${
              isSttDedicated
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            {isSttDedicated ? t.sttDedicated : t.sttUnified}
          </span>
        </button>

        {/* ChromaDB + SQLite indicator */}
        {backendHealth && (
          <span
            title={`${t.ragStorageTitle}: ChromaDB (${backendHealth.chromaCount} vetores) / SQLite (${backendHealth.totalSessions})`}
            className="hidden 2xl:flex items-center gap-1 px-2 py-1 rounded border border-sky-500/30 bg-zinc-900/90 text-[10px] text-sky-400"
          >
            <Database className="w-3 h-3" />
            <span>RAG</span>
          </span>
        )}

        {/* Dual Language selectors: UI & Conversation */}
        {onChangeUiLang ? (
          <div className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 hover:border-amber-500/50 rounded px-1.5 py-1 transition-colors">
            <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase select-none">{t.badgeUi || 'UI'}:</span>
            <select
              value={effectiveUiLang}
              onChange={(e) => onChangeUiLang(e.target.value as AppLanguage)}
              title={t.uiLangSelectorTitle}
              aria-label={t.uiLangSelectorTitle}
              className="bg-transparent text-[11px] font-bold text-amber-200 focus:outline-none cursor-pointer"
            >
              <option value="pt" className="bg-zinc-900 text-zinc-100">PT</option>
              <option value="en" className="bg-zinc-900 text-zinc-100">EN</option>
              <option value="ja" className="bg-zinc-900 text-zinc-100">JA</option>
            </select>
          </div>
        ) : onChangeLang ? (
          <select
            value={effectiveUiLang}
            onChange={(e) => onChangeLang(e.target.value as AppLanguage)}
            title={t.langSelectorTitle}
            aria-label={t.langSelectorTitle}
            className="bg-zinc-900/90 border border-zinc-800 hover:border-orange-500/50 text-[11px] font-bold text-amber-200 rounded px-1.5 py-1 focus:outline-none"
          >
            <option value="pt">PT-BR</option>
            <option value="en">EN</option>
            <option value="ja">JA</option>
          </select>
        ) : null}

        {onChangeConvLang && (
          <div className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 hover:border-orange-500/50 rounded px-1.5 py-1 transition-colors">
            <span className="text-[9px] font-mono font-bold text-orange-400 uppercase select-none">{t.badgeTalk || 'FALA'}:</span>
            <select
              value={effectiveConvLang}
              onChange={(e) => onChangeConvLang(e.target.value as AppLanguage)}
              title={t.convLangSelectorTitle}
              aria-label={t.convLangSelectorTitle}
              className="bg-transparent text-[11px] font-bold text-orange-300 focus:outline-none cursor-pointer"
            >
              <option value="pt" className="bg-zinc-900 text-zinc-100">PT</option>
              <option value="en" className="bg-zinc-900 text-zinc-100">EN</option>
              <option value="ja" className="bg-zinc-900 text-zinc-100">JA</option>
            </select>
          </div>
        )}

        {onToggleCanonicalJp && effectiveConvLang !== 'ja' && (
          <button
            type="button"
            onClick={onToggleCanonicalJp}
            title={t.jpVoiceToggleTitle}
            aria-pressed={Boolean(voiceSettings?.canonicalJpVoice)}
            className={`px-2 py-1 rounded text-[11px] font-bold border transition-all ${
              voiceSettings?.canonicalJpVoice
                ? 'bg-[#201509] border-orange-500 text-orange-400'
                : 'bg-zinc-900/90 border-zinc-800 text-zinc-400 hover:text-orange-400'
            }`}
          >
            {t.jpVoiceBadge}
          </button>
        )}

        {/* CRT Scanlines Toggle */}
        {onToggleScanlines && (
          <button
            onClick={onToggleScanlines}
            title={t.scanlinesTitle}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-all text-[11px] font-bold ${
              scanlines
                ? 'bg-[#201509] border border-orange-500 text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.3)]'
                : 'bg-zinc-900/90 border border-zinc-800 text-zinc-400 hover:text-orange-400 hover:border-orange-500/50'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CRT</span>
          </button>
        )}

        {/* Legal Notice */}
        {onOpenLegal && (
          <button
            onClick={onOpenLegal}
            title={t.legalTitle}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-400 hover:text-orange-400 hover:border-orange-500/50 transition-colors text-[11px] font-bold"
          >
            <Scale className="w-3.5 h-3.5 text-orange-400" />
            <span className="hidden sm:inline">LEGAL</span>
          </button>
        )}

        {/* New Session / Reset Call */}
        {onNewCall && viewMode === 'call' && (
          <button
            onClick={onNewCall}
            title={t.newSessionTitle}
            className="hidden sm:flex items-center gap-1 px-2 py-1 rounded border border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-orange-400 hover:border-orange-500/50 transition-colors text-[10px] font-bold"
          >
            <RefreshCw className="w-3 h-3 text-orange-400" />
            <span>REINICIAR</span>
          </button>
        )}

        {/* Direct Setup Menu Capsule Button */}
        {onOpenSettingsWithSection && (
          <button
            type="button"
            onClick={() => onOpenSettingsWithSection('cortex')}
            title={t.openSetupTitle}
            className="copper-capsule px-3 py-1 flex items-center gap-1.5 text-[11px] font-bold text-amber-200"
          >
            <Sliders className="w-3.5 h-3.5 text-orange-400" />
            <span>SETUP</span>
          </button>
        )}
      </div>
    </header>
  );
};
