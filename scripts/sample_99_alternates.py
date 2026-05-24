"""
Sample-mode for A/B comparison: regenerate `title` and `translation` for
N selected poems via Gemini, saving as `title_gemini` and `translation_gemini`
(paralelo, sem tocar nos originais).

After running, compare humano vs Gemini side-by-side and decide if it's
worth running for all 99.

Usage:
  python scripts/sample_99_alternates.py                          # dry-run (10 default sample)
  python scripts/sample_99_alternates.py --run                    # write to JSON
  python scripts/sample_99_alternates.py --run --numbers 1,5,17,28,33,50,57,82,25,95
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
TEMPERATURE = 0.65
RETRY_TEMPERATURE = 0.45

# Default sample: 10 poemas variados (natureza, filosofia, Kannon, messianico,
# lar, profecia). Cobre a paleta tematica das primeiras secoes.
DEFAULT_SAMPLE = [1, 5, 17, 25, 28, 33, 50, 57, 82, 95]

# Limite duro: este script e' so' para amostragem A/B antes de decidir se
# vale gerar versoes alternativas para os 99 inteiros. Se quiser rodar
# todos, use um script dedicado (a ser feito).
MAX_SAMPLE = 10


class AlternateTranslation(BaseModel):
    number: int = Field(description="Numero do poema (deve corresponder).")
    title: str = Field(description="Titulo curto em PT (3-6 palavras), evocativo, ousado.")
    translation: str = Field(description="Traducao artistica em PT-BR, fluida e elevada; pode usar inversoes sintaticas, exclamacoes dramaticas e estrutura em 3 clausulas breves (espelhando os 3 'grupos' do tanka).")


@dataclass
class PoemSample:
    number: int
    original: str
    reading: str
    title_h: str          # humano
    translation_h: str    # humano
    date: str
    section_idx: int
    poem_idx: int


def collect(data, numbers):
    out = []
    by_num = {p["number"]: (si, pi, sec, p)
              for si, sec in enumerate(data["sections"])
              for pi, p in enumerate(sec["poems"])}
    for n in numbers:
        if n not in by_num:
            print(f"  WARN poem #{n} not found")
            continue
        si, pi, sec, p = by_num[n]
        if p.get("translation_source") != "human":
            print(f"  WARN poem #{n} is not human-translated, skipping")
            continue
        out.append(PoemSample(
            number=n,
            original=p["original"],
            reading=p["reading"],
            title_h=p["title"],
            translation_h=p["translation"],
            date=p.get("date", ""),
            section_idx=si,
            poem_idx=pi,
        ))
    return out


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def save_atomic(data):
    tmp = JSON_PATH.with_suffix(JSON_PATH.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, JSON_PATH)


def load_system_instruction():
    md = PROMPT_PATH.read_text(encoding="utf-8")
    cutoff = md.find("## Protocolo de Processamento")
    if cutoff > 0:
        md = md[:cutoff].strip()
    return md + (
        "\n\n## Tarefa especifica — versao alternativa\n\n"
        "Voce esta gerando uma versao ALTERNATIVA de title e translation. "
        "Existem ja traducoes humanas previas; esta versao sera comparada com "
        "elas em um painel A/B. **Seja mais ousado:** use inversoes sintaticas "
        "elevadas, pontuacao dramatica (exclamacoes, dois-pontos, travessoes), "
        "e estruture a traducao em **3 clausulas breves** espelhando os tres "
        "grupos do tanka (5-7-5 / 7-7). Evite frases corridas. "
        "Mantenha nomes proprios em romaji. **Nao copie a traducao humana** — "
        "voce nao a ve, mas o ideal e produzir uma versao genuinamente "
        "alternativa, fiel ao original japones."
    )


def build_msg(batch):
    lines = ["Gere uma versao alternativa de title e translation para:\n"]
    for p in batch:
        lines.append(f"### Poema {p.number}")
        lines.append(f"original: {p.original}")
        lines.append(f"reading:  {p.reading}")
        if p.date:
            lines.append(f"data:     {p.date}")
        lines.append("")
    return "\n".join(lines)


def call_gemini(client, system_instruction, user_message, temperature):
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=user_message,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=list[AlternateTranslation],
        ),
    )
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return list(parsed)
    return [AlternateTranslation.model_validate(item) for item in json.loads(response.text)]


def validate(batch, alts):
    if len(alts) != len(batch):
        return False, f"count mismatch"
    sent = {p.number for p in batch}
    got = {a.number for a in alts}
    if sent != got:
        return False, f"numbers diverge"
    for a in alts:
        if not a.title.strip() or not a.translation.strip():
            return False, f"empty field for #{a.number}"
    return True, "ok"


def apply(data, batch, alts):
    by_n = {a.number: a for a in alts}
    for p in batch:
        a = by_n[p.number]
        poem = data["sections"][p.section_idx]["poems"][p.poem_idx]
        poem["title_gemini"] = a.title.strip()
        poem["translation_gemini"] = a.translation.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--numbers", type=str, default="",
                    help="Comma-separated poem numbers (default: 10 spread sample)")
    args = ap.parse_args()

    if args.numbers:
        try:
            numbers = [int(x.strip()) for x in args.numbers.split(",") if x.strip()]
        except ValueError:
            print("ERROR: --numbers must be comma-separated ints", file=sys.stderr)
            return 1
    else:
        numbers = DEFAULT_SAMPLE

    if len(numbers) > MAX_SAMPLE:
        print(f"ERROR: este script aceita no máximo {MAX_SAMPLE} poemas por execução "
              f"(você passou {len(numbers)}). É apenas para amostragem A/B. "
              f"Para gerar versões alternativas de todos os 99, crie um script "
              f"dedicado depois de validar a qualidade da amostra.", file=sys.stderr)
        return 1

    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        print("ERROR: set GEMINI_API_KEY", file=sys.stderr)
        return 1

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    samples = collect(data, numbers)
    if not samples:
        print("Nothing to compare.")
        return 0

    batches = list(chunks(samples, BATCH_SIZE))
    print(f"Sample: {len(samples)} poems ({len(batches)} batches of <= {BATCH_SIZE})")
    print(f"Mode:   {'WRITE' if args.run else 'DRY-RUN (no save)'}")
    print()

    client = genai.Client(api_key=key)
    sysinst = load_system_instruction()

    for bi, batch in enumerate(batches, 1):
        nums = [p.number for p in batch]
        print(f"[batch {bi}/{len(batches)}] {nums}")
        msg = build_msg(batch)
        alts = None
        for attempt, temp in enumerate([TEMPERATURE, RETRY_TEMPERATURE], start=1):
            try:
                alts = call_gemini(client, sysinst, msg, temp)
                ok, reason = validate(batch, alts)
                if ok:
                    break
                print(f"  attempt {attempt} validation: {reason}")
                alts = None
            except Exception as e:
                print(f"  attempt {attempt} api error: {type(e).__name__}: {e}")
                alts = None
                time.sleep(3)

        if alts is None:
            print(f"  SKIPPED.\n")
            continue

        # Print side-by-side comparison
        by_n = {a.number: a for a in alts}
        print("  --- comparison ---")
        for p in batch:
            a = by_n[p.number]
            print(f"\n  #{p.number}")
            print(f"    [H] title:       {p.title_h}")
            print(f"    [G] title:       {a.title}")
            print(f"    [H] translation: {p.translation_h}")
            print(f"    [G] translation: {a.translation}")
        print()

        if args.run:
            apply(data, batch, alts)
            save_atomic(data)
            print("  saved.\n")
        else:
            print("  (use --run to save as title_gemini / translation_gemini)\n")

        if bi < len(batches):
            time.sleep(1.5)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
