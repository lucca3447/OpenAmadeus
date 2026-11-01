import React, { useEffect, useRef } from 'react';
import { SpeechService } from '../services/speechService';

interface AudioOscilloscopeProps {
  isActive: boolean;
  isListening?: boolean;
  className?: string;
}

export const AudioOscilloscope: React.FC<AudioOscilloscopeProps> = ({
  isActive,
  isListening = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.max(Math.floor(rect.width * dpr), 320);
      const targetHeight = Math.max(Math.floor(rect.height * dpr), 60);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
    };

    updateSize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateSize());
      resizeObserver.observe(canvas);
    }

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      if (!isActive && !isListening) {
        ctx.fillStyle = '#070504';
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.fillStyle = 'rgba(7, 5, 4, 0.3)';
        ctx.fillRect(0, 0, width, height);
      }

      // Warm copper/amber oscilloscope reticle grid
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.08)';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      const gridStep = Math.max(Math.floor(width / 16), 24);
      for (let x = 0; x < width; x += gridStep) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      ctx.stroke();

      const activeAnalyser = isActive
        ? SpeechService.getAnalyser()
        : isListening
          ? SpeechService.getMicAnalyser()
          : null;
      let hasRealAudio = false;
      let currentSpeed = 0.05;

      if (activeAnalyser) {
        const timeData = new Uint8Array(activeAnalyser.fftSize);
        activeAnalyser.getByteTimeDomainData(timeData);

        let variance = 0;
        for (let i = 0; i < timeData.length; i++) {
          variance += Math.abs(timeData[i] - 128);
        }

        if (variance > 30) {
          hasRealAudio = true;
          currentSpeed = 0.14;
          const waveColor = isActive ? '#fb923c' : '#38bdf8';
          ctx.beginPath();
          ctx.strokeStyle = waveColor;
          ctx.lineWidth = 2.5;
          ctx.shadowBlur = 14;
          ctx.shadowColor = waveColor;

          const sliceWidth = width / timeData.length;
          let currentX = 0;

          for (let i = 0; i < timeData.length; i++) {
            const v = timeData[i] / 128.0;
            const y = v * (height / 2);

            if (i === 0) {
              ctx.moveTo(currentX, y);
            } else {
              ctx.lineTo(currentX, y);
            }
            currentX += sliceWidth;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      if (!hasRealAudio) {
        if (isActive || isListening) {
          let baseAmplitude = height * 0.22;
          if (isActive) {
            baseAmplitude = height * 0.32 + Math.sin(phase * 3) * (height * 0.12);
            currentSpeed = 0.14;
          } else {
            baseAmplitude = height * 0.22 + Math.sin(phase * 4) * (height * 0.08);
            currentSpeed = 0.12;
          }

          ctx.beginPath();
          ctx.strokeStyle = isActive ? '#fb923c' : '#38bdf8';
          ctx.lineWidth = 2;
          ctx.shadowBlur = 12;
          ctx.shadowColor = isActive ? '#f97316' : '#38bdf8';

          for (let x = 0; x < width; x++) {
            const normX = x / width;
            const wave1 = Math.sin(normX * 16 + phase) * baseAmplitude;
            const wave2 = Math.sin(normX * 36 - phase * 1.5) * (baseAmplitude * 0.4);
            const wave3 = Math.cos(normX * 8 + phase * 0.5) * (baseAmplitude * 0.2);

            const taper = Math.sin(normX * Math.PI);
            const y = centerY + (wave1 + wave2 + wave3) * taper;

            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.38)';
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
        }
      }

      if (isActive || isListening) {
        phase += currentSpeed;
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [isActive, isListening]);

  return (
    <div
      className={`relative border border-amber-900/60 bg-[#070504] overflow-hidden shadow-[inset_0_2px_8px_rgba(0,0,0,0.95)] ${className}`}
    >
      <div className="absolute top-1.5 left-2.5 text-[10px] font-mono tracking-wider flex items-center gap-1.5 z-10 select-none pointer-events-none">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isActive
              ? 'bg-orange-400 animate-ping'
              : isListening
                ? 'bg-sky-400 animate-pulse'
                : 'bg-amber-900'
          }`}
        />
        <span className="engraved-serif text-[9px] text-amber-200/80 font-bold tracking-widest">
          OSCILOSCÓPIO:
        </span>
        <span
          className={`font-bold ${
            isActive ? 'text-orange-400' : isListening ? 'text-sky-400' : 'text-zinc-500'
          }`}
        >
          {isActive ? 'SINAL ATIVO' : isListening ? 'ESCUTA VAD' : 'REPOUSO'}
        </span>
      </div>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
