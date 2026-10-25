import React, { useState, useEffect, useRef } from 'react';
import { CameraFraming, CameraMode, CharacterPose, Emotion, MouthState } from '../types/amadeus';
import {
  inferCameraFraming,
  normalizeEmotion,
  preloadPrimarySprites,
  preloadEmotionSprites,
  resolveKurisuSprite,
} from '../services/spriteCatalog';
import { SpeechService } from '../services/speechService';
import { Camera } from 'lucide-react';

interface AmadeusSpriteViewProps {
  emotion: Emotion;
  pose?: CharacterPose;
  camera?: CameraFraming;
  isSpeaking: boolean;
  isListening?: boolean;
  isProcessing?: boolean;
  memoryPulse?: number;
  scanlines?: boolean;
  className?: string;
}

const CAMERA_CYCLE: CameraMode[] = ['auto', 'closeup', 'medium', 'full'];
const CAMERA_LABELS: Record<CameraFraming, string> = {
  closeup: 'JL',
  medium: 'JM',
  full: 'JS',
};

export const AmadeusSpriteView: React.FC<AmadeusSpriteViewProps> = ({
  emotion,
  pose = 'default',
  camera,
  isSpeaking,
  isListening = false,
  isProcessing = false,
  memoryPulse = 0,
  scanlines = false,
  className = '',
}) => {
  const [mouthState, setMouthState] = useState<MouthState>('closed');
  const [voiceAmplitude, setVoiceAmplitude] = useState<number>(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const [idleGazeOverride, setIdleGazeOverride] = useState<Emotion | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>(() => {
    const saved = localStorage.getItem('amadeus_camera_mode');
    return saved === 'closeup' || saved === 'medium' || saved === 'full' ? saved : 'auto';
  });

  // Parallax state (-1..1 normalized mouse coords)
  const mouseRafRef = useRef<number | null>(null);
  const [parallax, setParallax] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Transition & cognitive glitch states
  const [prevFrameUrl, setPrevFrameUrl] = useState<string | null>(null);
  const [isPoseShifting, setIsPoseShifting] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);

  const lipFlapIntervalRef = useRef<number | null>(null);

  const effectiveEmotion = idleGazeOverride || emotion;
  const canonicalEmotion = normalizeEmotion(effectiveEmotion);
  const effectivePose: CharacterPose =
    pose === 'backview'
      ? 'backview'
      : pose === 'crossed_arms'
      ? 'crossed_arms'
      : 'default';

  const activeCamera: CameraFraming =
    cameraMode !== 'auto'
      ? cameraMode
      : camera || inferCameraFraming(effectiveEmotion, effectivePose);

  // Preload sprites whenever active camera changes
  useEffect(() => {
    preloadPrimarySprites(activeCamera);
  }, [activeCamera]);

  // Preload mouth flap sequence when target emotion/pose/camera updates
  useEffect(() => {
    preloadEmotionSprites(effectiveEmotion, effectivePose, activeCamera);
  }, [effectiveEmotion, effectivePose, activeCamera]);

  // Cycle camera mode on button click
  const handleCycleCamera = () => {
    const nextIdx = (CAMERA_CYCLE.indexOf(cameraMode) + 1) % CAMERA_CYCLE.length;
    const nextMode = CAMERA_CYCLE[nextIdx];
    setCameraMode(nextMode);
    localStorage.setItem('amadeus_camera_mode', nextMode);
  };

  // Track canonical emotion in ref for the autonomous blink loop
  const emotionRef = useRef(canonicalEmotion);
  emotionRef.current = canonicalEmotion;

  // Autonomous Blinking Cycle (with 22% natural double-blink)
  useEffect(() => {
    const timers: number[] = [];

    const scheduleNextBlink = () => {
      const delay = Math.floor(Math.random() * 2400) + 3200; // 3.2s - 5.6s
      const t1 = window.setTimeout(() => {
        // Skip blink if character already has eyes closed or is actively winking
        if (emotionRef.current === 'eyes_closed' || emotionRef.current === 'wink') {
          scheduleNextBlink();
          return;
        }
        setIsBlinking(true);
        const t2 = window.setTimeout(() => {
          setIsBlinking(false);
          // 22% chance of a quick double-blink
          if (Math.random() < 0.22) {
            const t3 = window.setTimeout(() => {
              setIsBlinking(true);
              const t4 = window.setTimeout(() => {
                setIsBlinking(false);
                scheduleNextBlink();
              }, 115);
              timers.push(t4);
            }, 95);
            timers.push(t3);
          } else {
            scheduleNextBlink();
          }
        }, 125);
        timers.push(t2);
      }, delay);
      timers.push(t1);
    };

    scheduleNextBlink();
    return () => timers.forEach(clearTimeout);
  }, []);

  // Autonomous Idle Saccades (look_side glance every ~12s of neutral silence)
  useEffect(() => {
    setIdleGazeOverride(null);

    if (isSpeaking || isProcessing || isListening) return;

    let gazeRevertTimer: number;
    const saccadeInterval = window.setInterval(() => {
      if (normalizeEmotion(emotion) === 'neutral' && effectivePose === 'default') {
        setIdleGazeOverride('look_side');
        gazeRevertTimer = window.setTimeout(() => setIdleGazeOverride(null), 1500);
      }
    }, 12500);

    return () => {
      clearInterval(saccadeInterval);
      clearTimeout(gazeRevertTimer);
    };
  }, [emotion, effectivePose, isSpeaking, isProcessing, isListening]);

  // Acoustic & Syllable 3-Stage Lip-Sync + Voice Amplitude Reactivity
  useEffect(() => {
    if (!isSpeaking) {
      if (lipFlapIntervalRef.current) {
        clearInterval(lipFlapIntervalRef.current);
        lipFlapIntervalRef.current = null;
      }
      setMouthState('closed');
      setVoiceAmplitude(0);
      return;
    }

    let lastAcousticTimestamp = 0;

    const unsubscribe = SpeechService.addLipSyncListener((isOpen, amplitude) => {
      if (!isSpeaking) {
        setMouthState('closed');
        setVoiceAmplitude(0);
        return;
      }
      if (isOpen || amplitude > 0.05) {
        lastAcousticTimestamp = Date.now();
      }
      setVoiceAmplitude(isOpen ? Math.min(1, amplitude) : 0);

      if (!isOpen) {
        setMouthState('closed');
      } else if (amplitude > 0.45) {
        setMouthState('open');
      } else {
        setMouthState('half');
      }
    });

    // Fallback lip-flap animator for browser TTS when no Web Audio stream is active
    let flapStep = 0;
    lipFlapIntervalRef.current = window.setInterval(() => {
      if (!isSpeaking) return;
      if (Date.now() - lastAcousticTimestamp > 300) {
        flapStep = (flapStep + 1) % 4;
        const states: MouthState[] = ['closed', 'half', 'open', 'half'];
        const amps = [0.05, 0.3, 0.65, 0.25];
        setMouthState(states[flapStep]);
        setVoiceAmplitude(amps[flapStep]);
      }
    }, 120);

    return () => {
      unsubscribe();
      if (lipFlapIntervalRef.current) {
        clearInterval(lipFlapIntervalRef.current);
        lipFlapIntervalRef.current = null;
      }
      setMouthState('closed');
      setVoiceAmplitude(0);
    };
  }, [isSpeaking]);

  // Determine current image frame
  const activeBlinking = isBlinking && !isSpeaking;
  const currentFrameUrl = resolveKurisuSprite(
    effectiveEmotion,
    mouthState,
    activeBlinking,
    effectivePose,
    activeCamera
  );

  // Detect Pose or Camera shifts for Double-Buffer Crossfade and Spring Bounce
  const lastPoseRef = useRef<CharacterPose>(effectivePose);
  const lastCameraRef = useRef<CameraFraming>(activeCamera);
  const lastDisplayedUrlRef = useRef<string>(currentFrameUrl);

  useEffect(() => {
    const poseChanged = lastPoseRef.current !== effectivePose;
    const cameraChanged = lastCameraRef.current !== activeCamera;

    if (poseChanged || cameraChanged) {
      setPrevFrameUrl(lastDisplayedUrlRef.current);
      setIsPoseShifting(true);

      lastPoseRef.current = effectivePose;
      lastCameraRef.current = activeCamera;
      lastDisplayedUrlRef.current = currentFrameUrl;

      const t = window.setTimeout(() => {
        setPrevFrameUrl(null);
        setIsPoseShifting(false);
      }, 240);
      return () => clearTimeout(t);
    }

    lastDisplayedUrlRef.current = currentFrameUrl;
  }, [effectivePose, activeCamera, currentFrameUrl]);

  // Trigger 130ms Cognitive Glitch when memories are recalled
  useEffect(() => {
    if (!memoryPulse) return;
    setIsGlitching(true);
    const t = window.setTimeout(() => setIsGlitching(false), 140);
    return () => clearTimeout(t);
  }, [memoryPulse]);

  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    setImageError(false);
  }, [currentFrameUrl]);

  const isAgitated =
    canonicalEmotion === 'blushing' ||
    canonicalEmotion === 'annoyed' ||
    canonicalEmotion === 'stern' ||
    canonicalEmotion === 'worried' ||
    canonicalEmotion === 'surprised' ||
    canonicalEmotion === 'holding_back_tears';

  const breatheClass = isAgitated ? 'animate-amadeus-breathe-fast' : 'animate-amadeus-breathe';
  const voiceBounceY = isSpeaking ? -Math.round(voiceAmplitude * 2.5) : isListening ? -1 : 0;
  const glowAlpha = (0.22 + voiceAmplitude * 0.36).toFixed(2);

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center overflow-hidden select-none ${className}`}
      onMouseMove={(e) => {
        if (mouseRafRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        mouseRafRef.current = requestAnimationFrame(() => {
          setParallax({ x: nx, y: ny });
          mouseRafRef.current = null;
        });
      }}
      onMouseLeave={() => {
        if (mouseRafRef.current) {
          cancelAnimationFrame(mouseRafRef.current);
          mouseRafRef.current = null;
        }
        setParallax({ x: 0, y: 0 });
      }}
    >
      {/* Subtle 2.5D Background Telemetry Ring (moves opposite to cursor) */}
      <div
        className="absolute w-72 h-72 rounded-full border border-[#f59e0b]/10 pointer-events-none transition-transform duration-300 ease-out"
        style={{
          transform: `translate3d(${(-parallax.x * 5).toFixed(1)}px, ${(-parallax.y * 5).toFixed(1)}px, 0)`,
        }}
      />

      {/* Discreet Camera Framing Button (Auto / JL / JM / JS) */}
      <button
        type="button"
        onClick={handleCycleCamera}
        title="Alternar enquadramento de câmera (Auto / Meio-Corpo JM / Close-up JL / Corpo Inteiro JS)"
        className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#121620]/80 hover:bg-[#1c2232] border border-[#2a3246] text-[10px] font-mono text-[#94a3b8] hover:text-[#f59e0b] transition-colors shadow-sm"
      >
        <Camera className="w-3 h-3 text-[#f59e0b]" />
        <span>
          {cameraMode === 'auto'
            ? `AUTO·${CAMERA_LABELS[activeCamera]}`
            : CAMERA_LABELS[activeCamera]}
        </span>
      </button>

      {/* Character Sprite Stage with 2.5D Foreground Parallax & Voice Micro-Bounce */}
      <div
        className="relative z-10 w-full h-full flex items-end justify-center pointer-events-none pt-4 pb-1 transition-transform duration-150 ease-out"
        style={{
          transform: `translate3d(${(parallax.x * 3.5).toFixed(1)}px, ${(parallax.y * 2 + voiceBounceY).toFixed(1)}px, 0)`,
        }}
      >
        {!imageError ? (
          <div
            className={`relative h-full max-h-full flex items-end justify-center ${breatheClass} ${
              isPoseShifting ? 'animate-amadeus-pose-shift' : ''
            } ${isGlitching ? 'animate-amadeus-glitch' : ''}`}
          >
            {/* Previous Frame Crossfade Layer during Pose/Camera Shifts */}
            {prevFrameUrl && prevFrameUrl !== currentFrameUrl && (
              <img
                src={prevFrameUrl}
                alt=""
                aria-hidden="true"
                className="absolute bottom-0 h-full max-h-full w-auto object-contain object-bottom animate-fadeOutQuick pointer-events-none"
                draggable={false}
              />
            )}

            {/* Primary Active Sprite */}
            <img
              src={currentFrameUrl}
              alt="OpenAmadeus Companion Sprite"
              className="h-full max-h-full w-auto object-contain object-bottom transition-opacity duration-150"
              style={{
                filter: `drop-shadow(0 0 ${Math.round(28 + voiceAmplitude * 18)}px rgba(245, 158, 11, ${glowAlpha}))`,
              }}
              draggable={false}
              onError={() => setImageError(true)}
              onLoad={() => setImageError(false)}
            />
          </div>
        ) : (
          /* Holographic Silhouette Fallback (Zero Copyright / Modular Avatar Mode) */
          <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center select-none animate-fadeIn">
            <div className="relative flex items-center justify-center mb-4">
              <div
                className={`absolute w-36 h-36 rounded-full border border-[#f59e0b]/40 transition-all duration-300 ${
                  isSpeaking ? 'scale-125 opacity-80 animate-ping' : 'scale-100 opacity-20'
                }`}
              />
              <div
                className={`absolute w-44 h-44 rounded-full border border-[#38bdf8]/30 transition-all duration-500 ${
                  isSpeaking ? 'scale-110 opacity-60' : 'scale-90 opacity-10'
                }`}
              />

              <div className="relative w-28 h-28 rounded-full bg-gradient-to-b from-[#1c2230] to-[#0c0e14] border-2 border-[#f59e0b] shadow-[0_0_35px_rgba(245,158,11,0.35)] flex items-center justify-center overflow-hidden">
                <svg
                  viewBox="0 0 100 100"
                  className={`w-20 h-20 text-[#f59e0b] transition-transform duration-300 ${
                    isSpeaking ? 'scale-105' : 'scale-100'
                  }`}
                  fill="currentColor"
                >
                  <path
                    d="M50 20 A18 18 0 0 0 32 38 C32 46 36 51 40 54 C30 58 20 68 18 82 C28 85 40 86 50 86 C60 86 72 85 82 82 C80 68 70 58 60 54 C64 51 68 46 68 38 A18 18 0 0 0 50 20 Z"
                    opacity="0.85"
                  />
                  <path d="M30 38 Q25 50 28 65 Q33 55 35 48 Z" opacity="0.6" />
                  <path d="M70 38 Q75 50 72 65 Q67 55 65 48 Z" opacity="0.6" />
                </svg>

                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#f59e0b]/15 to-transparent animate-pulse pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161b26] border border-[#2d374d] text-[#f59e0b] tracking-wider font-semibold">
                MODO SILHUETA HOLOGRÁFICA
              </span>
              <p className="text-[11px] text-[#8892a4] font-mono leading-relaxed">
                Assets visuais da persona não encontrados. Para usar sprites de anime, execute{' '}
                <code className="text-[#38bdf8] bg-[#121620] px-1 py-0.5 rounded">
                  python scripts/setup_sprites.py
                </code>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Neural Processing Scan Beam when LLM is thinking */}
      {isProcessing && (
        <div className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-[#f59e0b]/10 to-transparent animate-pulse pointer-events-none z-20" />
      )}

      {/* Local Scanline Overlay if enabled specifically */}
      {scanlines && <div className="absolute inset-0 crt-scanlines pointer-events-none z-20" />}

      {/* Subtle Depth Vignette */}
      <div className="absolute inset-0 pointer-events-none z-20 shadow-[inset_0_0_90px_rgba(0,0,0,0.85)]" />
    </div>
  );
};
