# -*- coding: utf-8 -*-
"""
Exporta os Ensinamentos (mioshiec1..4, PT-BR) para arquivos Markdown prontos
para subir como FONTES no NotebookLM.

Por que assim:
  - O NotebookLM limita ~500 mil palavras por fonte e 50 fontes (plano Free).
    Como o acervo PT tem ~5,75 milhoes de palavras, empacotamos em poucos
    arquivos grandes (fatiados por volume, sem nunca quebrar uma publicacao).
  - Cada ensinamento carrega um CABECALHO com localizador + link direto do
    leitor. Esse link e a "ponte": quando o NotebookLM cita um ensinamento,
    o link viaja na citacao e voce abre o trecho no site com 1 clique e
    clica em "Recomendar este Ensinamento".

Uso:
    python scripts/export_notebooklm.py

Saida: notebooklm_export/  (arquivos .md + _LEIA-ME.md)
"""
import json, glob, os, re, html

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC      = os.path.join(ROOT, ".local-edits", "teachings")
OUT      = os.path.join(ROOT, "notebooklm_export")
BASE_URL = "https://www.cmu.org.br/caminho_da_felicidade"
VOLS     = ["mioshiec1", "mioshiec2", "mioshiec3", "mioshiec4"]
MAX_WORDS = 450_000          # margem de seguranca sob o teto de 500k do NotebookLM

VOL_LABEL = {
    "mioshiec1": "Coletanea 1",
    "mioshiec2": "Coletanea 2",
    "mioshiec3": "Coletanea 3",
    "mioshiec4": "Coletanea 4",
}

_MESES = ["janeiro","fevereiro","marco","abril","maio","junho",
          "julho","agosto","setembro","outubro","novembro","dezembro"]

def showa_to_pt(s):
    """Converte '昭和24年8月25日' -> '25 de agosto de 1949'. Deixa o resto como esta."""
    if not s:
        return ""
    m = re.match(r'^\s*昭和\s*(\d+)\s*年(?:\s*(\d+)\s*月)?(?:\s*(\d+)\s*日)?\s*$', s)
    if not m:
        return s.strip()
    y  = 1925 + int(m.group(1))
    mo = int(m.group(2)) if m.group(2) else None
    da = int(m.group(3)) if m.group(3) else None
    if da and mo:
        return f"{da} de {_MESES[mo-1]} de {y}"
    if mo:
        return f"{_MESES[mo-1]} de {y}"
    return str(y)

def clean_block(h):
    """HTML -> texto limpo, preservando quebras de paragrafo."""
    if not h:
        return ""
    t = re.sub(r'<br\s*/?>', '\n', h, flags=re.I)
    t = re.sub(r'</(p|div|li|h[1-6]|blockquote)>', '\n', t, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t)
    t = t.replace('　', ' ')                 # espaco ideografico -> espaco
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r' *\n *', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()

def clean_line(h):
    """Igual ao clean_block, mas colapsa tudo numa linha (titulos)."""
    return re.sub(r'\s+', ' ', clean_block(h)).strip()

def pick_title(tp):
    for k in ("topic_title_br", "title_ptbr", "title_pt"):
        v = clean_line(tp.get(k) or "")
        if v:
            return v
    return clean_line(tp.get("title") or "") or "(sem titulo)"

def topic_url(vol, filename, idx):
    return f"{BASE_URL}/reader.html?vol={vol}&file={filename}&topic={idx}"

