# 🧠 OpenAmadeus Backend Core (`v0.1.0`)

High-performance Python backend server for the **Amadeus System**, orchestrating continuous episodic memory (RAG), psychological persona simulation, multi-provider LLM routing, and a 4-stage neural voice cascade with CUDA Graphs acceleration.

---

## ⚡ Architecture Overview & Voice Cascade

The backend operates as a decoupled, fault-tolerant multi-service pipeline:

```text
[ Frontend Client (React 19 / TypeScript / Vite) ]
       │ HTTP /api/chat & /api/tts (Streaming PCM16 / WAV / MP3)
       ▼
[ FastAPI Core Server (:8000) ] ──── (Hybrid RAG: ChromaDB + SQLite)
       │
       ├──► Stage 1: Kurisu Qwen3-TTS 1.7B (:8005 or Colab Cloudflare Tunnel)
       │         ├── Accelerated via faster-qwen3-tts (Static KV Cache + CUDA Graphs)
       │         ├── Latency: ~391 ms TTFA | Speed: 1.92x RTF (NVIDIA L4)
       │         ├── Output: Raw PCM16 streaming (audio/L16;rate=24000)
       │         └── DSP: 120-sample (5 ms) C0 boundary continuity ramp + text sanitization
       │
       ├──► Stage 2: Kokoro-TTS 82M (Local Offline CPU/GPU)
       │         ├── Model: Kokoro-82M (lang_code='p', voice='pf_dora')
       │         ├── Latency: ~80–150 ms | Footprint: ~350 MB RAM/VRAM
       │         └── Optional: Morph speech timbre with Kurisu RVC v2
       │
       ├──► Stage 3: Microsoft Edge-TTS (Universal Zero-Setup Cloud CPU)
       │         ├── Voices: pt-BR-FranciscaNeural, ja-JP-NanamiNeural
       │         ├── Footprint: 0 MB local weights, runs on ANY hardware
       │         └── Optional: Morph speech timbre with Kurisu RVC v2
       │
       └──► Stage 4: Browser Web Speech API Fallback
                 └── Automatic client-side fallback with syllable lip-sync
```

### Key Subsystems:
1. **FastAPI Core Gateway (`:8000`)**:
   - **Hybrid RAG Memory Engine**: Persistent **ChromaDB** (`server/data/memory_db`) storing semantic embeddings and 63 curated ChatML dialogue exemplars (`server/training/kurisu_finetuning_dataset_enhanced.jsonl`), coupled with **SQLite** (`server/data/amadeus.db`) for multi-turn session persistence.
   - **Multi-Provider LLM Orchestrator**: Dynamic routing across **Google Gemini** (`gemini-2.5-flash`), **Groq Cloud LPU** (`llama-3.3-70b-versatile`, `qwen/qwen3.8-27b`), **OpenRouter Free Tier** (`google/gemma-4-31b-it:free`, `nvidia/nemotron-3.5-lightning:free`), and a local deterministic **Heuristic Offline Simulator** (`offline_simulator.py`).
   - **Voice Service (`voice_service.py`)**: 4-stage automated fallback cascade with health diagnostics, round-trip pinging, and text sanitization (`clean_text_for_tts`).

---

## 🎙️ Neural Voice Models & Asset Setup

