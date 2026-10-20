import React, { useState } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX,
  Zap, 
  Brain, 
  Settings, 
  PhoneOff
} from 'lucide-react';

interface ControlBarProps {
  onSendMessage: (message: string) => void;
  isListening: boolean;
  onToggleMic: () => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
  onEndCall: () => void;
  streamEnabled?: boolean;
  onToggleStream?: () => void;
  isQwen?: boolean;
  disabled?: boolean;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  onSendMessage,
  isListening,
  onToggleMic,
  voiceEnabled,
  onToggleVoice,
  onOpenMemory,
  onOpenSettings,
  onEndCall,
  streamEnabled = false,
  onToggleStream,
  isQwen = false,
  disabled = false,
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || disabled) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-2.5 pt-2 pb-3 px-3 z-30 select-none font-mono">
      {/* Text Input Form */}
      <form onSubmit={handleSend} className="w-full flex-1 flex items-center relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={isListening ? 'Escutando sua voz...' : 'Digite sua mensagem para a Kurisu...'}
          disabled={disabled}
          className="w-full h-11 pl-4 pr-12 rounded-xl bg-[#12151c]/90 border border-[#262c3a] text-sm text-[#f8fafc] placeholder-[#64748b] focus:outline-none focus:border-[#f59e0b] focus:ring-1 focus:ring-[#f59e0b]/40 font-sans transition-all backdrop-blur-md"
        />
        {/* Send Button: Iconic Circular Amber Arrow Button from Amadeus Login Screen */}
        <button
          type="submit"
          disabled={disabled || !inputValue.trim()}
          title="Transmitir para Amadeus (Enter)"
          className="absolute right-1.5 w-8 h-8 rounded-full bg-[#f59e0b] hover:bg-[#fbbf24] text-black font-bold text-sm flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.5)] transition-all disabled:opacity-30 disabled:hover:bg-[#f59e0b] disabled:hover:text-black transform hover:scale-105 active:scale-95"
        >
          <span className="translate-x-[0.5px]">➔</span>
        </button>
      </form>

      {/* Action Buttons Toolbar (100% Iconic Buttons) */}
      <div className="flex items-center gap-2 shrink-0 p-1 rounded-xl bg-[#141720]/80 border border-[#252b3a] backdrop-blur-md">
        {/* Microphone STT */}
        <button
          type="button"
          onClick={onToggleMic}
          disabled={disabled}
          title={isListening ? 'Microfone Ativo (Clique para pausar)' : 'Ativar Microfone (Reconhecimento de Voz)'}
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all ${
            isListening 
              ? 'bg-[#38bdf8]/20 border border-[#38bdf8] text-[#38bdf8] shadow-[0_0_12px_rgba(56,189,248,0.4)] animate-pulse' 
              : 'bg-[#181c26] border border-[#262c3a] text-[#94a3b8] hover:text-[#f59e0b] hover:border-[#f59e0b]/50'
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
            className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all ${
              streamEnabled
                ? 'bg-[#0c202e] border border-[#38bdf8]/60 text-[#38bdf8] shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                : 'bg-[#181c26] border border-[#262c3a] text-[#64748b] hover:text-[#cbd5e1]'
            }`}
          >
            <Zap className="w-4 h-4" />
          </button>
        )}

        {/* TTS Voice Toggle */}
        <button
          type="button"
          onClick={onToggleVoice}
          title={voiceEnabled ? 'Voz da Kurisu Ativa (Clique para silenciar)' : 'Voz Silenciada (Clique para ativar síntese)'}
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all ${
            voiceEnabled 
              ? 'bg-[#201509] border border-[#f59e0b]/60 text-[#f59e0b] box-glow-nixie' 
              : 'bg-[#181c26] border border-[#262c3a] text-[#64748b] hover:text-[#cbd5e1]'
          }`}
        >
          {voiceEnabled ? <Volume2 className="w-4 h-4 text-[#f59e0b]" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Memory Cortex Inspector */}
        <button
          type="button"
          onClick={onOpenMemory}
          title="Inspecionar Córtex & Memórias Sinápticas"
          className="h-9 w-9 rounded-lg bg-[#181c26] border border-[#262c3a] text-[#38bdf8] hover:text-white hover:border-[#38bdf8]/60 transition-colors flex items-center justify-center"
        >
          <Brain className="w-4 h-4" />
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Configurações do Amadeus"
          className="h-9 w-9 rounded-lg bg-[#181c26] border border-[#262c3a] text-[#94a3b8] hover:text-[#f59e0b] hover:border-[#f59e0b]/50 transition-colors flex items-center justify-center"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* End Call (Hangup Phone) */}
        <button
          type="button"
          onClick={onEndCall}
          title="Encerrar Conexão com o Amadeus"
          className="h-9 px-3 rounded-lg bg-[#dc2626] hover:bg-[#ef4444] text-white shadow-[0_0_12px_rgba(220,38,38,0.5)] transition-all flex items-center justify-center font-bold"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
