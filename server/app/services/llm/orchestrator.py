from typing import Dict, List, Any
import httpx

from app.core.config import MAX_HISTORY_MESSAGES
from app.schemas.chat import ChatRequest, ChatResponse
from app.db.memory_store import memory_store
from app.services.persona_service import load_persona
from app.services.emotion_service import strip_thinking_tags, is_scratchpad_or_reasoning, parse_tags, sanitize_repetitive_openers, infer_pose_and_camera
from app.services.offline_simulator import offline_simulator
from app.services.divergence_service import get_worldline_divergence
from app.services.llm.gemini import GeminiError, gemini_request, get_candidate_models
from app.services.llm.groq import get_groq_candidate_models
from app.services.llm.openrouter import get_openrouter_candidate_models

_model_cache: Dict[str, str] = {}

class LLMOrchestrator:
    def __init__(self):
        self.model_cache = _model_cache

    async def handle_chat(self, req: ChatRequest) -> ChatResponse:
        persona = load_persona(req.personaId or "kurisu")
        
        # Active session ID
        session_id = req.sessionId
        if not session_id:
            session_id = memory_store.create_session()

        # 1. Semantic Memory Retrieval using ChromaDB
        semantic_matches = memory_store.search_memories(req.message, n_results=6)
        recalled_ids = [m["id"] for m in semantic_matches]

        # Save user message to SQLite
        memory_store.save_message(session_id, sender="user", content=req.message)

        api_key = (req.apiKey or "").strip()
        is_groq = api_key.startswith("gsk_")
        is_openrouter = api_key.startswith("sk-or-")

        # Offline Simulator fallback if no key
        if not api_key:
            clean_text, emotion, learned = offline_simulator(req.message, persona, semantic_matches)
            pose, camera = infer_pose_and_camera(clean_text, emotion, req.message)
            
            # If offline simulator detected user fact, save to Chroma + SQLite
            if learned:
                memory_store.add_memory(
                    category="user",
                    title=learned.title,
                    content=learned.content,
                    emotional_weight=learned.emotionalWeight or "Factual",
                    source="learned"
                )

            memory_store.save_message(session_id, sender="amadeus", content=clean_text, emotion=emotion, recalled=recalled_ids)
            return ChatResponse(
                response=clean_text,
                emotion=emotion,
                pose=pose,
                camera=camera,
                recalledMemories=recalled_ids,
                sessionId=session_id,
                learnedMemory=learned,
                model="Simulador Local (ChromaDB + SQLite)"
            )

        # 2. Build Memory Context for LLM
        kurisu_memories = [m for m in semantic_matches if m.get("source") != "learned"]
        user_memories = [m for m in semantic_matches if m.get("source") == "learned"]

        memory_ctx_blocks = []
        if kurisu_memories:
            block = "[MEMÓRIAS DIGITALIZADAS DE MAKISE KURISU RESGATADAS PELO CÓRTEX]:\n" + "\n".join(
                [f"- {m['title']}: {m['content']} (Sentimento: {m.get('emotionalWeight', 'Factual')})" for m in kurisu_memories]
            )
            memory_ctx_blocks.append(block)

        if user_memories:
            block = "[FATOS APRENDIDOS ANTERIORMENTE SOBRE O OPERADOR]:\n" + "\n".join(
                [f"- {m['title']}: {m['content']}" for m in user_memories]
            )
            memory_ctx_blocks.append(block)

        # 3. Dynamic Few-Shot Exemplars from Kurisu Fine-Tuning Pack
        exemplars = memory_store.search_exemplars(req.message, n_results=2)
        if exemplars:
            ex_lines = [f"Operador: \"{ex['user']}\"\nKurisu: \"{ex['assistant']}\"" for ex in exemplars]
            block = "[EXEMPLOS CANÔNICOS DE DIÁLOGO E TOM DA KURISU]:\n" + "\n\n".join(ex_lines)
            memory_ctx_blocks.append(block)

        # 4. Telemetria do Medidor de Divergência (Steins;Gate Worldline Meter)
        div_data = await get_worldline_divergence()
        div_val = div_data.get("divergence", "1.048596")
        div_wl = div_data.get("worldline", "Steins Gate")
        block_div = f"[TELEMETRIA DO SISTEMA AMADEUS // DIVERGENCE METER]: Linha de Mundo Atual: {div_val}% ({div_wl})"
        memory_ctx_blocks.append(block_div)

        memory_ctx = ("\n\n" + "\n\n".join(memory_ctx_blocks)) if memory_ctx_blocks else ""
        system_prompt = persona.get("systemPrompt", "") + memory_ctx

        try:
            raw_reply = ""
            used_model = ""

            # --- A. Groq Branch (Ultra-fast LPU) ---
            if is_groq:
                messages = [{"role": "system", "content": system_prompt}]
                for turn in req.history[-MAX_HISTORY_MESSAGES:]:
                    role = "user" if turn.role == "user" else "assistant"
                    clean_content = sanitize_repetitive_openers(turn.content) if role == "assistant" else turn.content
                    messages.append({
                        "role": role,
                        "content": clean_content
                    })
                messages.append({"role": "user", "content": req.message})

                last_groq_err = None
                fp = api_key[-8:]
                async with httpx.AsyncClient(timeout=35.0) as client:
                    groq_candidates = await get_groq_candidate_models(client, api_key)
                    if fp in self.model_cache and self.model_cache[fp] in groq_candidates:
                        groq_candidates.remove(self.model_cache[fp])
                        groq_candidates.insert(0, self.model_cache[fp])

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
                                is_retryable = (
                                    res.status_code in (400, 404, 429, 502, 503)
                                    or "decommissioned" in err_body.lower()
                                    or "rate_limit" in err_body.lower()
                                    or "rate limit" in err_body.lower()
                                )
                                if is_retryable:
                                    print(f"[Amadeus Core] Groq model {candidate_groq} returned {res.status_code} ({err_body[:80]}...), trying next...")
                                    continue
                                raise GeminiError(res.status_code, err_body)

                            data = res.json()
                            choice_msg = (data.get("choices") or [{}])[0].get("message") or {}
                            content_val = choice_msg.get("content")
                            clean_candidate = strip_thinking_tags(content_val if isinstance(content_val, str) else "")

                            if not clean_candidate or is_scratchpad_or_reasoning(clean_candidate):
                                print(f"[Amadeus Core] Groq model {candidate_groq} returned empty, reasoning, or scratchpad, trying next candidate...")
                                continue

                            raw_reply = clean_candidate
                            used_model = f"{candidate_groq} (Groq LPU)"
                            self.model_cache[fp] = candidate_groq
                            last_groq_err = None
                            break
                        except GeminiError as e:
                            last_groq_err = e
                            if e.code in (400, 404, 429, 502, 503):
                                continue
                            raise

                if last_groq_err and not raw_reply:
                    raise last_groq_err

            # --- B. OpenRouter Branch ---
            elif is_openrouter:
                messages = [{"role": "system", "content": system_prompt}]
                for turn in req.history[-MAX_HISTORY_MESSAGES:]:
                    role = "user" if turn.role == "user" else "assistant"
                    clean_content = sanitize_repetitive_openers(turn.content) if role == "assistant" else turn.content
                    messages.append({
                        "role": role,
                        "content": clean_content
                    })
                messages.append({"role": "user", "content": req.message})

                openrouter_candidates = get_openrouter_candidate_models()
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
                                    "X-Title": "Amadeus System"
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
                                is_retryable = (
                                    res.status_code in (404, 429, 502, 503)
                                    or "unavailable for free" in err_body.lower()
                                    or "rate-limited" in err_body.lower()
                                    or "rate limit" in err_body.lower()
                                )
                                if is_retryable:
                                    print(f"[Amadeus Core] OpenRouter model {candidate_or} returned {res.status_code}, trying next...")
                                    continue
                                raise GeminiError(res.status_code, err_body)

                            data = res.json()
                            choice_msg = (data.get("choices") or [{}])[0].get("message") or {}
                            content_val = choice_msg.get("content")
                            clean_candidate = strip_thinking_tags(content_val if isinstance(content_val, str) else "")

                            if not clean_candidate or is_scratchpad_or_reasoning(clean_candidate):
                                print(f"[Amadeus Core] OpenRouter model {candidate_or} returned empty, reasoning, or scratchpad, trying next candidate...")
                                continue

                            raw_reply = clean_candidate
                            used_model = f"{candidate_or.replace(':free', '')} (OpenRouter)"
                            last_or_err = None
                            break
                        except GeminiError as e:
                            last_or_err = e
                            if e.code in (404, 429, 502, 503):
                                continue
                            raise

                if last_or_err and not raw_reply:
                    raise last_or_err

            # --- C. Google Gemini Branch ---
            else:
                contents: List[Dict[str, Any]] = []
                for turn in req.history[-MAX_HISTORY_MESSAGES:]:
                    role = "model" if turn.role in ("model", "assistant") else "user"
                    turn_text = sanitize_repetitive_openers(turn.content) if role == "model" else turn.content
                    if contents and contents[-1]["role"] == role:
                        contents[-1]["parts"][0]["text"] += "\n" + turn_text
                    else:
                        contents.append({"role": role, "parts": [{"text": turn_text}]})
                while contents and contents[0]["role"] == "model":
                    contents.pop(0)
                contents.append({"role": "user", "parts": [{"text": req.message}]})

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
                    candidates = await get_candidate_models(client, api_key, self.model_cache)
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
                            if e.code in (503, 429, 404):
                                print(f"[Amadeus Core] Model {candidate_model} returned {e.code}, trying next...")
                                continue
                            raise

                    if last_error and not data:
                        raise last_error

                    candidate = (data.get("candidates") or [{}])[0]
                    parts = (candidate.get("content") or {}).get("parts") or []
                    raw_reply = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                    used_model = selected_model

            # Parse tags with user message context for action intent mapping
            clean_text, emotion, learned = parse_tags(raw_reply, user_message=req.message)
            pose, camera = infer_pose_and_camera(raw_reply, emotion, user_message=req.message)

            # Auto-consolidate learned memory into ChromaDB + SQLite
            if learned:
                print(f"[Amadeus Core] Auto-consolidating memory: {learned.title}")
                memory_store.add_memory(
                    category="user",
                    title=learned.title,
                    content=learned.content,
                    emotional_weight=learned.emotionalWeight or "Factual",
                    source="learned"
                )

            # Save assistant message to SQLite
            memory_store.save_message(session_id, sender="amadeus", content=clean_text, emotion=emotion, recalled=recalled_ids)

            return ChatResponse(
                response=clean_text,
                emotion=emotion,
                pose=pose,
                camera=camera,
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