def build_file_blocks(vol, filename, data):
    """
    Retorna (lista_de_blocos_markdown, n_ensinamentos, n_palavras).
    Achata themes->topics na MESMA ordem que o leitor usa (o indice 'topic' da URL).
    Fragmentos 'continues_previous' sao anexados ao bloco anterior (nao viram cabecalho novo).
    """
    blocks = []
    idx = 0
    n_teach = 0
    for theme in data.get("themes", []):
        for tp in theme.get("topics", []):
            body = clean_block(tp.get("content_ptbr") or tp.get("content_pt") or "")
            if tp.get("continues_previous") and blocks:
                if body:
                    blocks[-1] += "\n\n" + body
                idx += 1
                continue
            title = pick_title(tp)
            date  = showa_to_pt(tp.get("date") or "")
            url   = topic_url(vol, filename, idx)
            code  = f"[[CdF:{vol}/{filename}/{idx}]]"
            head  = [f"## {title}", ""]
            head.append(f"**Codigo:** {code}  ")
            head.append(f"**Localizador:** {vol} / {filename} / topico {idx}  ")
            if date and date.lower() != "unknown":
                head.append(f"**Data:** {date}  ")
            head.append(f"**Abrir no leitor:** {url}")
            head.append("")
            block = "\n".join(head) + (body if body else "_(sem texto em portugues)_")
            blocks.append(block)
            idx += 1
            n_teach += 1
    text = "\n\n---\n\n".join(blocks)
    return blocks, n_teach, len(text.split())

def file_order(vol):
    """Ordem de leitura do site (nav.json) + sobras em ordem alfabetica."""
    nav_path = os.path.join(SRC, f"{vol}_nav.json")
    present = {os.path.basename(p) for p in glob.glob(os.path.join(SRC, vol, "*.json"))}
    # arquivos sao "SB.html.json" -> nav lista "SB.html"
    ordered = []
    seen = set()
    if os.path.exists(nav_path):
        for fn in json.load(open(nav_path, encoding="utf-8")):
            key = fn + ".json"
            if key in present and key not in seen:
                ordered.append(key); seen.add(key)
    for key in sorted(present):
        if key not in seen:
            ordered.append(key); seen.add(key)
    return ordered

