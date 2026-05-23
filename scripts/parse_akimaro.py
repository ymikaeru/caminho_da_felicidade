"""
Build data/poetry/akimaro_kineishu.json from two sources:

  1. The user-supplied Markdown (.../Downloads/Jikan Shosho Vol.8 _Coleção...md)
     provides PT title + PT translation + romaji reading for poems 1..99.

  2. The original Japanese source (Akimaro Kin'eishū.md, transcribed from
     https://www.eonet.ne.jp/~rattail/gosanka/akemaro.htm) is authoritative for:
       - the 序文 (preface) text
       - section structure (元旦, 春の訪れ, 真理, 美しき此世, ...)
       - poem original kanji + hiragana reading
       - composition date (Shōwa Y. M. D)
       - author signature 東山明麿

The original has 486 tanka in 53 sections. Only 99 have PT translation;
the remaining 387 are included with `translation_pending: true` so the
UI can show "tradução pendente" placeholders, awaiting the next batch.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PT_SRC = r"C:\Users\ymika\Downloads\Jikan Shosho Vol.8 _Coleção de Poemas Recentes de Akimaro_.md"
JP_SRC = os.path.join(ROOT, "Akimaro Kin'eishū.md")
DST = os.path.join(ROOT, "data", "poetry", "akimaro_kineishu.json")


# --- PT side ---------------------------------------------------------------

HEADING_RE = re.compile(r"^##\s+(\d+)\\?\.\s+(.+?)\s*$")
TRANS_BLOCK_RE = re.compile(
    r"\*\*Tradu(?:ç|c)ão Art(?:í|i)stica:\*\*\s*\n+\s*\"([^\"]+)\"",
    re.DOTALL,
)
ORIG_READ_RE = re.compile(
    r"\*\*Original:\*\*\s*(.+?)\s*\*\*Leitura:\*\*\s*(.+?)\s*$"
)
MD_ESCAPE_RE = re.compile(r"\\([!\".,;:?\-()\[\]<>*_`~|])")


def _unescape_md(s):
    return MD_ESCAPE_RE.sub(r"\1", s) if s else s


def parse_pt():
    """Return {number: {title_pt, translation_pt, romaji}}."""
    with open(PT_SRC, encoding="utf-8") as f:
        text = f.read()
    chunks = re.split(r"(?m)^(?=##\s+\d+\\?\.\s+)", text)
    chunks = [c for c in chunks if c.strip().startswith("## ")]
    out = {}
    for ch in chunks:
        m = HEADING_RE.match(ch.splitlines()[0].strip())
        if not m:
            continue
        number = int(m.group(1))
        title = _unescape_md(m.group(2).strip())
        mtr = TRANS_BLOCK_RE.search(ch)
        translation = ""
        if mtr:
            translation = _unescape_md(re.sub(r"\s*\n\s*", " ", mtr.group(1)).strip())
        romaji = ""
        for ln in ch.splitlines():
            mor = ORIG_READ_RE.search(ln)
            if mor:
                romaji = _unescape_md(mor.group(2).strip())
                break
        out[number] = {
            "title_pt": title,
            "translation_pt": translation,
            "romaji": romaji,
        }
    return out


# --- JP side ---------------------------------------------------------------

POEM_RE = re.compile(r"^(\d+)\t(.+)$")


def _is_section_heading(line):
    # Skip kanji-body lines (lines that end with TAB+date)
    if re.search(r"\tS\d+\.", line):
        return None
    s = line.strip(" 　\t")
    if not s or len(s) > 40:
        return None
    if any(x in s for x in (
        "この歌集", "この書", "深き神秘", "昭和二十四", "熱海",
        "東　山", "明麿近詠", "岡 田", "東山明麿", "序　文", "首収録",
    )):
        return None
    if not re.search(r"[一-鿿]", s):  # need at least one kanji
        return None
    return s


def parse_jp():
    """Return (preface_lines, [{title_jp, poems:[{number, original, reading_hira, date}]}, ...])."""
    with open(JP_SRC, encoding="utf-8") as f:
        text = f.read()
    lines = text.splitlines()

    # Preface: between "序　文" and signature "明　麿"
    pre_start = pre_end = None
    for i, ln in enumerate(lines):
        if "序　文" in ln:
            pre_start = i + 1
        elif pre_start is not None and "明　麿" in ln:
            pre_end = i + 1
            break
    preface_lines = []
    if pre_start is not None and pre_end is not None:
        for ln in lines[pre_start:pre_end]:
            s = ln.strip(" 　\t")
            if s:
                preface_lines.append(s)

    sections = []
    current = None
    i = 0
    while i < len(lines):
        ln = lines[i]
        pm = POEM_RE.match(ln)
        if pm:
            number = int(pm.group(1))
            reading_hira = pm.group(2).strip()
            # Look ahead for kanji+date line
            j = i + 1
            kanji_line = ""
            while j < len(lines):
                if lines[j].strip(" 　\t"):
                    kanji_line = lines[j]
                    break
                j += 1
            i = j + 1
            if "\t" in kanji_line:
                kanji, date_raw = kanji_line.rsplit("\t", 1)
                kanji = kanji.strip(" 　\t")
                date = date_raw.strip(" 　\t")
            else:
                kanji = kanji_line.strip(" 　\t")
                date = ""
            if current is None:
                raise RuntimeError(f"Poem {number} before any section heading")
            current["poems"].append({
                "number": number,
                "original": kanji,
                "reading_hira": reading_hira,
                "date": date,
            })
            continue

        title = _is_section_heading(ln)
        if title:
            current = {"title_jp": title, "poems": []}
            sections.append(current)
        i += 1

    sections = [s for s in sections if s["poems"]]
    return preface_lines, sections


# --- PT mapping for all 53 sections ---------------------------------------
# Keys are the exact title_jp as extracted (including full-width spaces).
SECTION_PT = {
    "元　旦（がんたん）":                        {"pt": "Ano Novo",                              "romaji": "Gantan"},
    "春の訪れ":                                  {"pt": "A Chegada da Primavera",                "romaji": "Haru no Otozure"},
    "真　理":                                    {"pt": "A Verdade",                             "romaji": "Shinri"},
    "美しき此世":                                {"pt": "Este Mundo de Beleza",                  "romaji": "Utsukushiki Kono Yo"},
    "玉　川　郷":                                {"pt": "Vila Tamagawa",                         "romaji": "Tamagawa-gō"},
    "※全集未収録":                              {"pt": "Poemas Avulsos",                        "romaji": "Zenshū Mishūroku"},
    "元伊勢に詣でて　　（於琵琶湖ホテル）":      {"pt": "Peregrinação a Moto-Ise (no Hotel Biwako)", "romaji": "Moto-Ise ni Mōdete"},
    "立　　春":                                  {"pt": "Início da Primavera",                   "romaji": "Risshun"},
    "還暦の歌":                                  {"pt": "Cantos dos Sessenta Anos",              "romaji": "Kanreki no Uta"},
    "立春其他　　（於東京大東亜会館発表）":      {"pt": "Início da Primavera e Outros (no Salão Daitōa de Tóquio)", "romaji": "Risshun Sonohoka"},
    "立　春　　（立春大会）":                    {"pt": "Início da Primavera (no Encontro de Risshun)", "romaji": "Risshun (Risshun Taikai)"},
    "黎　明":                                    {"pt": "A Aurora",                              "romaji": "Reimei"},
    "熱　海":                                    {"pt": "Atami",                                 "romaji": "Atami"},
    "閑　日":                                    {"pt": "Dia Tranquilo",                         "romaji": "Kanjitsu"},
    "正　邪":                                    {"pt": "O Justo e o Iníquo",                    "romaji": "Seija"},
    "神　の　愛":                                {"pt": "O Amor de Deus",                        "romaji": "Kami no Ai"},
    "真の大和魂":                                {"pt": "O Verdadeiro Espírito Yamato",          "romaji": "Makoto no Yamato-damashii"},
    "吾":                                        {"pt": "Eu",                                    "romaji": "Ware"},
    "時":                                        {"pt": "O Tempo",                               "romaji": "Toki"},
    "和光同塵":                                  {"pt": "Velar a Luz na Poeira do Mundo",        "romaji": "Wakō Dōjin"},
    "珍の神業":                                  {"pt": "A Obra Divina Preciosa",                "romaji": "Uzu no Kamiwaza"},
    "奇しき神業":                                {"pt": "A Obra Divina Misteriosa",              "romaji": "Kushiki Kamiwaza"},
    "地上天国":                                  {"pt": "Paraíso Terrestre",                     "romaji": "Chijō Tengoku"},
    "大　浄　化":                                {"pt": "A Grande Purificação",                  "romaji": "Dai-Jōka"},
    "新　世　界":                                {"pt": "Novo Mundo",                            "romaji": "Shin Sekai"},
    "誠":                                        {"pt": "Sinceridade",                           "romaji": "Makoto"},
    "医しの業":                                  {"pt": "A Obra da Cura",                        "romaji": "Iyashi no Waza"},
    "観　山　亭":                                {"pt": "Pavilhão Kanzantei",                    "romaji": "Kanzantei"},
    "大　峠":                                    {"pt": "A Grande Passagem",                     "romaji": "Ō-tōge"},
    "新　年":                                    {"pt": "Ano Novo",                              "romaji": "Shinnen"},
    "神　の　守":                                {"pt": "A Proteção Divina",                     "romaji": "Kami no Mamori"},
    "楽しき世":                                  {"pt": "Mundo Alegre",                          "romaji": "Tanoshiki Yo"},
    "早雲寮初祭":                                {"pt": "Primeira Festividade do Sōunryō",       "romaji": "Sōunryō Hatsumatsuri"},
    "石　楽　園":                                {"pt": "Jardim Sekirakuen",                     "romaji": "Sekirakuen"},
    "立　春":                                    {"pt": "Início da Primavera",                   "romaji": "Risshun"},
    "救主降臨":                                  {"pt": "A Descida do Salvador",                 "romaji": "Kyūshu Kōrin"},
    "天国の苑":                                  {"pt": "Jardim do Paraíso",                     "romaji": "Tengoku no Sono"},
    "神　の　力":                                {"pt": "O Poder Divino",                        "romaji": "Kami no Chikara"},
    "火の洗礼":                                  {"pt": "Batismo de Fogo",                       "romaji": "Hi no Senrei"},
    "救ひの光":                                  {"pt": "A Luz da Salvação",                     "romaji": "Sukui no Hikari"},
    "神の仕組":                                  {"pt": "O Plano Divino",                        "romaji": "Kami no Shigumi"},
    "嵐　の　外":                                {"pt": "Fora da Tempestade",                    "romaji": "Arashi no Soto"},
    "神は十全":                                  {"pt": "Deus é Perfeito",                       "romaji": "Kami wa Jūzen"},
    "神　仙　郷":                                {"pt": "Vila Shinsenkyō",                       "romaji": "Shinsenkyō"},
    "最後の日":                                  {"pt": "O Último Dia",                          "romaji": "Saigo no Hi"},
    "善　と　悪":                                {"pt": "O Bem e o Mal",                         "romaji": "Zen to Aku"},
}


# --- Main build ------------------------------------------------------------

def build():
    pt = parse_pt()
    preface_lines, jp_sections = parse_jp()

    out_sections = []
    translated_count = 0
    for sec in jp_sections:
        gloss = SECTION_PT.get(sec["title_jp"])
        if gloss is None:
            print(f"WARN: no PT mapping for section {sec['title_jp']!r}")
            gloss = {"pt": sec["title_jp"], "romaji": ""}
        poems_out = []
        for p in sec["poems"]:
            pt_entry = pt.get(p["number"])
            if pt_entry and pt_entry["translation_pt"]:
                poems_out.append({
                    "number": p["number"],
                    "title": pt_entry["title_pt"],
                    "original": p["original"],
                    "reading": pt_entry["romaji"] or p["reading_hira"],
                    "reading_hira": p["reading_hira"],
                    "translation": pt_entry["translation_pt"],
                    "date": p["date"],
                })
                translated_count += 1
            else:
                poems_out.append({
                    "number": p["number"],
                    "title": "",
                    "original": p["original"],
                    "reading": p["reading_hira"],
                    "reading_hira": p["reading_hira"],
                    "translation": "",
                    "translation_pending": True,
                    "date": p["date"],
                })
        out_sections.append({
            "title_pt": gloss["pt"],
            "title_jp": sec["title_jp"],
            "title_romaji": gloss["romaji"],
            "poems": poems_out,
        })

    total = sum(len(s["poems"]) for s in out_sections)
    out = {
        "preface": {
            "title_pt": "Prefácio",
            "title_jp": "序　文",
            "content_jp": preface_lines,
            "content_pt": [
                "Esta coletânea reúne poemas compostos desde o 11º ano da Era Showa (1936) até tempos recentes — frutos de impressões nascidas em meio à correnteza dos compromissos, escritos conforme afloravam, ao sabor do momento e da circunstância. Há cantos sagrados (神歌), cantos do Caminho (道歌), cantos líricos (舒情歌) e cantos descritivos da paisagem (舒景歌); multifacetados, refletindo um lado da vida de fé que percorri. Os que vivem a fé hão de encontrar, nestas páginas, algum alimento para a alma.",
                "Entre os muitos poemas reunidos neste livro há os que encerram profundo mistério; estes se revelam conforme o espírito de quem os lê. Por isso, peço que sejam lidos sem negligenciar uma só palavra, com o coração inteiro, recolhido em atenção.",
                "Outubro do 24º ano da Era Showa (outubro de 1949), em Atami, em minha residência. — Higashiyama Akimaro (東山明麿)",
            ],
        },
        "edition": {
            "publication_date_jp": "昭和24年11月30日",
            "publication_date_pt": "30 de novembro de 1949",
            "total_in_original": total,
            "translated_here": translated_count,
            "author_jp": "東山明麿",
            "author_romaji": "Higashiyama Akimaro",
        },
        "sections": out_sections,
    }

    if total != 486:
        raise RuntimeError(f"Expected 486 poems, got {total}")
    if translated_count != 99:
        raise RuntimeError(f"Expected 99 translated, got {translated_count}")

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"OK: wrote {DST}")
    print(f"Sections: {len(out_sections)}")
    print(f"Total poems: {total}  (translated: {translated_count}, pending: {total-translated_count})")


if __name__ == "__main__":
    build()
