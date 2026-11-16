import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { PersonaProfile } from '../types/amadeus';
import { KURISU_AVATAR_DEFAULT } from '../services/spriteCatalog';
import { LabBackground } from './LabBackground';
import { getUiText } from '../i18n';

interface IncomingCallScreenProps {
  persona: PersonaProfile;
  onAccept: () => void;
  onDecline: () => void;
  scanlines?: boolean;
  lang?: string;
}

export const IncomingCallScreen: React.FC<IncomingCallScreenProps> = ({
  persona,
  onAccept,
  onDecline,
  scanlines = false,
  lang,
}) => {
  const t = getUiText(lang).incoming;
  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-between p-6 bg-[#09090b] overflow-hidden select-none font-mono">
      <LabBackground scanlines={scanlines} />

      {/* Top Banner */}
      <div className="z-10 text-center space-y-1.5 pt-6">
        <div className="inline-flex items-center gap-2 copper-capsule px-4 py-1 text-amber-200 text-xs">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-ping" />
          <span className="engraved-serif font-bold tracking-widest">{t.incomingCallBadge} // OPENAMADEUS</span>
        </div>
        <h1 className="engraved-heading text-xl md:text-2xl font-bold tracking-widest pt-2">
          OPENAMADEUS WORKBENCH
        </h1>
        <p className="text-xs text-zinc-400 tracking-wider uppercase">
          {t.systemHeader}
        </p>
      </div>

      {/* Center Clockwork Astrolabe / Caller Profile */}
      <div className="z-10 flex flex-col items-center justify-center space-y-6">
        <div className="relative flex items-center justify-center">
          {/* Concentric Clockwork SVG Rings */}
          <svg className="absolute w-56 h-56 md:w-64 md:h-64 spin-cw-slow pointer-events-none" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="92" fill="none" stroke="#f97316" strokeWidth="1" strokeDasharray="6 4" opacity="0.45" />
            <circle cx="100" cy="100" r="82" fill="none" stroke="#fbbf24" strokeWidth="0.75" opacity="0.3" />
          </svg>
          <svg className="absolute w-48 h-48 md:w-56 md:h-56 spin-ccw-med pointer-events-none" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="88" fill="none" stroke="#f97316" strokeWidth="1.2" strokeDasharray="16 8" opacity="0.4" />
          </svg>

          {/* Avatar Ring */}
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-2 border-orange-400 p-1 shadow-[0_0_35px_rgba(249,115,22,0.45)] bg-[#120e0b] flex items-center justify-center overflow-hidden">
            <img
              src={KURISU_AVATAR_DEFAULT}
              alt={persona.name}
              className="w-full h-full object-cover object-top scale-150 translate-y-3"
            />
          </div>
        </div>

        {/* Identity Information */}
        <div className="text-center space-y-1">
          <div className="engraved-heading text-lg md:text-xl font-bold tracking-widest">
            {persona.name}
          </div>
          <div className="text-xs text-orange-400 font-semibold tracking-widest">
            [UNIDADE NEURAL ATIVA]
          </div>
          <div className="text-[11px] text-zinc-400 max-w-sm px-4 font-sans">
            {t.neuralSubtitle}
          </div>
        </div>
      </div>

      {/* Bottom Call Action Buttons */}
      <div className="z-10 w-full max-w-sm flex items-center justify-around pb-10">
        {/* Decline Button */}
        <button
          onClick={onDecline}
          className="flex flex-col items-center gap-2 group transition-transform active:scale-95"
        >
          <div className="w-16 h-16 rounded-full bg-rose-950/50 border-2 border-rose-500 flex items-center justify-center text-rose-400 group-hover:bg-rose-600 group-hover:text-white transition-all shadow-[0_0_20px_rgba(244,63,94,0.3)]">
            <PhoneOff className="w-7 h-7" />
          </div>
          <span className="engraved-serif text-xs text-zinc-400 group-hover:text-rose-400 tracking-widest font-bold">
            {t.declineBtn}
          </span>
        </button>

        {/* Accept Button */}
        <button
          onClick={onAccept}
          className="flex flex-col items-center gap-2 group transition-transform active:scale-95"
        >
          <div className="w-16 h-16 rounded-full bg-orange-500/20 border-2 border-orange-400 flex items-center justify-center text-amber-300 group-hover:bg-orange-500 group-hover:text-black transition-all shadow-[0_0_25px_rgba(249,115,22,0.5)]">
            <Phone className="w-7 h-7" />
          </div>
          <span className="engraved-serif text-xs text-amber-300 group-hover:text-white tracking-widest font-bold">
            {t.acceptBtn}
          </span>
        </button>
      </div>
    </div>
  );
};
