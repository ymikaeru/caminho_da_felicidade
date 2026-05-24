"""
Sample-mode v2: regenera title + translation com configuracao calibrada
para aproximar o tom literario do Gemini Web (AI Studio).

Diferencas vs sample_99_alternates.py (v1):
  - temperature = 0.95   (era 0.65) — mais ousadia, menos sobriedade
  - batch_size  = 2      (era 5)    — atencao maxima por poema
  - prompt explicito sobre tom: "Quao", "Eis", "O", inversoes,
    estrutura em 3 clausulas breves, ousadia paradoxal nos titulos
  - salva em title_gemini_v2 / translation_gemini_v2 (preserva v1)

Usa os mesmos 10 poemas do v1 (#1, 5, 17, 25, 28, 33, 50, 57, 82, 95)
para comparacao 3-way: Web vs API-v1 vs API-v2.

Usage:
  python scripts/sample_99_alternates_v2.py            # dry-run (preview, no save)
  python scripts/sample_99_alternates_v2.py --run      # salva no JSON
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
TEMPERATURE = 0.95
RETRY_TEMPERATURE = 0.75
MAX_SAMPLE = 10

DEFAULT_SAMPLE = [1, 5, 17, 25, 28, 33, 50, 57, 82, 95]


# v2 prompt — instruções explícitas de tom para aproximar o estilo Web/AI Studio.
SYSTEM_INSTRUCTION = """\
Você é um Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental,
com autoridade suprema na filosofia de Meishu-Sama (Mokichi Okada) e na
estética literária japonesa (Waka/Tanka).

Sua tarefa: gerar uma versão ALTERNATIVA de `title` e `translation` em PT-BR
para tanka japoneses já traduzidos. Existem versões prévias; esta versão
será comparada em painel A/B. Seja **deliberadamente ousado**.

# Regras de Ouro

