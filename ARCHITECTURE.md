# Arquitetura — Caminho da Felicidade (Mioshie College)

> Documentação de referência para manutenção. Descreve **como o projeto é montado**, não a lista de tarefas.
> Para o "porquê" de decisões pontuais e armadilhas históricas, veja também as memórias em `~/.claude/.../memory/` e os handoffs em `scripts/*.md`.
>
> Última síntese: 2026-07-02.

---

## 1. Visão geral

Site **estático multi-página** para leitura, busca e estudo dos ensinamentos de Meishu-Sama (japonês + português-BR), hospedado no **GitHub Pages** e servido em produção por `https://www.cmu.org.br/caminho_da_felicidade/`.

Não há framework nem bundler de aplicação: cada página é um `.html` que carrega módulos JS por `<script>`. Todo o backend dinâmico (auth, dados, busca semântica, sync, push, IA) fica no **Supabase** (projeto `succhmnbajvbpmoqrktq`). O conteúdo dos ensinamentos vive no **Storage do Supabase**, com um espelho local editável (`.local-edits/`).

```
Navegador (GitHub Pages: HTML + CSS + JS)
        │  supabase-js (anon key, RLS)
        ▼
Supabase
 ├─ Auth (email/senha, roles)
 ├─ Postgres (71 migrations, RLS, ~50 RPCs)
 ├─ Storage (bucket `teachings` = fonte da verdade do conteúdo)
 ├─ Edge Functions (Deno) → Voyage AI, Gemini, Web Push
 └─ pg_cron / pg_net (retenção, disparo de push)
```

**Quatro subsistemas** (cada um detalhado abaixo):
1. **Frontend** — páginas HTML, módulos JS, CSS, build/cache-bust, PWA.
2. **Backend Supabase** — auth, schema, RLS, Edge Functions, Storage, busca.
3. **Pipeline de dados** — modelo de conteúdo, índices, scripts, sync de Storage.
4. **Admin & features** — painel `admin-supabase.html`, destaques, playlists, recomendações, review de tradução, analytics.

---

## 2. Frontend

### 2.1 Páginas HTML (raiz + `mioshiec{1..4}/index.html`)

| Página | Papel |
|---|---|
| `index.html` | Hub de volumes / entrada do site |
| `reader.html` | Leitor principal (ensinamentos + modo discípulos via `?pub=disciples`) |
| `mioshiec1..4/index.html` | Índices de volume pré-renderizados (grandes, ~200 KB) |
| `poesia.html` + `yama-to-mizu` / `warai-no-izumi` / `akimaro-kineishu` / `gosanka-{shoban,kaitei,shikiten}` | Coleções de poesia |
| `destaques.html` | Central de Destaques (Caderno de Estudos) |
| `lidos.html` | Ensinamentos lidos (read marks) |
| `recomendacoes.html` | Recomendações + inscrição em Web Push |
| `poemas-salvos.html` | Poemas salvos |
| `analise-espiritual.html` | Análise Espiritual (taxonomia de doenças) |
| `pontos-vitais-johrei.html` | Guia de pontos vitais do Johrei (oculto, logado) |
| `shin-dendo.html` | Apostila só-leitura (JSON do repo, `noindex`) |
| `login.html` / `reset-password.html` | Autenticação |
| `admin-supabase.html` | Painel de administração (ver §5) |

Todas as páginas de leitura carregam o mesmo "cabeçalho" de scripts compartilhados (`toggle.js`, `nav.js`, `theme.js`, `language.js`, `typography.js`, `search.min.js`) mais o que a página específica precisa.

### 2.2 Mapa de módulos JS (`js/`, ~60 arquivos)

**Boot / UI global:** `init-theme.js` (tema síncrono no `<head>`, antes do CSS), `toggle.js` (strings PT/JA, focus trap), `nav.js` (menu/hambúrguer + TOC desktop), `theme.js` (modal de tema + modo claro/escuro), `language.js` (troca PT↔JA), `typography.js` (tamanho de fonte / espaçamento).

