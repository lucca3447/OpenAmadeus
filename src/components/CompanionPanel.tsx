import React from 'react';
import { CameraFraming, Emotion, CharacterPose } from '../types/amadeus';
import { AmadeusSpriteView } from './AmadeusSpriteView';
import { AudioOscilloscope } from './AudioOscilloscope';

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
}) => {
  return (
    <div className="hidden lg:flex w-80 xl:w-96 border-l border-[#222836] bg-[#0e1117] flex-col items-center justify-between p-4 relative shrink-0 select-none font-mono">
      {/* Header Info */}
      <div className="w-full flex items-center justify-between text-[11px] text-[#717d96] border-b border-[#202532] pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
          <span className="text-[#f59e0b] font-bold tracking-wider text-glow-nixie">
            {personaName.toUpperCase()}
          </span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-[#161a22] border border-[#2d3546] text-[#cbd5e1]">
          CONEXÃO ATIVA
        </span>
      </div>

      {/* Center Sprite Stage */}
      <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden my-2">
        <AmadeusSpriteView
          emotion={emotion}
          pose={pose}
          camera={camera}
          isSpeaking={isSpeaking}
          isListening={isListening}
          isProcessing={isProcessing}
          memoryPulse={memoryPulse}
          scanlines={scanlines}
          className="h-full"
        />
      </div>

      {/* Bottom: Voice Oscilloscope & Mood Badge */}
      <div className="w-full space-y-2">
        <AudioOscilloscope
          isActive={isSpeaking}
          isListening={isListening}
          className="h-14 w-full"
        />

        <div className="flex items-center justify-between text-[11px] px-1 font-mono text-[#8892a4]">
          <span>HUMOR:</span>
          <span className="text-[#f59e0b] font-bold uppercase tracking-wider">
            {emotion.replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  );
};
