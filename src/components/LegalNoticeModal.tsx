import React, { useEffect, useRef } from 'react';
import { X, ShieldAlert, Scale, ExternalLink, Heart, CheckCircle2 } from 'lucide-react';
import { getUiText } from '../i18n';

interface LegalNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: string;
}

export const LegalNoticeModal: React.FC<LegalNoticeModalProps> = ({ isOpen, onClose, lang }) => {
  const t = getUiText(lang).legalModal;
  const modalRef = useRef<HTMLDivElement>(null);

  // Platform dismiss: Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Trap focus or light-dismiss on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md font-mono select-none animate-fadeIn"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-notice-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-[#0e1117] border border-[#2a3040] rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f2430] bg-[#13161f]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b]">
              <Scale className="w-5 h-5 text-glow-nixie" />
            </div>
            <div>
              <h2 id="legal-notice-title" className="text-sm font-bold text-[#f59e0b] tracking-wider text-glow-nixie">
                {t.title}
              </h2>
              <span className="text-[11px] text-[#717d96]">
                {t.subtitle}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar modal"
            className="p-1.5 rounded-lg border border-[#262c3a] bg-[#181c26] text-[#8892a4] hover:text-white hover:border-[#f59e0b] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-[#cbd5e1] leading-relaxed custom-scrollbar">
          {/* Section 1: Non-commercial Fan Project */}
          <div className="p-4 rounded-lg bg-[#141822] border border-[#252c3c] space-y-2">
            <div className="flex items-center gap-2 text-[#f59e0b] font-bold text-[13px]">
              <Heart className="w-4 h-4" />
              <span>{t.sec1Title}</span>
            </div>
            <p className="text-[#94a3b8]">{t.sec1P1}</p>
            <p className="text-[#94a3b8]">{t.sec1P2}</p>
          </div>

          {/* Section 2: Copyright & Trademark Notice */}
          <div className="space-y-2">
            <h3 className="text-[#f59e0b] font-bold tracking-wide flex items-center gap-1.5 text-xs">
              <ShieldAlert className="w-4 h-4" />
              {t.sec2Title}
            </h3>
            <p className="text-[#94a3b8]">{t.sec2P1}</p>
            <p className="text-[#94a3b8]">{t.sec2P2}</p>
          </div>

          {/* Section 3: Voice Acting & Neural Models */}
          <div className="space-y-2">
            <h3 className="text-[#f59e0b] font-bold tracking-wide flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              {t.sec3Title}
            </h3>
            <p className="text-[#94a3b8]">{t.sec3P1}</p>
            <p className="text-[#94a3b8]">{t.sec3P2}</p>
          </div>

          {/* Section 4: Sprites & Asset Distribution Policy */}
          <div className="space-y-2">
            <h3 className="text-[#f59e0b] font-bold tracking-wide flex items-center gap-1.5 text-xs">
              <ExternalLink className="w-4 h-4" />
              {t.sec4Title}
            </h3>
            <p className="text-[#94a3b8]">{t.sec4P1}</p>
            <p className="text-[#94a3b8]">{t.sec4P2}</p>
          </div>

          {/* Section 5: DMCA & Contact */}
          <div className="p-3 rounded-lg bg-[#11141c] border border-[#222836] text-[11px] text-[#717d96]">
            <p>{t.sec5Text}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1f2430] bg-[#12151c] flex items-center justify-between text-[11px]">
          <span className="text-[#717d96]">{t.footerLicense}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#f59e0b] text-black font-bold hover:bg-[#fbbf24] transition-colors shadow-[0_0_12px_rgba(245,158,11,0.3)]"
          >
            {t.understoodBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
