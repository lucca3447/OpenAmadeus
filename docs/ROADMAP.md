# 🧭 OpenAmadeus Companion: SemVer 0.y.z Granular Roadmap

This document aligns the evolution of the project strictly with the **[Semantic Versioning 2.0.0](https://semver.org/)** specification:
> *"Major version zero (0.y.z) is for initial development. Anything may change at any time. The public API should not be considered stable."*

There is no rush to `1.0.0`. Every backward-compatible feature set increments **MINOR (`0.y.0`)** or **PATCH (`0.y.z`)**, keeping the project in the agile `0.x` series.

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
*Focus: Audiovisual vitality of Makise Kurisu and bidirectional voice conversation.*
1. ✅ **Acoustic Calibration & Qwen3-TTS Stabilization (`emotion_mapper.py`, `qwen_worker.py`, `voice_service.py`)**:
   - Empirical mapping of 21 canonical acoustic states (`EMOTION_ACOUSTIC_TARGETS` / `EMOTION_INSTRUCT_MAP`) and protection of the SFT `Base` checkpoint (`QWEN_USE_EMOTION_INSTRUCT=false` by default) to prevent high-pitched falsettos (>550 Hz) and vocal groans.
   - Calibration of acoustic codebooks 1–15 in `PredictorGraph` (`temperature=0.6`, `top_p=0.9`) prior to CUDA Graph compilation (`FasterQwen3TTS`).
   - PT-BR phonetic sanitization (`clean_text_for_tts` and `sanitize_for_qwen`): removal of non-lexical vocables (`Hum`, `Hmm`, `U-um`), replacement of ellipses (`...`) with `, ` (eliminating 2–3s silent gaps), and conversion of `!` to `.` in PT-BR (preventing glottal-stop clipping of unstressed final syllables).
   - Automatic segmentation of long paragraphs (`prepare_worker_segments`) with `180 ms` pauses and $C^0$ continuity, eliminating early EOS cutoffs and volume drops on second sentences.
2. ✅ **174-Sprite State Machine (Poses & Camera Framing)**:
   - **Full 174-Slot Sprite Resolution:** Complete mapping of all 174 sprite slots across `default`, `crossed_arms`, and `backview` poses at `closeup`, `medium`, and `full` camera framings.
   - **Autonomous Eye-Blink Alignment:** Suppression of autonomous blinks when Kurisu has her eyes closed (`eyes_closed`) or is winking (`wink`), and preservation of happy closed-eye smiles (`happy`).
3. ✅ **Fluid Voice Conversation (Hands-Free vs. Push-to-Talk) with Groq Whisper Turbo**:
   - Quick mode toggle in `ControlBar.tsx` and granular settings in `SettingsModal.tsx`.
   - **High-Speed STT via Groq `whisper-large-v3-turbo` (`stt.py` / `sttService.ts`)**: Client-side Web Audio VAD, domain prompt biasing, and subtitle hallucination filtering.
   - **Hands-Free Mode** with VAD, native echo cancellation, and real **barge-in** (instant interruption of Kurisu's speech when the operator starts talking).
   - **Push-to-Talk Mode** and configurable Web Speech API fallback.

---

### 🟢 `v0.2.1`: Conversational Naturalness, Organic Pose/Camera Unlocking & Trilingual Foundation (Completed)
*Focus: Making the LLM converse like a real human with Makise Kurisu's canonical behavior while organically driving all 174 sprites.*
1. ✅ **Persona System Prompt 2.0 & Canonical Behavior (`kurisu.json`, `kurisu.ts`)**:
   - **Full Body Grammar:** Explicit directives for `default`, `crossed_arms`, and `backview` poses and `closeup`, `medium`, and `full` camera framings.
   - **Canonical Cognitive Habits:** Zero chatbot question mirroring, scientific rationalization of shyness (using neuroscience/thermodynamics as a shield when flustered), self-contradictory denial, existential Amadeus awareness, and modern Dev/Tech fluency (Python, C++, CUDA, Git, ArXiv, `@channel`).
   - **Spoken Lexical Hesitations:** Replacement of non-lexical filler vocables (`"Hmm..."`) with spoken transitions (`"Espere um instante,"`, `"Pensando bem,"`, `"Olha só,"`, `"Francamente,"`) so subtitle and Qwen3-TTS audio stay 100% synchronized.
2. ✅ **Circadian Call Telemetry & Rapport Evolution (`orchestrator.py`, `aiService.ts`)**:
   - Dynamic injection of `[TELEMETRIA DA CHAMADA AMADEUS]` with local time, period of day (including late-night sleep deprivation and black coffee/Dr Pepper banter), turn counter, and Rapport stage (`Initial Contact` &rarr; `Active Debate` &rarr; `LabMem Trust`).
   - Preservation of `<!--emotion:...,pose:...,camera:...-->` tags in SQLite history resolution (`_resolve_history_turns`) so the LLM never loses visual conditioning across multi-turn sessions.
3. ✅ **125 Canonical Few-Shot Exemplars (`build_enhanced_dataset.py`, `memory_store.py`)**:
   - Removal of 100% of legacy 4th-wall breaks (`"No universo de STEINS;GATE..."`).
   - Expansion from 86 to **125 canonical exemplars** covering all 21 emotion clusters, iconic interactions (`Nullpo -> Gah!`, Dr Pepper, Fujiko/cockroach panic, personal fork, `@channel`, Maho, Okabe, Reading Steiner), software engineering banter, and circadian turns — 100% tagged with `<!--emotion:X,pose:Y,camera:Z-->` and `"lang": "pt"`.
4. ✅ **Organic Pose & Camera Inference + 2-Beat Sprite Transitions (`emotion_service.py`, `App.tsx`)**:
   - Organic inference of `pose="crossed_arms"` and `camera="medium"` on scientific analysis (`analytical`), skepticism (`disdain`/`smug`), sharp rebuttals (`annoyed`/`stern`), and defensive shyness (`blushing`), plus `pose="backview"` and `camera="full"` on nickname offenses (`Christina`/`Zombie`).
   - **2-Beat Expression Shift:** Support for `leadEmotion` / `leadPose` in the chat schema and automatic frontend sprite transition (~1.5s into speech) without splitting the single Qwen3-TTS WAV stream (preserving $C^0$ amplitude continuity).
5. ✅ **Trilingual Foundation (`v0.3.0` Ready)**:
   - Added `lang: Optional[str] = "pt"` to `ChatRequest`, language-filtered exemplar retrieval in ChromaDB (`search_exemplars`), trilingual (PT / EN / JA) regex triggers in `emotion_service.py`, and language-aware phonetic cleaning in `clean_text_for_tts(text, lang)`.

---

### 🔨 `v0.2.2`: LLM $\rightarrow$ TTS Sentence-Level Streaming & Pre-LLM Micro-Reactions (Next Step)
*Focus: Reducing perceived end-to-end latency (total TTFA) and pre-response visual reactivity.*
1. ⏳ **LLM $\rightarrow$ TTS Sentence-Level Streaming**:
   - As the LLM (Groq LPU or Gemini) streams tokens, a sentence boundary parser detects punctuation (`.`, `!`, `?`, `\n`) and immediately dispatches the first sentence to TTS (`FasterQwen3-TTS` / Kokoro).
   - Audio playback starts in the browser while the LLM is still generating subsequent sentences in the background, bringing total time-to-first-audio below **~600 ms**.
2. ⏳ **Pre-LLM Listening Gaze (Micro-Reactions)**:
   - Instantaneous sprite shift during voice capture/submission (e.g., `thinking` on complex questions or `surprised` on sudden exclamations) before the first LLM token arrives.

---

### 🌐 `v0.3.0`: Full Internationalization (PT-BR / EN / JA) & Persona Variants
*Focus: Global accessibility and native support for Portuguese, English, and Japanese across the UI and interactions.*
1. **Language Selector & Persona Variants (`SettingsModal.tsx`, `i18n`)**:
   - Dedicated language profiles (`kurisu.pt.json`, `kurisu.en.json`, `kurisu.ja.json`) with authentic cultural guidelines:
     - **JA:** Makise Kurisu's native Japanese (`わたし` / `あんた` pronouns, original cadence, and direct alignment with Qwen3-TTS native phonetics).
     - **EN:** Sharp Viktor Chondria academic tone.
     - **PT-BR:** Natural Brazilian adaptation free of literal translation artifacts.
   - Full UI localization (HUD, menus, settings modal, memory inspector, and call telemetry) in `PT-BR`, `EN`, and `JA`.
2. **Polyglot Speech Synthesis & Transcription (TTS + STT)**:
   - Qwen3-TTS switching phonetic sanitization (`clean_text_for_tts(text, lang)`) and prosody parameters across `pt`, `en`, and `ja`.
   - Kokoro-TTS switching automatically between native voices (`pf_dora` in PT, `af_heart` in EN, `jf_alpha` in JA).
   - Edge-TTS switching to matching neural voices (`pt-BR-FranciscaNeural`, `en-US-AvaNeural`, `ja-JP-NanamiNeural`).
   - Groq Whisper Turbo STT receiving the active ISO-639-1 language code (`pt`, `en`, `ja`) and language-specific domain prompt biasing.
3. **Trilingual Few-Shot RAG Expansion**:
   - Native `"lang": "en"` and `"lang": "ja"` exemplars dynamically filtered by session language.

---

### 👁️ `v0.4.0`: Multimodal Vision & Screen Capture
*Focus: Allowing Kurisu to see and comment on what is on the operator's screen.*
1. **On-Demand Screen Capture via Web Screen Capture (`getDisplayMedia`)**:
   - HUD button or voice command ("Kurisu, look at my screen") to grab an instant snapshot of the active window.
   - Compressed frame dispatch to multimodal LLMs (Google Gemini 2.5 Flash / Groq Vision / local Qwen2.5-VL).
2. **Workspace Context Analysis**:
   - Kurisu comments on code open in VS Code, spots syntax errors, and reacts to diagrams, papers, or videos the operator is viewing.
3. **Snipping / Region Mode**:
   - Rectangular region selector for focused inspection of logs and code snippets.

---

### 🪟 `v0.5.0`: Pop-up Form Factor / Desktop Companion
*Focus: Kurisu as an Always-on-Top floating desktop companion.*
1. **Native Floating Window via Document Picture-in-Picture API**:
   - Uses Chromium's native `window.documentPictureInPicture.requestWindow()` API to detach Kurisu's sprite canvas and status bar into an Always-on-Top window on Windows.
   - Lets Kurisu float over VS Code, Discord, or games with full lip-sync and audio without Electron/Tauri overhead.
2. **Passive Co-Pilot Mode**:
   - Optional periodic screen sampling with spontaneous remarks while the operator works.

---

### 🏁 `v1.0.0`: Production Stable Release (Public API Freeze)
*Focus: Final stability, public API maturity, and distribution.*
- Formal freeze of the public API contract.
- Native one-click desktop installer package.
- Fully orchestrated GPU Docker Compose release.
