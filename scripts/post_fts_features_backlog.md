# Backlog pós-migração FTS — features destravadas

Lista de features que ficaram triviais ou possíveis depois que a busca migrou
para Postgres FTS (ver `scripts/search_fts_migration_plan.md`). Cada item tem
contexto suficiente para um agente novo ou desenvolvedor pegar do zero.

Ordenado por **valor entregue ÷ esforço**, não por dependência. Itens são
independentes salvo nota explícita.

---

## 🟢 Quick wins (horas de trabalho)

### 1. Auto-suggest enquanto digita (typeahead)

**Problema:** o usuário precisa digitar a busca inteira e clicar/aguardar
debounce. Não tem feedback de "tem resultado pra isso?" enquanto compõe.

**Solução:** dropdown de 3-5 títulos sugeridos abaixo do input do
`#searchModal` conforme o usuário digita. Reaproveita a RPC `search_teachings`
com `max_results=5` e debounce mais curto (~80ms). Clicar uma sugestão
abre o preview direto.

**Onde mexer:**
- `js/search.js` — adicionar listener no `searchInput` que dispara busca
  com `max_results=5` e renderiza dropdown separado do `#searchResults`
  principal.
- `css/modules/_search-modal.css` — estilos do dropdown.

**Estimativa:** 3-4h.

**Cuidados:**
- Cancelar request anterior ao disparar nova (AbortController) — senão
  pile-up igual ao caso JA 2-char.
- Min 2 chars pra PT, min 3 pra JA (mesmo limite atual).
- Não quebrar o teclado (setas devem navegar entre sugestões e principal).

---

### 2. "Você quis dizer...?" para zero resultados

**Problema:** quando o usuário digita errado ("Johre", "Meishu Sma"), a busca
retorna 0 e o usuário fica perdido.

**Solução:** quando `search_teachings` retorna 0 linhas, dispara uma 2ª
chamada usando `pg_trgm`'s `similarity()` em `title_pt`/`title_ja` pra achar
títulos próximos. Mostra "Você quis dizer: <link>?" acima do "Nenhum
resultado".

**Onde mexer:**
- Nova RPC `suggest_teachings(q, lang)` em `scripts/search_fts_rpc.sql` que
  retorna top 3 títulos com similaridade > 0.3.
- `js/search.js` — no branch `if (results.length === 0)` do `performSearch`,
  chama a RPC nova e renderiza sugestões.

**Estimativa:** 2h.

---

### 3. Dashboard de analytics de busca no admin

**Problema:** hoje não dá pra saber:
- O que os usuários mais buscam.
- Quais buscas retornam zero (gap de conteúdo ou de UX).
- Quais buscas estão lentas (gargalo a otimizar).

**Solução:** já existe a tabela `search_logs` (preenchida pelo `logSearch`
em `js/search.js:668`). Criar uma aba "Analytics de Busca" no
`admin-supabase.html` que mostra:
- Top 20 queries dos últimos 7/30 dias (gráfico de barras).
- Lista de queries com `results_count = 0` (gaps).
- Latência por query (precisa adicionar campo `latency_ms` ao
  `logSearch` — pequena mudança em `js/search.js`).

**Onde mexer:**
- `js/search.js` — incluir `latency_ms` no insert de `search_logs`.
- `scripts/search_fts_rpc.sql` — adicionar RPC `admin_search_analytics(days)`
  protegida por role admin.
- `admin-supabase.html` — nova aba `tab-search-analytics`, similar em
  estilo às outras analytics tabs (~5500-5600).

**Estimativa:** 4-5h.

---

### 4. "Ensinamentos relacionados" automáticos no fim do reader

**Problema:** o botão "Ensinamentos Relacionados" no preview modal
(`spmOpenPub` em `js/search.js`) só abre a publicação inteira do tópico
atual. Não há descoberta horizontal entre publicações.

