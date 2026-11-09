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

### 🟢 `v0.2.2`: Sentence-Level LLM &rarr; TTS Streaming, Mid-Speech Pose Shifts & 8GB GPU Optimization (Completed — Current)
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

### 🔨 `v0.3.0`: Acoustic, VAD & Cognitive Depth (Next Step)
*Focus: Noise-immune speech detection, authentic Steins;Gate lore grounding, and native PT-BR voice fine-tuning.*
1. **Silero VAD Web (`@ricky0123/vad-web`)**:
   - Client-side ONNX neural Voice Activity Detection (hosted locally in `public/`) replacing raw RMS volume thresholding.
   - Eliminates false barge-in triggers from keyboard typing, mouse clicks, and breathing, avoiding unnecessary Groq Whisper API calls.
2. **End-of-Call Session Summarization & Canonical Lorebook**:
   - Automatic single-pass episodic summary generated in `memory_store.py` upon call hangup / session close (zero per-turn LLM overhead during conversation).
   - Lightweight, deterministic keyword/regex JSON *Lorebook* (~25 lines in `orchestrator.py`) injecting exact canonical lore when key terms are mentioned (*IBN 5100*, *SERN*, *Leskinen*, *Kerr Black Hole*, *Operação Skuld*).
3. **Multilingual & Cloud-Trained Acoustic Upgrades**:
   - Cultural persona adaptation and full UI localization across `PT-BR`, `EN`, and `JA`.
   - Native PT-BR Qwen3-TTS LoRA fine-tuning notebook (`notebooks/`) trained on Google Colab to eliminate cross-lingual accent drift.
   - Phonetic vowel/formant lip-sync (`A/E/I/O/U`) driving mouth shapes by audio frequency analysis instead of simple volume thresholding.

---

### 👁️ `v0.4.0`: Flexible 3-Tier Multimodal Vision & Co-Pilot
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

### 🪟 `v0.5.0`: Native Tauri v2 Desktop Companion & Always-on-Top Widget
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
