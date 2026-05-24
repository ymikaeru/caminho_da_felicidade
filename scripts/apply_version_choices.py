"""
Aplica as escolhas exportadas pela aba "Versões A/B" do admin no
data/poetry/akimaro_kineishu.json. Substitui `title` e `translation`
do poema pela versão escolhida (Web/v1/v2/v3).

O JSON de entrada (gerado pelo botão "Exportar JSON" do admin) tem
formato:
  {
    "exported_at": "2026-...",
    "total_choices": 42,
    "choices": {
      "1":  { "version": "v3", "title": "...", "translation": "..." },
      "5":  { "version": "WEB", "title": "...", "translation": "..." },
      ...
    }
  }

Cria backup em data/poetry/akimaro_kineishu.before-choices.json.bak
na primeira execução. Atomic save.

Usage:
  python scripts/apply_version_choices.py path/to/akimaro_choices.json --dry-run
  python scripts/apply_version_choices.py path/to/akimaro_choices.json --apply
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.json"
BACKUP_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.before-choices.json.bak"


def save_atomic(data, path):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("choices_file", help="Caminho para o JSON exportado pelo admin")
    ap.add_argument("--apply", action="store_true", help="Realmente aplica (sem isso é dry-run)")
    args = ap.parse_args()

    choices_path = Path(args.choices_file)
    if not choices_path.exists():
        print(f"ERROR: {choices_path} not found", file=sys.stderr)
        return 1

    with open(choices_path, encoding="utf-8") as f:
        export = json.load(f)

    choices = export.get("choices") or {}
    if not choices:
        print("Nenhuma escolha no arquivo.")
        return 0

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    by_number = {}
    for si, sec in enumerate(data["sections"]):
        for pi, p in enumerate(sec["poems"]):
            by_number[p["number"]] = (si, pi)

    changes = []
    skipped = []
    for num_str, choice in choices.items():
        n = int(num_str)
        if n not in by_number:
            skipped.append((n, "not found in JSON"))
            continue
        si, pi = by_number[n]
        poem = data["sections"][si]["poems"][pi]
        new_title = choice.get("title")
        new_trans = choice.get("translation")
        if not new_title or not new_trans:
            skipped.append((n, "missing title/translation in choice"))
            continue
        before_title = poem.get("title", "")
        before_trans = poem.get("translation", "")
        if before_title == new_title and before_trans == new_trans:
            skipped.append((n, "no change"))
            continue
        changes.append({
            "number": n,
            "version": choice.get("version"),
            "before_title": before_title,
            "after_title": new_title,
        })
        if args.apply:
            poem["title"] = new_title
            poem["translation"] = new_trans
            # Marca a origem da escolha pra rastreabilidade
            poem["chosen_version"] = choice.get("version", "unknown")

    print(f"Total no arquivo de escolhas: {len(choices)}")
    print(f"Mudancas pendentes:           {len(changes)}")
    print(f"Skipped (no change/missing):  {len(skipped)}")
    print()

    # Mostra primeiras 8 mudanças como preview
    for c in changes[:8]:
        print(f"  #{c['number']:3d} [{c['version']}] {c['before_title']!r} → {c['after_title']!r}")
    if len(changes) > 8:
        print(f"  ... ({len(changes) - 8} more)")
    print()

    if not args.apply:
        print("DRY-RUN — nenhum arquivo modificado. Use --apply para gravar.")
        return 0

    if not BACKUP_PATH.exists():
        shutil.copy2(JSON_PATH, BACKUP_PATH)
        print(f"Backup criado: {BACKUP_PATH.name}")

    save_atomic(data, JSON_PATH)
    print(f"OK: {len(changes)} mudancas aplicadas em {JSON_PATH.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