**Solução:** no fim de cada tópico no `reader.html`, mostrar 3-5 cards de
tópicos similares de **outras** publicações, baseado em similaridade de
`tsv_pt`. Aumenta tempo de sessão e descoberta.

**Onde mexer:**
- Nova RPC `related_teachings(vol, file, topic_idx, limit)` em
  `scripts/search_fts_rpc.sql`. Lógica:
  ```sql
  with target as (
    select tsv_pt from teachings_topics
    where vol = $1 and file = $2 and topic_idx = $3
  )
  select * from teachings_topics
  where (vol, file) <> ($1, $2)  -- excluir mesma publicação
    and tsv_pt @@ (select to_tsquery from extract_top_terms(target.tsv_pt))
  order by ts_rank(tsv_pt, ...) desc
  limit $4;
  ```
  (Detalhe: extrair termos top do `tsv_pt` é não-trivial; alternativa mais
  simples é usar `ts_rank_cd` com a query do título do target.)
- `js/reader.js` — chamar RPC ao terminar de renderizar tópico, anexar
  cards no fim.
- `css/modules/_reader.css` — estilos pros cards.

**Estimativa:** 6-8h.

**Cuidados:**
- Respeitar permissões do user — RPC já filtra via `_user_blocks`.
- Considerar cache no client por 5min pra evitar requests redundantes
  quando user pula entre tópicos.

---

## 🟡 Médio esforço, alto valor (dias)

### 5. Filtros server-side reais no modal de busca

**Problema:** os radio buttons "Tudo / Só Título / Só Conteúdo" do search
modal viraram no-op no PR 2 (a RPC sempre busca em ambos). Além disso,
não há filtro por volume ou seção no modal.

**Solução:** estender `search_teachings` com params:
- `match_in text default 'all'` — `'title' | 'content' | 'all'`
- `vols text[] default null` — restringe a esses volumes (cliente passa,
  RPC ainda aplica `_user_blocks` por cima)
- `sections text[] default null` — opcional

**Onde mexer:**
- `scripts/search_fts_rpc.sql` — atualizar RPC.
- `js/search.js:performSearch` — passar params do UI.
- `index.html` etc — adicionar dropdown de volumes no modal de busca.

**Estimativa:** 1 dia.

---

### 6. Caminhos de Leitura curados

**Problema:** novo usuário entra no site, vê 17.000 ensinamentos, não sabe
por onde começar.

**Solução:** admin (você) curates sequências temáticas:
- "Primeiros passos no Johrei (10 ensinamentos)"
- "Saúde e cura espiritual (15 ensinamentos)"
- "O Mundo Espiritual explicado (20 ensinamentos)"

Página dedicada lista os caminhos. Cada caminho = uma sequência ordenada de
`(vol, file, topic_idx)` triples.

**Onde mexer:**
- Nova tabela `reading_paths(id, title_pt, title_ja, description, topics
  jsonb, order_index)`.
- UI de criação no `admin-supabase.html` (drag-drop de tópicos, ou colar
  uma lista de URLs).
- Nova página `caminhos.html` ou seção no `index.html`.
- Reader poderia mostrar "próximo no caminho" se o user veio de um
  caminho.

**Estimativa:** 2 dias.

---

### 7. Progresso de leitura por usuário

**Problema:** o site não dá sensação de jornada. Usuário não sabe o que
já leu, o que falta.

**Solução:** ampliar a tabela `reading_positions` (que já existe) pra
marcar tópicos como "lidos" quando o user passa X% de scroll. Mostrar:
- Banner "Você leu 142 de 17.227 ensinamentos" no header logado.
- Progress bar por volume na home.
- Filtro "Só não-lidos" no modal de busca.

**Onde mexer:**
- `js/reader.js` — detectar 80%+ de scroll e marcar como lido (POST a
  `reading_positions`).
- `js/search.js` — opção "Só não-lidos" que filtra resultados.
- `index.html` — progress bars.

**Estimativa:** 1 dia.

**Cuidado:** "lido" diferente de "favorito" e diferente de "highlight".
Não confundir.

