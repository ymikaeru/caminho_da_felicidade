"""
Backfill Kigo / Kototama / Profundidade into the first 99 poems of
data/poetry/akimaro_kineishu.json, reading them from the original MD
in Downloads/ (which has the full analysis from the Gemini IDE session).

Idempotent and safe:
  - Does NOT regenerate the JSON. Loads, mutates in place, atomic save.
  - Only touches poems 1..99 — the 20 Gemini-translated ones (100-119)
    and any other state are preserved exactly as-is.
  - Skips a poem if all three fields are already present (rerun-safe).
  - Marks each filled poem with translation_source="human" so it is
    distinguishable from the Gemini ones in admin/analytics later.

Usage:
  python scripts/backfill_99_analysis.py
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MD_SRC = Path(r"C:\Users\ymika\Downloads\Jikan Shosho Vol.8 _Coleção de Poemas Recentes de Akimaro_.md")
JSON_PATH = ROOT / "data" / "poetry" / "akimaro_kineishu.json"

HEADING_RE = re.compile(r"^##\s+(\d+)\\?\.\s+(.+?)\s*$")
MD_ESCAPE_RE = re.compile(r"\\([!\".,;:?\-()\[\]<>*_`~|])")


def _unescape(s: str) -> str:
    return MD_ESCAPE_RE.sub(r"\1", s).strip() if s else s


def _strip_md(s: str) -> str:
    """Remove asterisks for **bold** that might leak into a captured field."""
    return s.replace("**", "").strip()


# The three analysis sections in the MD start with these markers. We capture
# everything from the colon to the next blank "---" separator or next field.
KIGO_RE = re.compile(
    r"\*\*[^*]*Kigo[^*]*\*\*[:：]?\s*(.+?)(?=\n\s*\*\*[^*]*Kototama|\n\s*\*\*[^*]*Sonoridade|\n\s*---)",
    re.DOTALL,
)
KOTOTAMA_RE = re.compile(
    r"\*\*[^*]*Kototama[^*]*\*\*[:：]?\s*(.+?)(?=\n\s*\*\*[^*]*Profundidade|\n\s*\*\*[^*]*Lição|\n\s*---)",
    re.DOTALL,
)
PROFUND_RE = re.compile(
    r"\*\*[^*]*Profundidade[^*]*\*\*[:：]?\s*(.+?)(?=\n\s*---|\Z)",
    re.DOTALL,
)


def parse_md() -> dict[int, dict]:
    """Return {number: {kigo, kototama, profundidade}} for poems 1..99."""
    text = MD_SRC.read_text(encoding="utf-8")
    chunks = re.split(r"(?m)^(?=##\s+\d+\\?\.\s+)", text)
    chunks = [c for c in chunks if c.strip().startswith("## ")]
    out: dict[int, dict] = {}
    for ch in chunks:
        m = HEADING_RE.match(ch.splitlines()[0].strip())
        if not m:
            continue
        number = int(m.group(1))

        def grab(rx: re.Pattern) -> str:
            m2 = rx.search(ch)
            if not m2:
                return ""
            body = m2.group(1).strip()
            # Collapse internal newlines + spaces
            body = re.sub(r"\s*\n\s*", " ", body)
            return _unescape(_strip_md(body))

        kigo = grab(KIGO_RE)
        kototama = grab(KOTOTAMA_RE)
        prof = grab(PROFUND_RE)
        if not (kigo and kototama and prof):
            # Some poems may be missing one — warn but continue
            print(f"  WARN poem #{number}: missing fields  "
                  f"(kigo={bool(kigo)}, kototama={bool(kototama)}, profundidade={bool(prof)})")
        out[number] = {
            "kigo": kigo,
            "kototama": kototama,
            "profundidade": prof,
        }
    return out


def save_atomic(data: dict) -> None:
    tmp = JSON_PATH.with_suffix(JSON_PATH.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, JSON_PATH)


def main() -> int:
    if not MD_SRC.exists():
        print(f"ERROR: source MD not found: {MD_SRC}")
        return 1

    md_data = parse_md()
    print(f"Parsed {len(md_data)} poems from MD.")
    have_all_three = sum(
        1 for v in md_data.values()
        if v["kigo"] and v["kototama"] and v["profundidade"]
    )
    print(f"  Of those, {have_all_three} have all three fields complete.")

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    updated = 0
    skipped_complete = 0
    skipped_pending = 0
    not_in_md = 0

    for sec in data["sections"]:
        for poem in sec["poems"]:
            num = poem["number"]
            if poem.get("translation_pending"):
                # not yet translated — skip
                skipped_pending += 1
                continue
            if num not in md_data:
                not_in_md += 1
                continue
            md = md_data[num]
            already = poem.get("kigo") and poem.get("kototama") and poem.get("profundidade")
            if already:
                skipped_complete += 1
                continue
            if md["kigo"]:
                poem["kigo"] = md["kigo"]
            if md["kototama"]:
                poem["kototama"] = md["kototama"]
            if md["profundidade"]:
                poem["profundidade"] = md["profundidade"]
            poem.setdefault("translation_source", "human")
            updated += 1

    save_atomic(data)
    print()
    print(f"Updated:           {updated}")
    print(f"Already complete:  {skipped_complete}")
    print(f"Still pending:     {skipped_pending}")
    print(f"Not in MD source:  {not_in_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