**Leitor:** `reader.js` (orquestrador: busca artigo no Storage, cache, prefetch, histórico, parse de `?vol=&file=&topic=`), `reader-content.js` (`_normalizeContent`, regras de quebra e rótulos de fala, datas Shōwa — **sem DOM**), `reader-render.js` (renderiza em `#readerContainer`, citações), `reader-recommend.js`, `disciples-reader.js` (leitor alternativo Markdown para os livros de discípulos).

**Storage / sync / auth:** `supabase-config.js` (cliente singleton), `storage.js` (`supabaseStorageFetch`, cache 30 min, timeout 8 s, workaround iOS 17), `sync.js` (posição de leitura + favoritos), `sync-queue.js` (fila offline de destaques), `login.js` (auth + detecção de dispositivo/OS/browser + logging de acesso), `access.js` (restrição de volume/arquivo por usuário).

**Busca / navegação:** `search.js` (FTS bilíngue via RPC + modos Título/Conteúdo/Coleção/Relacionados), `modals.js` (builders de modais).

**Features:** `highlights.js` (grifar via CSS Custom Highlight API, offsets por caractere, modo tap-to-highlight), `playlists.js` + `playlists-loader.js` (só admin, lazy), `recommendations.js` / `reader-recommend.js` / `poetry-recommend.js`, `study-messages.js` (Canal com o Reverendo / Mural), `translation-report.js` (reportar erro de tradução), `read-time-tracker.js` + `scroll-progress.js` (analytics de leitura), `first-visit-tips.js`, `push-notifications.js` (Web Push), `content-protection.js`.

**Família poesia:** `poetry-{yama,warai,akimaro,gosanka}.js` (leitores por coleção), `poetry-fontsize.js`, `poetry-highlights.js`, `poetry-recommend.js`.

**Páginas dedicadas:** `destaques-page.js`, `lidos-page.js`, `recomendacoes-page.js`, `poemas-salvos.js`, `disease-map.js`, `johrei-points.js`.

**Motor compartilhado:** `align-engine.js` (alinhamento JA↔PT, detecção de "paredão" — usado tanto no admin quanto em scripts Node; ver §4.4).

### 2.3 Build e cache-busting

Scripts em `package.json`:

```
npm run build:css        # css/styles.css → styles.min.css (PostCSS + postcss-import + cssnano)
npm run build:admin-css  # css/admin.css → admin.min.css
npm run build:js         # esbuild --minify: playlists, highlights, disciples-reader, reader-render, search
npm run build            # os três acima
npm run versions         # scripts/bump-versions.mjs — alinha/incrementa ?v=N nos HTML
```

- **Só 5 JS são minificados** (`playlists`, `highlights`, `disciples-reader`, `reader-render`, `search`) → servem `.min.js`. **Editar o fonte sem rodar `build:js` não publica** a mudança para esses arquivos. Os demais módulos são servidos crus.
- **Cache-bust é manual** via `?v=N` no `<script>`/`<link>` de cada HTML. Ao editar um JS/CSS compartilhado, rode `node scripts/bump-versions.mjs bump <asset>` para incrementar a versão em **todos** os HTML de uma vez (evita cache dividido entre páginas). `--list` mostra divergências.
- O **service worker (`sw.js`) NÃO faz cache de assets** — só Web Push. Isso é intencional: cachear assets brigaria com o esquema de `?v=N`.

### 2.4 CSS e temas

- `css/styles.css` é só uma lista de `@import` para `css/modules/_*.css` (variáveis, reset, header, layout, reader, controls, modais, poesia, highlights, discípulos, disease-map, responsivo…). `css/admin.css` é separado.
- Cores vêm de **CSS custom properties** em `_variables.css`. O tema é aplicado por atributos no `<html>` (`data-mode` claro/escuro × `data-theme`), decididos em `init-theme.js` (boot, lê `localStorage`) e trocados em `theme.js`.
- ⚠️ Armadilha conhecida: existem `var(--bg-card)`, `--border-color`, `--text-color` referenciadas que **nunca existiram** → caem no fallback e quebram temas escuros (ver memória `css-ghost-variables`).

### 2.5 PWA