---

### 8. Notas e destaques pessoais sincronizados

**Problema:** highlights hoje vivem em localStorage. Trocou de dispositivo,
perdeu tudo.

**Solução:** tabela `user_highlights(user_id, vol, file, topic_idx,
range_json, color, note, updated_at)` com RLS por user. Modificar
`js/highlights.js` pra sincronizar via Supabase em vez de só localStorage.
Modo offline-first com sync no background.

**Onde mexer:**
- Schema SQL pra tabela.
- `js/highlights.js` — adicionar persistência Supabase.
- Eventual reconciliação — o que fazer se o mesmo user destacou diferente
  em dois devices?

**Estimativa:** 2-3 dias.

---

## 🔴 Projetos maiores (semanas)

### 9. Ensinamento do dia personalizado

**Problema:** retorno diário ao site depende de o user lembrar de voltar.

**Solução:** cron `pg_cron` diário escolhe um tópico por user baseado em:
- Volumes que o user lê mais.
- Tópicos ainda não lidos.
- Datas comemorativas (matchear dia do calendário com `topic.title`).
Push notification opcional via Web Push API.

**Estimativa:** 1 semana (sem push); 2 semanas (com push).

---

### 10. Comentários/perguntas com moderação

**Problema:** site é unidirecional, sem espaço pra dúvidas dos fiéis.

**Solução:** tabela `topic_comments(user_id, vol, file, topic_idx, body,
status, replied_by, replied_at, reply_body)`. Status fluxo:
`pending → published | rejected`. Admin/discípulos seniores moderam.

**Cuidado:** conteúdo religioso é sensível. Talvez restringir a
"perguntas a discípulos seniores" (não comentários públicos abertos)
pra evitar discussões.

**Estimativa:** 2 semanas com UI completa de moderação.

---

### 11. Coleções compartilháveis

**Problema:** usuário curte um conjunto de ensinamentos, quer compartilhar
com um amigo. Hoje só dá pra compartilhar URLs individuais.

**Solução:** tabela `shared_collections(id, owner_user_id, title,
description, topics jsonb, public_slug, created_at)`. Usuário monta
coleção, gera link público (`/colecao/<slug>`). Visitante vê a coleção
mesmo sem login (ou com login leve).

**Estimativa:** 1-2 semanas.

---

### 12. PWA com leitura offline

**Problema:** usuário quer ler no metrô / sem internet.

**Solução:** estender o `sw.js` existente pra:
- Cachear todos os JSONs de tópicos já visitados.
- Cachear assets (CSS/JS/fonts).
- Permitir busca offline restrita aos tópicos cacheados (precisa de
  índice client-side leve — voltamos a uma forma do índice antigo, mas
  só pro modo offline).

**Estimativa:** 1 semana.

**Cuidado:** quebra a propriedade de "permissões só no servidor" — modo
offline força confiança no client. Aceitável se restringir aos tópicos
que o user já tem permissão de ver (validação no momento do download).

---

## Decisões a tomar antes de começar qualquer um

1. **Você curou os caminhos de leitura ou alguém?** Influencia escopo de #6.
2. **Comentários públicos ou só perguntas a seniores?** Define UI de #10.
3. **Push notifications são aceitáveis para o público?** Define escopo de #9.
4. **Quer coleções públicas (qualquer user vê) ou só por link?** Define
   privacidade de #11.

## Recomendação de ordem prática

1. #1 (auto-suggest) — efeito imediato perceptível.
2. #2 (você quis dizer) — completa o ciclo de "busca smart".
3. #3 (analytics admin) — você ganha dados pra priorizar o resto.
4. #4 (relacionados) — começa a transformar de biblioteca em jornada.
5. Depois: deixa os analytics decidirem. Se há buscas frustradas → #5
   (filtros). Se há baixo retorno → #9 (ensinamento do dia). Se há muitas
   queries de "como começar" → #6 (caminhos).
