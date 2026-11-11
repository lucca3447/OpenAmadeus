import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  Copy,
  Check,
  Cpu,
  AlertCircle,
  AlertTriangle,
  X,
  Terminal,
} from 'lucide-react';
import { ChatMessage } from '../types/amadeus';
import { KURISU_AVATAR_DEFAULT } from '../services/spriteCatalog';
import { EMOTION_LABELS, getUiText, normalizeAppLang } from '../i18n';

interface ChatFeedStreamProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  errorNotice?: string | null;
  onDismissError?: () => void;
  modelNotice?: string | null;
  onDismissModelNotice?: () => void;
  onReplayAudio: (text: string, emotion?: string) => void;
  personaAvatarUrl?: string;
  personaName: string;
  lang?: string;
}

export const ChatFeedStream: React.FC<ChatFeedStreamProps> = ({
  messages,
  isProcessing,
  errorNotice,
  onDismissError,
  modelNotice,
  onDismissModelNotice,
  onReplayAudio,
  personaAvatarUrl = KURISU_AVATAR_DEFAULT,
  personaName,
  lang,
}) => {
  const t = getUiText(lang).chatFeed;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing, errorNotice, modelNotice]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyCode = (codeKey: string, codeText: string) => {
    navigator.clipboard?.writeText(codeText);
    setCopiedCodeId(codeKey);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const renderInlineFormatted = (text: string): React.ReactNode => {
    const parts = text.split(/(`[^`]+`)/g);

    return parts.map((part, pIdx) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={pIdx}
            className="px-1.5 py-0.5 mx-0.5 bg-black/80 border border-amber-900/60 text-amber-300 font-mono text-[12px]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={pIdx}>
          {boldParts.map((bPart, bIdx) => {
            if (bPart.startsWith('**') && bPart.endsWith('**') && bPart.length > 4) {
              return (
                <strong key={bIdx} className="font-bold text-amber-200">
                  {bPart.slice(2, -2)}
                </strong>
              );
            }
            return bPart;
          })}
        </span>
      );
    });
  };

  const renderFormattedContent = (content: string, messageId: string) => {
    if (content.includes('```')) {
      const segments: React.ReactNode[] = [];
      const codeRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let blockIndex = 0;

      while ((match = codeRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          const textBefore = content.substring(lastIndex, match.index).trim();
          if (textBefore) {
            segments.push(
              <div key={`txt_${blockIndex}`} className="space-y-1.5 leading-relaxed whitespace-pre-wrap">
                {renderInlineFormatted(textBefore)}
              </div>
            );
          }
        }

        const lang = match[1] || 'code';
        const codeText = match[2].trim();
        const codeKey = `${messageId}_code_${blockIndex}`;

        segments.push(
          <div
            key={codeKey}
            className="my-3 border border-amber-900/60 bg-[#080706] overflow-hidden text-xs font-mono shadow-lg"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#120e0b] border-b border-amber-900/50 text-zinc-400">
              <span className="text-[11px] font-bold text-orange-400 uppercase tracking-widest flex items-center gap-1.5">
                <Terminal className="w-3 h-3" />
                <span>{lang}</span>
              </span>
              <button
                type="button"
                onClick={() => handleCopyCode(codeKey, codeText)}
                className="flex items-center gap-1 text-[11px] hover:text-amber-200 transition-colors"
                title="Copiar código"
              >
                {copiedCodeId === codeKey ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 overflow-x-auto text-amber-100/90 leading-relaxed">
              <code>{codeText}</code>
            </pre>
          </div>
        );

        lastIndex = match.index + match[0].length;
        blockIndex++;
      }

      if (lastIndex < content.length) {
        const textAfter = content.substring(lastIndex).trim();
        if (textAfter) {
          segments.push(
            <div key="txt_after" className="space-y-1.5 leading-relaxed whitespace-pre-wrap">
              {renderInlineFormatted(textAfter)}
            </div>
          );
        }
      }

      return <div className="space-y-2">{segments}</div>;
    }

    const lines = content.split('\n');
    const firstTableIdx = lines.findIndex((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));

    if (firstTableIdx !== -1) {
      let lastTableIdx = firstTableIdx;
      while (
        lastTableIdx + 1 < lines.length &&
        lines[lastTableIdx + 1].trim().startsWith('|') &&
        lines[lastTableIdx + 1].trim().endsWith('|')
      ) {
        lastTableIdx++;
      }

      const textBefore = lines.slice(0, firstTableIdx).join('\n').trim();
      const tableLines = lines.slice(firstTableIdx, lastTableIdx + 1);
      const textAfter = lines.slice(lastTableIdx + 1).join('\n').trim();

      return (
        <div className="space-y-3 font-sans">
          {textBefore && (
            <div className="leading-relaxed whitespace-pre-wrap">{renderInlineFormatted(textBefore)}</div>
          )}
          <div className="overflow-x-auto my-2 border border-amber-900/60 bg-[#080706]">
            <table className="w-full text-xs font-sans text-left">
              <thead className="bg-[#14100d] text-orange-400 font-mono border-b border-amber-900/50">
                <tr>
                  {tableLines[0]
                    ?.split('|')
                    .filter((c) => c.trim().length > 0)
                    .map((header, idx) => (
                      <th key={idx} className="p-2.5 font-bold uppercase tracking-wider">
                        {header.trim()}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-900/30 text-zinc-200">
                {tableLines.slice(2).map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-orange-500/5 transition-colors">
                    {row
                      .split('|')
                      .filter((c) => c.trim().length > 0)
                      .map((cell, cellIdx) => (
                        <td key={cellIdx} className="p-2.5">
                          {renderInlineFormatted(cell.trim())}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {textAfter && (
            <div className="leading-relaxed whitespace-pre-wrap">{renderInlineFormatted(textAfter)}</div>
          )}
        </div>
      );
    }

    return (
      <div className="leading-relaxed whitespace-pre-wrap font-sans text-sm">
        {renderInlineFormatted(content)}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 chalkboard-grid">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 text-zinc-400 space-y-4 select-none">
          {/* Clockwork Orbital Gear Emblem */}
          <div className="relative w-20 h-20 flex items-center justify-center">
            <svg className="w-20 h-20 spin-cw-slow" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" fill="none" stroke="#f97316" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.7" />
              <circle cx="50" cy="50" r="34" fill="none" stroke="#fbbf24" strokeWidth="1" opacity="0.4" />
              <path d="M50 2 L50 12 M50 88 L50 98 M2 50 L12 50 M88 50 L98 50" stroke="#f97316" strokeWidth="2" />
            </svg>
            <span className="absolute engraved-serif font-bold text-orange-400 text-lg tracking-widest">
              OA
            </span>
          </div>

          <div className="space-y-1.5 max-w-md">
            <h2 className="engraved-heading text-base md:text-lg font-bold tracking-widest">
              {t.emptyTitle}
            </h2>
            <div className="bus-line-horizontal w-48 mx-auto my-1" />
            <p className="text-xs text-zinc-400 font-sans leading-relaxed">
              {t.emptyDesc}
            </p>
          </div>
        </div>
      ) : (
        messages.map((msg) => {
          const isUser = msg.sender === 'user';

          return (
            <div
              key={msg.id}
              className={`flex gap-3.5 max-w-4xl ${
                isUser ? 'ml-auto justify-end' : 'mr-auto justify-start'
              }`}
            >
              {/* Kurisu Astrolabe Avatar */}
              {!isUser && (
                <div className="relative w-10 h-10 shrink-0 flex items-center justify-center select-none mt-1">
                  <svg className="absolute inset-0 w-10 h-10 spin-cw-slow pointer-events-none" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="22" fill="none" stroke="#f97316" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.75" />
                  </svg>
                  <div className="w-8 h-8 rounded-full border border-orange-400 overflow-hidden bg-[#120e0b] p-0.5 shadow-[0_0_12px_rgba(249,115,22,0.35)]">
                    <img
                      src={personaAvatarUrl}
                      alt={personaName}
                      className="w-full h-full object-cover object-top scale-125"
                    />
                  </div>
                </div>
              )}

              {/* Message Content Container */}
              <div className={`space-y-1.5 ${isUser ? 'text-right max-w-2xl' : 'text-left max-w-3xl flex-1'}`}>
                {/* Message Header Tag */}
                <div
                  className={`flex items-center gap-2 font-mono text-[11px] select-none ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <span
                    className={`engraved-serif font-bold tracking-widest ${
                      isUser ? 'text-amber-200/90' : 'text-orange-400'
                    }`}
                  >
                    {isUser ? t.youLabel : personaName.toUpperCase()}
                  </span>
                  {msg.timestamp && (
                    <span className="text-[10px] text-zinc-500">{formatTime(msg.timestamp)}</span>
                  )}
                  {msg.emotion && !isUser && (
                    <span className="text-[9px] px-2 py-0.2 bg-black/80 border border-amber-900/60 text-amber-300 uppercase tracking-wider">
                      {EMOTION_LABELS[normalizeAppLang(lang)][msg.emotion] || msg.emotion}
                    </span>
                  )}
                </div>

                {/* Message Deck Plate */}
                <div
                  className={`p-4 text-sm leading-relaxed relative ${
                    isUser
                      ? 'bg-gradient-to-b from-[#1c140e] to-[#0e0a08] border border-amber-700/60 text-amber-50 shadow-[0_6px_20px_rgba(0,0,0,0.8)]'
                      : 'widescreen-steel-deck text-zinc-100'
                  }`}
                >
                  {renderFormattedContent(msg.content, msg.id)}
                </div>

                {/* Action Toolbar for AI message */}
                {!isUser && (
                  <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400 pt-0.5 select-none">
                    <button
                      onClick={() => onReplayAudio(msg.content, msg.emotion)}
                      className="hover:text-amber-200 flex items-center gap-1 transition-colors"
                      title={t.replayVoiceTitle}
                    >
                      <Volume2 className="w-3.5 h-3.5 text-orange-400" />
                      <span className="engraved-serif text-[10px] font-bold tracking-wider">
                        VOCALIZAR
                      </span>
                    </button>
                    <span className="text-amber-900">•</span>
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="hover:text-amber-200 flex items-center gap-1 transition-colors"
                      title="Copiar Registro"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 text-[10px] font-bold">COPIADO</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-orange-400/80" />
                          <span className="engraved-serif text-[10px] font-bold tracking-wider">
                            COPIAR
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Operator Badge */}
              {isUser && (
                <div className="w-9 h-9 rounded-full border border-amber-700/70 bg-[#18110c] text-amber-300 flex items-center justify-center engraved-serif font-bold text-xs shrink-0 select-none mt-1 shadow-[0_0_10px_rgba(249,115,22,0.2)]">
                  OP
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Processing / Generating Indicator */}
      {isProcessing && (
        <div className="flex gap-3 max-w-3xl mr-auto items-center">
          <div className="w-9 h-9 rounded-full border border-orange-500/50 shrink-0 bg-[#120e0b] flex items-center justify-center">
            <Cpu className="w-4 h-4 text-orange-400 animate-spin" />
          </div>
          <div className="widescreen-steel-deck px-4 py-3 text-xs font-mono text-amber-200 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-ping" />
            <span>{t.processingBadge}</span>
          </div>
        </div>
      )}

      {/* Transient Error Notice Banner */}
      {errorNotice && (
        <div className="flex gap-3 max-w-3xl mr-auto items-center p-3.5 border border-rose-500/70 bg-rose-950/40 text-xs font-mono text-rose-200 shadow-lg animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <div className="flex-1 font-sans">{errorNotice}</div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="text-rose-300 hover:text-white p-1"
              title={t.dismissNoticeTitle}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Informative Decommission / Migration Notice Banner */}
      {modelNotice && (
        <div className="flex gap-3 max-w-3xl mr-auto items-center p-3.5 border border-orange-500/70 bg-amber-950/40 text-xs font-mono text-amber-200 shadow-lg animate-fadeIn">
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1 font-sans">{modelNotice}</div>
          {onDismissModelNotice && (
            <button
              onClick={onDismissModelNotice}
              className="text-amber-300 hover:text-white p-1 transition-colors"
              title={t.dismissNoticeTitle}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
