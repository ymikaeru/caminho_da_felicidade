# Handoff — Ferramenta de Alinhamento JA↔PT (admin do Caminho da Felicidade)

> Documento pra continuar o trabalho em outra janela/sessão. Lê tudo antes de mexer —
> teve MUITO zig-zag de abordagem; as seções "ABANDONADO" existem pra não repetir os erros.

---

## 1. Objetivo (o que o usuário quer)

No leitor do CdF, no **modo comparação** (日本語 | Português lado a lado) e na **leitura normal**,
muitos ensinamentos do Volume 1 (mioshiec1) aparecem **desalinhados / como paredão**: o português
não tem parágrafos legíveis e/ou não casa com o japonês.

**Norte do usuário (frase dele): "o importante é alinhar o `<br>`"** — o PT deve ganhar quebras
`<br>` nos **mesmos trechos dos blocos do japonês**, que é a régua natural de parágrafo.

---

## 2. ⭐ DIAGNÓSTICO CORRETO (a conclusão final, depois de muito erro)

### 2.1 O japonês é a fonte da estrutura
O `content` (JA) tem `<br>` nos pontos de parágrafo do autor (ex.: kuni3 t1 = 11 blocos). Esses
blocos são a paragrafação correta. O `content_ptbr` (PT) deve seguir.

### 2.2 O leitor JÁ quebra parágrafo nos rótulos de fala (regra crucial, descoberta tarde)
`_normalizeContent` em [js/reader-content.js](../js/reader-content.js) (regra ~linha 41) insere uma
quebra de parágrafo **antes de cada rótulo de fala**: "Pergunta do Fiel", "Ensinamento de
Meishu-Sama", "Orientação de Meishu-Sama", etc.
**Consequência:** os **Q&A renderizam em turnos sozinhos, mesmo sem `<br>`** → JÁ aparecem alinhados
no site. **NÃO são o problema.** (Verificado: SBzengensanzi t11 = 0 `<br>` no PT → renderiza 10 parágrafos.)

### 2.3 O problema REAL são os MONÓLOGOS-PAREDÃO (~617 tópicos)
Palestras/ensinamentos longos **sem rótulos de fala**. O tradutor separou o PT em parágrafos com
`\n\n`, mas o leitor **achata `\n\n` em espaço** (só `<br>` e rótulos viram parágrafo). Sem rótulo,
nada quebra → **paredão** (ex.: kuni3 t1 = 175 `\n\n` no PT → renderiza **1** parágrafo).

### 2.4 Métrica de detecção CORRETA
`isWall(pt)` = `splitPtParas(pt).length − renderedParasProxy(pt) >= 4`, onde
`renderedParasProxy = 1 + nº<br> + nº rótulos-de-fala`. (A métrica ANTIGA, que contava só `<br>`,
dava falso-positivo em todo Q&A.)

### 2.5 Achado de qualidade da quebra (o último insight do usuário)
Quebra **frase-a-frase** funciona em japonês, mas em **português fica HORRÍVEL de ler** (picado).
O PT precisa de **parágrafos de verdade = frases AGRUPADAS**, e o agrupamento certo segue os
~11 blocos do JA. Por isso `\n\n`→`<br>` (que mantém uma quebra por frase) **não serve**.

---

## 3. 🎯 PLANO TRAVADO (o próximo passo a implementar)

**Agrupar as frases do PT atual nos blocos do JA** (preserva o texto; ~11 parágrafos):
1. JA → `readerSegs(content)` = N blocos (a régua).
2. PT → `splitPtSentences(content_ptbr)` = frases (unidades).
3. IA (`gemini-suggest`) diz **em qual frase do PT cada bloco do JA começa** (N−1 pontos de corte).
4. Agrupa as frases nesses pontos → N parágrafos → `assemblePt(...)` junta com `<br/>`.
5. **Invariante:** `wordsOnly(novo) === wordsOnly(original)` (só separadores mudam).
6. Admin revisa lado a lado e aplica (grava só `content_ptbr`; JA intocado).

