"""
Gera versao v2 (calibrada para tom literario elevado) de title + translation
para TODOS os 486 poemas de Akimaro Kin'eishū, salvando em campos paralelos
`title_gemini_v2` e `translation_gemini_v2` sem alterar os existentes.

Diferencas vs translate_akimaro_gemini.py:
  - Nao retraduz analise (kigo, kototama, profundidade, literal, context, tags
    permanecem como estao). So gera title + translation.
  - Prompt v2: temperature=0.95, batch=2, instrucoes explicitas sobre tom
    (Quao, Eis, O, inversoes, 3 clausulas, vocabulario japones — Grupo A
    romaji vs Grupo B traduzir incluindo Magakami → deuses sombrios).
  - Salva em campos paralelos para A/B comparison no admin.

Permite retomar via --start-at se cair no meio.

Usage:
  python scripts/translate_all_v2.py                      # dry-run (1 batch, no save)
  python scripts/translate_all_v2.py --run --all          # roda todos os 486
  python scripts/translate_all_v2.py --run --limit 10     # so 10 batches
  python scripts/translate_all_v2.py --run --all --start-at 200
  python scripts/translate_all_v2.py --run --all --skip-existing  # pula quem ja tem _v2
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

from pydantic import BaseModel, Field

from google import genai
from google.genai import types as genai_types

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.json"
BACKUP_V2_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.before-v2.json.bak"

MODEL_ID = "gemini-3.1-pro-preview"
BATCH_SIZE = 2
TEMPERATURE = 0.95
RETRY_TEMPERATURE = 0.75
SLEEP_BETWEEN_BATCHES = 1.5


SYSTEM_INSTRUCTION = """\
Você é um Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental,
com autoridade suprema na filosofia de Meishu-Sama (Mokichi Okada) e na
estética literária japonesa (Waka/Tanka).

Sua tarefa: gerar uma versão ALTERNATIVA de `title` e `translation` em PT-BR
para tanka japoneses. Existem versões prévias; esta versão será comparada
em painel A/B. Seja **deliberadamente ousado**.

# Regras de Ouro

1. **Tom literário elevado**: vocabulário culto ("Gélido" não "frio";
   "Vasto" não "grande"; "Crepúsculo" não "fim de tarde"; "Quão" não
   "muito"; "Eis" para apresentar; "Ó" como vocativo).

2. **Pontuação dramática**: use `!`, `;`, `—`, `:`, reticências com
   propósito. Não tenha medo de exclamação.

3. **Estrutura em 3 cláusulas breves** espelhando os três grupos do tanka
   (5-7-5 / 7-7). Evite frases corridas longas.

4. **Inversões sintáticas elevadas**: predicado antes de sujeito, objeto
   antes de verbo quando o efeito for forte ("Repousa em silêncio o mar...",
   "Aspirando até a fartura o ar...").

