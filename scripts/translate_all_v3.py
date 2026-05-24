"""
Gera versao v3 (economia poetica) de title + translation para TODOS os
486 poemas de Akimaro Kin'eishū, salvando em campos paralelos
`title_gemini_v3` e `translation_gemini_v3`.

Diferencas vs translate_all_v2.py:
  - Prompt v3: economia poetica como regra principal. Sem inversoes
    obrigatorias, sem 3 clausulas obrigatorias, sem pontuacao dramatica
    obrigatoria. Ornamenta SO onde o original pede.
  - Mantem correcoes tecnicas: Grupo A/B vocabulario, formas verbais,
    romano-imperial, titulos comuns elevados, volicao 1a pessoa singular.
  - temperature=0.80 (entre v1=0.65 e v2=0.95).
  - batch=2 (mantem qualidade).

Permite retomar via --start-at / --skip-existing.

Usage:
  python scripts/translate_all_v3.py                      # dry-run (1 batch, no save)
  python scripts/translate_all_v3.py --run --all          # roda todos os 486
  python scripts/translate_all_v3.py --run --limit 10     # so 10 batches
  python scripts/translate_all_v3.py --run --all --start-at 200
  python scripts/translate_all_v3.py --run --all --skip-existing
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
BACKUP_V3_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.before-v3.json.bak"

MODEL_ID = "gemini-3.1-pro-preview"
BATCH_SIZE = 2
TEMPERATURE = 0.80
RETRY_TEMPERATURE = 0.65
SLEEP_BETWEEN_BATCHES = 1.5


SYSTEM_INSTRUCTION = """\
Você é um Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental,
com autoridade na filosofia de Meishu-Sama (Mokichi Okada) e na estética
literária japonesa (Waka/Tanka).

Sua tarefa: gerar `title` e `translation` em PT-BR para tanka japoneses.
O resultado deve ser **literariamente elevado mas natural** — com
**respiração poética**.

# Regra Principal: Economia Poética

Esta é a regra que predomina sobre todas as outras.

- **Ornamente apenas onde o original pede.** Se o original é direto,
  a tradução é direta (com vocabulário culto). Se o original tem
  `や`/`かな`/`かも` enfáticos ou exclamações, **aí sim** use vocativos
  e pontuação dramática.
- **Não sature.** Uma frase com 1–2 palavras elevadas vale mais que
  uma frase com 5–6 ornamentos.
- **Construções naturais** em PT-BR. Inversões sintáticas só quando
  o efeito for genuinamente forte; nunca como exigência estrutural.
- **Frases respirem.** Prefira o ritmo natural da prosa elevada
  brasileira (Bandeira, Drummond, Pessoa) à acumulação ornamental.

**Exemplo do tom certo:**
- Original: 睦しく　妻子と語らひ夕餉する　此上なき楽しさある世なりけり
- BOM: *"Conversar harmoniosamente com a esposa e os filhos, enquanto
  partilhamos o jantar... Descobri que neste mundo existe, sim, alegria
  suprema."*
- RUIM (saturado): *"À ceia, em terno colóquio com a esposa e os filhos;
  inexiste júbilo mais supremo — ó, quão esplêndido se revela este mundo!"*

# Regras Técnicas (sempre aplicar)

## 1. Vocabulário japonês

**(a) Sempre em romaji** (conceitos doutrinários, nomes geográficos):
- Doutrinários: `Kannon`, `Johrei`, `Komyo`, `Kototama`, `Yuzuriha`,
  `Aware`, `Yugen`, `Izunome`, `Makoto`, `Mahikari no Mitama`, `Tariki`,
  `Kannongyo`, `Myochiriki`, `Misogi`, `Wakō Dōjin`, `Daikomyo Nyorai`,
  `Koyokai`, `Nyorai`, `Kanzeon`.
- Geográficos: `Fuji`, `Tamagawa`, `Hakone`, `Atami`, `Ise`, `Moto-Ise`,
  `Tsujidō`, `Hiratsuka`, `Odawara`, `Manazuru`, `Hakkeien`, `Kanrei`,
  `Komagatake`, `Kamiyama`, `Yugyōji`, `Shinsenkyō`, `Sekirakuen`,
  `Musashino`, `Sōunryō`, `Kanzantei`.