**Próxima ação concreta combinada com o usuário:** DEMONSTRAR no kuni3 primeiro — pegar o PT atual,
agrupar nos 11 blocos do JA, e mostrar **renderizado** (paredão → ~11 parágrafos, mesmo texto).
**Só depois** de aprovar, fixar isso na aba. **Nenhuma escrita em produção sem aprovação.**

> A aba HOJE está com o conserto ERRADO (`\n\n`→`<br>`, ver §5) como primário — precisa ser
> re-apontada pro agrupamento-ao-JA acima.

---

## 4. ❌ ABANDONADO (não repetir)
- **`\n\n`→`<br>` cru (`wallFix`)**: transporta a quebra-por-frase pro PT → picado/horrível. (Existe no
  engine como `wallFix` e na aba como primário — TROCAR pelo agrupamento-ao-JA.)
- **Detecção por contagem de `<br>`** (readerSegs JA vs PT): falso-positivo em Q&A. (Já trocado por `isWall`.)
- **Sentence-editor manual (clicar/mover `<br>`)** e **clipboard→claude.ai**: descartados.
- **Retraduzir (gemini-retrad + prompt calibrado)**: FUNCIONA e alinha por construção, mas **substitui
  o texto**. Mantido só como **opção secundária** (o usuário prefere preservar o PT atual, que é bom).

---

## 5. Arquivos (estado atual)
- **[js/align-engine.js](../js/align-engine.js)** `?v=6` — motor PURO (node + browser, `window.AlignEngine`).
  Funções úteis pro plano: `readerSegs` (blocos JA, = `_stripHeader`+split`<br>`+`mergeHeadings`,
  portado VERBATIM do leitor), `splitPtSentences` (frases do PT), `assemblePt(sentences, breakSet)`
  (remonta inserindo `<br/>`), `wordsOnly`. Tem também `wallFix`/`isWall`/`renderedParasProxy`,
  `splitPtParas`, e `buildAlignment` (modelo antigo de bloco — pode ignorar).
- **[scripts/build_alignment_candidates.mjs](build_alignment_candidates.mjs)** → **[data/alignment_candidates.json](../data/alignment_candidates.json)**.
  HOJE detecta **paredões** via `isWall`: **617 candidatos** (campos: vol, file, theme_idx, topic_idx,
  title, intended, rendered, gain). Rodar após `npm run storage:pull`.
- **[js/admin/tabs/alignment.js](../js/admin/tabs/alignment.js)** `?v=18` — a ABA. HOJE: lista paredões;
  revisão mostra ANTES (via `_normalizeContent`) × DEPOIS (`\n\n`→`<br>`) **só pra inspeção** — o botão de
  aplicar o `\n\n`→`<br>` foi **REMOVIDO** (evitar acidente). Só resta o botão
  "Retraduzir e alinhar" (secundário, deliberado). **PRECISA** ser re-apontada pro agrupamento-ao-JA (§3):
  trocar o preview de `wallFix` por "agrupar frases do PT nos blocos do JA" + um botão de aplicar esse.
  - KPI **"Aplicados"** é clicável → lista os itens já gravados com botão "👁 Preview" (render live do Storage).
    A lista é **PERSISTENTE**: `_hydrateApplied()` lê do `admin_logs` (ações `alignment_retranslate`/
    `alignment_wallfix`) no load, recuperando `theme_idx`/título via `_cands` — sobrevive a reload e sessão.
    O apply agora loga `theme_idx` também (logs antigos só têm vol/file/topic_idx → theme_idx vem do `_cands`).
- **[js/admin/tabs/translation-review.js](../js/admin/tabs/translation-review.js)** `?v=3` — exporta
  `TRANSLATION_GUIDELINES` (prompt CALIBRADO: tom natural BR, sem pt-pt/advocacia, glossário doutrinário,
  rótulos por extenso). Usado pela retradução.
- **admin-supabase.html** — nav item + `<div id="tab-alignment">`; bumps: `admin.js?v=117`,
  `admin.min.css?v=24`, `alignment.js?v=18` (em js/admin.js).
