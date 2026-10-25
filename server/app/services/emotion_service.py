import re
from typing import Optional, Tuple
from app.schemas.chat import LearnedMemoryInfo

VALID_EMOTIONS = [
    # Canonical 21 Visual Novel / OpenAmadeus emotions
    "neutral", "tsundere", "flustered", "blushing", "smile", "happy",
    "serious", "analytical", "thinking", "annoyed", "stern", "smug",
    "disdain", "puzzled", "worried", "sad", "holding_back_tears",
    "desperate", "wink", "look_side", "eyes_closed",
]

def is_scratchpad_or_reasoning(text: Optional[str]) -> bool:
    """
    Detects if the text is an internal AI scratchpad / chain-of-thought planning monologue
    rather than dialogue spoken by the character in Portuguese.
    """
    if not text:
        return True
    t = text.strip()
    if not t:
        return True

    # 1. Obvious English or Portuguese meta-planning starts
    start_patterns = [
        r"^the user\b",
        r"^according to (?:the )?instructions\b",
        r"^i need to (?:respond|act|think|make|create|follow)\b",
        r"^i should (?:respond|act|think|make|create|follow)\b",
        r"^let me (?:think|draft|see|structure|analyze|break)\b",
        r"^let\'s (?:think|draft|see|structure|analyze|break)\b",
        r"^here is (?:my|the) (?:plan|thought|response)\b",
        r"^first, let's\b",
        r"^first, i should\b",
        r"^in this interaction\b",
        r"^to respond to the user\b",
        r"^thinking process:\b",
        r"^analysis:\b",
        r"^plan:\b",
        r"^o usu[áa]rio (?:quer|pediu|compartilhou)\b",
        r"^devo responder (?:como|em)\b",
        r"^preciso responder (?:como|em)\b",
    ]
    for pattern in start_patterns:
        if re.search(pattern, t, re.IGNORECASE):
            return True

    # 2. Strong meta-analysis indicators
    meta_phrases = [
        r"according to the instructions",
        r"the user wants me to",
        r"i need to respond as makise kurisu",
        r"let me draft the response",
        r"so i should structure it as",
        r"now for the memory tag",
        r"let me think about the emotion",
        r"my dialogue text",
    ]
    matches = sum(1 for p in meta_phrases if re.search(p, t, re.IGNORECASE))
    if matches >= 2:
        return True

    return False

def strip_thinking_tags(raw: Optional[str]) -> str:
    """
    Strips internal chain-of-thought blocks such as:
    - <think>...</think>
    - <thought>...</thought>
    - <reasoning>...</reasoning>
    - <reflection>...</reflection>
    - <scratchpad>...</scratchpad>
    - Unclosed thinking tags (when generation finishes inside thought)
    - Markdown thought headers like **Thinking Process:**
    - Rejects pure scratchpads/planning text
    """
    if not raw:
        return ""
    text = raw
    text = re.sub(r"(?is)<(think|thought|reasoning|reflection|internal|scratchpad)>.*?</\1>", "", text)
    text = re.sub(r"(?is)<(think|thought|reasoning|reflection|internal|scratchpad)>.*$", "", text)
    text = re.sub(r"(?is)\*{0,2}(?:thinking(?:\s+process)?|racioc[íi]nio|pensamento):\*{0,2}.*?\n\n", "", text)
    
    if is_scratchpad_or_reasoning(text):
        return ""

    return text.strip()