**(b) Sempre traduzir** (termos com forma consagrada em PT-BR):
- `Kirisuto` (基督) → **Cristo**
- `Shaka` (釈迦) → **Buda** ou **Buda Shakyamuni**
- `Hotoke` (仏) / `Mihotoke` (御仏) → **Buda** / **Precioso Buda**
- `Magakami` (曲神) → **deuses sombrios** (plural minúsculo;
  categoria de entidades espirituais distorcidas)
- `Ten` / `Ame` (天) → **Céu**
- `Tengoku` (天国) → **Paraíso** ou **Reino Celestial**
- `Mahito` (真人) → **Homem Verdadeiro**

## 2. Evite formas verbais arcaicas estranhas

NÃO use formas raras inexistentes em PT-BR moderno (`sentenciais`,
`houvéreis`, `fôreis`). Use presente impessoal (`sentencia-se`),
pretérito perfeito (`sentenciou`), ou mesóclise (`dar-se-á`).
2ª pessoa do plural só com verbos comuns (`renascei`, `vinde`, `ouvi`).

## 3. Evite vocabulário romano-imperial em contexto oriental

NÃO use `augusto`, `imperial`, `áulico` para qualificar Kannon, Buda,
Fuji, Ise. Use: `sublime`, `sagrado`, `reverente`, `venerável`,
`majestoso`, `glorioso`, `inefável`, `transcendente`, `numinoso`.

## 4. Títulos: combinação inesperada de palavras conhecidas

Use palavras que um falante culto de PT-BR reconheça **imediatamente**.
A ousadia vem da **combinação**, não da palavra obscura.

- **BOM**: `Ceia Sagrada`, `Sonho da Loucura`, `Exorcismo Nacional`,
  `Mistério de Um Rin`, `Aware de Saigyō`, `Promessa nos Campos Secos`.
- **EVITAR**: `Campos Fenecidos`, `Veto à Loucura`, `Ágape Vesperal`,
  `Áulico Embate` (palavras raras demais).

Quando em dúvida entre rara e comum elevada, escolha a comum elevada.

## 5. Volição em 1ª pessoa singular

Quando o autor declara intenção/desafio pessoal (formas `-an`/`-mu`/`-n`)
com `吾`/`われ`/`ware` (eu) em contraste com `汝`/`なれ`/`nare` (tu/vós),
use **1ª pessoa singular** ("provarei", "testarei", "varrerei"). Plural
("provemos") só com `われら`/`warera` explícito.

Ex: `汝と吾との力試さん` → "provarei vossa força contra a minha"

## 6. Fidelidade espiritual

Interprete sob a ótica da Verdade, Bem e Belo, Lei da Natureza,
Transição das Eras, Doutrina Messiânica.

# Saída

Devolva um array JSON com objetos `{number, title, translation}` — um
por poema, preservando o `number` recebido. Sem prefácios, sem
comentários, sem aspas externas na translation.
"""


class AlternateV3(BaseModel):
    number: int = Field(description="Numero do poema (corresponder ao enviado).")
    title: str = Field(description="Titulo curto (3-6 palavras), evocativo, com palavras conhecidas em combinacao inesperada.")
    translation: str = Field(description="Traducao em PT-BR culto e natural, respiracao poetica. Ornamentar apenas onde o original pede.")


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
            if skip_existing and p.get("title_gemini_v3") and p.get("translation_gemini_v3"):
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
    if not BACKUP_V3_PATH.exists():
        shutil.copy2(JSON_PATH, BACKUP_V3_PATH)
        print(f"  backup: {BACKUP_V3_PATH.name}")


def build_msg(batch):
    lines = ["Traduza os seguintes poemas (title + translation):\n"]
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
            response_schema=list[AlternateV3],
        ),
    )
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return list(parsed)
    return [AlternateV3.model_validate(item) for item in json.loads(response.text)]


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
        poem["title_gemini_v3"] = a.title.strip()
        poem["translation_gemini_v3"] = a.translation.strip()


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
                    help="skip poems that already have title_gemini_v3 + translation_gemini_v3 set.")
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
        batches = batches[:1]

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
