# 🧭 OpenAmadeus Companion: SemVer 0.y.z Granular Roadmap

This document aligns the evolution of the project strictly with the **[Semantic Versioning 2.0.0](https://semver.org/)** specification:
> *"Major version zero (0.y.z) is for initial development. Anything may change at any time. The public API should not be considered stable."*

There is no rush to `1.0.0`. Every backward-compatible feature set increments **MINOR (`0.y.0`)** or **PATCH (`0.y.z`)**, keeping the project in the agile `0.x` series.

---

### 🏛️ Core Architectural Principle: The 3-Tier Execution Guarantee
No feature in OpenAmadeus may force the user into expensive enterprise APIs or require top-tier enthusiast GPUs (>16GB). Every major capability adheres to the **3-Tier Execution Triad**:
1. **Tier 1 — Free Cloud / Remote (0 GB Local VRAM):** Google Colab GPU Tunnels (T4 16GB), Gemini 2.5 Flash Free Tier, Groq Cloud Free Tier, OpenRouter Free, and Edge-TTS — runs smoothly on lightweight laptops or machines with 4–6GB VRAM.
2. **Tier 2 — Mainstream Local GPU (8 GB – 12 GB VRAM):** Calibrated for real-world user hardware (**RTX 3060 12GB, RTX 4060 8GB, RTX 5060 8GB**) using optimized KV cache (`max_seq_len=1024`), 4-bit quantization, and intelligent VRAM lifecycle management.
3. **Tier 3 — Local Ultra-Lightweight (CPU / Low Power):** Kokoro 82M (~350MB), Silero VAD ONNX (~2MB), local active-window text extraction, and Offline Heuristic Simulator — enabling full companion operation while gaming or running heavy local workloads without GPU contention or internet dependency.

---

## 📍 SemVer Evolution Timeline (`0.y.z`)

### 🟢 `v0.1.0` (Released)
- Real-time streaming for Kurisu Qwen3-TTS with CUDA Graphs (~391 ms TTFA, 1.92x RTF).
- Server-side $C^0$ amplitude continuity ramp (120 samples / 5 ms).
- Client-side Web Audio DSP: 16-bit alignment buffer, 480 ms jitter buffer, 1.65x make-up gain (+4.3 dB), and dynamic compressor (-20 dB, 3.5:1).
- Resilient 4-stage voice cascade (Qwen3 &rarr; Kokoro 82M &rarr; Edge-TTS &rarr; Web Speech).
- Initial dynamic Few-Shot RAG in ChromaDB with hybrid SQLite WAL persistence.

---

### 🟢 `v0.2.0`: Acoustic Expressiveness, 174 Sprites & Hands-Free Voice Call (Completed)
- **Acoustic Ground Truth Mapping:** Empirical mapping of 21 canonical acoustic states (`EMOTION_ACOUSTIC_TARGETS`) and Talker/PredictorGraph calibration.
- **174-Slot Sprite Resolution:** Complete mapping of all 174 sprite slots across `default`, `crossed_arms`, and `backview` poses at `closeup`, `medium`, and `full` camera framings with autonomous eye-blink alignment.
- **Hands-Free & Push-to-Talk Call Modes:** High-speed STT via Groq Whisper Turbo, barge-in voice interruption, and subtitle hallucination filtering.

---

### 🟢 `v0.2.1`: Conversational Naturalness, Organic Pose/Camera Unlocking & Trilingual Foundation (Completed)
- **Body Grammar & Persona 2.0:** Canonical cognitive habits (zero chatbot mirroring, scientific rationalization of shyness, tech fluency).
- **Circadian Call Telemetry & Episodic Bridge:** Real-time injection of local time, period of day, turn counter, hiatus duration ($\Delta t$), rapport stage, and previous call memory.
- **130 Canonical Exemplars:** Rebuilt Few-Shot RAG dataset in SQLite and ChromaDB covering all 21 emotion clusters.
- **2-Beat Sprite Transitions & Trilingual Base:** Frontend expression transitions and language-aware phonetic cleaning across PT, EN, and JA.

---

### 🟢 `v0.2.2`: Sentence-Level LLM &rarr; TTS Streaming, Mid-Speech Pose Shifts & 8GB GPU Optimization (Completed)
*Focus: Real-time responsiveness, dynamic body language during speech, and rock-solid worker execution.*
1. ✅ **LLM &rarr; TTS Sentence-Level SSE Streaming (`POST /api/chat/stream`)**:
   - `SentenceStreamBuffer` boundary parser emitting `visual`, `sentence`, and `done` events upon first complete clause.
   - Tag-first conditioning (`<!--emotion:X,pose:Y,camera:Z-->`) placed at token 0 so Kurisu shifts posture before speech synthesis starts.
   - Frontend `SentenceSpeaker` prefetch audio queue (`fetchQueue`) maintaining sample-accurate $C^0$ Web Audio continuity without GPU worker preemption collisions.
   - HUD `ttfa_ms` telemetry and instant barge-in aborting both in-flight LLM stream and GPU synthesis (`POST /abort`).
2. ✅ **Dynamic Mid-Speech Pose, Expression & Camera Shifts**:
   - Support for mid-speech inline tags between sentences + organic rhetorical shift inference (`infer_sentence_shift`).
   - Sprite pose/expression/camera transitions synchronized exactly at sentence audio onset (`reveal()`).
   - Rebalanced 130 canonical exemplars and prompt directives to eliminate `crossed_arms` bias in favor of natural transitions between `default`, `crossed_arms`, `thinking`, `angry`, and `backview`.
3. ✅ **Pre-LLM Listening Micro-Reactions (Listening Gaze)**:
   - Instant visual response (questions &rarr; `thinking`, teasing &rarr; `blushing`/`annoyed`, greetings &rarr; `smile`) in the ~200-400ms prior to first LLM token arrival.
4. ✅ **PT-BR Prosody Stabilization & 8GB+ GPU Local Worker Optimization**:
   - Talker sampling calibrated (`temperature=0.75`, `top_p=0.85`) to eliminate tail-token accent drift in Portuguese.
   - Continuous producer streaming via `asyncio.Queue` on dedicated `_gpu_executor` thread (matching Google Colab architecture).
   - KV Cache trimmed (`max_seq_len=1024`) with post-warmup `torch.cuda.empty_cache()` for smooth execution on 8GB VRAM GPUs (RTX 3060/4060/5060).
   - Strict isolation in `resolve_target_url` preventing stale remote Colab URLs from overriding local mode.

---

### 🟢 `v0.3.0`: Acoustic, VAD, Multilingual & Cognitive Depth (Completed)
*Focus: Noise-immune speech detection, authentic Steins;Gate lore grounding, trilingual localization, F1/F2 formant lip-sync, and native PT-BR voice fine-tuning.*
1. ✅ **Silero VAD Web (`@ricky0123/vad-web`)**:
   - Client-side ONNX neural Voice Activity Detection (hosted locally in `public/`) replacing raw RMS volume thresholding.
   - Eliminates false barge-in triggers from keyboard typing, mouse clicks, and breathing, avoiding unnecessary Groq Whisper API calls.
2. ✅ **End-of-Call Session Summarization & Canonical Lorebook**:
   - Automatic single-pass episodic summary generated in `memory_store.py` upon call hangup / session close (zero per-turn LLM overhead during conversation).
   - Lightweight, deterministic keyword/regex JSON *Lorebook* (~25 lines in `orchestrator.py`) injecting exact canonical lore when key terms are mentioned (*IBN 5100*, *SERN*, *Leskinen*, *Kerr Black Hole*, *Operação Skuld*).
3. ✅ **Multilingual, Formant Lip-Sync & Cloud-Trained Acoustic Upgrades**:
   - Cultural persona adaptation and 100% complete UI localization across `PT-BR`, `EN`, and `JA` via zero-dependency typed dictionary (`src/i18n.ts`).
   - Canonical Japanese dubbing mode (`canonicalJpVoice`) emitting Japanese speech via single-pass inline `<!--ja:...-->` tags while displaying subtitles in the user's chosen language.
   - Native PT-BR Qwen3-TTS hybrid restoration + bilingual replay LoRA training notebook (`notebooks/Amadeus_Qwen3_TTS_PTBR_LoRA.ipynb`) eliminating foreign accent drift.
   - Real-time phonetic vowel/formant lip-sync (`F1/F2` spectral analysis: `600–950 Hz` open &rarr; `02`, `250–550 Hz` close/mid &rarr; `01`, silence &rarr; `00`) driving the 3 canonical mouth frames of the 174 VN sprites.

---

### 🟢 `v0.3.1`: Streaming Sync, Local Hardening, Docker/Env Readiness & CI (Completed)
*Focus: End-to-end streaming polish, local security hardening, Docker/environment reliability, and clean structural foundations for `v0.4.0` multimodal vision and `v0.5.0` Tauri v2 desktop.*
1. ✅ **Streaming Subtitle, Lip-Sync & Canonical JP Alignment**:
   - Preserved progressive typing across multi-sentence responses (`SubtitleBox.tsx`), cleared `isProcessing` on first audible sentence, guarded full history persistence on mid-speech cancel, and silenced synthetic mouth flap during inter-sentence pauses (`AmadeusSpriteView.tsx`).
   - Grouped multi-sentence translations under each `<!--ja:...-->` delimiter (`sentence_stream.py`), blocked mid-turn PT audio fallback after JA speech begins, and added `[HH:MM:SS.mmm]` stream/TTS telemetry logs.
2. ✅ **Local Hardening, 3-Tier Stability & Worker Lifecycle**:
   - Locked default CORS/bind to local origins (`localhost:5173`, `127.0.0.1:5173`, and Tauri v2 `tauri.localhost`), added SSRF worker URL guards (`qwen_manager.py`), and added path traversal validation on persona and RVC checkpoint loaders.
   - Offloaded blocking Kokoro and RVC inference off the asyncio event loop, added cross-platform RVC Python discovery, skipped PT-only Kokoro on EN/JA fallback, implemented clean worker shutdown in `lifespan.py`, and replaced full-table `/api/health` scans with `SELECT COUNT(*)`.
3. ✅ **Docker, `.env` Wiring & Automated CI**:
   - Fixed frontend `Dockerfile` `postinstall` build (`COPY scripts ./scripts`), enabled `server/.env` loading (`load_dotenv`) with env API key fallback and unified LLM message builders (`orchestrator.py`), removed expiring hardcoded Colab URLs, isolated GPU manual scripts into `server/scripts/`, and added GitHub Actions CI (`.github/workflows/ci.yml`).

---

### 🟢 `v0.3.2`: Runtime Latency Telemetry, E2E Benchmarks & Cold-Start Optimization (Completed)
*Focus: Full per-stage latency observability, automated offline/live benchmarking, and empirical elimination of first-turn cold-start bottlenecks.*
1. ✅ **Backend & Frontend Runtime Telemetry (`GET /api/metrics`, `X-TTS-*`, Setup → `SYSTEM`)**:
   - Added zero-dependency rolling metrics collector (`server/app/services/metrics.py`, `deque(maxlen=50)`) exposing `p50`/`p95`, cold vs. warm averages, and error/fallback/abort counters via `GET /api/metrics` and `POST /api/metrics/reset`.
   - Instrumented `/api/chat`, `/api/chat/stream`, and `/api/tts` with per-stage breakdowns (`rag_ms`, `model_discovery_ms`, `llm_fallback_attempts`, `llm_ttft_ms`, `llm_first_sentence_ms`, `handshake_ms`, `ttfb_ms`, `realtime_speed_x`), exposed via `ChatResponse.metrics` and CORS-exposed `X-TTS-*` headers.
   - Upgraded `CallHeader.tsx` TTFA badge (color-coded + clickable) and added a localized PT/EN/JA **Live Latency Telemetry & Diagnostics** panel in `SettingsModal.tsx` (`SYSTEM` tab) displaying per-turn waterfalls, STT Whisper latency, PCM audio underrun counts, and 1-click subsystem probes.
   - Migrated `SettingsModal.tsx` to native `<dialog>` (`showModal()`, `closedby="any"` + light-dismiss fallback, `overscroll-behavior: contain`) with auto-diagnostics on `SYSTEM` open and an actionable `v0.3.2` Active Runtime Stack ledger.
2. ✅ **Unified CLI Benchmark Suite & Script Upgrades**:
   - Created `server/scripts/benchmark_amadeus.py` supporting `--offline` (health, RAG hit rate & latency, offline chat/SSE, `SentenceStream`, `/api/metrics`) and `--live` (cold vs. warm LLM, trilingual/canonical JP, Colab/local Qwen3 streaming/WAV + DSP acoustic anomaly checks, and barge-in abort recovery) with automatic JSON + Markdown report export to `server/data/benchmarks/`.
   - Updated `compare_local_remote.py` and `qwen_probe.py` to print `TTFB`, total latency, and real-time speed (`x`) in summary tables, and added unit coverage in `server/tests/test_metrics.py`.
3. ✅ **Empirical Cold-Start & Per-Turn Latency Optimization**:
   - Added background ONNX embedding warm-up on server startup (`lifespan.py`) and LRU single-embedding reuse (`_embed_query` + `query_embeddings` in `memory_store.py`), eliminating the ~25–28s first-turn ONNX cold stall and reducing per-turn embeddings from 4x to 1x (~3.8x–7.9x faster offline/RAG turns).
   - Added 10-minute TTL caching for Groq/Gemini `/models` discovery (`groq.py`, `gemini.py`) plus a loop-aware keep-alive `httpx.AsyncClient` in `orchestrator.py`, dropping warm `model_discovery_ms` from ~430 ms to 0 ms.

---

### 🟢 `v0.3.3`: Persistent ONNX Session, KV Prefix Cache, Non-Blocking RAG & Honest Benchmarks (Completed)
*Focus: Eliminating per-query ONNX reloads and fixed-256 CPU padding, keeping the FastAPI event loop non-blocking, optimizing KV prefix caching, and separating uncached vs. cached RAG latency.*
1. ✅ **Persistent `ONNXMiniLM_L6_V2` & Dynamic Single-Query Padding (`memory_store.py`)**:
   - Added `_PersistentDefaultEF(DefaultEmbeddingFunction)` keeping one `ONNXMiniLM_L6_V2` session resident in RAM (fixing ChromaDB `1.5.9`'s per-call reload) and disabling fixed 256-token padding on single queries (`enable_truncation(max_length=256)` preserved), cutting uncached `rag_cold_query_ms` `p50` from `389.6 ms` to **`9.7 ms`** (**`40×` faster**) with `max_abs_diff < 1e-5`.
   - Removed private `_embedding_function` access and redundant `collection.get()` pre-queries in `_query_memory_group()`, restricted `_embed_lock` to LRU cache lookups/writes only, reused `query_embeddings` + `embeddings` in `add_memory()`, and added reentrant thread-scoped SQLite `connection_scope()` with explicit WAL transactions.
2. ✅ **KV Prefix Cache Prompt Ordering & Non-Blocking Turn I/O (`orchestrator.py`)**:
   - Reordered `_build_system_prompt()` to place static persona/language/canonical-voice blocks at the top and per-turn memories, exemplars, rolling summary, and circadian telemetry at the bottom.
   - Offloaded `_prepare_turn_context()` and `_persist_turn_result()` (including offline simulator + barge-in persistence) via `asyncio.to_thread()` inside `connection_scope()`.
3. ✅ **Lifespan-Aware Honest Benchmarking & Test Coverage (`benchmark_amadeus.py`, `tests/`)**:
   - Updated `run_offline_suite()` to run inside `with TestClient(app) as client:` and report explicit `rag_cold_query_ms` (`9.7 ms` `p50`) vs. `rag_cached_ms` (`5.1 ms` `p50`) plus uncached `chat_offline` runs (`34.6–35.4 ms` `p50`).
   - Added unit coverage for connection reuse/rollback, `collection.get()` removal, single-embedding `add_memory`, concurrent `_embed_query`, KV prefix ordering, and `_PersistentDefaultEF` batch/truncation safety (`88/88` tests in `21.06 s`).

---

### 🔨 `v0.4.0`: Amadeus Cognitive Core, MCP Agentic Tooling & Automated Evals (In Progress — `feat/v040-cognitive-core`)
*Focus: Asynchronous sleep-time memory consolidation, safe agentic MCP tool execution with Human-in-the-Loop approvals, quantitative evaluation gates, and bitemporal + emotional continuity.*
1. ✅ **Cognitive Core Infra, RAM Core Memory & Sleep-Time Compute (Slice 1 — Completed)**:
   - Implemented `complete_background()` structured-output runner (`background.py`) with Gemini schema sanitization, `/models` 404 fallback discovery, and Gemini ↔ Groq failover.
   - Added RAM-resident 4-block `CoreMemory` (`0 ms` KV-prefix injection + `/api/core-memory` CRUD) and coalescing `CognitiveWorker` (`hangup` + `idle`) with per-session exponential backoff, global circuit breaker (`cognitive.circuit_open`), and `CURRENT DATE` grounding.
   - Exposed non-secret `.env` provider auto-detection in `/api/health` + UI, added `.env` cross-provider failover (`Groq → OpenRouter → Gemini`), and handled Gemini 3 compatibility (penalty omission + `thoughtSignature` preservation).
2. ✅ **Zero-Dependency MCP Client, Bounded Tool Loop & Atomic HITL Approvals (Slice 2 — Completed)**:
   - Built stdlib JSON-RPC 2.0 `stdio` (`Popen` compatible with Windows `--reload`) and SSRF-guarded Streamable HTTP transports (`mcp_client.py`) plus opt-in reference server `mcp_lab_notes_server.py` (`0 ms` overhead when unconfigured).
   - Enforced a fail-closed policy gate (ignoring external `readOnlyHint`, `jsonschema` validation, hard timeouts, and `UNTRUSTED EXTERNAL DATA` wrapping) alongside a bounded `max_steps=3` tool loop in `/api/chat` and `/api/chat/stream`.
   - Added atomic single-use SQLite HITL approvals (`200`/`409`/`410`/`404`) via `/api/tools` and `/api/tools/approvals/*` plus `tools` telemetry in `GET /api/metrics`.
3. ✅ **Automated Evals, Optional LLM-as-a-Judge & Baseline Regression Diff (Slice 3 — Completed)**:
   - Added versioned `server/evals/golden_dataset.json`, CLI `server/scripts/run_evals.py` (`--offline`, `--live`, `--judge`, `--compare`), and CI-integrated `server/tests/test_evals.py` (`114/114` backend tests passing).
   - Established deterministic 5-suite offline gates (RAG baseline `R@1=0.83`, `R@K=0.92`, `MRR=0.88`, `FP_Rej=1.00`, Lorebook `6/6`, Hygiene `8/8`, MCP Safety `7/7`, Cognitive `5/5`) plus live structured `EvalJudgeVerdict` scoring via `complete_background()` (`6/6` turns, `4.79/5.0` avg).
4. ⏳ **Bitemporal SQLite Memory, FTS5 Hybrid RRF & Beliefs (Slice 4 — Next)**:
   - Local 0-infra bitemporal history (`valid_from`/`valid_to`, non-destructive superseding), SQLite FTS5 + ChromaDB Reciprocal Rank Fusion (benchmarked against Slice 3's baseline via `--compare`), ACT-R/Ebbinghaus confidence-weighted Beliefs, and optional pluggable Graphiti (FalkorDB / Neo4j) adapter interface.
5. ⏳ **Continuous PAD + Rapport Engine & Cognitive/HITL React UI (Slice 5 — Planned)**:
   - 3D continuous emotional state (**PAD + Rapport**, *Tsundere Paradox* mapped to the 22 emotions), Core Memory/Beliefs tabs in `MemoryInspectorModal.tsx`, interactive HITL approval cards in chat, and cognitive/tool metrics in `Setup → SYSTEM`.
6. ⏳ **Semantic End-of-Turn & Local Micro-Fillers (Slice 6 — Planned)**:
   - CPU ONNX turn-taking (`pipecat-ai/smart-turn`, ~8 MB) and zero-latency local vocal micro-fillers during tool/LLM waits.

---

### 👁️ `v0.5.0`: Flexible 3-Tier Multimodal Vision & Co-Pilot (Realigned)
*Focus: Giving Kurisu genuine visual perception of the operator's workspace, screen, and documents without forcing expensive APIs or heavy local models.*
1. **3-Tier Vision Engines (Configurable in Settings > Vision)**:
   - **Tier 1 (Default — Free Cloud):** `Gemini 2.5 Flash` / `Groq Vision` / Remote Colab worker (`Qwen2.5-VL`) with 0 GB local VRAM footprint, high-resolution code and PDF reading.
   - **Tier 2 (Local GPU Mainstream):** Quantized `Qwen2.5-VL 3B/7B` (4-bit via GGUF/Ollama) fitting alongside TTS on 8GB–12GB GPUs.
   - **Tier 3 (Local Ultra-Light):** Fast local OCR + active window title inspection via CPU (ideal when playing GPU-intensive games).
2. **On-Demand & Continuous Capture UX**:
   - Quick toolbar button (Camera/Eye icon) + global configurable shortcut (`Alt+S`).
   - Privacy toggle: *"Always show thumbnail preview before sending"* vs *"Instant silent capture"*.
   - Continuous Screen Stream mode (`getDisplayMedia`) allowing Kurisu to inspect on-demand without repeated browser prompts.
   - Canonical voice triggers (*"Kurisu, olha minha tela"*, *"O que está errado nesse código?"*).
3. **Intelligent Proactive Co-Pilot Mode**:
   - Active window/app change awareness (detecting transitions between IDE, browser, terminal, and games).
   - Smart interval sampling (30–60s) with Canvas Diff pixel hash: unchanged screen = zero LLM requests.
   - Silence filter (`NO_COMMENT`): Kurisu remains quiet unless detecting terminal exceptions, build completions, or noticeable distraction.
4. **Code, PDF & Clipboard Analysis (Quick Chip + Laboratory Modal)**:
   - Drag-and-drop file attachment chip above chat input with `Alt+C` clipboard paste support.
   - Side-by-side 'Analysis Laboratory' modal: syntax-highlighted code / PDF viewer on the left, Kurisu's avatar and review on the right.
5. **Authentic Kurisu Companion Persona & Privacy Filter**:
   - Organic, contextual reactions: senior lab partner code review, academic curiosity on science papers, and subtle `@channel` humor on games.
   - Automatic privacy masking for password fields, API tokens, and sensitive data.

---

### 🪟 `v0.6.0`: Native Tauri v2 Desktop Companion & Always-on-Top Widget (Realigned)
*Focus: Transforming OpenAmadeus into a native desktop companion running seamlessly alongside any workflow.*
1. **Tauri v2 Desktop Shell (~15 MB RAM)**:
   - Native Rust/WebView2 wrapper over the existing React 19/Vite frontend with Python FastAPI sidecar managed via Windows Job Objects (guaranteeing zero orphaned GPU processes on exit).
2. **Hybrid Display Mode & Alpha Click-Through**:
   - 1-click toggle between full Lab 304 interface and a compact, *Always-on-Top* floating "Amadeus Phone" or transparent mascot sprite.
   - Per-pixel alpha click-through (inspired by `Open-LLM-VTuber`) allowing clicks on transparent canvas areas to pass directly to underlying IDEs or games.
3. **System Tray & Global Hotkeys**:
   - Background presence in the Windows taskbar tray.
   - Global Push-to-Talk hotkey enabling voice conversation from inside fullscreen games or external apps.
4. **Tsundere Study/Focus Pomodoro Mode**:
   - Integrated study timer with characteristic tsundere encouragement and scolding when procrastination is detected.

---

### 🏁 `v1.0.0`: Production Release & One-Click Model Hub
*Focus: Out-of-the-box ease of use, standalone installers, and public API stability.*
1. **Public API Contract Freeze**: Stable, versioned REST/SSE endpoints.
2. **Lightweight Standalone Installer (`.msi` / `.exe`)**:
   - Hardware-Aware 3-Tier Model Hub auto-detecting system VRAM to guide the user between:
     - Remote Free Colab / Cloud APIs (0 GB VRAM required).
     - Local Mainstream GPU Models (for RTX 3060 12GB / 4060 8GB / 5060 8GB).
     - Local Ultra-Lightweight CPU Mode (Kokoro 82M).
3. **Full GPU-Orchestrated Docker Release**: One-line container deployment.
