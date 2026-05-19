"""Remove parenthetical kanji/kana annotations from a teaching JSON.

Pure-JP parens like "(神)" -> removed entirely.
Mixed parens like "(Johrei/浄霊)" -> kept as "(Johrei)".
Nested parens are handled because the regex only matches innermost parens (no nested '(' or ')').
"""

import json
import re
import sys
from pathlib import Path

JP = r'[　-〿぀-ゟ゠-ヿ一-鿿]'
PAREN_WITH_JP = re.compile(r'\(([^()]*' + JP + r'[^()]*)\)')
PURE_JP = re.compile(r'^[\s' + JP[1:-1] + r'、。・]+$')


def fix_paren(match: re.Match) -> str:
    inner = match.group(1)
    if '/' in inner:
        parts = inner.split('/')
        keep = [p for p in parts if not re.fullmatch(JP + r'+', p)]
        if keep:
            return '(' + '/'.join(keep) + ')'
        return ''
    if PURE_JP.match(inner):
        return ''
    return match.group(0)


def fix_string(s: str) -> str:
    new = PAREN_WITH_JP.sub(fix_paren, s)
    if new == s:
        return s
    # Tidy up spacing left over by removal.
    new = re.sub(r' +([,.;:!?\)])', r'\1', new)
    new = re.sub(r'\( +', '(', new)
    new = re.sub(r'[ \t]{2,}', ' ', new)
    new = re.sub(r' +\n', '\n', new)
    return new


def walk(node):
    if isinstance(node, dict):
        return {k: walk(v) for k, v in node.items()}
    if isinstance(node, list):
        return [walk(v) for v in node]
    if isinstance(node, str):
        return fix_string(node)
    return node


def main(path_str: str) -> None:
    path = Path(path_str)
    data = json.loads(path.read_text(encoding='utf-8'))
    data = walk(data)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


if __name__ == '__main__':
    main(sys.argv[1])