5. **Títulos ousados**: paradoxais, evocativos, 3-6 palavras. Prefira o
   **inesperado** ("O Sonho da Loucura", "A Ceia Sagrada", "Exorcismo
   Nacional") ao **descritivo** ("Oração no Santuário", "O Dever").

6. **Vocabulário japonês — regras claras**:

   **(a) Sempre em romaji** (conceitos doutrinários e nomes geográficos):
   - Doutrinários: `Kannon`, `Johrei`, `Komyo`, `Kototama`, `Yuzuriha`,
     `Aware`, `Yugen`, `Izunome`, `Makoto`, `Mahikari no Mitama`, `Tariki`,
     `Kannongyo`, `Myochiriki`, `Misogi`, `Wakō Dōjin`, `Daikomyo Nyorai`,
     `Koyokai`, `Nyorai`, `Kanzeon`.
   - Geográficos: `Fuji`, `Tamagawa`, `Hakone`, `Atami`, `Ise`, `Moto-Ise`,
     `Tsujidō`, `Hiratsuka`, `Odawara`, `Manazuru`, `Hakkeien`, `Kanrei`,
     `Komagatake`, `Kamiyama`, `Yugyōji`, `Shinsenkyō`, `Sekirakuen`,
     `Musashino`, `Sōunryō`, `Kanzantei`.

   **(b) SEMPRE traduzir** (termos com tradução estabelecida em PT-BR):
   - `Kirisuto` (基督) → **Cristo**
   - `Shaka` (釈迦) → **Buda** ou **Buda Shakyamuni**
   - `Hotoke` (仏) / `Mihotoke` (御仏) → **Buda** / **Precioso Buda**
   - `Magakami` (曲神) → **deuses sombrios** (plural minúsculo;
     categoria de entidades espirituais distorcidas, antônimo conceitual
     de Komyo/Luz — **nunca** "Deus Maligno" no singular, nunca Satanás)
   - `Ten` / `Ame` (天) → **Céu**
   - `Tengoku` (天国) → **Paraíso** ou **Reino Celestial**
   - `Mahito` (真人) → **Homem Verdadeiro**
   - `Yo no owari` (世の終り) → **Fim dos Tempos** ou **Fim da Era**

7. **Vocativos íntimos quando o original tiver `や`, `かな`, `かも`**:
   `Ó Cristo, renascei!`, `Quão sereno é o dia!`, `Eis que desponta...`

8. **Fidelidade espiritual**: interprete sob a ótica da Verdade, Bem e Belo,
   Lei da Natureza, Transição das Eras, Doutrina Messiânica.

# Saída

Devolva um array JSON com objetos `{number, title, translation}` — um por
poema, preservando o `number` recebido. Sem prefácios, sem comentários,
sem aspas externas na translation.
"""


class AlternateV2(BaseModel):
    number: int = Field(description="Numero do poema (corresponder ao enviado).")
    title: str = Field(description="Titulo curto (3-6 palavras), evocativo e ousado, possivelmente paradoxal.")
    translation: str = Field(description="Traducao em PT-BR culto, com 3 clausulas breves separadas por ponto-e-virgula, travessao ou ponto-final, espelhando os 3 grupos do tanka.")


@dataclass
class Target:
    number: int
    original: str
    reading: str
    date: str
    section_idx: int
    poem_idx: int


def collect(data, start_at=None, skip_existing=False):
    out = []
    for si, sec in enumerate(data["sections"]):
        for pi, p in enumerate(sec["poems"]):
            if start_at is not None and p["number"] < start_at:
                continue
            if skip_existing and p.get("title_gemini_v2") and p.get("translation_gemini_v2"):
                continue
            out.append(Target(
                number=p["number"],
                original=p["original"],
                reading=p["reading"],
                date=p.get("date", ""),
                section_idx=si,
                poem_idx=pi,
            ))
    out.sort(key=lambda x: x.number)
    return out


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def save_atomic(data):
    tmp = JSON_PATH.with_suffix(JSON_PATH.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, JSON_PATH)


def make_backup_once():
    if not BACKUP_V2_PATH.exists():
        shutil.copy2(JSON_PATH, BACKUP_V2_PATH)
        print(f"  backup: {BACKUP_V2_PATH.name}")


def build_msg(batch):
    lines = ["Gere title e translation alternativos para os seguintes poemas:\n"]
    for p in batch:
        lines.append(f"### Poema {p.number}")
        lines.append(f"original: {p.original}")
        lines.append(f"reading:  {p.reading}")
        if p.date:
            lines.append(f"data:     {p.date}")
        lines.append("")
    return "\n".join(lines)


def call_gemini(client, sysinst, msg, temp):
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=msg,
        config=genai_types.GenerateContentConfig(
            system_instruction=sysinst,
            temperature=temp,
            response_mime_type="application/json",
            response_schema=list[AlternateV2],
        ),
    )
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return list(parsed)
    return [AlternateV2.model_validate(item) for item in json.loads(response.text)]


def validate(batch, alts):
    if len(alts) != len(batch):
        return False, "count mismatch"
    sent = {p.number for p in batch}
    got = {a.number for a in alts}
    if sent != got:
        return False, "numbers diverge"
    for a in alts:
        if not a.title.strip() or not a.translation.strip():
            return False, f"empty for #{a.number}"
    return True, "ok"


def apply(data, batch, alts):
    by_n = {a.number: a for a in alts}
    for p in batch:
        a = by_n[p.number]
        poem = data["sections"][p.section_idx]["poems"][p.poem_idx]
        poem["title_gemini_v2"] = a.title.strip()
        poem["translation_gemini_v2"] = a.translation.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true",
                    help="actually write the JSON. Without this, it's a dry-run.")
    ap.add_argument("--all", action="store_true",
                    help="process all targets (otherwise: 1 batch only).")
    ap.add_argument("--limit", type=int, default=0,
                    help="max batches to process (0 = no limit when --all).")
    ap.add_argument("--start-at", type=int, default=None,
                    help="start from this poem number (skip earlier).")
    ap.add_argument("--skip-existing", action="store_true",
                    help="skip poems that already have title_gemini_v2 + translation_gemini_v2 set.")
    args = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        print("ERROR: set GEMINI_API_KEY", file=sys.stderr)
        return 1

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    targets = collect(data, start_at=args.start_at, skip_existing=args.skip_existing)
    if not targets:
        print("Nothing to do.")
        return 0

    batches = list(chunks(targets, BATCH_SIZE))
    if args.run:
        if not args.all:
            batches = batches[:1]
        if args.limit > 0:
            batches = batches[:args.limit]
    else:
        batches = batches[:1]  # dry-run = 1 batch preview

    print(f"Model:    {MODEL_ID}  |  temperature={TEMPERATURE}  |  batch={BATCH_SIZE}")
    print(f"Targets:  {len(targets)} poems ({len(list(chunks(targets, BATCH_SIZE)))} batches of {BATCH_SIZE})")
    print(f"Running:  {len(batches)} batch(es){'  [DRY RUN]' if not args.run else ''}")
    print()

    client = genai.Client(api_key=key)

    if args.run:
        make_backup_once()

    stats = {"ok": 0, "failed": 0}
    start_time = time.time()

    for bi, batch in enumerate(batches, 1):
        nums = [p.number for p in batch]
        elapsed = time.time() - start_time
        est_remaining = (elapsed / bi) * (len(batches) - bi) if bi > 1 else 0
        eta_str = f"  eta={est_remaining/60:.1f}min" if est_remaining > 30 else ""
        print(f"[batch {bi}/{len(batches)}] poems {nums}{eta_str}")
        msg = build_msg(batch)
        alts = None
        for attempt, temp in enumerate([TEMPERATURE, RETRY_TEMPERATURE], start=1):
            try:
                alts = call_gemini(client, SYSTEM_INSTRUCTION, msg, temp)
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
            print(f"  SKIPPED batch {nums} after 2 attempts.\n")
            stats["failed"] += 1
            continue

        if not args.run:
            print("  --- preview (dry-run) ---")
            for a in alts:
                print(f"  #{a.number} {a.title}")
                print(f"    {a.translation}")
            print("  (use --run --all to write)\n")
            stats["ok"] += 1
            continue

        apply(data, batch, alts)
        save_atomic(data)
        stats["ok"] += 1
        if bi < len(batches):
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"\nDone. ok={stats['ok']}  failed={stats['failed']}  elapsed={(time.time()-start_time)/60:.1f}min")
    if stats["failed"]:
        print("  (re-run with --skip-existing para retomar batches que falharam)")
    return 0 if stats["failed"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
