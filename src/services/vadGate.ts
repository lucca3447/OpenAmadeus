// Silero speech-probability gate; prob === null means Silero is not ready, so fall back to the legacy RMS decision
export function isVoiced(o: {
  prob: number | null;
  rms: number;
  rmsThreshold: number;
  sensitivity: number;
  speaking: boolean;
  active: boolean;
}): boolean {
  if (o.prob === null) return o.rms > o.rmsThreshold;
  const base = o.speaking ? 0.75 : o.active ? 0.35 : 0.5; // hysteresis like Silero's negativeSpeechThreshold
  const thr = Math.min(0.9, base / Math.max(0.5, Math.min(2, o.sensitivity || 1)));
  // while Kurisu talks, also require loudness so speaker echo never barges in
  return o.prob > thr && (!o.speaking || o.rms > o.rmsThreshold);
}
