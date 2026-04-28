#!/usr/bin/env python3
"""
Normaliza todas as variantes de tradução de 善言讃詞 no Supabase
para o padrão: "oração Zengensanji"

Uso:
  python normalize_zengensanji.py          # dry run (mostra mudanças)
  python normalize_zengensanji.py --apply  # aplica no banco
"""
import re
import json
import sys
import urllib.request

ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1Y2NobW5iYWp2YnBtb3Fya3RxIiwicm9sZSI"
    "6ImFub24iLCJpYXQiOjE3NzY0NjY3MDgsImV4cCI6MjA5MjA0MjcwOH0"
    ".humCcLYpnnnapkLtLOeb9ZVo5EZWoWw6ItNo0WVY3DY"
)
BASE = "https://succhmnbajvbpmoqrktq.supabase.co/rest/v1"
HEADERS = {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
TARGET = "oração Zengensanji"

# ── Romanized variants (all spellings/hyphenations) ───────────────────────────
_R = (
    r"Zengensanshi"       # correct with h
    r"|Zengensanji"       # without h (most common)
    r"|Zengen[ -]Sanshi"
    r"|Zengen[ -]Sanji"
    r"|Zengon[ -]Sanshi"
    r"|Zengon[ -]Sanji"
    r"|Zengen-Sanshi"
    r"|Zengen-Sanji"
    r"|Zengon-Sanshi"
    r"|Zengon-Sanji"
    r"|\bZengon\b"        # truncated form
)

# ── Descriptive PT forms (with optional parenthesized romanization) ───────────
_D = (
    r"Palavras?\s+de\s+Louvor(?:\s+ao\s+Bem)?"
    r"|Palavra\s+Divina"
    r"|Palavras?\s+Louvando\s+o\s+Bem"
)

# Combined: descriptive + optional parens
_DESCRIPTIVE = rf"(?:{_D})(?:\s*\([^\)]+\))?"

# Combined: "oração [variant]" (already has prefix — just normalize variant)
_ORACAO_VARIANT = rf"oração\s+(?:{_R})"


def normalize(title: str) -> str:
    t = title

    # 1. Descriptive PT (± parenthetical romanization) → target
    t = re.sub(_DESCRIPTIVE, TARGET, t, flags=re.IGNORECASE)

    # 2. "oração [variant]" → target  (avoid double "oração oração")
    t = re.sub(_ORACAO_VARIANT, TARGET, t, flags=re.IGNORECASE)

    # 3. Standalone romanized variants → target
    t = re.sub(_R, TARGET, t, flags=re.IGNORECASE)

    # 4. Fix Portuguese article agreement ("oração" is feminine singular)
    #    Replaces masculine/plural articles left over from old noun forms
    fixes = [
        (r"\bo\s+oração\b",   "a oração"),
        (r"\bdo\s+oração\b",  "da oração"),
        (r"\bos\s+oração\b",  "a oração"),
        (r"\bdos\s+oração\b", "da oração"),
        (r"\bas\s+oração\b",  "a oração"),
        (r"\bdas\s+oração\b", "da oração"),
        (r"\bnos\s+oração\b", "na oração"),
        (r"\bnas\s+oração\b", "na oração"),
    ]
    for pat, rep in fixes:
        t = re.sub(pat, rep, t)

    # 5. Guard: collapse accidental double "oração oração"
    t = re.sub(r"\boração\s+oração\b", "oração", t, flags=re.IGNORECASE)

    return t


def api_get(path: str):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def api_patch(record_id: str, new_title: str):
    url = f"{BASE}/teachings?id=eq.{record_id}"
    body = json.dumps({"title_pt": new_title}).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
    )
    with urllib.request.urlopen(req) as r:
        return r.status


# ── Main ──────────────────────────────────────────────────────────────────────

records = api_get(
    "/teachings"
    "?title_ja=like.*%E5%96%84%E8%A8%80%E8%AE%83%E8%A9%9E*"
    "&select=id,title_pt,volume,file,topic_index"
    "&limit=200"
)

changes = []
for r in records:
    old = r["title_pt"]
    new = normalize(old)
    if old != new:
        changes.append((r["id"], old, new, r["volume"], r["file"], r["topic_index"]))

print(f"Total registros com 善言讃詞: {len(records)}")
print(f"Registros com mudança necessária: {len(changes)}")
print("=" * 80)

for _id, old, new, vol, f, idx in changes:
    print(f"\n[{vol} / {f} : topic {idx}]")
    print(f"  - {old}")
    print(f"  + {new}")

print("\n" + "=" * 80)

if "--apply" in sys.argv:
    print("\nAplicando mudanças...")
    ok = err = 0
    for _id, old, new, vol, f, idx in changes:
        try:
            api_patch(_id, new)
            print(f"  ✓  [{vol}/{f}:{idx}]")
            ok += 1
        except Exception as e:
            print(f"  ✗  [{vol}/{f}:{idx}]: {e}")
            err += 1
    print(f"\nConcluído: {ok} atualizados, {err} erros")
else:
    print("\nExecute com --apply para aplicar as mudanças.")