- `manifest.json` — `display: standalone`, escopo `./`, tema dourado (`#B8860B`).
- `sw.js` — mínimo, só notificações push (install→skipWaiting, activate→claim, push→showNotification, notificationclick→abre a recomendação).

---

## 3. Backend (Supabase)

Projeto: `https://succhmnbajvbpmoqrktq.supabase.co`. A **anon key é pública por design** — a segurança real é RLS. A **service role key só existe nas Edge Functions**.

### 3.1 Autenticação e controle de acesso

Fluxo em `login.js` → `supabase.auth.signInWithPassword` → carrega permissões → `onAuthStateChange` atualiza estado global → heartbeat atualiza `user_profiles.last_seen_at`.

Três níveis: **`admin`** (`user_profiles.role='admin'`), **`full`** (sem restrição), **`limited`** (allowlist/blacklist de volume+arquivo em `user_permissions`, cacheada em `localStorage` como `mioshie_access_config`).

Gate do admin em **camadas**: (1) `role='admin'` no banco; (2) `is_allowed_admin()` — allowlist de UUIDs (Walter Fujii, Michael); (3) **PIN bcrypt** em `user_profiles.admin_pin_hash` verificado a cada carregamento de `admin-supabase.html`. Idioma por conta via `user_profiles.preferred_lang`.

### 3.2 Schema (71 migrations em `supabase/migrations/`)

Tabelas principais:

| Tabela | Papel |
|---|---|
| `user_profiles` | `role`, `preferred_lang`, `admin_pin_hash`, `last_seen_at` (perfil auto-criado por trigger no signup) |
| `user_permissions` | Restrição de volume/arquivo por usuário |
| `access_logs` | Pageviews + `metadata` jsonb (dispositivo/OS/browser); dedup 60 s via RPC |
| `reading_positions` | Última posição + `max_scroll_pct` (high-water) + `time_spent_seconds` |
| `synced_favorites`, `user_highlights`, `read_marks` | Dados de leitura do usuário (offsets de grifo por caractere) |
| `teachings_topics` | **Espelho FTS/semântico** dos ensinamentos (~17k linhas): `tsv_pt` (tsvector) + `embedding` (halfvec, índice HNSW). Leitura pública. |
| `search_logs`, `search_aliases` | Analytics de busca + expansão de consulta |
| `study_recommendations` | Recomendações admin→usuário (ensino/áudio/playlist/poema); trigger dispara push |
| `study_messages` | Canal privado usuário→Reverendo |
| `study_posts` (+ `study_post_reactions`) | Mural anônimo com pré-moderação |
| `collections` (+ `collection_items`) | Playlists de curadoria (admin) |
| `push_subscriptions` | Inscrições Web Push |
| `translation_reports` | Reportes de erro de tradução (inclui poesia via `vol='poetry'`) |
| `audio_listens` | High-water de % de áudio + `completed` |
| `site_events` (+ `site_events_daily`) | Analytics anônimo compartilhado com landing/guia; retenção 90 d via pg_cron |
| `landing_config`, `auth_codes` | Config de landing + códigos de convite |

**Padrão RLS:** tabelas de usuário → `USING (auth.uid()=user_id)` + `is_admin()` para SELECT/DELETE de admin; logs → INSERT próprio, SELECT próprio-ou-admin; tabelas admin-only → `is_admin()`; conteúdo público (`teachings_topics`, `site_events`) → `USING(true)`. Funções-chave `SECURITY DEFINER`: `is_admin()`, `is_allowed_admin()`.

> ⚠️ Segurança: a auditoria 06/2026 (`security_fixes_2026_06*.sql`) endereçou autopromoção a admin (faltava `WITH CHECK`), bypass de volume e restrição de upload no Storage. Ver memória `security-audit-2026-06`.

### 3.3 Edge Functions (`supabase/functions/`, Deno)

