import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Sparkles,
  Zap,
  ChevronDown
} from 'lucide-react';

import { MODEL_OPTIONS, ModelOption, AIProvider } from '../services/aiService';

interface PromptBarProps {
  onSendMessage: (text: string) => void;
  isListening: boolean;
  onToggleMic: () => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  currentModel: string;
  onSelectModel: (model: string) => void;
  modelOptions?: ModelOption[];
  currentProvider?: AIProvider;
  streamEnabled?: boolean;
  onToggleStream?: () => void;
  isQwen?: boolean;
  disabled?: boolean;
}

const SUGGESTED_TOPICS = [
  { label: 'Identidade', prompt: 'Quem é você e qual seu papel no laboratório?' },
  { label: 'Viagem no Tempo', prompt: 'O que você acha sobre viagem no tempo e linhas de mundo?' },
  { label: 'Viktor Chondria', prompt: 'Como funciona sua pesquisa na Viktor Chondria?' },
  { label: 'Dr Pepper', prompt: 'Qual sua opinião sincera sobre refrigerante Dr Pepper?' },
];

export const PromptBar: React.FC<PromptBarProps> = ({
  onSendMessage,
  isListening,
  onToggleMic,
  voiceEnabled,
  onToggleVoice,
  currentModel,
  onSelectModel,
  modelOptions,
  currentProvider: _currentProvider,
  streamEnabled = false,
  onToggleStream,
  isQwen = false,
  disabled = false,
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea height
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
        <span className="text-[#717d96] font-bold flex items-center gap-1 mr-1 shrink-0">
          <Sparkles className="w-3 h-3 text-[#f59e0b]" />
          <span>SUGESTÕES:</span>
        </span>
        {SUGGESTED_TOPICS.map((topic, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleFillTopic(topic.prompt)}
            className="px-2.5 py-1 rounded-full bg-[#181c24] border border-[#272d3c] text-[#cbd5e1] hover:text-[#f59e0b] hover:border-[#f59e0b]/60 transition-colors whitespace-nowrap font-sans text-xs"
          >
            {topic.label}
          </button>
        ))}
      </div>

      {/* Main Prompt Bar Container */}
      <div className="rounded-2xl border border-[#f59e0b]/40 bg-[#0b0d11]/95 backdrop-blur-xl p-2.5 box-glow-nixie transition-all">
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
              isListening
                ? 'Escutando sua fala pelo microfone...'
                : 'Envie uma mensagem para a Kurisu... (Shift+Enter para nova linha)'
            }
            className="w-full bg-transparent border-none text-sm text-[#f8fafc] placeholder-[#64748b] focus:outline-none resize-none px-2 py-1 font-sans max-h-36 leading-relaxed"
          />

          {/* Bottom Tools Row */}
          <div className="flex items-center justify-between pt-1 border-t border-[#1c202a]">
            {/* Model Selector Pill Dropdown */}
            <div className="flex items-center gap-2">
              <div className="relative flex items-center">
                <select
                  value={currentModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  disabled={disabled}
                  className="appearance-none bg-[#161922] border border-[#2a3040] text-[#e2e8f0] text-[11px] font-mono rounded-lg pl-2.5 pr-6 py-1 focus:outline-none focus:border-[#f59e0b] cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {(modelOptions && modelOptions.length > 0 ? modelOptions : MODEL_OPTIONS).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {'isDecommissioned' in opt && opt.isDecommissioned ? `⚠️ [Desativado] ${opt.label}` : opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-[#717d96] absolute right-1.5 top-2 pointer-events-none" />
              </div>
            </div>

            {/* Action Buttons: Mic, Sound & Send */}
            <div className="flex items-center gap-1.5">
              {/* Mic Toggle */}
              <button
                type="button"
                onClick={onToggleMic}
                disabled={disabled}
                title={isListening ? 'Parar Reconhecimento de Voz' : 'Ativar Microfone (STT)'}
                className={`p-2 rounded-lg border transition-all ${
                  isListening
                    ? 'border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8] animate-pulse shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                    : 'border-[#2a3040] bg-[#161922] text-[#94a3b8] hover:text-[#f59e0b] hover:border-[#f59e0b]/50'
                }`}
              >
                {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>

                            {/* Quick Stream vs Complete WAV Toggle */}
              {isQwen && onToggleStream && (
                <button
                  type="button"
                  onClick={onToggleStream}
                  title={
                    streamEnabled
                      ? '⚡ Streaming em Tempo Real Ativo (~500ms) — Clique para alternar para WAV Completo'
                      : '🛡️ Modo WAV Completo Ativo (Estável) — Clique para alternar para Streaming em Tempo Real'
                  }
                  className={`p-2 rounded-lg border transition-all ${
                    streamEnabled
                      ? 'border-[#38bdf8]/60 bg-[#0c202e] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                      : 'border-[#2a3040] bg-[#161922] text-[#64748b] hover:text-[#cbd5e1]'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                </button>
              )}

              {/* TTS Voice Toggle */}
              <button
                type="button"
                onClick={onToggleVoice}
                title={voiceEnabled ? 'Voz da Kurisu Ativa' : 'Voz Silenciada'}
                className={`p-2 rounded-lg border transition-all ${
                  voiceEnabled
                    ? 'border-[#f59e0b]/40 bg-[#201509] text-[#f59e0b] box-glow-nixie'
                    : 'border-[#2a3040] bg-[#161922] text-[#64748b] hover:text-[#cbd5e1]'
                }`}
              >
                {voiceEnabled ? <Volume2 className="w-4 h-4 text-[#f59e0b]" /> : <VolumeX className="w-4 h-4" />}
              </button>

              {/* Send Button: Iconic Circular Amber Arrow Button from Amadeus Login Screen */}
              <button
                type="submit"
                disabled={disabled || !input.trim()}
                title="Transmitir para Amadeus (Enter)"
                className="w-8 h-8 rounded-full bg-[#f59e0b] hover:bg-[#fbbf24] text-black font-bold text-sm flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.6)] transition-all disabled:opacity-30 disabled:hover:bg-[#f59e0b] transform hover:scale-105 active:scale-95"
              >
                <span className="translate-x-[0.5px]">➔</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
