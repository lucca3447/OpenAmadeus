import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  Zap,
  ChevronDown,
  Headphones,
  Square,
  Send,
  PhoneOff,
  AlertTriangle,
} from 'lucide-react';

import { MODEL_OPTIONS, ModelOption, AIProvider } from '../services/aiService';
import { MicMode } from '../types/amadeus';
import { getUiText } from '../i18n';

interface PromptBarProps {
  onSendMessage: (text: string) => void;
  isListening: boolean;
  onToggleMic: () => void;
  micMode?: MicMode;
  onToggleMicMode?: () => void;
  interimTranscript?: string;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  isSpeaking?: boolean;
  onStopSpeaking?: () => void;
  currentModel: string;
  onSelectModel: (model: string) => void;
  modelOptions?: ModelOption[];
  currentProvider?: AIProvider;
  streamEnabled?: boolean;
  onToggleStream?: () => void;
  isQwen?: boolean;
  onEndCall?: () => void;
  disabled?: boolean;
  lang?: string;
}

export const PromptBar: React.FC<PromptBarProps> = ({
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
  currentModel,
  onSelectModel,
  modelOptions,
  currentProvider: _currentProvider,
  streamEnabled = false,
  onToggleStream,
  isQwen = false,
  onEndCall,
  disabled = false,
  lang,
}) => {
  const ui = getUiText(lang);
  const t = ui.controls;
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || disabled) return;
    onSendMessage(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFillTopic = (topic: string) => {
    setInput(topic);
    textareaRef.current?.focus();
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-4 pt-2 z-20 font-mono select-none">
      {/* Topics Carousel */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 text-[11px] scrollbar-none">
        <span className="text-zinc-400 font-bold flex items-center gap-1 mr-1 shrink-0">
          <Sparkles className="w-3 h-3 text-orange-400" />
          <span>{ui.subtitle.quickTopicsLabel}</span>
        </span>
        {ui.chatFeed.suggestions.map((topic, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleFillTopic(topic.prompt)}
            className="px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300 hover:text-orange-400 hover:border-orange-500/60 transition-colors whitespace-nowrap font-sans text-xs"
          >
            {topic.label}
          </button>
        ))}
      </div>

      {/* Main Prompt Bar Container */}
      <div className="widescreen-steel-deck rounded-lg p-3 transition-all">
        <form onSubmit={handleSend} className="flex flex-col gap-2">
          {/* Multiline Auto-resizing Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
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
            className="w-full bg-transparent border-none text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none px-2 py-1 font-sans max-h-36 leading-relaxed"
          />

          {/* Bottom Tools Row */}
          <div className="flex items-center justify-between pt-2 border-t border-amber-900/30">
            {/* Model Selector Pill Dropdown */}
            <div className="flex items-center gap-2">
              <div className="relative flex items-center">
                <select
                  value={currentModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  disabled={disabled}
                  className="appearance-none bg-[#0a0807] border border-amber-900/60 text-amber-100 text-[11px] font-mono rounded pl-2.5 pr-6 py-1 focus:outline-none focus:border-orange-400 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {(modelOptions && modelOptions.length > 0 ? modelOptions : MODEL_OPTIONS).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {'isDecommissioned' in opt && opt.isDecommissioned ? `[Desativado] ${opt.label}` : opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-orange-400 absolute right-1.5 top-2 pointer-events-none" />
              </div>
              {modelOptions?.find((m) => m.id === currentModel && 'isDecommissioned' in m && m.isDecommissioned) && (
                <span title="Modelo descontinuado no provedor">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                </span>
              )}
            </div>

            {/* Action Buttons: Barge-In, Mic, VAD/PTT, Stream, Sound & Transmit */}
            <div className="flex items-center gap-1.5">
              {/* Manual Barge-In / Cut Voice Button */}
              {isSpeaking && onStopSpeaking && (
                <button
                  type="button"
                  onClick={onStopSpeaking}
                  title={t.stopVoiceTitle}
                  className="copper-capsule px-3 py-1 flex items-center gap-1.5 text-amber-300 hover:text-white border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.45)] animate-pulse"
                >
                  <Square className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span className="engraved-serif text-[10px] font-bold tracking-widest">CORTAR VOZ</span>
                </button>
              )}

              {/* Mic Toggle */}
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
                className={`p-1.5 rounded-full border transition-all ${
                  isListening
                    ? 'border-sky-400 bg-sky-500/20 text-sky-300 animate-pulse shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                    : 'border-amber-900/60 bg-[#120e0b] text-zinc-400 hover:text-orange-400 hover:border-orange-500/50'
                }`}
              >
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
                  className={`px-2 py-1 rounded-full border text-[10px] font-bold flex items-center gap-1 transition-all ${
                    micMode === 'hands_free'
                      ? 'border-sky-400/60 bg-[#0c202e] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.3)]'
                      : 'border-amber-900/60 bg-[#120e0b] text-zinc-400 hover:text-amber-200'
                  }`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>{micMode === 'hands_free' ? 'VAD' : 'PTT'}</span>
                </button>
              )}

              {/* Quick Stream vs Complete WAV Toggle */}
              {isQwen && onToggleStream && (
                <button
                  type="button"
                  onClick={onToggleStream}
                  title={
                    t.streamTitle
                  }
                  className={`p-1.5 rounded-full border transition-all ${
                    streamEnabled
                      ? 'border-sky-400/60 bg-[#0c202e] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                      : 'border-amber-900/60 bg-[#120e0b] text-zinc-400 hover:text-amber-200'
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
                className={`p-1.5 rounded-full border transition-all ${
                  voiceEnabled
                    ? 'border-orange-500/60 bg-[#201509] text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.3)]'
                    : 'border-amber-900/60 bg-[#120e0b] text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              {/* Metallic TRANSMIT Capsule Button */}
              <button
                type="submit"
                disabled={disabled || !input.trim()}
                title={t.sendTitle}
                className="copper-capsule h-8 px-3.5 flex items-center gap-1.5 text-amber-200 hover:text-white disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5 text-orange-400" />
                <span className="engraved-serif text-[11px] font-bold tracking-widest">{t.sendBtn}</span>
              </button>

              {/* Metallic Red CANCEL Pill */}
              {onEndCall && (
                <button
                  type="button"
                  onClick={onEndCall}
                  title={t.endCallTitle}
                  className="h-8 px-3 rounded-full bg-gradient-to-b from-rose-900/80 to-black border border-rose-500/60 text-rose-200 hover:text-white hover:border-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)] transition-all flex items-center gap-1.5"
                >
                  <PhoneOff className="w-3.5 h-3.5 text-rose-400" />
                  <span className="engraved-serif text-[11px] font-bold tracking-widest">CANCEL</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
