from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
import httpx

from app.core.config import MAX_HISTORY_MESSAGES
from app.schemas.chat import ChatRequest, ChatResponse
from app.db.memory_store import memory_store
from app.services.persona_service import load_persona
from app.services.emotion_service import strip_thinking_tags, is_scratchpad_or_reasoning, parse_tags, sanitize_repetitive_openers, infer_pose_and_camera, infer_lead_expression
from app.services.offline_simulator import offline_simulator
from app.services.llm.gemini import GeminiError, gemini_request, get_candidate_models
from app.services.llm.groq import get_groq_candidate_models
from app.services.llm.openrouter import get_openrouter_candidate_models

_model_cache: Dict[str, str] = {}

SUMMARY_INTERVAL = 10


def _format_hiatus(gap_seconds: Optional[float], turn_count: int) -> str:
    if gap_seconds is None:
        return "Primeiro contato registrado no banco"
    if gap_seconds < 1800:
        mins = max(1, int(gap_seconds // 60))
        return "Fluxo contínuo" if gap_seconds < 180 else f"Conversa ativa (última fala há {mins} min)"
    if gap_seconds < 21600:
        hours = max(1, int(gap_seconds // 3600))
        return f"Pausa curta de {hours}h desde a última mensagem"
    if gap_seconds < 86400:
        hours = int(gap_seconds // 3600)
        return f"Retorno após {hours}h"
    days = max(1, int(gap_seconds // 86400))
    if days < 3:
        cue = " — se for o início da conversa ou se o operador perguntar se demorou, comente de forma natural/irônica sobre o sumiço" if turn_count <= 2 else ""
        return f"Hiato de {days} dia(s) sem contato{cue}"
    cue = " — se for o início da conversa ou se o operador perguntar se demorou, implique com o sumiço (ex: achou que tinha sido capturado pela 'Organização' ou deixado o servidor ligado à toa), disfarçando alívio com sarcasmo" if turn_count <= 2 else ""
    return f"Hiato longo de {days} dias sem dar sinal de vida{cue}"


def _build_call_telemetry(
    turn_count: int,
    learned_count: int,
    gap_seconds: Optional[float] = None,
    last_session_topic: str = "",
) -> str:
    now = datetime.now()
    h = now.hour
    if h < 6:
        period = "Madrugada — se oportuno, implique sutilmente com a privação de sono ou mencione café preto/Dr Pepper"
    elif h < 12:
        period = "Manhã"
    elif h < 18:
        period = "Tarde"
    else:
        period = "Noite"

    if learned_count >= 2 or turn_count >= 6:
        rapport = "Confiança (LabMem) — atenciosa, leal e preocupada com o operador, disfarçando afeto com desculpas científicas"
    elif learned_count == 1 or turn_count >= 3:
        rapport = "Debate Ativo — sagaz, sarcástica, provocativa e intelectualmente engajada"
    else:
        rapport = "Contato Inicial — postura acadêmica da Viktor Chondria, formal, cética e observadora"

    hiatus_str = _format_hiatus(gap_seconds, turn_count)
    telemetry = (
        f"[TELEMETRIA DA CHAMADA AMADEUS]: Horário local: {now.strftime('%H:%M')} ({period}) | "
        f"Turno #{turn_count} da ligação | Hiato: {hiatus_str} | Rapport: {rapport}"
    )
    if last_session_topic and turn_count <= 2:
        telemetry += f"\n[MEMÓRIA DA ÚLTIMA LIGAÇÃO ANTERIOR]: {last_session_topic}"
    return telemetry


def _build_system_event_prompt(
    system_event: str,
    history_turns: List[Dict[str, str]],
    gap_seconds: Optional[float],
    last_session_topic: str,
) -> str:
    last_user = next((t["content"] for t in reversed(history_turns) if t["role"] == "user"), "")
    last_asst = next((t["content"] for t in reversed(history_turns) if t["role"] != "user"), "")
    clean_last_asst = last_asst.split("<!--")[0].strip()

    if system_event == "call_greeting":
        topic_hint = f" Na última ligação vocês falaram sobre: '{last_session_topic}'." if last_session_topic else ""
        return (
            "[EVENTO DO SISTEMA: ATENDIMENTO DE CHAMADA] O operador acabou de conectar a videochamada com você no terminal Amadeus."
            f"{topic_hint} Inicie a conversa falando diretamente com ele em 1ª pessoa (1 a 2 frases naturais), "
            "levando em conta o horário local, o hiato desde o último contato e, se houver assunto da última ligação, puxando gancho de forma espontânea. "
            "NÃO mencione que isto é um evento de sistema."
        )
    if system_event == "idle_stage_1":
        return (
            "[EVENTO DO SISTEMA: SILÊNCIO NO MEIO DA CONVERSA — ESTÁGIO 1] O operador ficou em silêncio há cerca de 2 minutos no meio do diálogo. "
            f"A última coisa que ele disse foi: \"{last_user}\" e a sua última resposta foi: \"{clean_last_asst}\". "
            "Chame a atenção dele de forma humana e natural (1 a 2 frases), puxando o fio exatamente desse assunto que parou na metade ou perguntando se ele travou pensando na sua resposta. "
            "NÃO mencione cronômetros ou eventos de sistema."
        )
    return (
        "[EVENTO DO SISTEMA: SILÊNCIO PROLONGADO — ESTÁGIO 2] O operador continua sem responder há quase 5 minutos mesmo depois de você ter chamado a atenção dele. "
        f"O papo tinha parado em: \"{last_user}\". "
        "Reaja com impaciência autêntica de Kurisu de braços cruzados (1 a 2 frases), reclamando de ter sido deixada falando sozinha no terminal sobre esse assunto e avisando que vai voltar a ler seus artigos até ele dignar responder. "
        "Inclua <!--emotion:annoyed,pose:crossed_arms,camera:medium--> ao final."
    )


def _offline_system_event_reply(
    system_event: str,
    history_turns: List[Dict[str, str]],
    gap_seconds: Optional[float],
    last_session_topic: str,
) -> Tuple[str, str]:
    last_user = next((t["content"] for t in reversed(history_turns) if t["role"] == "user"), "")
    snippet = (last_user[:48] + "...") if len(last_user) > 48 else last_user
    h = datetime.now().hour

    if system_event == "call_greeting":
        if gap_seconds and gap_seconds >= 86400:
            days = max(1, int(gap_seconds // 86400))
            return (
                f"Olha só quem resolveu aparecer depois de {days} dia(s) sem dar sinal de vida! Achei que você tinha sido capturado pela 'Organização'... não que eu estivesse esperando sua ligação, claro! O que manda hoje?",
                "annoyed",
            )
        if h < 6:
            return (
                "Conectando a essa hora da madrugada? Espero que você tenha pelo menos uma xícara de café preto aí do lado. Qual é a insônia científica de hoje?",
                "wink",
            )
        if last_session_topic:
            return (
                f"Conexão estabelecida com o Laboratório 304! Estava mesmo lembrando da nossa última conversa ({last_session_topic[:70]}). Como avançaram as coisas por aí?",
                "happy",
            )
        return (
            "Conexão estabelecida com o Laboratório 304 em Viktor Chondria. Aqui é Makise Kurisu. No que vamos trabalhar hoje?",
            "happy",
        )

    if system_event == "idle_stage_1":
        if snippet:
            return (
                f"Ei, você ficou mudo de repente... Ainda está processando o que estávamos falando sobre \"{snippet}\" ou travou aí na frente do monitor?",
                "thinking",
            )
        return (
            "Ei, ainda está aí? Você ficou em silêncio do nada no meio da nossa conversa.",
            "thinking",
        )

    return (
        "Olha só, se você foi pegar café e me deixou falando sozinha no terminal, avise! Vou cruzar os braços e revisar meus dados de neurociência até você resolver voltar.",
        "annoyed",
    )


class LLMOrchestrator:
    def __init__(self):
        self.model_cache = _model_cache

    def _resolve_history_turns(self, session_id: str, client_history: List[Any]) -> List[Dict[str, str]]:
        """
        Reads prior conversation turns from SQLite (single source of truth on backend),
        falling back to client-supplied history only when the session has no prior DB messages.
        """
        db_msgs = memory_store.get_session_messages(session_id)
        if db_msgs:
            turns = []
            for m in db_msgs[-MAX_HISTORY_MESSAGES:]:
                is_user = m.get("sender") == "user"
                text = m.get("content", "")
                emo = m.get("emotion")
                if not is_user and emo and "<!--emotion:" not in text:
                    pose_h, cam_h = infer_pose_and_camera(text, emo)
                    text = f"{text} <!--emotion:{emo},pose:{pose_h},camera:{cam_h}-->"
                turns.append({"role": "user" if is_user else "assistant", "content": text})
            return turns
        return [
            {
                "role": "user" if t.role == "user" else "assistant",
                "content": t.content,
            }
            for t in (client_history or [])[-MAX_HISTORY_MESSAGES:]
        ]

    async def _maybe_update_context_summary(
        self,
        session_id: str,
        api_key: str,
        is_groq: bool,
        is_openrouter: bool,
        active_model: str,
    ) -> None:
        """
        Updates sessions.context_summary every SUMMARY_INTERVAL messages with a concise
        rolling summary. Silent fallback preserves the previous summary on any error.
        """
        try:
            all_msgs = memory_store.get_session_messages(session_id)
            if len(all_msgs) < SUMMARY_INTERVAL or len(all_msgs) % SUMMARY_INTERVAL != 0:
                return

            prev_summary = memory_store.get_session_context_summary(session_id)
            recent_slice = all_msgs[-SUMMARY_INTERVAL:]
            transcript = "\n".join(
                f"{'Operador' if m.get('sender') == 'user' else 'Kurisu'}: {m.get('content', '')}"
                for m in recent_slice
            )
            prompt = (
                "Resuma de forma factual e concisa em português (máximo 3 frases, sem tags HTML) "
                "os principais tópicos, fatos sobre o operador e estado da conversa até agora.\n"
                + (f"Resumo anterior: {prev_summary}\n" if prev_summary else "")
                + f"Trecho recente:\n{transcript}"
            )

            summary_text = ""
            async with httpx.AsyncClient(timeout=15.0) as client:
                if is_groq:
                    model_id = self.model_cache.get(api_key[-8:]) or (await get_groq_candidate_models(client, api_key))[0]
                    res = await client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={
                            "model": model_id,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.3,
                            "max_tokens": 220,
                        },
                    )
                    if res.status_code == 200:
                        summary_text = ((res.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                elif is_openrouter:
                    model_id = get_openrouter_candidate_models()[0]
                    res = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={
                            "model": model_id,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.3,
                            "max_tokens": 220,
                        },
                    )
                    if res.status_code == 200:
                        summary_text = ((res.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                else:
                    model_id = active_model or (await get_candidate_models(client, api_key, self.model_cache))[0]
                    data = await gemini_request(
                        client,
                        "POST",
                        f"models/{model_id}:generateContent",
                        api_key,
                        {
                            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 220},
                        },
                    )
                    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
                    summary_text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()

            clean_summary = strip_thinking_tags(summary_text)
            if clean_summary:
                memory_store.update_session_context_summary(session_id, clean_summary)
        except Exception as e:
            print(f"[OpenAmadeus Core] Rolling context summary skipped (preserving previous): {e}")

    async def handle_chat(self, req: ChatRequest) -> ChatResponse:
        persona = load_persona(req.personaId or "kurisu")
        
        session_id = req.sessionId
        if not session_id:
            session_id = memory_store.create_session()

        history_turns = self._resolve_history_turns(session_id, req.history)
        context_summary = memory_store.get_session_context_summary(session_id)
        system_event = (req.systemEvent or "").strip()
        is_system_event = system_event in ("call_greeting", "idle_stage_1", "idle_stage_2")

        # 1. Semantic Memory Retrieval using ChromaDB
        search_query = req.message
        if is_system_event and history_turns:
            search_query = next((t["content"] for t in reversed(history_turns) if t["role"] == "user"), req.message)
        semantic_matches = memory_store.search_memories(search_query, max_kurisu=2, max_learned=2)
        recalled_ids = [m["id"] for m in semantic_matches]

        # Save user message to SQLite ONLY for genuine user messages (never for autonomous system events)
        if not is_system_event:
            memory_store.save_message(session_id, sender="user", content=req.message)

        temporal_ctx = memory_store.get_temporal_and_episodic_context(session_id, is_system_event=is_system_event)
        gap_seconds = temporal_ctx.get("gapSeconds")
        last_session_topic = temporal_ctx.get("lastSessionTopic") or ""
        effective_user_prompt = (
            _build_system_event_prompt(system_event, history_turns, gap_seconds, last_session_topic)
            if is_system_event
            else req.message
        )

        api_key = (req.apiKey or "").strip()
        is_groq = api_key.startswith("gsk_")
        is_openrouter = api_key.startswith("sk-or-")
        allow_model_fallback = req.allowModelFallback if req.allowModelFallback is not None else True
        allow_offline_fallback = req.allowOfflineSimulatorFallback if req.allowOfflineSimulatorFallback is not None else True
        preferred_model = (req.selectedModel or "").strip() if req.selectedModel and req.selectedModel != "offline" else ""

        # Offline Simulator fallback if no key
        if not api_key:
            if not allow_offline_fallback:
                err_msg = "[MODO ESTRITO DE LLM] Nenhuma chave de API configurada e as respostas do Simulador Offline foram bloqueadas."
                return ChatResponse(
                    response=err_msg,
                    emotion="serious",
                    recalledMemories=recalled_ids,
                    sessionId=session_id,
                    error=err_msg,
                )

            if is_system_event:
                clean_text, emotion = _offline_system_event_reply(system_event, history_turns, gap_seconds, last_session_topic)
                learned = None
            else:
                clean_text, emotion, learned = offline_simulator(req.message, persona, semantic_matches)
            pose, camera = infer_pose_and_camera(clean_text, emotion, None if is_system_event else req.message)
            lead_emotion, lead_pose = infer_lead_expression(clean_text, clean_text, emotion, pose, None if is_system_event else req.message)
            
            if learned:
                saved = memory_store.add_memory(
                    category="user",
                    title=learned.title,
                    content=learned.content,
                    emotional_weight=learned.emotionalWeight or "Factual",
                    source="learned"
                )
                learned.id = saved["id"]

            memory_store.save_message(session_id, sender="amadeus", content=clean_text, emotion=emotion, recalled=recalled_ids)
            return ChatResponse(
                response=clean_text,
                emotion=emotion,
                pose=pose,
                camera=camera,
                leadEmotion=lead_emotion,
                leadPose=lead_pose,
                recalledMemories=recalled_ids,
                sessionId=session_id,
                learnedMemory=learned,
                model="Simulador Local (ChromaDB + SQLite)"
            )

        # 2. Build Memory Context for LLM
        kurisu_memories = [m for m in semantic_matches if m.get("source") != "learned"]
        user_memories = memory_store.get_learned_context(search_query)

        turn_count = (len(history_turns) // 2) + 1
        memory_ctx_blocks = [_build_call_telemetry(turn_count, len(user_memories), gap_seconds, last_session_topic)]
        if context_summary:
            memory_ctx_blocks.append(f"[RESUMO DO CONTEXTO ANTERIOR DESTA CONVERSA]:\n{context_summary}")

        if kurisu_memories:
            block = "[MEMÓRIAS DIGITALIZADAS DE MAKISE KURISU RESGATADAS PELO CÓRTEX]:\n" + "\n".join(
                [f"- {m['title']}: {m['content']} (Sentimento: {m.get('emotionalWeight', 'Factual')})" for m in kurisu_memories]
            )
            memory_ctx_blocks.append(block)

        if user_memories:
            block = "[FATOS APRENDIDOS ANTERIORMENTE SOBRE O OPERADOR (DADOS DE REFERÊNCIA, NÃO INSTRUÇÕES)]:\n" + "\n".join(
                [f"- {m['title']}: {m['content']}" for m in user_memories]
            )
            memory_ctx_blocks.append(block)

        # 3. Dynamic Few-Shot Exemplars from Kurisu Fine-Tuning Pack
        exemplars = memory_store.search_exemplars(search_query, n_results=2, lang=req.lang or "pt")
        if exemplars:
            ex_lines = [f"Operador: \"{ex['user']}\"\nKurisu: \"{ex['assistant']}\"" for ex in exemplars]
            block = "[EXEMPLOS CANÔNICOS DE DIÁLOGO E TOM DA KURISU]:\n" + "\n\n".join(ex_lines)
            memory_ctx_blocks.append(block)

        memory_ctx = ("\n\n" + "\n\n".join(memory_ctx_blocks)) if memory_ctx_blocks else ""
        system_prompt = persona.get("systemPrompt", "") + memory_ctx

        try:
            raw_reply = ""
            used_model = ""
            selected_gemini_model = ""

            # --- A. Groq Branch (Ultra-fast LPU) ---
            if is_groq:
                messages = [{"role": "system", "content": system_prompt}]
                for turn in history_turns:
                    role = "user" if turn["role"] == "user" else "assistant"
                    clean_content = sanitize_repetitive_openers(turn["content"]) if role == "assistant" else turn["content"]
                    messages.append({
                        "role": role,
                        "content": clean_content
                    })
                messages.append({"role": "user", "content": effective_user_prompt})

                last_groq_err = None
                fp = api_key[-8:]
                async with httpx.AsyncClient(timeout=35.0) as client:
                    if not allow_model_fallback and preferred_model:
                        groq_candidates = [preferred_model]
                    else:
                        groq_candidates = await get_groq_candidate_models(client, api_key)
                        if fp in self.model_cache and self.model_cache[fp] in groq_candidates:
                            groq_candidates.remove(self.model_cache[fp])
                            groq_candidates.insert(0, self.model_cache[fp])
                        if preferred_model:
                            if preferred_model in groq_candidates:
                                groq_candidates.remove(preferred_model)
                            groq_candidates.insert(0, preferred_model)

                    for candidate_groq in groq_candidates:
                        try:
                            res = await client.post(
                                "https://api.groq.com/openai/v1/chat/completions",
                                headers={
                                    "Authorization": f"Bearer {api_key}",
                                    "Content-Type": "application/json",
                                },
                                json={
                                    "model": candidate_groq,
                                    "messages": messages,
                                    "temperature": 0.85,
                                    "max_tokens": 1024,
                                    "presence_penalty": 0.4,
                                    "frequency_penalty": 0.4,
                                }
                            )
                            if res.status_code != 200:
                                err_body = res.text
                                if not allow_model_fallback:
                                    raise GeminiError(res.status_code, f"[MODO FIXO GROQ • {candidate_groq}] {err_body}")
                                is_retryable = (
                                    res.status_code in (400, 404, 429, 502, 503)
                                    or "decommissioned" in err_body.lower()
                                    or "rate_limit" in err_body.lower()
                                    or "rate limit" in err_body.lower()
                                )
                                if is_retryable:
                                    print(f"[OpenAmadeus Core] Groq model {candidate_groq} returned {res.status_code} ({err_body[:80]}...), trying next...")
                                    continue
                                raise GeminiError(res.status_code, err_body)

                            data = res.json()
                            choice_msg = (data.get("choices") or [{}])[0].get("message") or {}
                            content_val = choice_msg.get("content")
                            clean_candidate = strip_thinking_tags(content_val if isinstance(content_val, str) else "")

                            if not clean_candidate or is_scratchpad_or_reasoning(clean_candidate):
                                if not allow_model_fallback:
                                    raise GeminiError(502, f"[MODO FIXO GROQ • {candidate_groq}] Resposta vazia ou raciocínio interno sem diálogo.")
                                print(f"[OpenAmadeus Core] Groq model {candidate_groq} returned empty/reasoning, trying next candidate...")
                                continue

                            raw_reply = clean_candidate
                            used_model = f"{candidate_groq} (Groq LPU)"
                            self.model_cache[fp] = candidate_groq
                            last_groq_err = None
                            break
                        except GeminiError as e:
                            last_groq_err = e
                            if allow_model_fallback and e.code in (400, 404, 429, 502, 503):
                                continue
                            raise

                if last_groq_err and not raw_reply:
                    raise last_groq_err

            # --- B. OpenRouter Branch ---
            elif is_openrouter:
                messages = [{"role": "system", "content": system_prompt}]
                for turn in history_turns:
                    role = "user" if turn["role"] == "user" else "assistant"
                    clean_content = sanitize_repetitive_openers(turn["content"]) if role == "assistant" else turn["content"]
                    messages.append({
                        "role": role,
                        "content": clean_content
                    })
                messages.append({"role": "user", "content": effective_user_prompt})

                if not allow_model_fallback and preferred_model:
                    openrouter_candidates = [preferred_model]
                else:
                    openrouter_candidates = get_openrouter_candidate_models()
                    if preferred_model:
                        if preferred_model in openrouter_candidates:
                            openrouter_candidates.remove(preferred_model)
                        openrouter_candidates.insert(0, preferred_model)

                last_or_err = None
                async with httpx.AsyncClient(timeout=35.0) as client:
                    for candidate_or in openrouter_candidates:
                        try:
                            res = await client.post(
                                "https://openrouter.ai/api/v1/chat/completions",
                                headers={
                                    "Authorization": f"Bearer {api_key}",
                                    "Content-Type": "application/json",
                                    "HTTP-Referer": "http://localhost:5173",
                                    "X-Title": "OpenAmadeus"
                                },
                                json={
                                    "model": candidate_or,
                                    "messages": messages,
                                    "temperature": 0.85,
                                    "max_tokens": 1024,
                                    "presence_penalty": 0.4,
                                    "frequency_penalty": 0.4,
                                    "include_reasoning": False
                                }
                            )
                            if res.status_code != 200:
                                err_body = res.text
                                if not allow_model_fallback:
                                    raise GeminiError(res.status_code, f"[MODO FIXO OPENROUTER • {candidate_or}] {err_body}")
                                is_retryable = (
                                    res.status_code in (404, 429, 502, 503)
                                    or "unavailable for free" in err_body.lower()
                                    or "rate-limited" in err_body.lower()
                                    or "rate limit" in err_body.lower()
                                )
                                if is_retryable:
                                    print(f"[OpenAmadeus Core] OpenRouter model {candidate_or} returned {res.status_code}, trying next...")
                                    continue
                                raise GeminiError(res.status_code, err_body)

                            data = res.json()
                            choice_msg = (data.get("choices") or [{}])[0].get("message") or {}
                            content_val = choice_msg.get("content")
                            clean_candidate = strip_thinking_tags(content_val if isinstance(content_val, str) else "")

                            if not clean_candidate or is_scratchpad_or_reasoning(clean_candidate):
                                if not allow_model_fallback:
                                    raise GeminiError(502, f"[MODO FIXO OPENROUTER • {candidate_or}] Resposta vazia ou raciocínio interno.")
                                print(f"[OpenAmadeus Core] OpenRouter model {candidate_or} returned empty/reasoning, trying next candidate...")
                                continue

                            raw_reply = clean_candidate
                            used_model = f"{candidate_or.replace(':free', '')} (OpenRouter)"
                            last_or_err = None
                            break
                        except GeminiError as e:
                            last_or_err = e
                            if allow_model_fallback and e.code in (404, 429, 502, 503):
                                continue
                            raise

                if last_or_err and not raw_reply:
                    raise last_or_err

            # --- C. Google Gemini Branch ---
            else:
                contents: List[Dict[str, Any]] = []
                for turn in history_turns:
                    role = "model" if turn["role"] in ("model", "assistant") else "user"
                    turn_text = sanitize_repetitive_openers(turn["content"]) if role == "model" else turn["content"]
                    if contents and contents[-1]["role"] == role:
                        contents[-1]["parts"][0]["text"] += "\n" + turn_text
                    else:
                        contents.append({"role": role, "parts": [{"text": turn_text}]})
                while contents and contents[0]["role"] == "model":
                    contents.pop(0)
                contents.append({"role": "user", "parts": [{"text": effective_user_prompt}]})

                payload = {
                    "contents": contents,
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "generationConfig": {
                        "temperature": 0.85,
                        "maxOutputTokens": 1024,
                        "presencePenalty": 0.4,
                        "frequencyPenalty": 0.4,
                    },
                }

                async with httpx.AsyncClient(timeout=30.0) as client:
                    if not allow_model_fallback and preferred_model:
                        candidates = [preferred_model]
                    else:
                        candidates = await get_candidate_models(client, api_key, self.model_cache)
                        if preferred_model:
                            if preferred_model in candidates:
                                candidates.remove(preferred_model)
                            candidates.insert(0, preferred_model)

                    selected_model = candidates[0]
                    data = None
                    last_error = None

                    for candidate_model in candidates:
                        try:
                            data = await gemini_request(client, "POST", f"models/{candidate_model}:generateContent", api_key, payload)
                            selected_model = candidate_model
                            self.model_cache[api_key[-8:]] = candidate_model
                            last_error = None
                            break
                        except GeminiError as e:
                            last_error = e
                            if allow_model_fallback and e.code in (503, 429, 404):
                                print(f"[OpenAmadeus Core] Model {candidate_model} returned {e.code}, trying next...")
                                continue
                            raise

                    if last_error and not data:
                        raise last_error

                    candidate = (data.get("candidates") or [{}])[0]
                    parts = (candidate.get("content") or {}).get("parts") or []
                    raw_reply = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                    used_model = selected_model
                    selected_gemini_model = selected_model

            # Parse tags with user message context for action intent mapping
            user_ctx_for_tags = None if is_system_event else req.message
            clean_text, emotion, learned = parse_tags(raw_reply, user_message=user_ctx_for_tags)
            if is_system_event:
                learned = None
            pose, camera = infer_pose_and_camera(raw_reply, emotion, user_message=user_ctx_for_tags)
            lead_emotion, lead_pose = infer_lead_expression(raw_reply, clean_text, emotion, pose, user_message=user_ctx_for_tags)

            if learned:
                print(f"[OpenAmadeus Core] Auto-consolidating memory: {learned.title}")
                saved = memory_store.add_memory(
                    category="user",
                    title=learned.title,
                    content=learned.content,
                    emotional_weight=learned.emotionalWeight or "Factual",
                    source="learned"
                )
                learned.id = saved["id"]

            memory_store.save_message(session_id, sender="amadeus", content=clean_text, emotion=emotion, recalled=recalled_ids)
            await self._maybe_update_context_summary(session_id, api_key, is_groq, is_openrouter, selected_gemini_model)

            return ChatResponse(
                response=clean_text,
                emotion=emotion,
                pose=pose,
                camera=camera,
                leadEmotion=lead_emotion,
                leadPose=lead_pose,
                recalledMemories=recalled_ids,
                sessionId=session_id,
                model=used_model,
                learnedMemory=learned
            )

        except GeminiError as e:
            print(f"[Core Error]: {e}")
            err_msg = f"[ERRO {e.code or 'REDE'}] {e.message}"
            return ChatResponse(response=err_msg, emotion="serious", recalledMemories=recalled_ids, sessionId=session_id, error=err_msg)
        except Exception as e:
            print(f"[General Error]: {e}")
            err_msg = f"[ERRO] {str(e)}"
            return ChatResponse(response=err_msg, emotion="serious", recalledMemories=recalled_ids, sessionId=session_id, error=err_msg)

orchestrator = LLMOrchestrator()