def main():
    os.makedirs(OUT, exist_ok=True)
    # limpa exports antigos
    for old in glob.glob(os.path.join(OUT, "*.md")):
        os.remove(old)

    grand = {"files": 0, "teachings": 0, "words": 0, "sources": 0}
    manifest = []

    for vol in VOLS:
        label = VOL_LABEL[vol]
        keys = file_order(vol)
        # monta chunks respeitando o limite de palavras, sem quebrar publicacao
        chunks = []          # cada chunk = lista de (filename, blocks)
        cur = []; cur_words = 0
        for key in keys:
            data = json.load(open(os.path.join(SRC, vol, key), encoding="utf-8"))
            filename = key[:-5]                      # tira o .json -> "SB.html"
            blocks, n_teach, words = build_file_blocks(vol, filename, data)
            if not blocks:
                continue
            if cur and cur_words + words > MAX_WORDS:
                chunks.append(cur); cur = []; cur_words = 0
            cur.append((filename, blocks, n_teach))
            cur_words += words
        if cur:
            chunks.append(cur)

        total = len(chunks)
        for i, chunk in enumerate(chunks, 1):
            parte = f"parte{i:02d}" if total > 1 else "completo"
            out_name = f"{vol}_{parte}.md"
            out_path = os.path.join(OUT, out_name)
            n_teach = sum(c[2] for c in chunk)
            first_pub = chunk[0][0]
            last_pub  = chunk[-1][0]

            header = [
                f"# Ensinamentos do Meishu-Sama — {label}"
                + (f" (parte {i} de {total})" if total > 1 else ""),
                "",
                f"- Colecao interna: `{vol}`",
                f"- Publicacoes neste arquivo: {first_pub} ... {last_pub} ({len(chunk)})",
                f"- Ensinamentos neste arquivo: {n_teach}",
                f"- Fonte: Caminho da Felicidade — {BASE_URL}",
                "",
                "> Cada ensinamento abaixo traz, no cabecalho, seu **Localizador** e o "
                "**link direto** para abri-lo no leitor do site. Use esse link para, no "
                "site, clicar em \"Recomendar este Ensinamento\".",
                "",
                "---",
                "",
            ]
            body_parts = []
            for filename, blocks, _ in chunk:
                body_parts.append("\n\n---\n\n".join(blocks))
            content = "\n".join(header) + "\n\n---\n\n".join(body_parts) + "\n"

            with open(out_path, "w", encoding="utf-8") as f:
                f.write(content)

            words = len(content.split())
            grand["files"] += 1; grand["sources"] += 1
            grand["teachings"] += n_teach; grand["words"] += words
            manifest.append((out_name, len(chunk), n_teach, words))
            print(f"  {out_name:28s} {len(chunk):4d} pubs  {n_teach:5d} ensin.  {words:>9,} palavras")

    # LEIA-ME
    readme = [
        "# Fontes para o NotebookLM — Ensinamentos do Meishu-Sama",
        "",
        f"Gerado de `.local-edits/teachings` (volumes {', '.join(VOLS)}), texto em PT-BR.",
        "",
        "## Como usar (1 ensinamento por vez)",
        "1. Crie um notebook no NotebookLM.",
        "2. Suba os arquivos `.md` desta pasta como **fontes** (arraste todos de uma vez).",
        "3. Pergunte em portugues. Nas respostas, **clique nas citacoes**.",
        "4. No trecho citado, ache **Abrir no leitor:** e clique no link — o leitor abre "
        "exatamente naquele ensinamento.",
        "5. No site, use **\"Recomendar este Ensinamento\"** para publicar a recomendacao.",
        "",
        "## Como usar (varios de uma vez -> playlist)",
        "Cada ensinamento tem, no cabecalho, um **Codigo** `[[CdF:vol/arquivo/topico]]`, "
        "o **titulo** e o **link** do leitor.",
        "1. Depois de perguntar, peca ao NotebookLM (prompt minimo):",
        "   > *Liste, um por linha, cada ensinamento que voce usou, no formato "
        "`[[CdF:...]] — Titulo`. Copie o codigo exatamente como aparece no inicio do "
        "ensinamento na fonte.*",
        "2. Copie a lista (codigo + titulo por linha).",
        "3. No site: gerenciador de playlists -> **Importar do NotebookLM** -> cole -> "
        "**Analisar** -> confira -> **Criar playlist**.",
        "4. Use **Recomendar esta playlist** para enviar tudo de uma vez.",
        "",
        "### Prompt reforcado (opcional): codigo + titulo + link",
        "Se quiser dar mais chance de acerto, peca tambem o link (serve de backup "
        "quando o codigo vem errado):",
        "   > *Liste, um por linha, cada ensinamento que voce usou, no formato "
        "`[[CdF:...]] — Titulo — reader.html?vol=...&file=...&topic=...`. Copie o codigo "
        "e o link exatamente como aparecem na fonte.*",
        "",
        "### Por que pedir o titulo",
        "O NotebookLM as vezes erra o NUMERO do topico (acerta volume+arquivo, troca o "
        "ultimo digito). Com o titulo junto, o importador valida cada codigo no indice "
        "de titulos do site e CORRIGE o topico errado pelo titulo (ou descarta os "
        "inexistentes, sem criar item quebrado).",
        "",
        "O importador e tolerante: o separador (—, -, :) nao importa, aceita as URLs "
        "`reader.html?...` como codigo, e remove duplicatas. Voce so precisa pedir "
        "**codigo + titulo, um por linha**.",
        "",
        "## Arquivos",
        "",
        "| Arquivo | Publicacoes | Ensinamentos | Palavras |",
        "|---|---:|---:|---:|",
    ]
    for name, npub, nt, w in manifest:
        readme.append(f"| {name} | {npub} | {nt} | {w:,} |")
    readme += [
        "",
        f"**Total:** {grand['sources']} fontes · {grand['teachings']:,} ensinamentos · "
        f"{grand['words']:,} palavras.",
        "",
        f"Limite do NotebookLM: ~500.000 palavras/fonte e 50 fontes (Free). "
        f"Este export usa {grand['sources']} fontes (cap de {MAX_WORDS:,} palavras cada).",
    ]
    with open(os.path.join(OUT, "_LEIA-ME.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(readme) + "\n")

    print("\n" + "="*60)
    print(f"OK -> {OUT}")
    print(f"  Fontes (.md):  {grand['sources']}  (limite NotebookLM Free: 50)")
    print(f"  Ensinamentos:  {grand['teachings']:,}")
    print(f"  Palavras:      {grand['words']:,}")
    print("="*60)

if __name__ == "__main__":
    main()
