import React, { useState, useEffect, useRef } from 'react';
import { getUiText } from '../i18n';
import { CameraFraming, CameraMode, CharacterPose, Emotion, MouthState } from '../types/amadeus';
import {
  inferCameraFraming,
  normalizeEmotion,
  preloadPrimarySprites,
  preloadEmotionSprites,
  resolveKurisuSprite,
} from '../services/spriteCatalog';
import { SpeechService } from '../services/speechService';
import { Camera, User } from 'lucide-react';

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
  lang?: string;
}

const CAMERA_CYCLE: CameraMode[] = ['auto', 'closeup', 'medium', 'full'];
const CAMERA_LABELS: Record<CameraFraming, string> = {
  closeup: 'CLOSE-UP (JL)',
  medium: 'MEDIUM (JM)',
  full: 'FULL (JS)',
};

const POSE_CYCLE: Array<'auto' | CharacterPose> = ['auto', 'default', 'crossed_arms', 'backview'];
const POSE_LABELS: Record<'auto' | CharacterPose, string> = {
  auto: 'POSE: AUTO',
  default: 'POSE: FRONT',
  crossed_arms: 'POSE: CROSSED ARMS',
  backview: 'POSE: BACKVIEW',
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
  lang,
}) => {
  const t = getUiText(lang).sprite;
  const [mouthState, setMouthState] = useState<MouthState>('closed');
  const [voiceAmplitude, setVoiceAmplitude] = useState<number>(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const [idleGazeOverride, setIdleGazeOverride] = useState<Emotion | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>(() => {
    const saved = localStorage.getItem('amadeus_camera_mode');
    return saved === 'closeup' || saved === 'medium' || saved === 'full' ? saved : 'auto';
  });

  const [poseOverride, setPoseOverride] = useState<'auto' | CharacterPose>(() => {
    const saved = localStorage.getItem('amadeus_pose_override');
    return saved === 'default' || saved === 'crossed_arms' || saved === 'backview' ? saved : 'auto';
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
  const basePose: CharacterPose =
    pose === 'backview'
      ? 'backview'
      : pose === 'crossed_arms'
        ? 'crossed_arms'
        : 'default';

  const effectivePose: CharacterPose = poseOverride !== 'auto' ? poseOverride : basePose;

  const activeCamera: CameraFraming =
    cameraMode !== 'auto'
      ? cameraMode
      : camera || inferCameraFraming(effectiveEmotion, effectivePose);

  useEffect(() => {
    preloadPrimarySprites(activeCamera);
  }, [activeCamera]);

  useEffect(() => {
    preloadEmotionSprites(effectiveEmotion, effectivePose, activeCamera);
  }, [effectiveEmotion, effectivePose, activeCamera]);

  const handleCycleCamera = () => {
    const nextIdx = (CAMERA_CYCLE.indexOf(cameraMode) + 1) % CAMERA_CYCLE.length;
    const nextMode = CAMERA_CYCLE[nextIdx];
    setCameraMode(nextMode);
    localStorage.setItem('amadeus_camera_mode', nextMode);
  };

  const handleCyclePose = () => {
    const nextIdx = (POSE_CYCLE.indexOf(poseOverride) + 1) % POSE_CYCLE.length;
    const nextPose = POSE_CYCLE[nextIdx];
    setPoseOverride(nextPose);
    localStorage.setItem('amadeus_pose_override', nextPose);
  };

  const emotionRef = useRef(canonicalEmotion);
  emotionRef.current = canonicalEmotion;

  // Autonomous Blinking Cycle (with 22% natural double-blink)
  useEffect(() => {
    const timers: number[] = [];

    const scheduleNextBlink = () => {
      const delay = Math.floor(Math.random() * 2400) + 3200;
      const t1 = window.setTimeout(() => {
        if (emotionRef.current === 'eyes_closed' || emotionRef.current === 'wink') {
          scheduleNextBlink();
          return;
        }
        setIsBlinking(true);
        const t2 = window.setTimeout(() => {
          setIsBlinking(false);
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

  // Autonomous Idle Saccades
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

    const unsubscribe = SpeechService.addLipSyncListener((isOpen, amplitude, formantMouth) => {
      if (!isSpeaking) {
        setMouthState('closed');
        setVoiceAmplitude(0);
        return;
      }
      if (isOpen || amplitude > 0.05) {
        lastAcousticTimestamp = Date.now();
      }
      setVoiceAmplitude(isOpen ? Math.min(1, amplitude) : 0);

      if (formantMouth) {
        setMouthState(formantMouth);
      } else if (!isOpen) {
        setMouthState('closed');
      } else if (amplitude > 0.45) {
        setMouthState('open');
      } else {
        setMouthState('half');
      }
    });

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

  const activeBlinking = isBlinking && !isSpeaking;
  const currentFrameUrl = resolveKurisuSprite(
    effectiveEmotion,
    mouthState,
    activeBlinking,
    effectivePose,
    activeCamera
  );

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
  const glowAlpha = (0.24 + voiceAmplitude * 0.38).toFixed(2);

  return (
    <div
      className={`relative w-full h-full flex flex-col items-center justify-center overflow-hidden select-none ${className}`}
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
      {/* Corner Optical Reticles (+) */}
      <div className="absolute top-2.5 left-2.5 w-3 h-3 border-t border-l border-orange-500/50 pointer-events-none z-20" />
      <div className="absolute top-2.5 right-2.5 w-3 h-3 border-t border-r border-orange-500/50 pointer-events-none z-20" />
      <div className="absolute bottom-2.5 left-2.5 w-3 h-3 border-b border-l border-orange-500/50 pointer-events-none z-20" />
      <div className="absolute bottom-2.5 right-2.5 w-3 h-3 border-b border-r border-orange-500/50 pointer-events-none z-20" />

      {/* Top Centered Position & Camera Control Bar */}
      <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={handleCyclePose}
          title={t.togglePoseTitle}
          className="copper-capsule flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono text-amber-200 hover:text-white whitespace-nowrap"
        >
          <User className="w-3 h-3 text-orange-400 shrink-0" />
          <span className="engraved-serif font-bold tracking-wider">
            {(t.poses as Record<string, string>)[poseOverride] || POSE_LABELS[poseOverride]}
          </span>
        </button>

        <button
          type="button"
          onClick={handleCycleCamera}
          title={t.toggleCameraTitle}
          className="copper-capsule flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono text-amber-200 hover:text-white whitespace-nowrap"
        >
          <Camera className="w-3 h-3 text-orange-400 shrink-0" />
          <span className="engraved-serif font-bold tracking-wider">
            {cameraMode === 'auto'
              ? `AUTO · ${(t.cameras as Record<string, string>)[activeCamera] || CAMERA_LABELS[activeCamera]}`
              : (t.cameras as Record<string, string>)[activeCamera] || CAMERA_LABELS[activeCamera]}
          </span>
        </button>
      </div>

      {/* Concentric Clockwork Astrolabe Rings behind Kurisu (centered) */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none transition-transform duration-300 ease-out"
        style={{
          transform: `translate3d(${(-parallax.x * 6).toFixed(1)}px, ${(-parallax.y * 6).toFixed(1)}px, 0)`,
        }}
      >
        <svg className="w-72 h-72 md:w-80 md:h-80 spin-cw-slow opacity-25" viewBox="0 0 260 260">
          <circle cx="130" cy="130" r="120" fill="none" stroke="#f97316" strokeWidth="1" strokeDasharray="8 4" />
          <circle cx="130" cy="130" r="102" fill="none" stroke="#fbbf24" strokeWidth="0.75" />
          <path d="M130 4 L130 18 M130 242 L130 256 M4 130 L18 130 M242 130 L256 130" stroke="#f97316" strokeWidth="1.5" />
        </svg>
        <svg className="absolute w-56 h-56 md:w-64 md:h-64 spin-ccw-med opacity-20" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="90" fill="none" stroke="#f97316" strokeWidth="1.2" strokeDasharray="18 10" />
        </svg>
      </div>

      {/* Centered Character Sprite Stage */}
      <div
        className="relative z-10 w-full h-full flex items-center justify-center pointer-events-none pt-11 pb-2 px-2 transition-transform duration-150 ease-out"
        style={{
          transform: `translate3d(${(parallax.x * 3.5).toFixed(1)}px, ${(parallax.y * 2 + voiceBounceY).toFixed(1)}px, 0)`,
        }}
      >
        {!imageError ? (
          <div
            className={`relative w-full h-full flex items-center justify-center ${breatheClass} ${
              isPoseShifting ? 'animate-amadeus-pose-shift' : ''
            } ${isGlitching ? 'animate-amadeus-glitch' : ''}`}
          >
            {prevFrameUrl && prevFrameUrl !== currentFrameUrl && (
              <img
                src={prevFrameUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 m-auto max-h-full max-w-full w-auto h-auto object-contain object-center animate-fadeOutQuick pointer-events-none"
                draggable={false}
              />
            )}

            <img
              src={currentFrameUrl}
              alt="OpenAmadeus Companion Sprite"
              className="mx-auto my-auto max-h-full max-w-full w-auto h-auto object-contain object-center transition-opacity duration-150"
              style={{
                filter: `drop-shadow(0 0 ${Math.round(28 + voiceAmplitude * 18)}px rgba(249, 115, 22, ${glowAlpha}))`,
              }}
              draggable={false}
              onError={() => setImageError(true)}
              onLoad={() => setImageError(false)}
            />
          </div>
        ) : (
          /* Holographic Silhouette Fallback */
          <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center select-none animate-fadeIn">
            <div className="relative flex items-center justify-center mb-4">
              <div
                className={`absolute w-36 h-36 rounded-full border border-orange-500/40 transition-all duration-300 ${
                  isSpeaking ? 'scale-125 opacity-80 animate-ping' : 'scale-100 opacity-20'
                }`}
              />
              <div className="relative w-28 h-28 rounded-full bg-gradient-to-b from-[#1c140e] to-[#090706] border-2 border-orange-400 shadow-[0_0_35px_rgba(249,115,22,0.35)] flex items-center justify-center overflow-hidden">
                <svg
                  viewBox="0 0 100 100"
                  className={`w-20 h-20 text-orange-400 transition-transform duration-300 ${
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
              </div>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <span className="engraved-serif text-[10px] px-2.5 py-0.5 bg-black/80 border border-amber-900/60 text-orange-400 tracking-widest font-bold">
                {t.fallbackSilhouette}
              </span>
              <p className="text-[11px] text-zinc-400 font-mono leading-relaxed">
                {' '}
                <code className="text-amber-300 bg-black/80 px-1 py-0.5 border border-amber-900/50">
                  python scripts/setup_sprites.py
                </code>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Neural Processing Scan Beam when LLM is thinking */}
      {isProcessing && (
        <div className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-orange-500/15 to-transparent animate-pulse pointer-events-none z-20" />
      )}

      {/* Local Scanline Overlay if enabled */}
      {scanlines && <div className="absolute inset-0 crt-scanlines pointer-events-none z-20" />}

      {/* Subtle Depth Vignette */}
      <div className="absolute inset-0 pointer-events-none z-20 shadow-[inset_0_0_85px_rgba(0,0,0,0.88)]" />
    </div>
  );
};
