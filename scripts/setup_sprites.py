#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenAmadeus Companion - Utilitário de Verificação de Sprites da Persona
========================================================================
Este script verifica a presença do pacote opcional de sprites visuais
para a persona Makise Kurisu no OpenAmadeus Companion.

Nota de Direitos Autorais:
Os sprites visuais originais de Steins;Gate são propriedade exclusiva da
MAGES. / 5pb. / Chiyomaru Studio e NÃO são distribuídos neste repositório.
"""

import argparse
import os
import shutil
import sys
import zipfile
from pathlib import Path

# Fix Windows console encoding for UTF-8 characters if possible
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parent.parent
SPRITES_DIR = REPO_ROOT / "public" / "assets" / "sprites" / "kurisu"
SPRI_RESOURCE_URL = "https://www.spriters-resource.com/pc_computer/steinsgate0/asset/108143/"


def import_from_archive_or_dir(source_path: Path):
    """Import PNG files from a zip archive or directory into SPRITES_DIR."""
    if not source_path.exists():
        print(f"[!] ERRO: O caminho informado não existe: {source_path}")
        return False

    SPRITES_DIR.mkdir(parents=True, exist_ok=True)
    imported_count = 0

    if source_path.is_file() and zipfile.is_zipfile(source_path):
        print(f"[*] Extraindo arquivo ZIP: {source_path.name}...")
        with zipfile.ZipFile(source_path, "r") as zf:
            for member in zf.infolist():
                if member.is_dir():
                    continue
                filename = Path(member.filename).name
                if filename.lower().endswith(".png"):
                    target_file = SPRITES_DIR / filename
                    with zf.open(member) as src_file, open(target_file, "wb") as dst_file:
                        shutil.copyfileobj(src_file, dst_file)
                    imported_count += 1
    elif source_path.is_dir():
        print(f"[*] Copiando arquivos PNG da pasta: {source_path}...")
        for p in source_path.rglob("*.png"):
            target_file = SPRITES_DIR / p.name
            shutil.copy2(p, target_file)
            imported_count += 1
    else:
        print("[!] ERRO: Formato inválido. Forneça um arquivo .zip ou uma pasta com os sprites.")
        return False

    print(f"[OK] {imported_count} sprites importados com sucesso para:\n     {SPRITES_DIR}")
    try:
        from optimize_sprites import optimize_sprites
        optimize_sprites(SPRITES_DIR)
    except Exception:
        pass
    return True

def main():
    parser = argparse.ArgumentParser(
        description="OpenAmadeus Companion - Utilitário de Verificação e Importação de Sprites da Persona"
    )
    parser.add_argument(
        "--import",
        dest="import_path",
        type=str,
        help="Caminho para um arquivo .zip ou diretório contendo os sprites para importação automática.",
    )
    args = parser.parse_args()

    print("=" * 70)
    print(" OpenAmadeus Companion — Gestor de Assets Visuais da Persona")
    print("=" * 70)
    print(f"Diretório de destino: {SPRITES_DIR}\n")

    if args.import_path:
        success = import_from_archive_or_dir(Path(args.import_path).expanduser().resolve())
        print("-" * 70)
        if not success:
            return 1

    if not SPRITES_DIR.exists():
        print("[!] Diretório de sprites não encontrado.")
        print("[*] Criando diretório vazio...")
        SPRITES_DIR.mkdir(parents=True, exist_ok=True)
        print("[✓] Diretório criado.")

    png_files = list(SPRITES_DIR.glob("*.png"))
    count = len(png_files)

    if count >= 170:
        print(f"[OK] SUCESSO: Pacote completo detectado com {count} sprites.")
        print("     A interface do OpenAmadeus Companion exibirá todas as expressões nativas.")
        return 0
    elif count > 0:
        print(f"[!] ATENÇÃO: Detectados {count} sprites (esperado: ~174).")
        print("     Expressões ausentes utilizarão a silhueta holográfica vetorial de fallback.")
        return 0
    else:
        print("[i] NENHUM SPRITE ENCONTRADO.")
        print("-" * 70)
        print("INFORMAÇÕES E ORIENTAÇÕES:")
        print("1. O OpenAmadeus Companion é 100% funcional sem qualquer sprite proprietário.")
        print("   Por padrão, ele utiliza a silhueta holográfica vetorial (CyberHologramCanvas).")
        print()
        print("2. Caso deseje habilitar o visual completo de Makise Kurisu localmente:")
        print("   • Método A (Oficial via Steam/GOG):")
        print("     Extraia o arquivo 'chara.mpk' da sua cópia legítima de Steins;Gate 0")
        print("     utilizando a ferramenta open-source GARbro.")
        print()
        print("   • Método B (Referência Educacional & Preservação Comunitária):")
        print("     Consulte o arquivo de folhas de sprites documentado pela comunidade:")
        print(f"     -> {SPRI_RESOURCE_URL}")
        print()
        print("3. Como importar automaticamente:")
        print("   Se você já possui o arquivo .zip baixado ou extraído, execute:")
        print("     python scripts/setup_sprites.py --import \"C:\\caminho\\para\\arquivo.zip\"")
        print()


        print("4. Reinicie a interface web (npm run dev) após a importação.")
        print("-" * 70)
        return 1

if __name__ == "__main__":
    sys.exit(main())