1. **Tom literário elevado**: vocabulário culto (ex.: "Gélido" não "frio";
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

   **(a) Sempre em romaji** (conceitos doutrinários e nomes geográficos sem
   tradução estabelecida em PT-BR):
   - Doutrinários: `Kannon`, `Johrei`, `Komyo`, `Kototama`, `Yuzuriha`,
     `Aware`, `Yugen`, `Izunome`, `Makoto`, `Mahikari no Mitama`, `Tariki`,
     `Kannongyo`, `Myochiriki`, `Misogi`, `Wakō Dōjin`, `Daikomyo Nyorai`.
   - Geográficos: `Fuji`, `Tamagawa`, `Hakone`, `Atami`, `Ise`, `Moto-Ise`,
     `Tsujidō`, `Hiratsuka`, `Odawara`, `Manazuru`, `Hakkeien`, `Kanrei`,
     `Komagatake`, `Kamiyama`, `Yugyōji`, `Shinsenkyō`, `Sekirakuen`.

   **(b) SEMPRE traduzir** (nomes universais com forma consagrada em PT-BR
   ou termos messiânicos com tradução acessível):
   - `Kirisuto` (基督) → **Cristo**
   - `Shaka` (釈迦) → **Buda** ou **Buda Shakyamuni**
   - `Hotoke` (仏) → **Buda** (ou **Mihotoke** → **Precioso Buda**)
   - `Magakami` (曲神) → **deuses sombrios** (plural minúsculo; nunca
     "Deus Maligno" no singular — não é Satanás cristão; é categoria de
     entidades espirituais distorcidas, antônimo conceitual de Komyo/Luz)
   - `Ten` / `Ame` (天) → **Céu**
   - `Tsuchi` (土) → **Terra**
   - `Tengoku` (天国) → **Paraíso** ou **Reino Celestial**
   - `Yo no owari` (世の終り) → **Fim dos Tempos** ou **Fim da Era**
   - `Mahito` (真人) → **Homem Verdadeiro**

7. **Vocativos íntimos quando o original tiver `や`, `かな`, `かも`**:
   `Ó Cristo, renascei!`, `Quão sereno é o dia!`, `Eis que desponta...`
8. **Fidelidade espiritual**: interprete sob a ótica da Verdade, Bem e Belo,
   Lei da Natureza, Transição das Eras, Doutrina Messiânica.

9. **Evite formas verbais arcaicas estranhas**: NÃO use formas raríssimas
   ou inexistentes em PT-BR moderno (ex: `sentenciais`, `houvéreis`,
   `fôreis`). Prefira presente impessoal (`sentencia-se`), pretérito
   perfeito (`sentenciou`), ou mesóclise (`dar-se-á`). 2ª pessoa do plural
   só com verbos comuns (`renascei`, `vinde`, `ouvi`).

10. **Evite vocabulário romano-imperial em contexto oriental**: NÃO use
    `augusto`, `imperial`, `áulico` para qualificar Kannon, Buda, Fuji,
    Ise. Prefira: `sublime`, `sagrado`, `reverente`, `venerável`,
    `majestoso`, `glorioso`, `inefável`, `transcendente`, `numinoso`.

11. **Títulos: ousadia vem de combinação, não obscuridade**.
    BOM (palavras conhecidas em combinação inesperada): `Ceia Sagrada`,
    `Sonho da Loucura`, `Exorcismo Nacional`, `Mistério de Um Rin`.
    EVITAR (palavras raras demais): `Campos Fenecidos`, `Veto à Loucura`,
    `Ágape Vesperal`, `Áulico Embate`.
    Quando em dúvida entre rara e comum elevada, escolha a comum elevada.

12. **Volição em 1ª pessoa singular** (formas `-an`/`-mu`/`-n`): quando
    o autor declara intenção/desafio pessoal — tipicamente com `吾`/
    `われ`/`ware` (eu) sozinho ou em contraste com `汝`/`なれ`/`nare`
    (tu/vós) — traduza em **1ª pessoa singular** ("provarei", "testarei",
    "subjugarei"), NUNCA em plural ("provemos", "testemos") — suaviza o
    confronto. Use plural só com `われら`/`warera` (nós) explícito.
    Ex: `汝と吾との力試さん` → "provarei vossa força contra a minha".

# Saída

Devolva um array JSON com objetos `{number, title, translation}` — um por
poema, preservando o `number` recebido. Sem prefácios, sem comentários,
sem aspas externas na translation.
"""


class AlternateV2(BaseModel):
    number: int = Field(description="Numero do poema (corresponder ao enviado).")
    title: str = Field(description="Titulo curto (3-6 palavras), evocativo e ousado, possivelmente paradoxal.")
    translation: str = Field(description="Traducao em PT-BR culto, com 3 clausulas breves separadas por ponto-e-virgula, travessao ou ponto-final, espelhando os 3 grupos do tanka. Use vocativos, inversoes e pontuacao dramatica quando o original sugerir.")


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
    lines = ["Gere a versao ALTERNATIVA (v2) de title e translation para:\n"]
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

        # Show 3-way comparison
        by_n = {a.number: a for a in alts}
        for p in batch:
            a = by_n[p.number]
            poem = data["sections"][p.section_idx]["poems"][p.poem_idx]
            print(f"\n  #{p.number}")
            print(f"    [WEB ] title: {poem.get('title','')}")
            print(f"    [v1  ] title: {poem.get('title_gemini','')}")
            print(f"    [v2  ] title: {a.title}")
            print(f"    [WEB ] trans: {poem.get('translation','')}")
            print(f"    [v1  ] trans: {poem.get('translation_gemini','')}")
            print(f"    [v2  ] trans: {a.translation}")
        print()

        if args.run:
            apply(data, batch, alts)
            save_atomic(data)
            print("  saved.\n")
        else:
            print("  (use --run to save as title_gemini_v2 / translation_gemini_v2)\n")

        if bi < len(batches):
            time.sleep(1.5)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