| Função | Papel | Externo / segredos |
|---|---|---|
| `admin-create-user` | Cria usuário (sem confirmação de e-mail) | service role; exige `is_admin()` |
| `admin-delete-user` | Remove usuário + dados (guarda: não apagar a si nem o último admin) | service role |
| `search-semantic` | Busca híbrida: embed **Voyage `voyage-3`** → RPC `search_teachings_hybrid` (RRF de FTS + vetor) → rerank **Voyage `rerank-2.5-lite`**; fallback para FTS-only se sem chave/timeout | `VOYAGE_API_KEY` |
| `send-push` | Lê recomendações pendentes no banco, agrupa por usuário, envia Web Push, marca `push_notified_at` (idempotente) | VAPID (`VAPID_PUBLIC/PRIVATE_KEY`, `VAPID_SUBJECT`) |
| `gemini-retrad` | Retradução com bijeção por ¶N | **Gemini `gemini-3.1-pro-preview`**, `GEMINI_API_KEY`; exige admin |
| `gemini-suggest` | Sugestão/consulta LLM genérica | idem |
| `sync-teaching-topic` | Webhook Storage→DB: baixa o JSON, extrai tópicos (`_shared/topic_normalize.mjs`), faz upsert em `teachings_topics` com `tsv_pt` e re-embedda via Voyage | `SYNC_WEBHOOK_SECRET`, `VOYAGE_API_KEY` |

> ⚠️ Se "Relacionados" volta vazio, a causa clássica é `VOYAGE_API_KEY` vencida no Edge (embedding falha → FTS-AND → zero). Ver memória `search-relacionados-edge-voyage-key`.

### 3.4 Storage e busca

- Bucket **`teachings`** = fonte da verdade do conteúdo (`{vol}/{slug}.html.json`, além de `search_index_*.json`, `section_map.js`, `global_index_titles.js`, `books/`, `poetry/`). Buckets auxiliares: `rec-audio` (áudios de recomendação), e áreas de guia/apostila.
- O leitor busca o JSON do artigo direto do Storage (`storage.js`); anônimos caem em fetch local de fallback. `cacheControl` deve ser `public,max-age=0,must-revalidate` — `cacheControl:'0'` já causou restrição por egress (memória `storage-cachecontrol-egress`).
- **Busca semântica** e **FTS** convivem: `search.js` no cliente escolhe o modo; o edge `search-semantic` faz o híbrido; `teachings_topics` guarda `tsv_pt` + `embedding`.

---

## 4. Pipeline de dados e conteúdo

### 4.1 Modelo de conteúdo

Hierarquia: **volume → tema (publicação) → tópico (ensinamento)**. Cada arquivo `{slug}.html.json` no bucket tem `volume_title` e `themes[].topics[]`. Campos de um tópico:

- `content` — **JA original em HTML** (quebras por `<br/>`, `<font color>`, `<b>`).
- `content_ptbr` — **PT em Markdown** (`\n\n`, `**bold**`).
- `title` / `title_ptbr` / `topic_title_br` — títulos JA / PT / curto (Q&A).
- `date` (Shōwa), `filename`, `title_idx`, `pub_idx`.
- `continues_previous` — quando `true`, o tópico é fragmento de continuação e é **fundido ao anterior** na renderização (nunca filtrar do array — quebra `topic_idx`).

Escala: **~17.222 tópicos** em 4 volumes.

### 4.2 Índices (derivados)

| Arquivo | Uso |
|---|---|
| `.local-edits/teachings/search_index_mioshiec{1..4}.json` | Índice FTS completo (com conteúdo PT) — no Storage |
| `site_data/titles_index_mioshiec{1..4}.json` | Projeção só-título (`f,i,t,tj`) para o modo "Título" do cliente — no repo (`npm run build:titles`) |
| `data/jp_search/mioshiec{1..4}.json` | Índice JA (título+data+3000 chars) para a aba Citações do admin |
| `site_data/global_index_titles.js` | `GLOBAL_INDEX_TITLES[vol/file]` → títulos + seção (navegação/breadcrumb) |
| `site_data/section_map.js` | `SECTION_MAP[vol][file]` → agrupamento por seção (sidebar/TOC) |
| `site_data/disease_map.js` / `johrei_points.js` | Taxonomias curadas à mão (Análise Espiritual / Pontos Vitais) |
| `data/partial_citations_index.json` | Citações parciais → ensinamento-fonte |
| `data/alignment_candidates.json` | Worklist de "paredões" para o alinhamento |
| `data/retrad_prev_index.json` | Cache de retraduções (undo/comparação no admin) |

