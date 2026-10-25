import React, { useEffect, useRef } from 'react';
import { X, ShieldAlert, Scale, ExternalLink, Heart, CheckCircle2 } from 'lucide-react';

interface LegalNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LegalNoticeModal: React.FC<LegalNoticeModalProps> = ({ isOpen, onClose }) => {
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
                AVISOS LEGAIS & PROPRIEDADE INTELECTUAL
              </h2>
              <span className="text-[11px] text-[#717d96]">
                OpenAmadeus Companion • Termos de Uso e Isenção de Responsabilidade
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
              <span>Projeto de Fã Não-Comercial & Estudo Educacional</span>
            </div>
            <p className="text-[#94a3b8]">
              O <strong>OpenAmadeus Companion</strong> é uma plataforma de código aberto independente, desenvolvida
              para pesquisa em interfaces de conversação multimodal, processamento neural de linguagem, síntese de voz
              e sincronia labial.
            </p>
            <p className="text-[#94a3b8]">
              Este software é estritamente <strong>sem fins lucrativos</strong>, gratuito e de livre acesso, não
              possuindo monetização, paywalls ou assinaturas comerciais.
            </p>
          </div>

          {/* Section 2: Copyright & Trademark Notice */}
          <div className="space-y-2">
            <h3 className="text-[#f59e0b] font-bold tracking-wide flex items-center gap-1.5 text-xs">
              <ShieldAlert className="w-4 h-4" />
              MARCAS REGISTRADAS & DIREITOS AUTORAIS
            </h3>
            <p className="text-[#94a3b8]">
              Todos os nomes, termos conceituais e personagens do universo de <em>STEINS;GATE</em> (incluindo
              &quot;Makise Kurisu&quot;, &quot;Viktor Chondria University&quot;, &quot;Amadeus System&quot; e elementos de lore) são marcas e propriedades
              intelectuais registradas de <strong>MAGES. Inc. / 5pb. / Chiyomaru Studio / KADOKAWA</strong>.
            </p>
            <p className="text-[#94a3b8]">
              O <strong>OpenAmadeus Companion</strong> não é um produto oficial e não possui qualquer filiação,
              patrocínio ou endosso por parte das empresas detentoras dos direitos da franquia.
            </p>
          </div>

          {/* Section 3: Voice Acting & Neural Models */}
          <div className="space-y-2">
            <h3 className="text-[#f59e0b] font-bold tracking-wide flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              MODELOS NEURAIS DE VOZ & ATRIZES
            </h3>
            <p className="text-[#94a3b8]">
              Os modelos vocais integrados (como Kurisu RVC v2 e Qwen3-TTS) utilizam pesos criados e compartilhados de forma
              independente por entusiastas da comunidade na plataforma pública Hugging Face.
            </p>
            <p className="text-[#94a3b8]">
              Nenhum arquivo de áudio de treino está hospedado ou distribuído neste repositório. O uso desses modelos é
              uma emulação acústica experimental sem qualquer afiliação ou endosso do elenco original ou dos detentores de direitos.
            </p>
          </div>

          {/* Section 4: Sprites & Asset Distribution Policy */}
          <div className="space-y-2">
            <h3 className="text-[#f59e0b] font-bold tracking-wide flex items-center gap-1.5 text-xs">
              <ExternalLink className="w-4 h-4" />
              POLÍTICA DE ASSETS & SPRITES
            </h3>
            <p className="text-[#94a3b8]">
              Em estrita conformidade com as diretrizes de código aberto e propriedade intelectual,{' '}
              <strong>nenhum sprite comercial da visual novel é armazenado ou distribuído no repositório do Git</strong>.
              O repositório fornece apenas o motor executável e código-fonte sob licença GPLv3.
            </p>
            <p className="text-[#94a3b8]">
              O sistema opera nativamente com uma silhueta vetorial de fallback, cabendo ao usuário final fornecer seus
              próprios assets locais para customização pessoal.
            </p>
          </div>

          {/* Section 5: DMCA & Contact */}
          <div className="p-3 rounded-lg bg-[#11141c] border border-[#222836] text-[11px] text-[#717d96]">
            <p>
              <strong>Notificação de Remoção (Notice & Takedown):</strong> Caso você seja o detentor legal de qualquer
              propriedade intelectual mencionada e considere que este projeto excede o uso aceitável de fã (Fair Use),
              solicitações de alteração ou remoção serão atendidas prontamente através de uma Issue no repositório do GitHub.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1f2430] bg-[#12151c] flex items-center justify-between text-[11px]">
          <span className="text-[#717d96]">OpenAmadeus Companion v1.0 • Licença GPLv3 (Código)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#f59e0b] text-black font-bold hover:bg-[#fbbf24] transition-colors shadow-[0_0_12px_rgba(245,158,11,0.3)]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
