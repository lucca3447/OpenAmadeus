#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenAmadeus Companion - Utilitário de Otimização de Sprites da Persona
========================================================================
Otimiza os arquivos PNG em public/assets/sprites/kurisu/ reduzindo o
tamanho individual de ~1.2 MB para ~150 KB (redução de ~87%) através de
quantização de 256 cores preservando o canal alfa e a extensão .png.

Como executar usando o venv existente do projeto:
    .\server\rvc_env\Scripts\python.exe scripts/optimize_sprites.py
ou ativando o venv:
    .\server\rvc_env\Scripts\Activate.ps1
    python scripts/optimize_sprites.py
"""

import sys
import time
from pathlib import Path
try:
    from PIL import Image
except ModuleNotFoundError:
    print("[!] Erro: A biblioteca 'Pillow' não foi encontrada neste ambiente Python.")
    print("    Para rodar, use o ambiente virtual existente do projeto:")
    print(r"    .\server\rvc_env\Scripts\python.exe scripts/optimize_sprites.py")
    print(r"    Ou ative o ambiente com: .\server\rvc_env\Scripts\Activate.ps1")
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
SPRITES_DIR = REPO_ROOT / "public" / "assets" / "sprites" / "kurisu"


def optimize_sprites(target_dir: Path = SPRITES_DIR):
    if not target_dir.exists():
        print(f"[!] Diretório não encontrado: {target_dir}")
        return False

    png_files = sorted(list(target_dir.glob("*.png")))
    total_files = len(png_files)
    if total_files == 0:
        print("[!] Nenhum arquivo PNG encontrado para otimizar.")
        return False

    print(f"[*] Iniciando otimização de {total_files} sprites em:\n    {target_dir}")
    t0 = time.time()

    initial_total_bytes = 0
    final_total_bytes = 0
    optimized_count = 0

    for i, p in enumerate(png_files, 1):
        try:
            orig_size = p.stat().st_size
            initial_total_bytes += orig_size

            # Skip if already under 250 KB (already optimized)
            if orig_size < 256 * 1024:
                final_total_bytes += orig_size
                continue

            with Image.open(p) as im:
                if im.mode == "RGBA":
                    im_quant = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
                    im_quant.save(p, "PNG", optimize=True)
                elif im.mode != "P":
                    im.save(p, "PNG", optimize=True)

            new_size = p.stat().st_size
            final_total_bytes += new_size
            optimized_count += 1

            if i % 25 == 0 or i == total_files:
                print(f"    [{i}/{total_files}] Sprites processados...")
        except Exception as e:
            print(f"[!] Erro ao otimizar {p.name}: {e}")

    dt = time.time() - t0
    saved_mb = (initial_total_bytes - final_total_bytes) / (1024 * 1024)
    init_mb = initial_total_bytes / (1024 * 1024)
    final_mb = final_total_bytes / (1024 * 1024)

    print("-" * 65)
    print(f"[OK] Concluído em {dt:.1f}s.")
    print(f"    Sprites otimizados: {optimized_count}/{total_files}")
    print(f"    Tamanho total anterior: {init_mb:.1f} MB")
    print(f"    Tamanho total atual:    {final_mb:.1f} MB")
    if init_mb > 0:
        print(f"    Espaço economizado:     {saved_mb:.1f} MB ({(saved_mb / init_mb) * 100:.1f}% de redução)")
    print("-" * 65)
    return True


if __name__ == "__main__":
    optimize_sprites()
