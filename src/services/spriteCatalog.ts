import {
  CameraFraming,
  CanonicalEmotion,
  CharacterPose,
  Emotion,
  LegacyEmotion,
  MouthState,
} from '../types/amadeus';

export const SPRITE_BASE_PATH = '/assets/sprites/kurisu';

export const KURISU_AVATAR_DEFAULT = `${SPRITE_BASE_PATH}/CRS_JLD_40000100.png`;

export const EMOTION_ALIASES: Record<LegacyEmotion, CanonicalEmotion> = {
  smile: 'happy',
  serious: 'analytical',
  surprised: 'worried',
  tsundere: 'stern',
  thinking: 'analytical',
  smug: 'disdain',
  flustered: 'blushing',
  sad: 'holding_back_tears',
  puzzled: 'analytical',
  desperate: 'holding_back_tears',
};

export function normalizeEmotion(emotion?: Emotion): CanonicalEmotion {
  if (!emotion) return 'neutral';
  if (emotion in EMOTION_ALIASES) {
    return EMOTION_ALIASES[emotion as LegacyEmotion];
  }
  return emotion as CanonicalEmotion;
}

const CAMERA_PREFIX: Record<CameraFraming, 'JL' | 'JM' | 'JS'> = {
  closeup: 'JL',
  medium: 'JM',
  full: 'JS',
};

// Pose D (Braços soltos): 12 hex slots (1..c), blink frame is slot 'a' (except 'happy' which is already closed in '6')
const POSE_D_SLOTS: Record<CanonicalEmotion, string> = {
  neutral: '1',
  wink: '2',
  annoyed: '3',
  worried: '4',
  disdain: '5',
  happy: '6',
  stern: '7',
  blushing: '8',
  look_side: '9',
  eyes_closed: 'a',
  analytical: 'b',
  holding_back_tears: 'c',
};

// Pose E (Braços cruzados): 7 hex slots (1..7), blink frame is slot '7'
const POSE_E_SLOTS: Record<CanonicalEmotion, string> = {
  neutral: '1',
  blushing: '2',
  happy: '3',
  wink: '3',
  worried: '4',
  holding_back_tears: '4',
  disdain: '5',
  annoyed: '5',
  look_side: '5',
  stern: '6',
  analytical: '6',
  eyes_closed: '7',
};

const MOUTH_INDEX: Record<MouthState, '00' | '01' | '02'> = {
  closed: '00',
  half: '01',
  open: '02',
};

/**
 * Infers the best camera framing (JL closeup, JM medium, JS full) when camera is in 'auto' mode.
 */
export function inferCameraFraming(
  emotion: Emotion = 'neutral',
  pose: CharacterPose = 'default'
): CameraFraming {
  if (pose === 'backview') return 'full';
  return 'closeup';
}

/**
 * Resolves any of the 174 canonical MAGES sprites across JL (closeup), JM (medium), and JS (full).
 */
export function resolveKurisuSprite(
  emotion: Emotion = 'neutral',
  mouthState: MouthState = 'closed',
  isBlinking: boolean = false,
  poseOverride?: CharacterPose,
  camera: CameraFraming = 'closeup'
): string {
  const camCode = CAMERA_PREFIX[camera] || 'JM';

  if (poseOverride === 'backview') {
    return `${SPRITE_BASE_PATH}/CRS_${camCode}F_00000001.png`;
  }

  const canonical = normalizeEmotion(emotion);
  const isCrossedArms = poseOverride === 'crossed_arms';

  if (isCrossedArms) {
    const slot = isBlinking ? '7' : (POSE_E_SLOTS[canonical] || '1');
    const mouth = isBlinking ? '00' : MOUTH_INDEX[mouthState];
    return `${SPRITE_BASE_PATH}/CRS_${camCode}E_40000${slot}${mouth}.png`;
  }

  const baseSlot = POSE_D_SLOTS[canonical] || '1';
  const slot = isBlinking ? (canonical === 'happy' ? '6' : 'a') : baseSlot;
  const mouth = isBlinking ? '00' : MOUTH_INDEX[mouthState];
  return `${SPRITE_BASE_PATH}/CRS_${camCode}D_40000${slot}${mouth}.png`;
}

const preloadedCameras = new Set<CameraFraming>();
const preloadedEmotionCache = new Set<string>();

/**
 * Preloads all 3 mouth frames (00, 01, 02) for the given emotion/pose/camera
 * to ensure seamless, instantaneous lip-sync before speech begins.
 */
export function preloadEmotionSprites(
  emotion: Emotion,
  pose: CharacterPose = 'default',
  camera: CameraFraming = 'closeup'
): void {
  if (typeof window === 'undefined') return;
  const camCode = CAMERA_PREFIX[camera] || 'JL';
  const canonical = normalizeEmotion(emotion);
  const isCrossed = pose === 'crossed_arms';
  const poseCode = isCrossed ? 'E' : 'D';
  const slot = isCrossed ? (POSE_E_SLOTS[canonical] || '1') : (POSE_D_SLOTS[canonical] || '1');
  const key = `${camCode}_${poseCode}_${slot}`;

  if (preloadedEmotionCache.has(key)) return;
  preloadedEmotionCache.add(key);

  const frames = ['00', '01', '02'];
  frames.forEach((mouth) => {
    const img = new Image();
    if ('fetchPriority' in img) (img as any).fetchPriority = 'high';
    img.src = `${SPRITE_BASE_PATH}/CRS_${camCode}${poseCode}_40000${slot}${mouth}.png`;
  });
}

/**
 * Preloads active camera sprites on demand without causing a 70MB network waterfall.
 */
export function preloadPrimarySprites(camera: CameraFraming = 'closeup'): void {
  if (typeof window === 'undefined' || preloadedCameras.has(camera)) return;
  preloadedCameras.add(camera);

  const camCode = CAMERA_PREFIX[camera] || 'JL';
  const loadImg = (url: string, priority: 'high' | 'auto' = 'auto') => {
    const img = new Image();
    if ('fetchPriority' in img) {
      (img as any).fetchPriority = priority;
    }
    img.src = url;
  };

  // Immediate priority: baseline neutral mouth flap frames
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000100.png`, 'high');
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000101.png`, 'high');
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000102.png`, 'high');
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000a00.png`, 'auto'); // blink

  // High priority for happy/smile (the most common greeting expression)
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000600.png`, 'high');
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000601.png`, 'high');
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000602.png`, 'high');

  // Baseline closed frames for other core emotions
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000b00.png`, 'auto'); // thinking/analytical
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000700.png`, 'auto'); // stern/tsundere
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000800.png`, 'auto'); // blushing
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000300.png`, 'auto'); // annoyed
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000400.png`, 'auto'); // worried
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}E_40000100.png`, 'auto'); // crossed arms
}
