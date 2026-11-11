import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Zap,
  Brain,
  Settings,
  PhoneOff,
  Headphones,
  Square,
  Send,
} from 'lucide-react';
import { MicMode } from '../types/amadeus';
import { getUiText } from '../i18n';

interface ControlBarProps {
  onSendMessage: (message: string) => void;
  isListening: boolean;
  onToggleMic: () => void;
  micMode?: MicMode;
  onToggleMicMode?: () => void;
  interimTranscript?: string;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  isSpeaking?: boolean;
  onStopSpeaking?: () => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
  onEndCall: () => void;
  streamEnabled?: boolean;
  onToggleStream?: () => void;
  isQwen?: boolean;
  disabled?: boolean;
  lang?: string;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  onSendMessage,
  isListening,
  onToggleMic,
  micMode = 'ptt',
  onToggleMicMode,
  interimTranscript = '',
  voiceEnabled,
  onToggleVoice,
  isSpeaking = false,
  onStopSpeaking,
  onOpenMemory,
  onOpenSettings,
  onEndCall,
  streamEnabled = false,
  onToggleStream,
  isQwen = false,
  disabled = false,
  lang,
}) => {
  const t = getUiText(lang).controls;
  const [inputValue, setInputValue] = useState('');

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || disabled) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-2.5 pt-2 pb-3 px-2 z-30 select-none font-mono">
      {/* Left Astrolabe Ring Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Astrolabe Mic Toggle */}
        <button
          type="button"
          onClick={onToggleMic}
          disabled={disabled && !isListening}
          title={
            isListening
              ? t.micPttTitle
              : micMode === 'hands_free'
                ? t.micVadTitle
                : t.micPttTitle
          }
          className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all border ${
            isListening
              ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.5)] animate-pulse'
              : 'bg-[#120e0b] border-orange-500/50 text-orange-400 hover:border-orange-400 hover:scale-105'
          }`}
        >
          <span className="absolute inset-1 rounded-full border border-dashed border-amber-500/40 pointer-events-none" />
          {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        {/* PTT vs Hands-Free VAD Toggle */}
        {onToggleMicMode && (
          <button
            type="button"
            onClick={onToggleMicMode}
            title={
              t.modeToggleTitle
            }
            className={`h-9 px-2.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition-all border ${
              micMode === 'hands_free'
                ? 'bg-[#0c202e] border-sky-400/60 text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.3)]'
                : 'bg-[#120e0b] border-amber-900/60 text-zinc-400 hover:text-amber-200 hover:border-orange-500/50'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>{micMode === 'hands_free' ? 'VAD' : 'PTT'}</span>
          </button>
        )}

        {/* Manual Barge-In / Cut Voice Button */}
        {isSpeaking && onStopSpeaking && (
          <button
            type="button"
            onClick={onStopSpeaking}
            title={t.stopVoiceTitle}
            className="copper-capsule px-3.5 py-1.5 flex items-center gap-1.5 text-amber-300 hover:text-white border-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.45)] animate-pulse"
          >
            <Square className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="engraved-serif text-[10px] font-bold tracking-widest">CORTAR VOZ</span>
          </button>
        )}
      </div>

      {/* Center Input + Metallic TRANSMIT Capsule */}
      <form onSubmit={handleSend} className="w-full flex-1 flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={
            interimTranscript
              ? `[VOZ] ${interimTranscript}`
              : isListening
                ? micMode === 'hands_free'
                  ? t.placeholderListeningVad
                  : t.placeholderListeningPtt
                : disabled
                  ? t.placeholderProcessing
                  : t.placeholderDefault
          }
          disabled={disabled}
          className="flex-1 h-10 bg-[#080706]/95 border border-amber-900/60 focus:border-orange-400 rounded-full px-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none font-sans shadow-inner transition-colors"
        />
        <button
          type="submit"
          disabled={disabled || !inputValue.trim()}
          title={t.sendTitle}
          className="copper-capsule h-10 px-4 flex items-center gap-1.5 text-amber-200 hover:text-white disabled:opacity-40 shrink-0"
        >
          <Send className="w-3.5 h-3.5 text-orange-400" />
          <span className="engraved-serif text-xs font-bold tracking-widest">{t.sendBtn}</span>
        </button>
      </form>

      {/* Right Astrolabe Ring Actions + Metallic Red CANCEL Pill */}
      <div className="flex items-center gap-2 shrink-0">
        {isQwen && onToggleStream && (
          <button
            type="button"
            onClick={onToggleStream}
            title={
              t.streamTitle
            }
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all border ${
              streamEnabled
                ? 'bg-[#0c202e] border-sky-400/60 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                : 'bg-[#120e0b] border-amber-900/60 text-zinc-400 hover:text-amber-200'
            }`}
          >
            <Zap className="w-4 h-4" />
          </button>
        )}

        {/* TTS Voice Toggle */}
        <button
          type="button"
          onClick={onToggleVoice}
          title={voiceEnabled ? t.voiceOnTitle : t.voiceOffTitle}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all border ${
            voiceEnabled
              ? 'bg-[#201509] border-orange-500/60 text-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.3)]'
              : 'bg-[#120e0b] border-amber-900/60 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Memory Cortex Inspector */}
        <button
          type="button"
          onClick={onOpenMemory}
          title={t.memoryBtnTitle}
          className="w-9 h-9 rounded-full bg-[#120e0b] border border-amber-900/60 text-sky-400 hover:text-white hover:border-sky-400/60 transition-colors flex items-center justify-center"
        >
          <Brain className="w-4 h-4" />
        </button>

        {/* Settings Workbench */}
        <button
          type="button"
          onClick={onOpenSettings}
          title={t.settingsBtnTitle}
          className="w-9 h-9 rounded-full bg-[#120e0b] border border-amber-900/60 text-zinc-300 hover:text-orange-400 hover:border-orange-500/60 transition-colors flex items-center justify-center"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Metallic Red CANCEL Pill */}
        <button
          type="button"
          onClick={onEndCall}
          title={t.endCallTitle}
          className="h-9 px-3.5 rounded-full bg-gradient-to-b from-rose-900/80 to-black border border-rose-500/60 text-rose-200 hover:text-white hover:border-rose-400 shadow-[0_0_14px_rgba(244,63,94,0.35)] transition-all flex items-center gap-1.5"
        >
          <PhoneOff className="w-3.5 h-3.5 text-rose-400" />
          <span className="engraved-serif text-[11px] font-bold tracking-widest">CANCEL</span>
        </button>
      </div>
    </div>
  );
};
