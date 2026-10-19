#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenAmadeus Companion - Qwen3-TTS Worker Launcher (Local / Remote)
==================================================================
Inicia o worker de inferência neural Kurisu Qwen3-TTS 1.7B
acelerado com CUDA Graphs (faster-qwen3-tts) e streaming PCM/WAV.
"""

import os
import sys
import argparse
import threading
import uvicorn

# Garante que o diretório server está no PYTHONPATH
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from app.services.qwen_tts.qwen_worker import app


def start_cloudflare_tunnel(port: int):
    try:
        from pycloudflared import try_cloudflare
        print(f"\n[Amadeus Tunnel] Iniciando Cloudflare Tunnel para porta {port}...")
        public_url = try_cloudflare(port=port)
        tunnel_url = public_url.tunnel if hasattr(public_url, "tunnel") else str(public_url)
        print("\n" + "=" * 65)
        print("  🌟 AMADEUS CLOUDFLARE TUNNEL ATIVO!")
        print(f"  URL Pública: {tunnel_url}")
        print("=" * 65)
        print("  Copie e cole a URL acima em 'Configurações > Voz > URL Remota (Colab)'\n")
    except ImportError:
        print("\n[Amadeus Tunnel] 'pycloudflared' não está instalado.")
        print("Para túnel automático, instale com: pip install pycloudflared\n")
    except Exception as e:
        print(f"[Amadeus Tunnel] Erro ao iniciar túnel Cloudflare: {e}")


def main():
    parser = argparse.ArgumentParser(description="OpenAmadeus Kurisu Qwen3-TTS Worker")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Interface de rede (padrão: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8005, help="Porta do servidor (padrão: 8005)")
    parser.add_argument("--tunnel", choices=["cloudflare", "none"], default="none", help="Criar túnel público")
    args = parser.parse_args()

    if args.tunnel == "cloudflare":
        threading.Thread(target=start_cloudflare_tunnel, args=(args.port,), daemon=True).start()

    print(f"\n[Amadeus Worker] Iniciando Qwen3-TTS Worker em {args.host}:{args.port}...")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