def parse_tags(raw: Optional[str], user_message: Optional[str] = None) -> Tuple[str, str, Optional[LearnedMemoryInfo]]:
    """
    Parses both <!--emotion:xxx--> and <!--remember:title|content|emotion-->
    after stripping any internal reasoning/thinking blocks.
    Sanitizes stage directions, handles piped/multi-token tags (e.g. happy|smile),
    and maps user action intents to appropriate Kurisu sprites.
    """
    clean = strip_thinking_tags(raw)
    learned_info = None

    if not clean or is_scratchpad_or_reasoning(clean):
        return "", "neutral", None

    # 1. Parse remember tag
    remember_match = re.search(r"<!--remember:(.*?)\|(.*?)\|(.*?)-->", clean, re.IGNORECASE)
    if remember_match:
        title = remember_match.group(1).strip()
        content = remember_match.group(2).strip()
        emotion = remember_match.group(3).strip()
        # Protect against dummy placeholders
        if not re.match(r"(?i)^(t[íi]tulo curto|fato memorizado|sentimento)$", title):
            learned_info = LearnedMemoryInfo(title=title, content=content, emotionalWeight=emotion)
        clean = re.sub(r"<!--remember:.*?-->", "", clean, flags=re.IGNORECASE)

    # 2. Parse emotion tag (isolated <!--emotion:...--> or composite <!--emotion:tsundere,pose:...-->)
    emotion = "neutral"
    emotion_match = None
    comment_matches = re.findall(r"<!--([\s\S]*?)-->", clean, re.IGNORECASE)
    for c in comment_matches:
        if c.strip().lower().startswith("remember:"):
            continue
        emo_m = re.search(r"(?:^|[,;|\s])emotion\s*:\s*([^,;|\s>]+)", c, re.IGNORECASE)
        if emo_m:
            raw_emo_val = emo_m.group(1).lower().strip()
            tokens = re.split(r"[\s|,;/]+", raw_emo_val)
            for tok in tokens:
                if tok in VALID_EMOTIONS:
                    emotion = tok
                    emotion_match = emo_m
                    break

    # Infallible removal of all comment tags so zero metadata leaks into speech
    clean = re.sub(r"<!--[\s\S]*?-->", "", clean)

    # 3. Detect actions from asterisks stage directions before stripping (e.g. *sorri*, *fica pensativa*)
    asterisk_matches = re.findall(r"\*([^*]+)\*", clean)
    for act in asterisk_matches:
        act_lower = act.lower()
        if emotion in ("neutral", "serious"):
            if any(w in act_lower for w in ["sorri", "sorriso", "alegre", "risad"]):
                emotion = "smile"
            elif any(w in act_lower for w in ["pensa", "pensativ", "olha para cima", "queixo"]):
                emotion = "thinking"
            elif any(w in act_lower for w in ["brava", "irritad", "emburrad", "cruza os braços"]):
                emotion = "annoyed"
            elif any(w in act_lower for w in ["cora", "vergonha", "tímid", "desvia o olhar"]):
                emotion = "tsundere"
            elif any(w in act_lower for w in ["surpres", "assustad", "choque"]):
                emotion = "surprised"
            elif any(w in act_lower for w in ["confus", "dúvida", "inclin"]):
                emotion = "puzzled"
            elif any(w in act_lower for w in ["triste", "chora", "lágrima"]):
                emotion = "sad"

    # Strip asterisks stage directions from dialogue
    clean = re.sub(r"\*[^*]+\*", "", clean)

    # 4. Context-aware inference from user intent & physical command triggers (only when LLM tag was not explicit)
    if user_message and (not emotion_match or emotion in ("neutral", "serious")):
        u_lower = user_message.lower()
        if re.search(r"(?i)\b(barata|fujiko|inseto|insetos)\b", u_lower):
            emotion = "desperate"
        elif re.search(r"(?i)\b(christina|assistente|zombie)\b", u_lower):
            emotion = "annoyed"
        elif re.search(r"(?i)\b(linda|fofa|bonita|maravilhosa|atraente|perfeita|cora|corada|vergonha|envergonhada|t[íi]mida|bochechas)\b", u_lower):
            emotion = "flustered"
        elif re.search(r"(?i)\b(d[eê]|d[aá]|um)?\s*(sorriso|sorria|sorri)\b", u_lower):
            if emotion in ("neutral", "serious", "tsundere"):
                emotion = "smile"
        elif re.search(r"(?i)\b(pense|pensativa|reflita|m[aã]o no queixo|analise)\b", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "thinking"
        elif re.search(r"(?i)\b(brava|irritada|emburrada|cruze os bra[çc]os|bra[çc]os cruzados)\b", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "annoyed"
        elif re.search(r"(?i)\b(confusa|d[úu]vida|incline a cabe[çc]a)\b", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "puzzled"
        elif re.search(r"(?i)\b(surpresa|assustada|olhos arregalados)\b", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "surprised"
        elif re.search(r"(?i)\b(triste|chore|chora|l[áa]grimas)\b", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "sad"

    # 5. Assistant dialogue sentiment fallback & vocal stuttering detection
    lower = clean.lower()
    if emotion in ("neutral", "serious"):
        if re.search(r"\b(n-não|q-quem|c-como|o-o que|b-bem|s-se você|l-linda|f-fofa)\b", lower):
            emotion = "flustered"
        elif any(w in lower for w in ["barata", "fujiko", "tirem isso de perto", "socorro"]):
            emotion = "desperate"
        elif any(w in lower for w in ["idiota", "não me entenda mal", "ora essa", "francamente", "baka"]):
            emotion = "tsundere"
        elif any(w in lower for w in ["o quê", "como assim", "?!"]):
            emotion = "surprised"
        elif any(w in lower for w in ["óbvio", "elementar", "como previsto", "como esperado", "naturalmente"]):
            emotion = "smug"
        elif any(w in lower for w in ["pesquisa", "teoria", "física", "sinapse", "hipótese", "kerr"]):
            emotion = "thinking"
        elif any(w in lower for w in ["obrigada", "fico feliz", "sorriso", "sorri"]):
            emotion = "smile"
        elif any(w in lower for w in ["triste", "sinto muito", "lágrimas", "desculpe", "mayuri"]):
            emotion = "sad"
        elif any(w in lower for w in ["estranho", "como pode", "não faz sentido", "curioso", "inexplicável"]):
            emotion = "puzzled"
        elif any(w in lower for w in ["por favor", "não desista", "urgente", "precisamos"]):
            emotion = "desperate"

    # 6. Sanitize robotic action narration phrases and parenthetical stage directions
    clean = re.sub(r"(?i)\((?:sorri|sorrindo|pensativa|pensando|brava|irritada|corada|envergonhada|com a mão no queixo|de braços cruzados)\)", "", clean)
    clean = re.sub(r"(?i)^(?:claro[,. ]+)?aqui vai um sorriso para voc[eê][.,! ]*", "U-um sorriso? Se você faz tanta questão... mas não se acostume com isso! ", clean)
    clean = re.sub(r"(?i)^(?:aqui est[aá] o meu sorriso|aqui vai o meu sorriso)[.,!:]*", "", clean)
    clean = re.sub(r"(?i)^(?:aqui est[aá] uma express[aã]o pensativa|aqui vai uma pose pensativa)[.,!:]*", "", clean)
    clean = re.sub(r"(?i)^(?:vou cruzar os bra[çc]os|estou de bra[çc]os cruzados)[.,!:]*", "", clean)
    clean = re.sub(r"(?i)^(?:estou com a m[aã]o no queixo)[.,!:]*", "", clean)

    # Strip residual emoticons like :) :-D xD
    clean = re.sub(r"[:;]-?[)(DPpOdD]", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip()

    # 7. Strip repetitive verbal tic openers (such as "Não me entenda mal, mas...")
    clean = sanitize_repetitive_openers(clean)

    return clean, emotion, learned_info

def sanitize_repetitive_openers(text: str) -> str:
    """
    Strips repetitive verbal tic prefixes like 'Não me entenda mal, mas' or 'N-não me entenda mal, mas',
    capitalizing the following sentence for natural, mature speech.
    """
    if not text:
        return ""
    t = re.sub(r"(?i)^(?:[Nn][ãa]o me entenda mal|[Nn]-n[ãa]o me entenda mal)[:;,!.—–-]*\s*(?:mas\s*)?", "", text).strip()
    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    return t




def infer_pose_and_camera(raw: Optional[str], emotion: str, user_message: Optional[str] = None) -> Tuple[str, str]:
    text = (raw or "").lower()
    u_low = (user_message or "").lower()

    pose = ""
    camera = ""

    pose_m = re.search(r"<!--[^\>]*\bpose\s*:\s*([a-z_]+)", text)
    if pose_m:
        tok = pose_m.group(1)
        if tok in ("crossed_arms", "thinking"):
            pose = "crossed_arms"
        elif tok in ("backview", "back"):
            pose = "backview"
        elif tok in ("default", "front"):
            pose = "default"

    cam_m = re.search(r"<!--[^\>]*\bcamera\s*:\s*([a-z_]+)", text)
    if cam_m:
        tok = cam_m.group(1)
        if tok in ("closeup", "close", "jl"):
            camera = "closeup"
        elif tok in ("medium", "jm"):
            camera = "medium"
        elif tok in ("full", "far", "js"):
            camera = "full"

    if not pose:
        if re.search(r"\b(de costas|vire de costas)\b", u_low):
            pose = "backview"
        elif re.search(r"\b(cruze os bra[çc]os|bra[çc]os cruzados)\b", u_low):
            pose = "crossed_arms"
        elif re.search(r"\b(descruze os bra[çc]os|solte os bra[çc]os)\b", u_low):
            pose = "default"
        else:
            pose = "default"

    if not camera:
        if re.search(r"\b(close-?up|de perto|aproxime|rosto)\b", u_low):
            camera = "closeup"
        elif re.search(r"\b(corpo inteiro|afaste|de longe)\b", u_low):
            camera = "full"
        elif re.search(r"\b(meio corpo)\b", u_low):
            camera = "medium"
        elif pose == "backview":
            camera = "full"
        else:
            camera = "closeup"

    return pose, camera
