import React, { useState, useEffect } from 'react';
import { Emotion } from '../types/amadeus';
import { Sparkles } from 'lucide-react';
import { EMOTION_LABELS as EMOTION_I18N, getUiText, normalizeAppLang } from '../i18n';

interface SubtitleBoxProps {
  speakerName: string;
  text: string;
  emotion: Emotion;
  isProcessing: boolean;
  onTopicClick?: (topic: string) => void;
  lang?: string;
}

const EMOTION_COLORS: Record<Emotion, string> = {
  // Canonical 12
  neutral: 'text-zinc-300 border-zinc-700',
  wink: 'text-amber-300 border-amber-500/40',
  annoyed: 'text-orange-400 border-orange-500/40',
  worried: 'text-pink-400 border-pink-500/40',
  disdain: 'text-zinc-300 border-zinc-700',
  happy: 'text-amber-300 border-amber-500/50',
  stern: 'text-rose-400 border-rose-500/50',
  blushing: 'text-rose-300 border-rose-400/40',
  look_side: 'text-violet-300 border-violet-500/40',
  eyes_closed: 'text-zinc-300 border-zinc-700',
  analytical: 'text-sky-400 border-sky-500/40',
  holding_back_tears: 'text-blue-300 border-blue-500/40',

  // Legacy & Poses
  smile: 'text-amber-300 border-amber-500/40',
  serious: 'text-sky-400 border-sky-500/40',
  surprised: 'text-pink-400 border-pink-500/40',
  tsundere: 'text-rose-400 border-rose-500/50',
  thinking: 'text-sky-400 border-sky-500/40',
  smug: 'text-amber-300 border-amber-500/40',
  flustered: 'text-rose-300 border-rose-400/40',
  sad: 'text-blue-300 border-blue-500/40',
  puzzled: 'text-purple-300 border-purple-500/40',
  desperate: 'text-rose-400 border-rose-500/50',
};

export const SubtitleBox: React.FC<SubtitleBoxProps> = ({
  speakerName,
  text,
  emotion,
  isProcessing,
  onTopicClick,
  lang,
}) => {
  const t = getUiText(lang).subtitle;
  const [displayedText, setDisplayedText] = useState('');

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

  const appLang = normalizeAppLang(lang);
  const emotionColor = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;
  const emotionDisplay = EMOTION_I18N[appLang]?.[emotion] || emotion.toUpperCase();

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-3 font-mono">
      {/* Quick Suggestions Chips */}
      {onTopicClick && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono scrollbar-none">
          <span className="text-zinc-400 flex items-center gap-1 text-[11px] shrink-0 mr-1">
            <Sparkles className="w-3 h-3 text-orange-400" />
            <span>{t.quickTopicsLabel}</span>
          </span>
          {t.topics.map((topic, i) => (
            <button
              key={i}
              onClick={() => onTopicClick(topic.prompt)}
              className="px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300 hover:text-orange-400 hover:border-orange-500/60 transition-colors text-[11px] whitespace-nowrap"
            >
              {topic.label}
            </button>
          ))}
        </div>
      )}

      {/* Widescreen Brushed Steel Deck */}
      <div className="widescreen-steel-deck px-6 py-4 rounded-sm relative mt-2">
        {/* Top-Left Floating Copper PCB Speaker Pill */}
        <div className="absolute -top-3.5 left-5 copper-capsule px-4 py-0.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shadow-[0_0_6px_#fb923c]" />
          <span className="engraved-serif text-xs font-bold text-amber-200 tracking-widest">
            {speakerName.toUpperCase()}
          </span>
          <span className="text-[10px] font-mono text-orange-400/80 border-l border-orange-500/30 pl-2">
            {emotion.toUpperCase()}
          </span>
        </div>

        {/* Top-Right Mood Status Tag */}
        <div className={`absolute -top-3 right-5 text-[10px] font-mono px-2.5 py-0.5 rounded-sm border bg-[#0e0c0a] ${emotionColor}`}>
          {emotionDisplay}
        </div>

        {/* Main Dialogue Area + 3D Spinning Gold Gimbal Ring */}
        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="min-h-[48px] flex-1 text-sm md:text-[15px] leading-relaxed text-zinc-100 font-sans drop-shadow-[0_2px_3px_rgba(0,0,0,0.95)]">
            {isProcessing ? (
              <div className="flex items-center gap-2 text-orange-400 font-mono text-xs pt-2">
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-ping" />
                <span>{t.processingText}</span>
              </div>
            ) : (
              <p className="tracking-wide">
                {displayedText}
                {displayedText.length < text.length && (
                  <span className="inline-block w-2 h-4 bg-orange-400 ml-1 animate-pulse" />
                )}
              </p>
            )}
          </div>

          {/* 3D Spinning Gold Gimbal Ring Indicator */}
          <div
            className="relative w-10 h-10 shrink-0 flex items-center justify-center"
            style={{ perspective: '200px' }}
            title={t.dialogueSyncTitle}
          >
            <div className="w-8 h-8 rounded-full border-2 border-amber-400 shadow-[0_0_12px_#f59e0b] gimbal-ring-3d" />
            <div className="absolute w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_#f97316]" />
          </div>
        </div>
      </div>
    </div>
  );
};
