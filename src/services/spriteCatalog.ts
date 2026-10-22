import {
  CanonicalEmotion,
  CharacterPose,
  Emotion,
  LegacyEmotion,
  MouthState,
  SpriteExpressionFrames,
} from '../types/amadeus';

export const SPRITE_BASE_PATH = '/assets/sprites/kurisu';

export const KURISU_AVATAR_DEFAULT = `${SPRITE_BASE_PATH}/CRS_JLD_40000100.png`;

/**
 * Mapping of legacy or synonymous emotion tags to the canonical 12-emotion matrix
 */
export const EMOTION_ALIASES: Record<LegacyEmotion, CanonicalEmotion> = {
  smile: 'happy',
  serious: 'analytical',
  surprised: 'worried',
  tsundere: 'stern',
  thinking: 'analytical',
  smug: 'analytical',
  flustered: 'blushing',
  sad: 'holding_back_tears',
  puzzled: 'analytical',
  desperate: 'holding_back_tears',
};

/**
 * Normalizes any emotion (canonical or legacy) to a valid CanonicalEmotion
 */
export function normalizeEmotion(emotion?: Emotion): CanonicalEmotion {
  if (!emotion) return 'neutral';
  if (emotion in EMOTION_ALIASES) {
    return EMOTION_ALIASES[emotion as LegacyEmotion];
  }
  return emotion as CanonicalEmotion;
}

/**
 * Pose D (Default Frontal / Braços relaxados ao lado do corpo)
 * Complete 12-expression matrix (hex slots 1 to c)
 */
export const KURISU_DEFAULT_EXPRESSIONS: Record<CanonicalEmotion, SpriteExpressionFrames> = {
  neutral: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000100.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000101.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000102.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  wink: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000200.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000201.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000202.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  annoyed: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000300.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000301.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000302.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  worried: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000400.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000401.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000402.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  disdain: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000500.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000501.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000502.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  happy: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000600.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000601.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000602.png`,
    // In expression 6, eyes are already closed in a happy arc (^^)
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000600.png`,
  },
  stern: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000700.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000701.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000702.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  blushing: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000800.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000801.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000802.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  look_side: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000900.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000901.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000902.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  eyes_closed: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000a01.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000a02.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  analytical: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000b00.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000b01.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000b02.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
  holding_back_tears: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLD_40000c00.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLD_40000c01.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLD_40000c02.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLD_40000a00.png`,
  },
};

/**
 * Pose E (Braços cruzados sobre o peito com jaleco)
 * 7 canonical expressions available in MAGES engine (slots 1 to 7):
 * - Slot 1: Neutral (olhar frontal, repouso)
 * - Slot 2: Blushing (rubor evidente nas bochechas)
 * - Slot 3: Happy / Suave (sorriso amigável nos lábios)
 * - Slot 4: Worried (preocupada / aflita)
 * - Slot 5: Disdain (olhar semicerrado cético / tédio)
 * - Slot 6: Stern / Analytical (olhos bem abertos, foco intenso)
 * - Slot 7: Eyes Closed (olhos completamente fechados - frame verdadeiro de blink)
 */
export const KURISU_CROSSED_ARMS_EXPRESSIONS: Partial<Record<CanonicalEmotion, SpriteExpressionFrames>> = {
  neutral: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000100.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000101.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000102.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  blushing: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000200.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000201.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000202.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  happy: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000300.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000301.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000302.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  worried: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000400.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000401.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000402.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  disdain: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000500.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000501.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000502.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  annoyed: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000500.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000501.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000502.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  stern: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000600.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000601.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000602.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  analytical: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000600.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000601.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000602.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  eyes_closed: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000701.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000702.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
  wink: {
    mouthClosed: `${SPRITE_BASE_PATH}/CRS_JLE_40000300.png`,
    mouthHalf: `${SPRITE_BASE_PATH}/CRS_JLE_40000301.png`,
    mouthOpen: `${SPRITE_BASE_PATH}/CRS_JLE_40000302.png`,
    blinkFrame: `${SPRITE_BASE_PATH}/CRS_JLE_40000700.png`,
  },
};

/**
 * Pose F (De Costas / Back View)
 */
export const KURISU_BACKVIEW_SPRITE = `${SPRITE_BASE_PATH}/CRS_JLF_00000001.png`;

/**
 * Resolves the exact sprite file URL for Kurisu based on emotion, mouth state, blink, and pose.
 */
export function resolveKurisuSprite(
  emotion: Emotion = 'neutral',
  mouthState: MouthState = 'closed',
  isBlinking: boolean = false,
  poseOverride?: CharacterPose
): string {
  // 1. Backview pose has no face/mouth variations
  if (poseOverride === 'backview') {
    return KURISU_BACKVIEW_SPRITE;
  }

  // 2. Normalize emotion
  const canonical = normalizeEmotion(emotion);

  // 3. Determine pose: if pose is crossed_arms (or emotion was legacy 'thinking'), use Pose E
  const isCrossedArms = poseOverride === 'crossed_arms' || emotion === 'thinking';

  // 4. Select expression frame set
  let frameSet: SpriteExpressionFrames | undefined;
  if (isCrossedArms) {
    frameSet = KURISU_CROSSED_ARMS_EXPRESSIONS[canonical] || KURISU_CROSSED_ARMS_EXPRESSIONS.neutral;
  }
  if (!frameSet) {
    frameSet = KURISU_DEFAULT_EXPRESSIONS[canonical] || KURISU_DEFAULT_EXPRESSIONS.neutral;
  }

  // 5. True Blink check: if blinking and not speaking, return matching closed-eyes frame
  if (isBlinking && frameSet.blinkFrame) {
    return frameSet.blinkFrame;
  }

  // 6. Return appropriate mouth frame (00, 01, 02)
  switch (mouthState) {
    case 'open':
      return frameSet.mouthOpen;
    case 'half':
      return frameSet.mouthHalf;
    case 'closed':
    default:
      return frameSet.mouthClosed;
  }
}

/**
 * Preloads all primary sprite frames to ensure zero lag or flicker when changing expressions and poses.
 */
export function preloadPrimarySprites(): void {
  const urlsToPreload = new Set<string>();

  // Preload all Pose D frames (mouth closed, half, open, blink)
  Object.values(KURISU_DEFAULT_EXPRESSIONS).forEach((expr) => {
    urlsToPreload.add(expr.mouthClosed);
    urlsToPreload.add(expr.mouthHalf);
    urlsToPreload.add(expr.mouthOpen);
    if (expr.blinkFrame) urlsToPreload.add(expr.blinkFrame);
  });

  // Preload Pose E crossed-arms frames
  Object.values(KURISU_CROSSED_ARMS_EXPRESSIONS).forEach((expr) => {
    if (expr) {
      urlsToPreload.add(expr.mouthClosed);
      urlsToPreload.add(expr.mouthHalf);
      urlsToPreload.add(expr.mouthOpen);
      if (expr.blinkFrame) urlsToPreload.add(expr.blinkFrame);
    }
  });

  // Preload Pose F
  urlsToPreload.add(KURISU_BACKVIEW_SPRITE);

  urlsToPreload.forEach((url) => {
    const img = new Image();
    img.src = url;
  });
}
