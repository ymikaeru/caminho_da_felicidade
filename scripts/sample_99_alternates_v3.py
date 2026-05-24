"""
Sample-mode v3: prompt SIMPLIFICADO com economia poética.

Insight do feedback do usuário: o v2 estava ornamentando demais — cada
frase saturada de inversões, "—", "eis", vocábulos raros. O Gemini Web
original tinha respiração: ornamenta onde faz sentido, fica simples
onde o original é direto.

Mudanças vs v2:
  - Remove regras AGRESSIVAS (pontuação dramática obrigatória, 3 cláusulas
    obrigatórias, inversões obrigatórias, vocativos em todo poema).
  - Substitui por "Economia poética": ornamentar SÓ quando o original pede.
  - Mantém regras técnicas (Grupo A/B vocabulário, formas verbais,
    romano-imperial, títulos comuns elevados, volição 1ª pessoa singular).
  - Temperature 0.80 (entre 0.65 do v1 e 0.95 do v2 — meio termo).
  - Batch 2 (mantém qualidade).
  - Salva em title_gemini_v3 / translation_gemini_v3.

Usa os mesmos 10 poemas do v1/v2 para comparação 4-way no terminal.

Usage:
  python scripts/sample_99_alternates_v3.py        # dry-run (preview, no save)
  python scripts/sample_99_alternates_v3.py --run  # salva no JSON
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

MODEL_ID = "gemini-3.1-pro-preview"
BATCH_SIZE = 2
TEMPERATURE = 0.80
RETRY_TEMPERATURE = 0.65
MAX_SAMPLE = 10

DEFAULT_SAMPLE = [1, 5, 17, 25, 28, 33, 50, 57, 82, 95]


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
class PoemSample:
    number: int
    original: str
    reading: str
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
        out.append(PoemSample(
            number=n,
            original=p["original"],
            reading=p["reading"],
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
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--numbers", type=str, default="",
                    help="Comma-separated poem numbers (default: 10 sample)")
    args = ap.parse_args()

    if args.numbers:
        try:
            numbers = [int(x.strip()) for x in args.numbers.split(",") if x.strip()]
        except ValueError:
            print("ERROR: --numbers must be ints", file=sys.stderr)
            return 1
    else:
        numbers = DEFAULT_SAMPLE

    if len(numbers) > MAX_SAMPLE:
        print(f"ERROR: maximo {MAX_SAMPLE} poemas (voce passou {len(numbers)})", file=sys.stderr)
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
    print(f"Model: {MODEL_ID}  |  temperature={TEMPERATURE}  |  batch={BATCH_SIZE}")
    print(f"Sample: {len(samples)} poems ({len(batches)} batches)")
    print(f"Mode:   {'WRITE' if args.run else 'DRY-RUN (no save)'}")
    print()

    client = genai.Client(api_key=key)

    for bi, batch in enumerate(batches, 1):
        nums = [p.number for p in batch]
        print(f"[batch {bi}/{len(batches)}] {nums}")
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
            print("  SKIPPED.\n")
            continue

        # Show 4-way comparison: WEB vs v1 vs v2 vs v3
        by_n = {a.number: a for a in alts}
        for p in batch:
            a = by_n[p.number]
            poem = data["sections"][p.section_idx]["poems"][p.poem_idx]
            print(f"\n  #{p.number}")
            print(f"    [WEB] title: {poem.get('title','')}")
            print(f"    [v1 ] title: {poem.get('title_gemini','')}")
            print(f"    [v2 ] title: {poem.get('title_gemini_v2','')}")
            print(f"    [v3 ] title: {a.title}")
            print(f"    [WEB] trans: {poem.get('translation','')}")
            print(f"    [v1 ] trans: {poem.get('translation_gemini','')}")
            print(f"    [v2 ] trans: {poem.get('translation_gemini_v2','')}")
            print(f"    [v3 ] trans: {a.translation}")
        print()

        if args.run:
            apply(data, batch, alts)
            save_atomic(data)
            print("  saved.\n")
        else:
            print("  (use --run to save as title_gemini_v3 / translation_gemini_v3)\n")

        if bi < len(batches):
            time.sleep(1.5)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
