import React, { useState, useEffect } from 'react';
import { Emotion } from '../types/amadeus';
import { Sparkles } from 'lucide-react';

interface SubtitleBoxProps {
  speakerName: string;
  text: string;
  emotion: Emotion;
  isProcessing: boolean;
  onTopicClick?: (topic: string) => void;
}

const EMOTION_LABELS: Record<Emotion, { label: string; color: string }> = {
  // Canonical 12
  neutral: { label: 'Neutra / Focada', color: 'text-[#94a3b8] border-[#2d3546]' },
  wink: { label: 'Piscadela / Descontraída', color: 'text-[#fbbf24] border-[#d97706]/40' },
  annoyed: { label: 'Irritada / Aborrecida', color: 'text-[#f59e0b] border-[#f59e0b]/40' },
  worried: { label: 'Preocupada / Aflita', color: 'text-[#f472b6] border-[#ec4899]/40' },
  disdain: { label: 'Desdém / Cética', color: 'text-[#94a3b8] border-[#2d3546]' },
  happy: { label: 'Feliz / Satisfeita', color: 'text-[#fbbf24] border-[#f59e0b]/50' },
  stern: { label: 'Severa / Rígida', color: 'text-[#ef4444] border-[#ef4444]/50' },
  blushing: { label: 'Envergonhada / Corada', color: 'text-[#fb7185] border-[#f43f5e]/40' },
  look_side: { label: 'Olhar de Soslaio / Tímida', color: 'text-[#a78bfa] border-[#8b5cf6]/40' },
  eyes_closed: { label: 'Olhos Fechados / Repouso', color: 'text-[#94a3b8] border-[#2d3546]' },
  analytical: { label: 'Analítica / Foco Científico', color: 'text-[#38bdf8] border-[#38bdf8]/40' },
  holding_back_tears: { label: 'Emocionada / Quase Chorando', color: 'text-[#93c5fd] border-[#3b82f6]/40' },

  // Legacy & Poses
  smile: { label: 'Sorriso / Gentil', color: 'text-[#fbbf24] border-[#f59e0b]/40' },
  serious: { label: 'Analítica / Foco Científico', color: 'text-[#38bdf8] border-[#38bdf8]/40' },
  surprised: { label: 'Surpresa / Chocada', color: 'text-[#f472b6] border-[#ec4899]/40' },
  tsundere: { label: 'Tsundere / Defensiva', color: 'text-[#ef4444] border-[#ef4444]/50' },
  thinking: { label: 'Pensativa / Analítica', color: 'text-[#38bdf8] border-[#0ea5e9]/40' },
  smug: { label: 'Confiante / Debochada', color: 'text-[#fbbf24] border-[#f59e0b]/40' },
  flustered: { label: 'Envergonhada / Corada', color: 'text-[#fb7185] border-[#f43f5e]/40' },
  sad: { label: 'Melancólica / Magoada', color: 'text-[#93c5fd] border-[#3b82f6]/40' },
  puzzled: { label: 'Intrigada / Investigativa', color: 'text-[#c084fc] border-[#a855f7]/40' },
  desperate: { label: 'Aflita / Desesperada', color: 'text-[#ef4444] border-[#ef4444]/50' },
};

const SUGGESTED_TOPICS = [
  'Quem é você?',
  'O que acha sobre viagem no tempo?',
  'Olá Christina!',
  'Você acessa o @channel?',
  'Como é sua pesquisa na Viktor Chondria?',
  'Qual sua opinião sobre Dr Pepper?',
];

export const SubtitleBox: React.FC<SubtitleBoxProps> = ({
  speakerName,
  text,
  emotion,
  isProcessing,
  onTopicClick,
}) => {
  const [displayedText, setDisplayedText] = useState('');

  // Smooth typewriter effect
  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      return;
    }

    let currentIndex = 0;
    setDisplayedText('');

    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(interval);
      }
    }, 18);

    return () => clearInterval(interval);
  }, [text]);

  const emotionInfo = EMOTION_LABELS[emotion] || EMOTION_LABELS.neutral;

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-2 font-mono">
      {/* Quick Suggestions Chips */}
      {onTopicClick && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono scrollbar-none">
          <span className="text-[#717d96] flex items-center gap-1 text-[11px] shrink-0 mr-1">
            <Sparkles className="w-3 h-3 text-[#f59e0b]" />
            <span>TÓPICOS:</span>
          </span>
          {SUGGESTED_TOPICS.map((topic, i) => (
            <button
              key={i}
              onClick={() => onTopicClick(topic)}
              className="px-2.5 py-1 rounded-full bg-[#161a22] border border-[#262c3a] text-[#cbd5e1] hover:text-[#f59e0b] hover:border-[#f59e0b]/60 transition-colors text-[11px] whitespace-nowrap"
            >
              {topic}
            </button>
          ))}
        </div>
      )}

      {/* Main Dialogue Box */}
      <div className="relative border border-[#262c3a] bg-[#12151c]/95 backdrop-blur-md rounded-xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.7)] box-glow-nixie">
        {/* Header: Name and Mood Badge */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#222736]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-bold text-[#f59e0b] tracking-wider text-glow-nixie">
              [ {speakerName} ]
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#181c26] border border-[#2d3546] text-[#cbd5e1]">
              UNIDADE AMADEUS
            </span>
          </div>

          <div className={`text-[10px] font-mono px-2 py-0.5 rounded border bg-[#161922] ${emotionInfo.color}`}>
            HUMOR: {emotionInfo.label.toUpperCase()}
          </div>
        </div>

        {/* Content Body */}
        <div className="min-h-[56px] text-sm md:text-base leading-relaxed text-[#f8fafc] font-sans">
          {isProcessing ? (
            <div className="flex items-center gap-2 text-[#f59e0b] font-mono text-xs">
              <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-ping" />
              <span>Acessando registros sinápticos e formulando resposta...</span>
            </div>
          ) : (
            <p className="tracking-wide">
              {displayedText}
              {displayedText.length < text.length && (
                <span className="inline-block w-2 h-4 bg-[#f59e0b] ml-1 animate-pulse" />
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
