import re
from typing import Optional, Tuple
from app.schemas.chat import LearnedMemoryInfo


VALID_EMOTIONS = [
    # Canonical SC3 MAGES. Engine (Steins;Gate 0) & OpenAmadeus emotions
    "neutral", "wink", "annoyed", "worried", "sad", "happy",
    "stern", "blushing", "thinking", "eyes_closed", "surprised",
    "holding_back_tears", "disdain", "analytical",
    # Legacy & Aliases
    "smile", "serious", "tsundere", "smug", "flustered",
    "puzzled", "desperate", "look_side",
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

    # 1. Parse remember tag (supports variable spaces, missing colon, 2 or 3+ pipe-separated fields, and malformed closers like >>)
    remember_raw = re.search(r"<!--\s*remember(?:\s*:\s*|\s+)([\s\S]*?)\s*(?:-->|-+>|>+|$)", clean, re.IGNORECASE)
    if remember_raw:
        parts = [p.strip() for p in remember_raw.group(1).split("|")]
        if len(parts) >= 2:
            title = parts[0]
            content = parts[1] if len(parts) == 2 else " | ".join(parts[1:-1]).strip()
            emo_w = (parts[-1] if len(parts) >= 3 else "") or "Factual"
            placeholder_re = r"(?i)^(t[íi]tulo curto|fato memorizado|sentimento)$"
            noise_re = r"(?i)\b(testou a capacidade|testando.*rea[çc][õo]es|teste de debugging|neurocientista kurisu|amadeus kurisu)\b"
            if (
                title
                and content
                and not re.match(placeholder_re, title)
                and not re.match(placeholder_re, content)
                and not re.search(noise_re, f"{title} {content}")
            ):
                learned_info = LearnedMemoryInfo(title=title, content=content, emotionalWeight=emo_w)
        clean = re.sub(r"<!--\s*remember(?:\s*:|\s)[\s\S]*?(?:-->|-+>|>+|$)", "", clean, flags=re.IGNORECASE)

    # 2. Parse emotion tag (isolated <!--emotion:...--> or composite <!--emotion:tsundere,pose:...-->)
    emotion = "neutral"
    emotion_match = None
    comment_matches = re.findall(r"<!--([\s\S]*?)(?:-->|-+>|>+|$)", clean, re.IGNORECASE)
    for c in comment_matches:
        if re.match(r"(?i)^remember(?:\s*:|\s)", c.strip()):
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

    # Infallible removal of all comment tags (including malformed >> or unclosed trailing <!--) so zero metadata leaks into speech
    clean = re.sub(r"<!--[\s\S]*?(?:-->|-+>|>+|$)", "", clean)

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

    # 4. Context-aware inference from user intent & physical command triggers (PT / EN / JA for v0.3 readiness)
    if user_message and (not emotion_match or emotion in ("neutral", "serious")):
        u_lower = user_message.lower()
        if re.search(r"(?i)(\b(?:barata|fujiko|inseto|insetos|cockroach|roach)\b|ゴキブリ|ふじこ)", u_lower):
            emotion = "desperate"
        elif re.search(r"(?i)(\b(?:christina|assistente|zombie|assistant)\b|クリスティーナ|助手|ゾンビ)", u_lower):
            emotion = "annoyed"
        elif re.search(r"(?i)(\b(?:linda|fofa|bonita|maravilhosa|atraente|perfeita|cora|corada|vergonha|envergonhada|t[íi]mida|bochechas|cute|pretty|beautiful|gorgeous|blush)\b|かわいい|可愛い|綺麗|美人)", u_lower):
            emotion = "flustered"
        elif re.search(r"(?i)(\b(?:piscadinha|pisque|pisca|wink)\b|ウインク)", u_lower):
            emotion = "wink"
        elif re.search(r"(?i)(\b(?:d[eê]|d[aá]|um)?\s*(?:sorriso|sorria|sorri|smile)\b|笑って|笑顔)", u_lower):
            if emotion in ("neutral", "serious", "tsundere"):
                emotion = "smile"
        elif re.search(r"(?i)(\b(?:pense|pensativa|reflita|m[aã]o no queixo|analise|think|analyze)\b|考えて)", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "thinking"
        elif re.search(r"(?i)(\b(?:brava|irritada|emburrada|cruze os bra[çc]os|bra[çc]os cruzados|cross your arms|crossed arms)\b|腕を組|怒って)", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "annoyed"
        elif re.search(r"(?i)(\b(?:confusa|d[úu]vida|incline a cabe[çc]a|confused)\b|どういうこと)", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "puzzled"
        elif re.search(r"(?i)(\b(?:surpresa|assustada|olhos arregalados|nullpo|surprised)\b|ぬるぽ)", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "surprised"
        elif re.search(r"(?i)(\b(?:triste|chore|chora|l[áa]grimas|mayuri|sacrif[íi]cio|sad|cry)\b|悲しい|泣いて)", u_lower):
            if emotion in ("neutral", "serious"):
                emotion = "sad"

    # 5. Assistant dialogue sentiment fallback & vocal stuttering detection
    lower = clean.lower()
    if emotion in ("neutral", "serious"):
        if re.search(r"\b(n-não|q-quem|c-como|o-o que|b-bem|s-se você|l-linda|f-fofa)\b", lower):
            emotion = "flustered"
        elif any(w in lower for w in ["barata", "fujiko", "tirem isso de perto", "socorro", "ゴキブリ"]):
            emotion = "desperate"
        elif any(w in lower for w in ["idiota", "não me entenda mal", "ora essa", "francamente", "baka", "勘違いしないで"]):
            emotion = "tsundere"
        elif any(w in lower for w in ["o quê", "como assim", "?!", "gah!"]):
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
    clean = re.sub(r"(?i)^(?:claro[,. ]+)?aqui vai um sorriso para voc[eê][.,! ]*", "Um sorriso? Se você faz tanta questão... mas não se acostume com isso! ", clean)
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


def _map_pose_token(tok: str) -> str:
    if tok in ("crossed_arms", "thinking"):
        return "crossed_arms"
    if tok in ("backview", "back"):
        return "backview"
    if tok in ("default", "front"):
        return "default"
    return ""


def _map_camera_token(tok: str) -> str:
    if tok in ("closeup", "close", "jl"):
        return "closeup"
    if tok in ("medium", "jm"):
        return "medium"
    if tok in ("full", "far", "js"):
        return "full"
    return ""


def infer_pose_and_camera(
    raw: Optional[str],
    emotion: str,
    user_message: Optional[str] = None,
    clean_text: Optional[str] = None,
) -> Tuple[str, str]:
    text = (raw or "").lower()
    u_low = (user_message or "").lower()

    pose = ""
    camera = ""

    pose_matches = re.findall(r"<!--[^\>]*\bpose\s*:\s*([a-z_]+)", text)
    for tok in pose_matches:
        mapped = _map_pose_token(tok)
        if mapped:
            pose = mapped

    cam_matches = re.findall(r"<!--[^\>]*\bcamera\s*:\s*([a-z_]+)", text)
    for tok in cam_matches:
        mapped = _map_camera_token(tok)
        if mapped:
            camera = mapped

    if not pose:
        if re.search(r"(\b(?:de costas|vire de costas|virada de costas|turn around|turn your back)\b|後ろを向|そっぽ)", u_low):
            pose = "backview"
        elif re.search(r"(\b(?:cruze os bra[çc]os|bra[çc]os cruzados|cross your arms|crossed arms)\b|腕を組)", u_low):
            pose = "crossed_arms"
        elif re.search(r"(\b(?:descruze os bra[çc]os|solte os bra[çc]os|uncross)\b)", u_low):
            pose = "default"
        elif re.search(r"(\b(?:christina|assistente|zombie|assistant)\b|クリスティーナ|助手|ゾンビ)", u_low) and re.search(r"(n[ãa]o olh|de costas|ignorar|esque[çc]a)", text):
            pose = "backview"
        elif emotion in ("analytical", "disdain", "smug"):
            pose = "crossed_arms"
        elif emotion in ("annoyed", "stern", "tsundere", "serious") and re.search(
            r"(\b(?:cruzar os bra[çc]os|bra[çc]os cruzados|christina|assistente|zombie|teoria|c[óo]digo|hip[óo]tese|ci[êe]ncia|relatividade|entropia|dados|erro)\b)",
            f"{u_low} {text}",
        ):
            pose = "crossed_arms"
        elif emotion in ("blushing", "flustered") and re.search(r"(n[ãa]o [ée] como se|processador|oscila[çc][ãa]o|sistema nervoso|calor|descaradamente)", text):
            pose = "crossed_arms"
        else:
            pose = "default"

    if not camera:
        if re.search(r"(\b(?:close-?up|de perto|aproxime|rosto)\b|近く)", u_low):
            camera = "closeup"
        elif re.search(r"(\b(?:corpo inteiro|afaste|de longe|full body)\b|全身)", u_low):
            camera = "full"
        elif re.search(r"(\b(?:meio corpo|medium)\b)", u_low):
            camera = "medium"
        elif pose == "backview":
            camera = "full"
        elif emotion in ("blushing", "flustered", "wink", "surprised", "holding_back_tears", "desperate", "sad", "worried"):
            camera = "closeup"
        elif pose == "crossed_arms" or emotion in ("analytical", "disdain", "smug"):
            camera = "medium"
        else:
            camera = "closeup"

    return pose, camera


def infer_lead_expression(
    raw: Optional[str],
    clean_text: str,
    final_emotion: str,
    final_pose: str,
    user_message: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Determines an optional 1st-beat (lead) expression & pose when a multi-sentence reply
    either contains multiple <!--emotion:...--> tags or opens with a sudden reaction before settling.
    """
    if not raw or not clean_text:
        return None, None

    # 1. Explicit multi-tag sequence: first tag = lead, last tag = final
    comment_matches = re.findall(r"<!--([\s\S]*?)(?:-->|-+>|>+|$)", raw, re.IGNORECASE)
    emo_tags = []
    for c in comment_matches:
        if re.match(r"(?i)^remember(?:\s*:|\s)", c.strip()):
            continue
        emo_m = re.search(r"(?:^|[,;|\s])emotion\s*:\s*([^,;|\s>]+)", c, re.IGNORECASE)
        if emo_m:
            tok = re.split(r"[\s|,;/]+", emo_m.group(1).lower().strip())[0]
            if tok in VALID_EMOTIONS:
                pose_m = re.search(r"\bpose\s*:\s*([a-z_]+)", c, re.IGNORECASE)
                p_tok = _map_pose_token(pose_m.group(1).lower()) if pose_m else ""
                emo_tags.append((tok, p_tok))

    if len(emo_tags) >= 2:
        first_emo, first_pose = emo_tags[0]
        if not first_pose:
            first_pose = "crossed_arms" if first_emo in ("analytical", "disdain", "smug") else "default"
        if first_emo != final_emotion or first_pose != final_pose:
            return first_emo, first_pose

    # 2. Natural 2-beat shift on multi-sentence replies with a strong reaction opener
    if len(clean_text) >= 55:
        first_clause = clean_text[:45].lower()
        if re.search(r"^(?:o qu[êe]\b|gah\b|h[ãa]\b|espere\b|como assim\b|what\b|huh\b|えっ|は？)", first_clause):
            if final_emotion not in ("surprised", "neutral"):
                return "surprised", "default"
        if re.search(r"^(?:francamente\b|ora\b|suspiro\b|francamente,|sério isso)", first_clause):
            if final_emotion not in ("eyes_closed", "neutral"):
                return "eyes_closed", "crossed_arms"

    return None, None


def infer_sentence_shift(
    sentence: str,
    index: int,
    emotion: str,
    pose: str,
    camera: str,
) -> dict:
    """
    Organically shifts Kurisu's pose, emotion and camera on sentence >= 1 during streaming
    when the LLM did not emit an explicit mid-stream <!--emotion:...--> tag for that sentence.
    Prevents staying frozen in crossed_arms for an entire multi-sentence explanation.
    """
    s = (sentence or "").strip()
    low = s.lower()
    if not s or index <= 0:
        return {"emotion": emotion, "pose": pose, "camera": camera}

    # 1. Exasperated sigh or eye-close mid-reply
    if re.search(r"^(?:francamente\b|ora essa\b|suspiro\b|humpf\b|sinceramente\b)", low):
        return {"emotion": "eyes_closed", "pose": "crossed_arms", "camera": "medium"}

    # 2. Sudden exclamation or self-contradictory blush mid-reply
    if re.search(r"\b(n-n[ãa]o|q-quem|n[ãa]o me entenda mal|oscila[çc][ãa]o t[ée]rmica|vi[ée]s de refor[çc]o)\b", low):
        return {"emotion": "blushing", "pose": "crossed_arms" if pose == "default" else "default", "camera": "closeup"}

    # 3. Closing or mid-speech question (?): uncross arms and lean in (closeup) to engage/challenge the operator
    if s.endswith("?"):
        if re.search(r"\b(ou ser[áa] que|n[ãa]o acha|vai me dizer|entendeu|consegue acompanhar|travou|duvida)\b", low):
            return {"emotion": "wink", "pose": "default", "camera": "closeup"}
        next_emo = "thinking" if emotion in ("analytical", "disdain", "stern") else emotion
        return {"emotion": next_emo, "pose": "default", "camera": "closeup"}

    # 4. Concrete example / open explanation pivot -> uncross arms to pose:default
    if pose == "crossed_arms" and (
        re.search(r"\b(por exemplo|imagine|na pr[áa]tica|pense bem|ou seja|basicamente|em outras palavras|veja bem)\b", low)
        or index % 2 == 1
    ):
        next_emo = "thinking" if emotion == "analytical" else ("neutral" if emotion == "stern" else emotion)
        return {"emotion": next_emo, "pose": "default", "camera": "closeup"}

    # 5. Deep theoretical / analytical pivot from default pose -> cross arms for that point
    if pose == "default" and (
        re.search(r"\b(entretanto|por[ée]m|contudo|por outro lado|matematicamente|fisicamente|equa[çc][ãa]o|m[ée]trica|tensor|entropia|hip[óo]tese)\b", low)
        or (index % 2 == 1 and emotion in ("thinking", "analytical", "annoyed", "stern"))
    ):
        next_emo = "analytical" if emotion in ("thinking", "neutral") else emotion
        return {"emotion": next_emo, "pose": "crossed_arms", "camera": "medium"}

    return {"emotion": emotion, "pose": pose, "camera": camera}