### 1. Kurisu Qwen3-TTS 1.7B (End-to-End Neural Streaming)
* **Hugging Face Repository**: [starrydark/Kurisu_Qwen3_TTS](https://huggingface.co/starrydark/Kurisu_Qwen3_TTS)
* **Acceleration Engine**: [faster-qwen3-tts](https://github.com/andimarafioti/faster-qwen3-tts) (CUDA Graphs + Static KV Cache).
* **Automatic Download**: Weights (~3.8 GB) download automatically on first startup via Hugging Face Hub into `~/.cache/huggingface/hub/`.
* **Manual Offline Clone (Optional)**:
  ```bash
  git lfs install
  git clone https://huggingface.co/starrydark/Kurisu_Qwen3_TTS server/weights/kurisu_qwen3
  ```

### 2. Kurisu RVC v2 (Timbre Morphing)
* **Hugging Face Repository**: [FrancescoCaracciolo/Kurisu-RVC](https://huggingface.co/FrancescoCaracciolo/Kurisu-RVC)
* **Voice Reference**: Makise Kurisu canonical voice timbre.
* **Weights Directory Layout**:
  ```text
  server/
  └── weights/
      ├── kurisu_rvc/
      │   ├── KurisuRVCv147.pth
      │   └── KurisuRVCv147.index
      └── models/
          ├── hubert_base.pt
          └── rmvpe.pt
  ```

### 3. Kokoro-TTS 82M & Microsoft Edge-TTS
* **Kokoro-TTS**: 82M open-weight model ([hexgrad/kokoro](https://github.com/hexgrad/kokoro)), providing instant offline synthesis.
* **Edge-TTS**: Zero configuration required, 100% free cloud neural synthesis.

---

## 🛠️ Installation & Execution

### 1. Core Server Setup (Universal — Any Machine)

```powershell
# Windows (PowerShell):
cd server
python -m venv rvc_env
.\rvc_env\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py  # or: python -m uvicorn main:app --reload --port 8000

# Linux / macOS:
cd server
python3 -m venv rvc_env
source rvc_env/bin/activate
pip install -r requirements.txt
python main.py  # or: python -m uvicorn main:app --reload --port 8000
```
Interactive OpenAPI / Swagger docs are available at `http://localhost:8000/docs`.

---

### 2. Real-Time Qwen3-TTS Execution

#### Option A: Google Colab Remote GPU Worker (Recommended)
1. Open `notebooks/Amadeus_Qwen3_TTS_Colab.ipynb` in Google Colab (select **NVIDIA L4** or **A100**).
2. Run all cells to install pinned dependencies (`transformers==5.15.1`, `faster-qwen3-tts`), capture CUDA Graphs, and expose the Cloudflare Tunnel URL.
3. Configure the public URL in OpenAmadeus Settings (⚙️) or set `QWEN_REMOTE_URL` in `server/.env`.

#### Option B: Local NVIDIA GPU Worker (`:8005`)
```powershell
# Windows (PowerShell):
cd server
python -m venv qwen_env
.\qwen_env\Scripts\Activate.ps1
pip install -r requirements-qwen.txt
python -m app.services.qwen_tts.qwen_worker

# Linux:
cd server
python3 -m venv qwen_env
source qwen_env/bin/activate
pip install -r requirements-qwen.txt
python -m app.services.qwen_tts.qwen_worker
```

---

## 📡 Key REST Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Core gateway health, ChromaDB vector count, and active subsystem status |
| `/api/chat` | `POST` | Turn execution with RAG exemplars, emotion parsing, and LLM fallback |
| `/api/tts` | `POST` | Universal speech synthesis (`audio/L16;rate=24000` PCM stream, `audio/wav`, or `audio/mpeg`) |
| `/api/voice/status` | `GET` | Real-time diagnostics across Remote Qwen3, Local Qwen3 (`:8005`), Kokoro, and RVC v2 |
| `/api/voice/ping` | `POST` | Probes Qwen3-TTS worker `/health` and measures round-trip latency + VRAM |
| `/api/voice/models` | `GET` | Lists discovered RVC checkpoints, Kokoro voices, and Edge-TTS voices |
| `/api/memories` | `GET` / `POST` / `DELETE` | Semantic episodic memory inspection and management |
| `/api/sessions` | `GET` / `POST` / `DELETE` | Conversation session persistence and history retrieval |
| `/api/divergence` | `GET` | Live worldline divergence meter telemetry |

---

## 🧪 Automated Testing

Execute the backend test suite:
```bash
python -m unittest discover -s tests -p "test_*.py"
```
