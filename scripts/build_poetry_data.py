"""
Build clean poetry data for caminho_da_felicidade from new_mioshie_zenshu source.

- Yama to Mizu (yamato_full.json): strip AI explanation fields (kigo, kototama,
  deepening) and the AI overview paragraph in the preface. Keep only original,
  reading, translation, titles.
- Warai no Izumi (waraino_poems.json): copy verbatim — already clean.

Output: data/poetry/yama_to_mizu.json + data/poetry/warai_no_izumi.json
"""
import json
import os
import re
import sys

SRC = r"C:\Mioshie_Sites\new_mioshie_zenshu\data\poetry"
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "poetry")

os.makedirs(DST, exist_ok=True)


def _strip_md(s):
    """Remove leftover markdown asterisks/backslash-escapes from a string."""
    if not s:
        return s
    s = s.replace("**", "")
    s = s.replace("\\(", "(").replace("\\)", ")").replace("\\-", "-")
    # Strip outer `*text*` italic wrapping if present.
    s = re.sub(r"^\*(.+)\*$", r"\1", s.strip())
    return s


def clean_yamato():
    with open(os.path.join(SRC, "yamato_full.json"), encoding="utf-8") as f:
        src = json.load(f)

    preface = src.get("preface", {}) or {}
    # Drop AI overview (first paragraph that starts with "Aqui, Meishu-Sama explica")
    pt_lines = preface.get("content_pt", []) or []
    cleaned_pt = []
    for line in pt_lines:
        s = (line or "").strip()
        if s.startswith("Aqui, Meishu-Sama explica") or s.startswith("Aqui Meishu-Sama explica"):
            continue
        cleaned_pt.append(_strip_md(s))

    out_preface = {
        "title_pt": preface.get("title_pt", "Prefácio"),
        "title_jp": preface.get("title_jp", "はしがき"),
        "content_pt": cleaned_pt,
        "content_jp": preface.get("content_jp", []) or [],
    }

    out_sections = []
    for sec in src.get("sections", []) or []:
        poems = []
        for p in sec.get("poems", []) or []:
            poems.append({
                "number": p.get("number"),
                "title": _strip_md(p.get("title", "")),
                "original": p.get("original", ""),
                "reading": _strip_md(p.get("reading", "")),
                "translation": _strip_md(p.get("translation", "")),
            })
        out_sections.append({
            "title_pt": sec.get("title_pt", ""),
            "title_jp": sec.get("title_jp", ""),
            "poems": poems,
        })

    out = {"preface": out_preface, "sections": out_sections}
    out_path = os.path.join(DST, "yama_to_mizu.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    total_poems = sum(len(s["poems"]) for s in out_sections)
    print(f"yama_to_mizu.json: {len(out_sections)} secoes, {total_poems} poemas -> {out_path}")


# Preface/edition do Warai no Izumi — hardcoded aqui porque o source
# (new_mioshie_zenshu/waraino_poems.json) é só a lista de versos. Se for
# editar, mexer aqui — o leitor poetry-warai.js depende destas chaves.
WARAINO_PREFACE = {
    "title_pt": "Prefácio",
    "title_jp": "はしがき",
    "content_jp": [
        "今日本の社会、否日本人に最も必要なものは、何であるかといふと、それは笑であらう事は、心あるものの等しく唱へる処である。見よ、税金苦、食糧難、住宅難、物価高、金詰り、犯罪激増、病気の氾濫等々、宛然（さながら）地獄図絵といつてもいい。又昔から笑う門には福来ると言われる通り、近頃のように湿つぽい陰気な此娑婆では、好い事など来そうもない。故に斯んな陰欝な空気は元気よく笑の爆発で、一遍に吹つ飛ばして了う事だ。という訳で、此著を刊行する事になつたのである。読者諸君よ、一読大いに笑え！　三読羽目をはづせ。笑つて笑つて！　笑い抜いて！　天国を造るべきだ。笑いは天国の花と言うじやないか。",
        "之は私が廿数年前、冠句の宗匠をしていた頃、笑冠句の会を作り、沢山の集句の中から選んだもので、それを又今度再選し筆を加えたものであるから、何れの句も珠玉のみといつてよかろう。",
        "昭和二十五年十月",
        "編　者　識"
    ],
    "content_pt": [
        "Aquilo que hoje é mais necessário à sociedade japonesa — ou melhor, ao próprio povo japonês — é, no entender unânime de todos os que têm coração, o riso. Vejam: a aflição dos impostos, a escassez de alimentos, a falta de moradia, a carestia, o aperto financeiro, o aumento desenfreado da criminalidade, a multiplicação das doenças, e tantos outros males — em verdade, este mundo se assemelha a um quadro do inferno. E como diz o antigo provérbio, «à casa que ri, vem a fortuna» (笑う門には福来る); ora, neste mundo umedecido e melancólico em que vivemos, não parece que coisas boas estejam por vir. Por isso, tal atmosfera sombria deve ser dissipada de uma só vez, com a vigorosa explosão do riso. Foi por essa razão que decidi publicar esta obra. Caros leitores: leiam-na uma vez e riam muito! Leiam-na três vezes e percam toda a compostura! Riam, riam! Riam até o fim! E construam, assim, o Paraíso — pois não se diz que o riso é a flor do Paraíso?",
        "Estes versos foram colhidos há mais de vinte anos, no tempo em que eu era mestre de Kanku (冠句) e organizei o Círculo dos Kanku Humorísticos (笑冠句), entre as numerosas coletâneas que então reunimos. Agora, novamente selecionados e com retoques desta pena, posso afirmar que todos eles são puras gemas.",
        "Outubro do 25º ano da Era Showa (outubro de 1950). — Pelo Editor (編者識)"
    ]
}

WARAINO_EDITION = {
    "title_jp": "笑の泉",
    "title_romaji": "Warai no Izumi",
    "subtitle_jp": "笑冠沓句集",
    "subtitle_romaji": "Shōkantō Kushū",
    "subtitle_pt": "Coletânea de Kanku Humorísticos (冠沓 — abertura e fecho fixos)",
    "attribution_jp": "岡田自観師の御歌集",
    "attribution_pt": "Coletânea Poética do Mestre Okada Mokichi (Meishu-Sama)",
    "publication_date_jp": "昭和26年1月30日",
    "publication_date_pt": "30 de janeiro de 1951",
    "total_in_original": 1093,
    "translated_here": 1063,
    "compiler_jp": "明烏阿呆",
    "compiler_romaji": "Akegarasu Aho",
    "compiler_label_pt": "Selecionador (選者)"
}


def copy_waraino():
    with open(os.path.join(SRC, "waraino_poems.json"), encoding="utf-8") as f:
        src = json.load(f)

    # Trim to needed fields only.
    poems = []
    for p in src:
        poems.append({
            "id": p.get("id"),
            "num": p.get("num"),
            "title": p.get("title", ""),
            "original": p.get("original", ""),
            "reading": p.get("reading", ""),
            "translation_pt": p.get("translation_pt", ""),
            "author_penname": p.get("author_penname", ""),
            "category": p.get("category", ""),
            "mood": p.get("mood", ""),
        })

    out = {
        "preface": WARAINO_PREFACE,
        "edition": dict(WARAINO_EDITION, translated_here=len(poems)),
        "poems": poems,
    }

    out_path = os.path.join(DST, "warai_no_izumi.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"warai_no_izumi.json: {len(poems)} poemas -> {out_path}")


if __name__ == "__main__":
    clean_yamato()
    copy_waraino()
