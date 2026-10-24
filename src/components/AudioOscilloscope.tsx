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

    // Responsive Canvas Resizing for high-DPI razor-sharp lines
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

      // Dark obsidian background with slight persistence
      ctx.fillStyle = 'rgba(12, 14, 18, 0.28)';
      ctx.fillRect(0, 0, width, height);

      // Draw faint technical grid lines (amber/charcoal)
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.06)';
      ctx.lineWidth = 1;

      ctx.beginPath();
      // Center horizontal line
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      // Vertical grid lines
      const gridStep = Math.max(Math.floor(width / 16), 24);
      for (let x = 0; x < width; x += gridStep) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      ctx.stroke();

      // Check for real acoustic waveform from SpeechService AnalyserNode
      const analyser = SpeechService.getAnalyser();
      let hasRealAudio = false;
      let currentSpeed = 0.05;

      if (isActive && analyser) {
        const timeData = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(timeData);

        let variance = 0;
        for (let i = 0; i < timeData.length; i++) {
          variance += Math.abs(timeData[i] - 128);
        }

        if (variance > 40) {
          hasRealAudio = true;
          currentSpeed = 0.14;
          ctx.beginPath();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.5;
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#f59e0b';

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

      // Draw aesthetic harmonic wave when not using real audio
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
          ctx.strokeStyle = isActive ? '#f59e0b' : '#38bdf8';
          ctx.lineWidth = 2;
          ctx.shadowBlur = 12;
          ctx.shadowColor = isActive ? '#f59e0b' : '#38bdf8';

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
          // Precise razor-sharp horizontal reference line when in idle/standby
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
        }
      }

      if (isActive || isListening) {
        phase += currentSpeed;
      }
      if (isActive || isListening) {
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
    <div className={`relative border border-amadeus-border bg-[#0b0e14] rounded-lg overflow-hidden shadow-sm ${className}`}>
      <div className="absolute top-1.5 left-2.5 text-[10px] font-mono text-amadeus-muted tracking-wider flex items-center gap-1.5 z-10 select-none pointer-events-none">
        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#f59e0b] animate-ping' : isListening ? 'bg-[#38bdf8] animate-pulse' : 'bg-[#78350f]'}`} />
        <span className="text-[#94a3b8]">OSCILOSCÓPIO:</span>
        <span className={`font-semibold ${isActive ? 'text-[#f59e0b]' : isListening ? 'text-[#38bdf8]' : 'text-[#64748b]'}`}>
          {isActive ? 'VOZ TRANSMITINDO' : isListening ? 'MICROFONE ATIVO' : 'EM ESPERA'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
};
