"""
Fill the THREE remaining fields (translation_literal, context, tags) for
the 99 human-translated poems of Akimaro Kin'eishū.

The 99 originals came with title, reading, translation, kigo, kototama,
profundidade. They lack translation_literal / context / tags — added later
in the schema. This script asks Gemini to fill ONLY those three fields,
preserving everything else exactly as-is.

Differences vs translate_akimaro_gemini.py:
  - Smaller schema (4 fields per poem: number, translation_literal, context, tags)
  - User message INCLUDES the existing translation and reading so Gemini can
    base the literal version on the artistic one and the context on the date.
  - Lower temperature (0.55) — these fields are more factual than poetic.
  - Batch size 5 (less tokens per poem, more room).
  - Only touches poems where translation_source == "human" AND any of the
    three target fields is missing/empty. Skips Gemini-translated and
    pending poems.

Usage:
  python scripts/complete_99_fields.py                # dry-run (1 batch)
  python scripts/complete_99_fields.py --run --all    # do it
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field

from google import genai
from google.genai import types as genai_types

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.json"
PROMPT_PATH = ROOT / "docs" / "akimaro_kineishu_translation_prompt.md"

MODEL_ID = "gemini-3.1-pro-preview"
BATCH_SIZE = 5
TEMPERATURE = 0.55
RETRY_TEMPERATURE = 0.40
SLEEP_BETWEEN_BATCHES = 1.5


# ---------------------------------------------------------------------------
# Schema — just the 3 missing fields
# ---------------------------------------------------------------------------

class CompletedFields(BaseModel):
    number: int = Field(description="Numero do poema (deve corresponder ao numero enviado).")
    translation_literal: str = Field(description="Traducao literal palavra-por-palavra, espelhando a estrutura do original, segmentada nas cinco estrofes 5-7-5-7-7 separadas por ' / '.")
    context: str = Field(description="Contexto historico-biografico em uma frase: o que acontecia na vida de Meishu-Sama ou no Japao naquela data; ancorar a data se possivel.")
    tags: list[str] = Field(description="2 a 5 tags curtas em portugues capturando os temas centrais. Use vocabulario consistente: Natureza, Kannon, Era do Dia, Profecia, Lar, Viagem, Fuji, Tamagawa, Hakone, Ise, Salvacao, Purificacao, Saudade, Lirismo, Critica social, Era da Noite, Messias, Beleza, Paz, Makoto.")


@dataclass
class PoemToComplete:
    number: int
    original: str
    reading: str
    translation: str
    title: str
    date: str
    section_idx: int
    poem_idx: int


def collect_targets(data: dict) -> list[PoemToComplete]:
    """Find poems that are human-translated but missing one of the 3 target fields."""
    out: list[PoemToComplete] = []
    for si, sec in enumerate(data["sections"]):
        for pi, p in enumerate(sec["poems"]):
            if p.get("translation_source") != "human":
                continue
            missing = (
                not p.get("translation_literal")
                or not p.get("context")
                or not p.get("tags")
            )
            if not missing:
                continue
            out.append(PoemToComplete(
                number=p["number"],
                original=p.get("original", ""),
                reading=p.get("reading", ""),
                translation=p.get("translation", ""),
                title=p.get("title", ""),
                date=p.get("date", ""),
                section_idx=si,
                poem_idx=pi,
            ))
    out.sort(key=lambda x: x.number)
    return out


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def save_atomic(data: dict) -> None:
    tmp = JSON_PATH.with_suffix(JSON_PATH.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, JSON_PATH)


def load_system_instruction() -> str:
    md = PROMPT_PATH.read_text(encoding="utf-8")
    cutoff = md.find("## Protocolo de Processamento")
    if cutoff > 0:
        md = md[:cutoff].strip()
    return md + (
        "\n\n## Tarefa específica\n\n"
        "Você está completando três campos que estavam faltando em traduções "
        "humanas já feitas. **Não altere o título nem a tradução** — eles já "
        "existem e são imutáveis. Gere apenas `translation_literal`, `context` "
        "e `tags`, mantendo total fidelidade ao original japonês fornecido. "
        "A `translation_literal` deve ser uma versão palavra-por-palavra (não "
        "uma re-tradução artística), segmentada nas cinco estrofes 5-7-5-7-7 "
        "separadas por ` / `. O `context` deve ancorar a data quando possível "
        "(ex.: 'S11.5.15' → 'Maio de 1936...'). As `tags` devem reusar o "
        "vocabulário sugerido no prompt principal."
    )


def build_user_message(batch: list[PoemToComplete]) -> str:
    lines = ["Complete os três campos faltantes para os seguintes poemas:\n"]
    for p in batch:
        lines.append(f"### Poema {p.number}")
        lines.append(f"título existente: {p.title}")
        lines.append(f"original (kanji): {p.original}")
        lines.append(f"leitura (romaji): {p.reading}")
        lines.append(f"tradução existente: {p.translation}")
        if p.date:
            lines.append(f"data: {p.date}")
        lines.append("")
    return "\n".join(lines)


def validate_batch(batch: list[PoemToComplete], completed: list[CompletedFields]) -> tuple[bool, str]:
    sent_numbers = {p.number for p in batch}
    if len(completed) != len(batch):
        return False, f"count mismatch: sent {len(batch)}, got {len(completed)}"
    got_numbers = {c.number for c in completed}
    if got_numbers != sent_numbers:
        return False, f"number mismatch: missing={sorted(sent_numbers - got_numbers)}"
    for c in completed:
        if not c.translation_literal.strip():
            return False, f"empty translation_literal for #{c.number}"
        if not c.context.strip():
            return False, f"empty context for #{c.number}"
        if not c.tags or len(c.tags) < 2:
            return False, f"tags must have >= 2 entries for #{c.number}"
    return True, "ok"


def call_gemini(client, system_instruction, user_message, temperature):
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=user_message,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=list[CompletedFields],
        ),
    )
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return list(parsed)
    return [CompletedFields.model_validate(item) for item in json.loads(response.text)]


def apply_completion(data: dict, batch: list[PoemToComplete], completed: list[CompletedFields]) -> None:
    by_number = {c.number: c for c in completed}
    for p in batch:
        c = by_number[p.number]
        poem = data["sections"][p.section_idx]["poems"][p.poem_idx]
        # Only set the three target fields; never touch title/translation/etc.
        poem["translation_literal"] = c.translation_literal.strip()
        poem["context"] = c.context.strip()
        poem["tags"] = [tag.strip() for tag in c.tags]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("ERROR: set GEMINI_API_KEY in env.", file=sys.stderr)
        return 1

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    targets = collect_targets(data)
    if not targets:
        print("Nothing to do — all 99 already have the 3 fields.")
        return 0

    batches = list(chunks(targets, BATCH_SIZE))
    if args.run:
        if not args.all:
            batches = batches[:1]
        if args.limit > 0:
            batches = batches[:args.limit]
    else:
        batches = batches[:1]

    print(f"Model:    {MODEL_ID}")
    print(f"Targets:  {len(targets)} poems with missing fields ({len(list(chunks(targets, BATCH_SIZE)))} batches of {BATCH_SIZE})")
    print(f"Running:  {len(batches)} batch(es){'  [DRY RUN]' if not args.run else ''}")
    print()

    client = genai.Client(api_key=api_key)
    system_instruction = load_system_instruction()
    stats = {"ok": 0, "failed": 0}

    for bi, batch in enumerate(batches, 1):
        nums = [p.number for p in batch]
        print(f"[batch {bi}/{len(batches)}] poems {nums[0]}-{nums[-1]} ({len(batch)} entries)")
        user_msg = build_user_message(batch)

        completed = None
        for attempt, temp in enumerate([TEMPERATURE, RETRY_TEMPERATURE], start=1):
            try:
                completed = call_gemini(client, system_instruction, user_msg, temp)
                ok, msg = validate_batch(batch, completed)
                if ok:
                    break
                print(f"  attempt {attempt} validation failed: {msg}")
                completed = None
            except Exception as e:
                print(f"  attempt {attempt} api error: {type(e).__name__}: {e}")
                completed = None
                time.sleep(3)

        if completed is None:
            print(f"  SKIPPED batch {nums[0]}-{nums[-1]} after 2 attempts.\n")
            stats["failed"] += 1
            continue

        if not args.run:
            print("  --- preview (dry-run) ---")
            for c in completed:
                print(f"  #{c.number}")
                print(f"    literal: {c.translation_literal}")
                print(f"    context: {c.context}")
                print(f"    tags:    {c.tags}")
                print()
            print("  (use --run --all to write)\n")
            stats["ok"] += 1
            continue

        apply_completion(data, batch, completed)
        save_atomic(data)
        print(f"  saved.\n")
        stats["ok"] += 1
        if bi < len(batches):
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"Done. ok={stats['ok']}  failed={stats['failed']}")
    return 0 if stats["failed"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
