import React, { useState, useEffect } from 'react';
import { BackendService } from '../services/backendService';

export const DivergenceMeter: React.FC = () => {
  const [telemetry, setTelemetry] = useState<string>('24.0kHz');
  const [busLabel, setBusLabel] = useState<string>('PCM16 Neural Audio Bus');
  const [isHovered, setIsHovered] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchTelemetry = async () => {
      try {
        const data = await BackendService.getDivergence();
        if (isMounted) {
          // Normalize legacy worldline strings into OpenAmadeus technical telemetry
          const rawDiv = data.divergence || '24.008';
          const isLegacyLore =
            !data.worldline ||
            data.worldline.toLowerCase().includes('steins') ||
            data.worldline.toLowerCase().includes('beta') ||
            data.worldline.toLowerCase().includes('alpha');
          setTelemetry(rawDiv === '1.048596' ? '24.0kHz' : rawDiv.slice(0, 6));
          setBusLabel(isLegacyLore ? 'PCM16 Neural Audio Bus' : data.worldline);
        }
      } catch {
        // Keep default 24.0kHz telemetry
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const displayChars = telemetry.padEnd(6, '0').slice(0, 6).split('');

  return (
    <div
      className="relative hidden md:flex items-center gap-1 px-2.5 py-1 rounded bg-[#070504] border border-amber-900/50 shadow-inner cursor-help select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={`Barramento Acústico: ${telemetry} [${busLabel}]`}
    >
      {displayChars.map((char, idx) => (
        <div key={idx} className="vacuum-nixie-tube">
          <span className="nixie-ghost-stack">{idx % 2 === 0 ? '8' : '0'}</span>
          <span className="nixie-cathode-lit">{char}</span>
        </div>
      ))}
      <div className="pl-2 flex flex-col leading-tight">
        <span className="text-[9px] font-mono text-amber-500/80 uppercase tracking-widest">SRATE</span>
        <span className="text-[10px] font-mono text-emerald-400 font-bold">PCM</span>
      </div>

      {isHovered && (
        <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 bg-[#0d0a08] border border-orange-500/50 text-amber-200 text-[10px] font-mono px-3 py-1.5 rounded shadow-2xl whitespace-nowrap pointer-events-none">
          <div className="font-bold text-orange-400 tracking-wider">TELEMETRIA DE BARRAMENTO</div>
          <div className="text-[9px] text-zinc-300">{busLabel} • {telemetry}</div>
        </div>
      )}
    </div>
  );
};
