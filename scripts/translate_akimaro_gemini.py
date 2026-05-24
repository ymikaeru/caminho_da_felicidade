"""
Translate the 387 pending poems of Akimaro Kin'eishū using Gemini 3.1 Pro Preview.

Reads data/poetry/akimaro_kineishu.json, picks the entries where
`translation_pending` is true, sends them to the Gemini API in batches of 10,
and merges the structured response back into the JSON.

Design choices (see docs/akimaro_kineishu_translation_prompt.md):
  - Structured output via response_schema (no markdown regex).
  - System instruction holds the style guide; user message carries only
    {number, original kanji, hiragana reading}.
  - Per-batch atomic save (write tmp + rename), one .bak before batch #1.
  - Per-batch validation (count, numbers match, no empty fields).
  - Retry once with lower temperature on validation/API failure.
  - Default = dry-run (1 batch, no save) so you can eyeball before commit.

Env:
  GEMINI_API_KEY    — required.

Usage:
  python scripts/translate_akimaro_gemini.py                # dry-run, 1 batch
  python scripts/translate_akimaro_gemini.py --run --all    # actually translate everything
  python scripts/translate_akimaro_gemini.py --run --limit 5
  python scripts/translate_akimaro_gemini.py --run --start-at 130
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from pydantic import BaseModel, Field

from google import genai
from google.genai import types as genai_types

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.json"
PROMPT_PATH = ROOT / "docs" / "akimaro_kineishu_translation_prompt.md"
BACKUP_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.json.bak"

MODEL_ID = "gemini-3.1-pro-preview"
# 3 per batch — quality-first setting. Each poem now generates 10 fields
# (translation_literal, context, tags, kigo, kototama, profundidade etc.),
# and small batches keep the model's attention focused on each entry,
# minimizing padronização of Kigo/Kototama and end-of-batch fatigue.
# 3 also preserves enough comparative context (vs 1-per-batch) so the
# model calibrates style across the period. Trade-off: 129 calls vs 39
# for batch_size=10, +~$0.50 in input tokens, +~20 min wall time.
BATCH_SIZE = 3
TEMPERATURE = 0.65          # poetic but not wild
RETRY_TEMPERATURE = 0.45    # second-try with tighter sampling
SLEEP_BETWEEN_BATCHES = 2.0 # seconds


# ---------------------------------------------------------------------------
# Schema (Gemini will return JSON matching this shape)
# ---------------------------------------------------------------------------

class TranslatedPoem(BaseModel):
    number: int = Field(description="Numero do poema (deve corresponder ao numero enviado).")
    title: str = Field(description="Titulo curto em portugues, evocativo (3-6 palavras).")
    reading: str = Field(description="Transliteracao em romaji Hepburn com ' / ' entre as cinco estrofes 5-7-5-7-7.")
    translation: str = Field(description="Traducao artistica em PT-BR, fluida e elevada, em prosa contida.")
    translation_literal: str = Field(description="Traducao literal palavra-por-palavra, espelhando a estrutura sintatica do original, segmentada nas cinco estrofes 5-7-5-7-7 separadas por ' / '.")
    context: str = Field(description="Contexto historico-biografico em uma frase: o que acontecia na vida de Meishu-Sama, no Japao ou na obra naquela data; se nao houver evento marcante, contextualize lugar/estacao.")
    tags: list[str] = Field(description="2 a 5 tags curtas em portugues capturando os temas centrais. Use vocabulario consistente: Natureza, Kannon, Era do Dia, Profecia, Lar, Viagem, Fuji, Tamagawa, Hakone, Ise, Salvacao, Purificacao, Saudade, Lirismo, Critica social, Era da Noite, Messias, Beleza, Paz.")
    kigo: str = Field(description="Analise sensorial da estacao, luz, temperatura, paisagem e clima evocados (Kigo).")
    kototama: str = Field(description="Analise fonetica do poema original: sons suaves vs duros, ritmo, repeticoes, alma das palavras (Kototama).")
    profundidade: str = Field(description="Licao espiritual do poema sob a otica dos Ensinamentos de Meishu-Sama: filosofia, profecia ou licao de vida oculta.")


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------

def load_json() -> dict:
    with open(JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_atomic(data: dict) -> None:
    tmp = JSON_PATH.with_suffix(JSON_PATH.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, JSON_PATH)


def make_backup_once() -> None:
    if not BACKUP_PATH.exists():
        shutil.copy2(JSON_PATH, BACKUP_PATH)
        print(f"  backup: {BACKUP_PATH.name}")


# ---------------------------------------------------------------------------
# Batch helpers
# ---------------------------------------------------------------------------

@dataclass
class PendingPoem:
    number: int
    original: str
    reading_hira: str
    date: str
    section_idx: int
    poem_idx: int


def collect_pending(data: dict, start_at: int | None = None) -> list[PendingPoem]:
    out: list[PendingPoem] = []
    for si, sec in enumerate(data["sections"]):
        for pi, p in enumerate(sec["poems"]):
            if not p.get("translation_pending"):
                continue
            if start_at is not None and p["number"] < start_at:
                continue
            out.append(PendingPoem(
                number=p["number"],
                original=p["original"],
                reading_hira=p["reading_hira"],
                date=p.get("date", ""),
                section_idx=si,
                poem_idx=pi,
            ))
    out.sort(key=lambda p: p.number)
    return out


def chunks(seq: list, n: int) -> Iterable[list]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

def load_system_instruction() -> str:
    """Load the style guide from the markdown file, stripping the I/O contract
    (template + stop instruction) which is now irrelevant — schema enforces it."""
    md = PROMPT_PATH.read_text(encoding="utf-8")
    # Cut everything from "## Protocolo de Processamento" onwards.
    cutoff = md.find("## Protocolo de Processamento")
    if cutoff > 0:
        md = md[:cutoff].strip()
    # Add a tight reminder about output format (the schema enforces shape,
    # but reminding the model keeps the style on-target).
    return md + (
        "\n\n## Saída\n\n"
        "Você receberá uma lista de poemas com `number`, `original` (kanji) e "
        "`reading_hira` (hiragana). Devolva um array JSON de objetos "
        "`{number, title, reading, translation}`, **um por poema**, "
        "preservando o `number` recebido. O campo `reading` é a transliteração "
        "em romaji Hepburn com ` / ` separando as cinco estrofes (5-7-5-7-7). "
        "O campo `title` é curto (3-6 palavras), evocativo, em português culto. "
        "O campo `translation` é a tradução artística em prosa contida, com no "
        "máximo três cláusulas; sem aspas externas, sem prefácios, sem comentário."
    )


def build_user_message(batch: list[PendingPoem]) -> str:
    lines = ["Traduza os seguintes poemas:\n"]
    for p in batch:
        lines.append(f"### Poema {p.number}")
        lines.append(f"original: {p.original}")
        lines.append(f"reading_hira: {p.reading_hira}")
        if p.date:
            lines.append(f"data: {p.date}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_batch(batch: list[PendingPoem], translated: list[TranslatedPoem]) -> tuple[bool, str]:
    sent_numbers = {p.number for p in batch}
    if len(translated) != len(batch):
        return False, f"count mismatch: sent {len(batch)}, got {len(translated)}"
    got_numbers = {t.number for t in translated}
    if got_numbers != sent_numbers:
        missing = sent_numbers - got_numbers
        extra = got_numbers - sent_numbers
        return False, f"number mismatch: missing={sorted(missing)} extra={sorted(extra)}"
    for t in translated:
        for field in ("title", "reading", "translation", "translation_literal",
                      "context", "kigo", "kototama", "profundidade"):
            if not getattr(t, field).strip():
                return False, f"empty {field} for #{t.number}"
        if not t.tags or len(t.tags) < 2:
            return False, f"tags must have >= 2 entries for #{t.number}"
        if any(not tag.strip() for tag in t.tags):
            return False, f"empty tag string for #{t.number}"
    return True, "ok"


# ---------------------------------------------------------------------------
# Gemini call
# ---------------------------------------------------------------------------

def call_gemini(
    client: genai.Client,
    system_instruction: str,
    user_message: str,
    temperature: float,
) -> list[TranslatedPoem]:
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=user_message,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=list[TranslatedPoem],
        ),
    )
    # The SDK exposes parsed objects when response_schema is set.
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return list(parsed)
    # Fallback: parse JSON text.
    data = json.loads(response.text)
    return [TranslatedPoem.model_validate(item) for item in data]


# ---------------------------------------------------------------------------
# Apply translation back into the JSON tree
# ---------------------------------------------------------------------------

def apply_translation(data: dict, batch: list[PendingPoem], translated: list[TranslatedPoem]) -> None:
    by_number = {t.number: t for t in translated}
    for p in batch:
        t = by_number[p.number]
        poem = data["sections"][p.section_idx]["poems"][p.poem_idx]
        poem["title"] = t.title.strip()
        poem["reading"] = t.reading.strip()  # romaji replaces hira display
        poem["translation"] = t.translation.strip()
        poem["translation_literal"] = t.translation_literal.strip()
        poem["context"] = t.context.strip()
        poem["tags"] = [tag.strip() for tag in t.tags]
        poem["kigo"] = t.kigo.strip()
        poem["kototama"] = t.kototama.strip()
        poem["profundidade"] = t.profundidade.strip()
        poem["translation_source"] = "gemini-3.1-pro-preview"
        poem.pop("translation_pending", None)
    # Update edition counter
    translated_now = 0
    total = 0
    for sec in data["sections"]:
        for poem in sec["poems"]:
            total += 1
            if not poem.get("translation_pending"):
                translated_now += 1
    data["edition"]["translated_here"] = translated_now
    data["edition"]["total_in_original"] = total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true",
                    help="actually write the JSON. Without this, it's a dry-run.")
    ap.add_argument("--all", action="store_true",
                    help="process every pending poem (otherwise: 1 batch only).")
    ap.add_argument("--limit", type=int, default=0,
                    help="max number of batches to process (0 = no limit when --all).")
    ap.add_argument("--start-at", type=int, default=None,
                    help="start from this poem number (skip earlier pendings).")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("ERROR: set GEMINI_API_KEY (or GOOGLE_API_KEY) in env.", file=sys.stderr)
        return 1

    data = load_json()
    pending = collect_pending(data, start_at=args.start_at)
    if not pending:
        print("Nothing to translate. All caught up.")
        return 0

    batches = list(chunks(pending, BATCH_SIZE))
    if args.run:
        if not args.all:
            batches = batches[:1]
        if args.limit > 0:
            batches = batches[:args.limit]
    else:
        batches = batches[:1]  # dry-run = single batch preview

    print(f"Model:    {MODEL_ID}")
    print(f"Pending:  {len(pending)} poems ({len(list(chunks(pending, BATCH_SIZE)))} batches of {BATCH_SIZE})")
    print(f"Running:  {len(batches)} batch(es){'  [DRY RUN]' if not args.run else ''}")
    print()

    client = genai.Client(api_key=api_key)
    system_instruction = load_system_instruction()

    if args.run:
        make_backup_once()

    stats = {"ok": 0, "failed": 0}

    for bi, batch in enumerate(batches, 1):
        nums = [p.number for p in batch]
        print(f"[batch {bi}/{len(batches)}] poems {nums[0]}-{nums[-1]} ({len(batch)} entries)")
        user_msg = build_user_message(batch)

        translated: list[TranslatedPoem] | None = None
        for attempt, temp in enumerate([TEMPERATURE, RETRY_TEMPERATURE], start=1):
            try:
                translated = call_gemini(client, system_instruction, user_msg, temp)
                ok, msg = validate_batch(batch, translated)
                if ok:
                    break
                print(f"  attempt {attempt} validation failed: {msg}")
                translated = None
            except Exception as e:
                print(f"  attempt {attempt} api error: {type(e).__name__}: {e}")
                translated = None
                time.sleep(3)

        if translated is None:
            print(f"  SKIPPED batch {nums[0]}-{nums[-1]} after 2 attempts.\n")
            stats["failed"] += 1
            continue

        # Dry-run: show preview, no write
        if not args.run:
            print("  --- preview (dry-run) ---")
            for t in translated:
                print(f"  #{t.number} {t.title}  [tags: {', '.join(t.tags)}]")
                print(f"    reading:       {t.reading}")
                print(f"    translation:   {t.translation}")
                print(f"    literal:       {t.translation_literal}")
                print(f"    context:       {t.context}")
                print(f"    kigo:          {t.kigo}")
                print(f"    kototama:      {t.kototama}")
                print(f"    profundidade:  {t.profundidade}")
                print()
            print("  (use --run --all to write)\n")
            stats["ok"] += 1
            continue

        apply_translation(data, batch, translated)
        save_atomic(data)
        print(f"  saved. translated_here = {data['edition']['translated_here']}/486\n")
        stats["ok"] += 1

        if bi < len(batches):
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"Done. ok={stats['ok']}  failed={stats['failed']}")
    if stats["failed"]:
        print("  (re-run to retry skipped batches — they remain translation_pending)")
    return 0 if stats["failed"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
