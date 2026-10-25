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
  serious: 'stern',
  tsundere: 'stern',
  smug: 'disdain',
  flustered: 'blushing',
  puzzled: 'thinking',
  desperate: 'holding_back_tears',
  look_side: 'thinking',
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

// Pose D (Braços soltos): 12 hex slots canônicos do bytecode SC3 (MAGES. Engine)
// Frame de blink: slot 'a' (fechado relaxado), exceto 'happy' que já é olhos fechados em '6'
const POSE_D_SLOTS: Record<CanonicalEmotion, string> = {
  neutral: '1',          // D_01: Neutro / Saudação formal
  wink: '2',             // D_02: Piscadela / Provocação amigável
  annoyed: '3',          // D_03: Irritada / Jitome (olhar severo)
  worried: '4',          // D_04: Preocupada / Melancólica / Empática
  sad: '5',              // D_05: Magoada / Tristeza contida (pálpebras caídas)
  happy: '6',            // D_06: Sorriso gentil / Satisfeita ("Heheh")
  stern: '7',            // D_07: Séria / Firme / Determinada
  blushing: '8',         // D_08: Envergonhada / Corada (Tsundere Flustered)
  thinking: '9',         // D_09: Pensativa / Calculando / Olhar lateral
  analytical: '9',       // D_09: Postura analítica dedutiva em Pose D
  eyes_closed: 'a',      // D_0a: Olhos fechados / Resignação / Suspiro
  surprised: 'b',        // D_0b: Surpresa / Espanto / Olhos arregalados
  holding_back_tears: 'c', // D_0c: Desespero / Choro iminente / Angústia
  disdain: '3',          // Fallback D (Jitome severo)
};

// Pose E (Braços cruzados): 7 hex slots canônicos do bytecode SC3
// Frame de blink: slot '7' (olhos fechados / ponderação sombria)
const POSE_E_SLOTS: Record<CanonicalEmotion, string> = {
  analytical: '1',       // E_01: Confiante e Analítica (postura acadêmica canônica)
  neutral: '1',          // E_01: Neutra com braços cruzados
  blushing: '2',         // E_02: Envergonhada e Inquisitiva (braços cruzados como escudo)
  happy: '3',            // E_03: Sorriso amigável e seguro
  wink: '3',             // E_03: Provocação amigável
  disdain: '4',          // E_04: Cética / Desconfiada (sobrancelha arqueada)
  thinking: '5',         // E_05: Curiosa / Intrigada (olhos para cima)
  surprised: '5',        // E_05: Intrigada por revelação
  annoyed: '6',          // E_06: Tsundere Desafiadora (queixo erguido)
  stern: '6',            // E_06: Firme desafiadora
  worried: '7',          // E_07: Ponderação sombria / reflexão difícil
  sad: '7',              // E_07: Tristeza contida em repouso
  holding_back_tears: '7', // E_07: Meditação séria / dor silenciada
  eyes_closed: '7',      // E_07: Olhos fechados
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
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000900.png`, 'auto'); // thinking (calculating)
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000b00.png`, 'auto'); // surprised (wide eyes)
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000500.png`, 'auto'); // sad (hurt downcast)
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000700.png`, 'auto'); // stern / determined
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000800.png`, 'auto'); // blushing / tsundere
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000300.png`, 'auto'); // annoyed / jitome
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}D_40000400.png`, 'auto'); // worried / empathetic
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}E_40000100.png`, 'auto'); // crossed arms analytical
  loadImg(`${SPRITE_BASE_PATH}/CRS_${camCode}E_40000400.png`, 'auto'); // crossed arms disdain
}
