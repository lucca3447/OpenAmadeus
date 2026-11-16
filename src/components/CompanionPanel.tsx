import React from 'react';
import { CameraFraming, Emotion, CharacterPose } from '../types/amadeus';
import { AmadeusSpriteView } from './AmadeusSpriteView';
import { AudioOscilloscope } from './AudioOscilloscope';
import { EMOTION_LABELS, getUiText, normalizeAppLang } from '../i18n';

interface CompanionPanelProps {
  emotion: Emotion;
  pose?: CharacterPose;
  camera?: CameraFraming;
  isSpeaking: boolean;
  isListening: boolean;
  isProcessing?: boolean;
  memoryPulse?: number;
  scanlines?: boolean;
  personaName: string;
  lang?: string;
}

export const CompanionPanel: React.FC<CompanionPanelProps> = ({
  emotion,
  pose = 'default',
  camera,
  isSpeaking,
  isListening,
  isProcessing = false,
  memoryPulse = 0,
  scanlines = false,
  personaName,
  lang,
}) => {
  const t = getUiText(lang).companion;
  return (
    <div className="hidden lg:flex w-80 xl:w-96 border-l border-orange-500/30 chalkboard-grid bg-[#0a090b]/95 flex-col items-center justify-between p-4 relative shrink-0 select-none font-mono">
      {/* Subtle Top Radial Spotlight */}
      <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_50%_0%,rgba(249,115,22,0.12),transparent_70%)] pointer-events-none" />

      {/* Top Header Plate + Horizontal Power Bus */}
      <div className="relative z-10 w-full space-y-1.5">
        <div className="w-full flex items-center justify-between">
          <div className="copper-capsule px-3.5 py-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_#fb923c] animate-pulse" />
            <span className="engraved-serif text-amber-100 font-bold text-xs tracking-widest">
              {personaName.toUpperCase()}
            </span>
          </div>
          <span className="text-[10px] px-2.5 py-0.5 bg-black/80 border border-amber-900/60 text-orange-400 font-bold tracking-wider">
            {t.liveLinkBadge}
          </span>
        </div>
        <div className="bus-line-horizontal w-full" />
      </div>

      {/* Center Precision Optical Stage Frame (Centered Sprite + Top Position Controls) */}
      <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden my-3 border border-amber-900/55 bg-gradient-to-b from-[#120e0b]/90 via-[#080706]/95 to-[#050403] shadow-[inset_0_0_45px_rgba(0,0,0,0.95)]">
        <AmadeusSpriteView
          emotion={emotion}
          pose={pose}
          camera={camera}
          isSpeaking={isSpeaking}
          isListening={isListening}
          isProcessing={isProcessing}
          memoryPulse={memoryPulse}
          scanlines={scanlines}
          lang={lang}
          className="w-full h-full"
        />
      </div>

      {/* Bottom Acoustic Oscilloscope & Engraved Telemetry Readout */}
      <div className="relative z-10 w-full space-y-2.5">
        <AudioOscilloscope
          isActive={isSpeaking}
          isListening={isListening}
          lang={lang}
          className="h-14 w-full"
        />

        <div className="widescreen-steel-deck px-3 py-2 space-y-1">
          <div className="flex items-baseline text-[11px]">
            <span className="engraved-serif text-[10px] text-zinc-300 font-bold tracking-wider">
              {t.stateLabel}
            </span>
            <div className="dotted-leader" />
            <span className="text-orange-400 font-bold uppercase tracking-wider text-[11px]">
              {EMOTION_LABELS[normalizeAppLang(lang)][emotion] || emotion}
            </span>
          </div>
          <div className="flex items-baseline text-[10px]">
            <span className="engraved-serif text-[9px] text-zinc-400 font-bold tracking-wider">
              {t.poseLabel}
            </span>
            <div className="dotted-leader" />
            <span className="text-amber-200/80 uppercase tracking-wider">
              {t.poses[pose] || pose}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