- **css/modules/_admin.css** — estilos `.align-*`, `.ed-*` (rodar `npm run build:admin-css` após editar).
- **[scripts/samples/](samples/)** — `preview.html` (render antes/depois, SEM PIN gate),
  `kuni3_t1_retrad.json`, `kuni3_t0_calibrado.md`, `SBzengensanzi_t11_qa_compare.md`.
- **Edge functions** (já deployadas): `gemini-retrad` e `gemini-suggest`, ambas
  **`gemini-3.1-pro-preview`** (hardcoded server-side; mudar = editar a função + `supabase functions deploy`).
  Hack usado: `gemini-suggest` tem responseSchema fixo de 4 strings → carrego a resposta (índices) no
  campo `correcao_sugerida` e parseio.

### Dados (mioshiec1–4, 17222 tópicos)
- ~**617** monólogos-paredão (ALVO real).
- ~6148 Q&A já renderizam OK (regra 9) — excluir.
- ~5707 PT vazio (não traduzido) — excluir.
- Causa-raiz: PT do lote antigo traduzido com `Backup/prompts/PROMPT_TRANSLACAO.md` (em
  `D:\Mioshie_Sites\mioshie_college_offline`) que mandava usar `\n\n`; o `PROMPT_TRANSLACAO_VOL2.md`
  já preservava `<br>`. O dado offline == Caminho (não há versão alinhada pronta pra importar).

---

## 6. ⚠️ CUIDADOS / GOTCHAS
- **Espelho ↔ Storage (footgun):** apply grava no **Supabase Storage** (bucket `teachings`, `{vol}/{file}`).
  O espelho `.local-edits/teachings/` fica stale; um `npm run storage:push` futuro do espelho stale
  **clobbaria** o live. Rodar `npm run storage:pull` (aceita `--prefix=mioshiec1/arquivo.html.json` p/
  um arquivo só) pra re-sincronizar. O admin LÊ do Storage (vivo), não do espelho/repo.
- **PIN gate:** o admin pede PIN ao carregar → bloqueia screenshot do preview. Verificar via DOM
  (preview_eval) ou usar a página `scripts/samples/preview.html` (sem gate).
- **Eval de 30s:** chamadas Gemini Pro levam ~12–60s e estouram o limite do preview_eval. Padrão usado:
  disparar a chamada (sem await, guardando em `window.__x`) e ler o resultado num eval seguinte.
- **`content_ptbr` tem outros consumidores:** `search.js`, `pdf-booklet.js`, e **highlights**
  (`user_highlights`, ancoram por offset de char no texto RENDERIZado). Mudar o PT desloca a marcação
  visual dos destaques (texto grifado é preservado no banco). A revisão deve avisar a contagem de destaques.
- **NÃO commitado:** tudo isso está só no working copy local. Pra o botão aparecer no admin REAL
  (cmu.org.br) precisa **commitar + publicar** os JS. As edge functions já estão no ar.
- **API key exposta (sibling repo):** `mioshie_college_offline/scripts/gemini_translate_safe.py` tem
  uma `GEMINI_API_KEY` hardcoded — **revogar/rotacionar**.

---

## 7. Pendência de produção (resolvida, mas saber)
Houve **1 apply de teste** em `mioshiec1/tengoku2ZIGOKU.html.json` t1 (pelo `\n\n`→`<br>` errado, 192
quebras por frase). Foi **REVERTIDO**: live (Storage) e espelho voltaram ao original (0 `<br>`, 192 `\n\n`,
texto do Caminho intacto). Foi a única escrita em produção. (Cuidado: a cópia em
`mioshie_college_offline/.../tengoku2ZIGOKU.html.json` é uma tradução DIFERENTE — não usar pra reverter.)

---

## 8. Resumo de uma linha
Alvo = ~617 monólogos-paredão do Vol 1. Conserto = **agrupar as frases do PT atual nos ~N blocos do
japonês** (IA acha os cortes, preserva o texto), virando parágrafos legíveis e alinhados. Próximo passo
= DEMONSTRAR no kuni3 (render antes/depois) antes de fixar na aba e antes de qualquer apply.
