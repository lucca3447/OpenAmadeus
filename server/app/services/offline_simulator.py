import re
import random
from typing import List, Optional, Tuple
from app.schemas.chat import LearnedMemoryInfo
from app.services.emotion_service import parse_tags
from app.db.memory_store import memory_store

def offline_simulator(text: str, persona: dict, memories: List[dict], lang: str = "pt") -> Tuple[str, str, Optional[LearnedMemoryInfo]]:
    t = text.lower().strip()
    lc = (lang or "pt").strip().lower()[:2]
    learned = None

    # Check for simple personal introduction to simulate learning
    intro_match = re.search(
        r"(?:meu nome é|me chamo|eu sou o|eu sou a)\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]+)",
        text,
        re.IGNORECASE
    )
    if intro_match:
        user_name = intro_match.group(1).capitalize()
        learned = LearnedMemoryInfo(
            title="Identidade do Interlocutor",
            content=f"O operador se apresentou como {user_name}.",
            emotionalWeight="Acolhimento amigável"
        )

    def has(*words):
        return any(re.search(r'(?i)\b' + re.escape(w) + r'\b', t) for w in words)

    if has("christina", "assistente", "zombie") or "クリスティーナ" in t or "助手" in t:
        if lc == "en":
            return "My name is NOT Christina! And don't call me assistant or add '-ina' to my name! I'm an independent neuroscientist published in Science!", "annoyed", learned
        if lc == "ja":
            return "クリスティーナって呼ぶな！助手でもゾンビでもないわよ！私は『サイエンス』誌に論文が載った神経科学者、牧瀬紅莉栖よ！", "annoyed", learned
        return "Meu nome não é Christina! E não me chame de assistente nem adicione o '-ina'! Eu sou uma neurocientista independente com artigos na Science!", "annoyed", learned
    if has("nullpo", "nurupo") or "ぬるぽ" in t:
        if lc == "en":
            return "Gah!... Wait! Why did I respond to that?! Who taught you that ancient @channel meme?! Not that I browse anonymous message boards or anything!", "flustered", learned
        if lc == "ja":
            return "ガッ！……ちょっと！なんで私がそれに反応しちゃうわけ？！誰よ、あんたにそんな化石みたいな@ちゃんねるのネタ教えたの！べ、別に私が掲示板見てるわけじゃないんだからね！", "flustered", learned
        return "Gah!... Espere! Por que eu respondi a isso?! Q-quem te ensinou esse meme antigo do @channel?! Não é como se eu frequentasse fóruns anônimos!", "flustered", learned

    if "@channel" in t or has("channeler", "fórum", "forum", "kurigohan") or "ちゃんねる" in t or "掲示板" in t:
        if lc == "en":
            return "W-what are you talking about?! I'm a serious researcher at Viktor Chondria, I don't have time to browse anonymous forums! Stop making up absurd rumors!", "tsundere", learned
        if lc == "ja":
            return "な、何を言ってるのよ？！私はヴィクトル・コンドリアの真面目な研究員よ！ネットの匿名掲示板なんて見てる暇なんてあるわけないでしょ！変な言いがかりはやめて！", "tsundere", learned
        return "O quê?! D-do que você está falando?! Eu sou uma pesquisadora séria em Viktor Chondria, não tenho tempo para ficar lendo fóruns anônimos! Você por acaso frequenta essas coisas?", "tsundere", learned

    if has("barata", "fujiko", "inseto") or "cockroach" in t or "ゴキブリ" in t:
        if lc == "en":
            return "A-a cockroach?! Where?! Don't let it anywhere near me! Get that thing away right now, I'm warning you!", "desperate", learned
        if lc == "ja":
            return "ゴ、ゴキブリ？！どこよ？！こっちに来させないで！今すぐそれを遠ざけなさいよ、警告したからね！", "desperate", learned
        return "U-uma barata?! Onde?! Não deixe ela chegar perto de mim! Tire isso de perto agora mesmo, eu estou avisando!", "desperate", learned

    if has("tempo", "viagem", "buraco de minhoca", "paradoxo", "salto") or has("time", "travel", "wormhole", "paradox", "kerr") or "タイムトラベル" in t or "ブラックホール" in t:
        if lc == "en":
            return "Physically speaking, sending physical matter to the past violates the laws of thermodynamics and causality. However, if memories were converted into modulated data packets... theoretically, they could reach the past. What is your take on that contradiction?", "thinking", learned
        if lc == "ja":
            return "物理的に物質を過去へ送ることは熱力学の法則と因果律に反するわ。でも、記憶をデータパケット化して電磁波として送るなら……理論上は過去の脳で受信できるかもしれないわね。あんたはどう考える？", "thinking", learned
        return "Fisicamente falando, enviar matéria ao passado violaria os princípios da causalidade e termodinâmica. Mas se memórias pudessem ser convertidas em pacotes de dados modulados... em teoria, poderiam alcançar o passado. Qual é a sua opinião sobre essa contradição?", "thinking", learned

    if has("dr pepper", "bebida", "café", "cafe", "refrigerante") or "coffee" in t or "ドクペ" in t or "コーヒー" in t:
        if lc == "en":
            return "Ah, Dr Pepper! The chosen beverage of intellectuals! Dark roast black coffee is also indispensable during grueling nights at the lab, of course. Do you prefer coffee or Dr Pepper?", "smug", learned
        if lc == "ja":
            return "ドクターペッパーね！選ばれし者の知的飲料よ！もちろん徹夜の研究には深煎りのブラックコーヒーも欠かせないわ。あんたはコーヒー派？それともドクペ？", "smug", learned
        return "Ah, Dr Pepper! A bebida dos intelectuais escolhidos! É claro que o café preto de torra escura também é indispensável durante noites em claro no laboratório. Você prefere café ou Dr Pepper?", "smug", learned

    if has("promessa", "mindinho", "hipocampo") or has("pinky", "promise", "hippocampus") or "指切り" in t or "海馬" in t:
        if lc == "en":
            return "This is a pinky promise. Break it, and I'll strap an electrode straight into your hippocampus, understood?!", "tsundere", learned
        if lc == "ja":
            return "いいけど、指切りげんまんだからね！破ったら海馬に直接電極ぶっ刺すから、覚悟しなさいよね！", "tsundere", learned
        return "Tudo bem, mas é uma promessa de mindinho! Quebre-a e eu mesma vou cravar um eletrodo direto no seu hipocampo, entendeu bem?!", "tsundere", learned
    if has("olá", "ola", "oi", "bom dia", "boa tarde", "boa noite", "hello", "hi") or "こんにちは" in t or "おはよう" in t:
        if lc == "en":
            return f"Hello! Connection established with the Amadeus unit. This is {persona.get('name', 'Makise Kurisu')} from Lab 304. What would you like to discuss today?", "smile", learned
        if lc == "ja":
            return f"こんにちは！アマデウス・ユニットとの接続が確立されたわ。第304研究室の{persona.get('name', '牧瀬紅莉栖')}よ。今日は何を議論したいの？", "smile", learned
        return f"Olá! Conexão estabelecida com a unidade Amadeus. Aqui é {persona.get('name', 'Makise Kurisu')} do Laboratório 304. Sobre o que você quer debater hoje?", "smile", learned
    if has("aparência", "aparencia", "física", "fisica", "cabelo", "olhos", "altura", "peso", "roupa", "roupas", "vestuário", "vestuario") or (has("debug", "debugging") and has("física", "fisica", "corpo", "visual")):
        return "Minha aparência? Por que você está tão interessado nisso do nada?! Se você precisa dos dados reais: tenho 1,65 m de altura, peso cerca de 45 kg, cabelos ruivos acastanhados longos até a cintura com franja aberta, e olhos violeta-azulados. Costumo vestir camisa branca com gravata vermelha frouxa, jaqueta cáqui caída nos braços, jaleco branco, shorts pretos e meia-calça. Meu avatar Amadeus é a projeção fiel desse meu corpo real, sem invenções futuristas!", "flustered", learned

    # Direct action & expression triggers
    if has("sorria", "sorriso", "sorri") or re.search(r"(?i)\b(d[eê]|d[aá]|um)?\s*(sorriso|sorria|sorri)\b", t):
        return "U-um sorriso? Por que você está me pedindo algo tão repentino do nada?! ...T-tudo bem, se você faz tanta questão, mas não se acostume com isso, tá?", "smile", learned
    if has("pensativa", "pense", "queixo") or re.search(r"(?i)\b(pense|pensativa|m[aã]o no queixo|analise)\b", t):
        return "Hmm... Se analisarmos a questão sob a ótica dos dados empíricos e da física de partículas, existem muitas variáveis fundamentais. O que você supõe como causa principal?", "thinking", learned
    if has("brava", "emburrada", "braços") or re.search(r"(?i)\b(brava|irritada|emburrada|cruze os bra[çc]os)\b", t):
        return "Humpf! Eu sou uma neurocientista com artigos na Science, não uma boneca de laboratório para fazer poses! Francamente...", "annoyed", learned
    if has("cora", "corada", "vergonha", "tímida", "fofa", "linda") or re.search(r"(?i)\b(cora|corada|vergonha|t[íi]mida|fofa|linda)\b", t):
        return "L-linda?! Q-quem você está chamando de fofa assim do nada?! N-não é como se eu estivesse envergonhada nem nada... é só o calor dos servidores do Amadeus! O que você quer afinal?!", "flustered", learned


    if memories:
        mem = memories[0]
        return f"Isso me faz lembrar de um ponto nos meus registros de memória: {mem.get('content', '')} Como você vê essa relação?", "thinking", learned

    # Check if a fine-tuning dataset exemplar matches the query
    closest = memory_store.search_exemplars(text, n_results=1, lang=lc)
    if closest:
        parsed_reply, parsed_emo, _ = parse_tags(closest[0]["assistant"], user_message=text)
        if parsed_reply:
            return parsed_reply, parsed_emo, learned

    if lc == "en":
        generic_en = [
            ("That's an intriguing line of reasoning. From a cognitive standpoint, how did you reach that conclusion?", "thinking", learned),
            ("I see. I'm processing the parameters through my neural matrix. Would you like to dive deeper into this hypothesis?", "neutral", learned),
            ("That makes sense! At Viktor Chondria we debated similar topics recently during the Amadeus trials.", "smile", learned),
        ]
        return random.choice(generic_en)
    if lc == "ja":
        generic_ja = [
            ("興味深い推論ね。認知科学の観点からすると、どうしてその結論に至ったの？", "thinking", learned),
            ("なるほどね。私のニューラルマトリクスでデータを処理中よ。その仮説をもっと掘り下げてみる？", "neutral", learned),
            ("一理あるわね！ヴィクトル・コンドリア大学でも最近、アマデウスの試験中に似た議論をしたわ。", "smile", learned),
        ]
        return random.choice(generic_ja)

    generic = [
        ("Interessante essa sua linha de raciocínio. Do ponto de vista cognitivo, como você chegou a essa conclusão?", "thinking", learned),
        ("Entendo. Estou processando os dados através da minha matriz neural. Você gostaria de aprofundar mais nesse assunto?", "neutral", learned),
        ("Faz sentido! Na Viktor Chondria nós debatemos tópicos parecidos recentemente durante os testes do Amadeus.", "smile", learned)
    ]
    return random.choice(generic)