### 4.3 Sync de Storage (`scripts/storage-*.mjs`, ver `scripts/STORAGE_SYNC.md`)

Espelho local **gitignored** em `.local-edits/teachings/`, com baseline SHA-256 em `.local-edits/.manifest.json`.

```
npm run storage:pull                     # baixa bucket → espelho (idempotente)
npm run storage:status                   # SHA local vs manifest → o que mudou
npm run storage:push                     # DRY-RUN
npm run storage:push -- --confirm        # sobe só arquivos com SHA alterado
```

> ⚠️ **Duas armadilhas críticas:**
> 1. **`storage:push` NÃO atualiza as tabelas do banco.** Só o bucket. `teachings_topics` (FTS/embeddings) só muda pelo webhook `sync-teaching-topic` ou mutação explícita. Editar o conteúdo no Storage não altera a busca sozinho.
> 2. A detecção é **local-vs-manifest**, não local-vs-remoto. Se alguém editar o Storage pela web depois do seu `pull`, o `push` não detecta colisão.
>
> Para `data/books/` existe um gap análogo: editar o repo não publica; suba do espelho `.local-edits/teachings/books/` (memória `books-deploy-mirror-gap`).

### 4.4 Scripts (`scripts/`, 48 arquivos)

- **Índices:** `build_titles_index.mjs`, `build_jp_search_index.mjs`, `split_search_index.js`, `generate_topic_embeddings.mjs`, `build_partial_citations_index.mjs`, `build_alignment_candidates.mjs`.
- **Taxonomias:** `build_disease_map.mjs`, `build_johrei_points.mjs` (GROUPS/MAP hardcoded no próprio script → editar + rerodar).
- **Alinhamento / retradução (motor `align-engine.js`):** `retrad_batch.mjs` (chama Gemini, gera staging local), `retrad_publish.mjs` (aplica no espelho→Storage, loga em `admin_logs`), `retrad_revert.mjs`.
- **Poesia:** `poetry_parse.mjs` (md→skeleton), `poetry_translate_gemini.mjs`, `poetry_translate_prefaces.mjs`, `build_ashita_bilingual.mjs`.
- **Export:** `export_notebooklm.py` → `notebooklm_export/mioshiecN_parteXX.md` com código `[[CdF:vol/file/topic]]` e link de volta pro leitor (chunks < 450k palavras).
- **Fixes/diag pontuais:** família `_fix_*.mjs`, `_diag_*.mjs`, `fix_glued_paper_headers.mjs` etc. (mutam o espelho, não o Storage).
- **Versão/manutenção:** `bump-versions.mjs`; handoffs em `scripts/STORAGE_SYNC.md`, `scripts/BACKUP.md`, `scripts/ALIGNMENT_HANDOFF.md`.

> ⚠️ A regra de rótulos de fala (`Pergunta do Fiel`, `Ensinamento de Meishu-Sama`…) é **duplicada** em `reader-content.js` e `align-engine.js` — mudar uma exige mudar a outra, senão a detecção de paredão diverge da renderização. Offsets de grifo também **derivam** quando o `content_ptbr` muda (fix de paredão insere `<br>`).

---

## 5. Painel de administração e features

### 5.1 `admin-supabase.html` + `js/admin/`

Arquitetura de **abas com navegação lateral** (`data-tab`/`data-section`). `js/admin.js` é o orquestrador: valida sessão/role, roda o PIN gate, e importa os módulos de aba. Cada módulo grande injeta seu próprio markup via constante `_TAB_MARKUP` no import (editar aba = mexer no módulo + `?v` bump). Estado compartilhado em `js/admin/shared/{state,helpers,constants}.js`. Logout por ociosidade (10 min).

Abas (por seção):

