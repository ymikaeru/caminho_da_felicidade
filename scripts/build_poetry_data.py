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


def copy_waraino():
    with open(os.path.join(SRC, "waraino_poems.json"), encoding="utf-8") as f:
        src = json.load(f)

    # Trim to needed fields only.
    out = []
    for p in src:
        out.append({
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

    out_path = os.path.join(DST, "warai_no_izumi.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"warai_no_izumi.json: {len(out)} poemas -> {out_path}")


if __name__ == "__main__":
    clean_yamato()
    copy_waraino()
