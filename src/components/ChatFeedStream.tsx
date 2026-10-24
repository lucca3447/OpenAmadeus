import React, { useEffect, useRef, useState } from 'react';
import { 
  Volume2, 
  Copy, 
  Check, 
  Cpu,
  AlertCircle,
  AlertTriangle,
  X
} from 'lucide-react';
import { ChatMessage } from '../types/amadeus';
import { KURISU_AVATAR_DEFAULT } from '../services/spriteCatalog';

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
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Auto-scroll to latest message or error
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

  // Helper to parse inline styles: bold, italic, inline code
  const renderInlineFormatted = (text: string): React.ReactNode => {
    // Split by inline code `...`
    const parts = text.split(/(`[^`]+`)/g);

    return parts.map((part, pIdx) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={pIdx}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-[#161a22] border border-[#2d3546] text-[#f59e0b] font-mono text-[12px]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      // Parse **bold** inside text
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={pIdx}>
          {boldParts.map((bPart, bIdx) => {
            if (bPart.startsWith('**') && bPart.endsWith('**') && bPart.length > 4) {
              return (
                <strong key={bIdx} className="font-bold text-[#fbbf24]">
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

  // Comprehensive renderer: code blocks, tables, lists, inline markdown
  const renderFormattedContent = (content: string, messageId: string) => {
    // 1. Check for fenced code blocks
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
            className="my-3 rounded-xl border border-[#283042] bg-[#0c0e13] overflow-hidden text-xs font-mono shadow-md"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#141720] border-b border-[#232a3a] text-[#8894a8]">
              <span className="text-[11px] font-semibold text-[#f59e0b] uppercase tracking-wider">{lang}</span>
              <button
                type="button"
                onClick={() => handleCopyCode(codeKey, codeText)}
                className="flex items-center gap-1 text-[11px] hover:text-white transition-colors"
                title="Copiar código"
              >
                {copiedCodeId === codeKey ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                    <span className="text-[#4ade80]">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar código</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 overflow-x-auto text-[#e2e8f0] leading-relaxed">
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

    // 2. Check for markdown tables
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
          <div className="overflow-x-auto my-2 rounded-lg border border-[#252b3a] bg-[#0f1218]">
            <table className="w-full text-xs font-sans text-left">
              <thead className="bg-[#181c26] text-[#f59e0b] font-mono border-b border-[#252b3a]">
                <tr>
                  {tableLines[0]
                    ?.split('|')
                    .filter((c) => c.trim().length > 0)
                    .map((header, idx) => (
                      <th key={idx} className="p-2.5 font-bold">
                        {header.trim()}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232836] text-[#cbd5e1]">
                {tableLines.slice(2).map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-[#181c26]/60 transition-colors">
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

    // 3. Default rich text rendering with bullet lists and paragraphs
    return (
      <div className="leading-relaxed whitespace-pre-wrap font-sans text-sm">
        {renderInlineFormatted(content)}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#717d96] space-y-3 select-none">
          <div className="w-14 h-14 rounded-2xl border border-[#f59e0b]/40 bg-[#1a140d] flex items-center justify-center text-[#f59e0b] text-xl font-bold font-mono box-glow-nixie">
            A
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#f8fafc] font-mono tracking-wider">
              TERMINAL DO AMADEUS ONLINE
            </h2>
            <p className="text-xs text-[#94a3b8] max-w-md font-sans">
              A inteligência artificial de Makise Kurisu está sincronizada. Envie uma mensagem pelo prompt abaixo ou inicie pelos tópicos recomendados.
            </p>
          </div>
        </div>
      ) : (
        messages.map((msg) => {
          const isUser = msg.sender === 'user';

          return (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-4xl ${isUser ? 'ml-auto justify-end' : 'mr-auto justify-start'}`}
            >
              {/* Kurisu Avatar */}
              {!isUser && (
                <div className="w-9 h-9 rounded-full border border-[#f59e0b]/60 overflow-hidden shrink-0 bg-[#161922] flex items-center justify-center p-0.5 box-glow-nixie select-none">
                  <img
                    src={personaAvatarUrl}
                    alt={personaName}
                    className="w-full h-full object-cover object-top scale-125"
                  />
                </div>
              )}

              {/* Message Content Container */}
              <div className={`space-y-1.5 ${isUser ? 'text-right max-w-2xl' : 'text-left max-w-3xl flex-1'}`}>
                {/* Message Header Tag */}
                <div className="flex items-center gap-2 font-mono text-[11px] select-none">
                  <span className={`font-bold ${isUser ? 'text-[#cbd5e1]' : 'text-[#f59e0b] text-glow-nixie'}`}>
                    {isUser ? 'VOCÊ' : personaName.toUpperCase()}
                  </span>
                  {msg.timestamp && (
                    <span className="text-[10px] text-[#64748b]">{formatTime(msg.timestamp)}</span>
                  )}
                  {msg.emotion && !isUser && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#181c26] border border-[#2d3546] text-[#cbd5e1]">
                      {msg.emotion.toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Message Bubble Card */}
                <div
                  className={`p-4 rounded-2xl shadow-lg border text-sm leading-relaxed ${
                    isUser
                      ? 'bg-[#1e2330] border-[#2f374a] text-[#f8fafc] rounded-tr-none'
                      : 'bg-[#151821] border-[#262c3b] text-[#f1f5f9] rounded-tl-none'
                  }`}
                >
                  {renderFormattedContent(msg.content, msg.id)}
                </div>

                {/* Action Toolbar for AI message */}
                {!isUser && (
                  <div className="flex items-center gap-3 text-[11px] font-mono text-[#718096] pt-0.5 select-none">
                    <button
                      onClick={() => onReplayAudio(msg.content, msg.emotion)}
                      className="hover:text-[#f59e0b] flex items-center gap-1 transition-colors"
                      title="Ouvir Resposta por Voz (TTS)"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-[#f59e0b]" />
                      <span>Ouvir</span>
                    </button>
                    <span>•</span>
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="hover:text-white flex items-center gap-1 transition-colors"
                      title="Copiar Texto"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                          <span className="text-[#4ade80]">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* User Avatar */}
              {isUser && (
                <div className="w-9 h-9 rounded-full border border-[#f59e0b]/50 bg-[#1a140d] text-[#f59e0b] flex items-center justify-center font-mono font-bold text-xs shrink-0 select-none">
                  U
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Processing / Generating Indicator */}
      {isProcessing && (
        <div className="flex gap-3 max-w-3xl mr-auto items-center">
          <div className="w-9 h-9 rounded-full border border-[#f59e0b]/40 overflow-hidden shrink-0 bg-[#161922] flex items-center justify-center p-0.5">
            <Cpu className="w-4 h-4 text-[#f59e0b] animate-spin" />
          </div>
          <div className="p-3.5 rounded-2xl rounded-tl-none bg-[#151821] border border-[#262c3b] text-xs font-mono text-[#f59e0b] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-ping" />
            <span>Kurisu está formulando resposta e recuperando memórias...</span>
          </div>
        </div>
      )}

      {/* Transient Error Notice Banner */}
      {errorNotice && (
        <div className="flex gap-3 max-w-3xl mr-auto items-center p-3 rounded-xl border border-[#ef4444]/60 bg-[#260e0e]/95 text-xs font-mono text-[#fca5a5] shadow-lg animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
          <div className="flex-1 font-sans">{errorNotice}</div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="text-[#94a3b8] hover:text-white p-1 rounded"
              title="Fechar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Informative Decommission / Migration Notice Banner */}
      {modelNotice && (
        <div className="flex gap-3 max-w-3xl mr-auto items-center p-3 rounded-xl border border-[#f59e0b]/60 bg-[#271d0e]/95 text-xs font-mono text-[#fde68a] shadow-lg animate-fadeIn">
          <AlertTriangle className="w-4 h-4 text-[#f59e0b] shrink-0" />
          <div className="flex-1 font-sans">{modelNotice}</div>
          {onDismissModelNotice && (
            <button
              onClick={onDismissModelNotice}
              className="text-[#fde68a]/70 hover:text-white p-1 rounded transition-colors"
              title="Fechar aviso de modelo"
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