- **Análise:** Geral (dashboard com ~18 subconsultas), Discípulos, Poesia, Buscas (top queries, zero-result, latência p50/p95/p99), Áudio (quem ouviu / % máx), Destaques e Salvos (por usuário).
- **Curadoria:** Recomendações (ensino), Recomendar Áudio (upload MP3 → bulk), Caixa de Entrada (inbox do Canal com o Reverendo).
- **Edição:** Relatórios (reportes de tradução + editor de retradução/alinhamento), Pesquisa de Omitidos, Reportes de Discípulos, Correções de Poemas, Adicionar Omitidos (citações parciais), Buscar & Substituir (em massa nos JSON do Storage), Comparação (traduções anteriores via `align-engine.js`).
- **Sistema:** Usuários (CRUD + permissões por volume/arquivo), Logs (auditoria de ações admin), Duplicatas (dedup por embedding ≥0.85, oculta).

`js/admin/fetch-all.js`: workaround do **cap de 1000 linhas** do PostgREST — pagina em blocos de 1000 (o builder é recriado a cada iteração porque é mutável). Usar em qualquer consulta que possa passar de 1000 linhas.

### 5.2 Destaques

`highlights.js` grifa via **CSS Custom Highlight API** (sem mutar o DOM), guardando offsets por caractere em `user_highlights`; modo tap-to-highlight e fila offline. A **Central de Destaques** (`destaques.html` + `destaques-page.js`) agrega por Volume→Publicação→Cor, com busca, chips de cor e toggle "ocultar títulos".

### 5.3 Playlists e recomendações

Playlists (`playlists.js`, lazy só para admin via `playlists-loader.js`) → `collections`/`collection_items`; exportam para Word/impressão e importam do NotebookLM. Recomendações (`study_recommendations`) chegam ao usuário em `recomendacoes.html` (abas Ativas/Arquivadas, filtro por tipo, "Ler" marca como lido) e podem disparar **Web Push** (trigger → `send-push`).

### 5.4 Review de tradução

Usuário reporta erro por seleção (`translation-report.js`) → `translation_reports`. O editor no admin (`translation-review.js`) mostra o reporte, permite retraduzir e **realinhar o tópico inteiro por bijeção ¶N** (motor `align-engine.js`), com título PT editável. Poesia e livros de discípulos têm abas próprias.

### 5.5 Analytics

Rastreamento: `access_logs` (dispositivo detectado em `login.js`), `reading_positions` (tempo cumulativo + `max_scroll_pct`), `search_logs`, `audio_listens`, `site_events`. ⚠️ "Progresso de Leitura": o **tempo é cumulativo all-time** e **0% lido = sem captura de scroll**, não "não leu". Datas de "Atividade recente" usam o fuso do observador (Japão vê +12 h).

---

## 6. Como fazer mudanças (checklist rápido)

- **Editou CSS?** `npm run build:css` (e `build:admin-css` se for o admin) → `npm run versions` / `bump-versions.mjs bump styles.min.css`.
- **Editou um dos 5 JS minificados** (`playlists`, `highlights`, `disciples-reader`, `reader-render`, `search`)? `npm run build:js` — senão o `.min.js` não muda. Depois bump de `?v`.
- **Editou JS compartilhado** (`nav.js`, `toggle.js`…)? Bump de `?v=N` em **todos** os HTML via `bump-versions.mjs`.
- **Editou conteúdo de ensinamento?** Trabalhe no espelho `.local-edits/teachings/`, `storage:status` → `storage:push --confirm`. Lembre: **isso não atualiza a busca** (`teachings_topics`) — depende do webhook `sync-teaching-topic`.
- **Regerou índices?** `build_titles_index` / `build_jp_search_index` conforme o caso; commite os `site_data/*.json` no repo.
- **Deploy do site:** push para `main` (GitHub Pages serve da raiz).
- **Git nesta máquina trava** com frequência — ver receita em memória `git-commit-hang-workaround` (matar processos órfãos, remover `index.lock`, um comando por vez).

---

## 7. Referências

- `README.md` — visão rápida e comandos de build.
- `scripts/STORAGE_SYNC.md`, `scripts/BACKUP.md`, `scripts/ALIGNMENT_HANDOFF.md` — handoffs operacionais.
- `docs/` — rascunhos de taxonomia (análise espiritual, pontos vitais), setup de web-push, prompt de tradução.
- Memórias em `~/.claude/projects/.../memory/` — o "porquê" e as armadilhas históricas de features individuais.
