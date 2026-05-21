# 001 — Playlists do admin (curadoria, recomendação em lote, apostila)

- **Status:** Implemented
- **Autor:** ymikaeru
- **Criado:** 2026-05-21
- **Última modificação:** 2026-05-21

## Escopo desta versão

**MVP admin-only.** Lado usuário fica pra uma fase posterior (ver "Para pensar depois").

### O que essa versão entrega

1. **Admin monta playlists temáticas** (ex: "Sobre o Daimiroku", "Sobre o Johrei", "Iniciantes", "Maio 2026 — Gratidão"). Nome livre.
2. **Adicionar itens à playlist por dois caminhos:**
   - Modo seleção múltipla nos resultados de busca → "Adicionar à playlist…" (existente ou nova).
   - Botão "Adicionar à playlist" no header de cada ensinamento aberto no reader.
3. **Usar a playlist como fonte de recomendação em lote:**
   - Admin abre a playlist, clica "Recomendar".
   - Escolhe destinatário(s) (mesmo seletor do fluxo atual).
   - Vê os N itens da playlist com **checkboxes (todos marcados por default)**.
   - Desmarca os que não vão dessa vez (cherry-pick).
   - Envia → cria N × M `study_recommendations` em **uma ação**, com `source_collection_name` preenchido.
4. **Lado usuário ganha agrupamento visual em [recomendacoes.html](../../recomendacoes.html):**
   - Recomendações vindas de uma mesma playlist aparecem **agrupadas** sob um cabeçalho:
     > **📂 Ensinamentos sobre Daimiroku (8)**
     > • Item 1
     > • Item 2
     > • ...
   - Cabeçalho colapsável (default expandido).
   - Cada item continua sendo um `study_recommendations` independente — arquivar segue por item (mantém o comportamento atual).
   - Recomendações sem origem em playlist (modelo antigo) caem num grupo "Avulsas" ou ficam soltas no topo.
5. **Gerar apostila física da playlist** → botão "Imprimir apostila" usa [js/pdf-booklet.js](../../js/pdf-booklet.js) com a lista de itens.

### O que essa versão NÃO faz

- Não muda nada no modal "Ensinamentos Salvos" do usuário.
- Não cria bandeja de impressão pro usuário.
- Não adiciona "modo tema" (card único agrupado com arquivar-tudo) — recomendações continuam sendo rows individuais, **só agrupadas visualmente**.
- Não permite ao usuário "salvar tema como minha playlist" (não tem playlists do usuário ainda).
- Não muda fluxo de arquivamento (continua item por item).

Todas essas ideias ficam preservadas em "Para pensar depois". A premissa: validar o ganho admin (curadoria + envio em lote + apostila) antes de mexer no usuário.

## Estado atual relevante

- Recomendação hoje vai 1 por vez via [admin-supabase.html](../../admin-supabase.html) — admin entra em cada ensinamento individualmente. Esta é a principal dor.
- Tabela `study_recommendations` já existe, com RPCs `get_my_recommendations` / `_archived` consumidas por [js/recomendacoes-page.js](../../js/recomendacoes-page.js).
- [js/pdf-booklet.js](../../js/pdf-booklet.js) + [js/pdf-booklet-ui.js](../../js/pdf-booklet-ui.js) hoje imprimem 1 ensinamento. Precisamos estender pra aceitar lista de itens.
- Busca: [js/search.js](../../js/search.js) renderiza resultados.

## Design

### Schema

```sql
-- Playlist do admin. Só admin acessa (gate por role).
create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on collections(user_id);

-- Itens da playlist. Referência (vol+file+topic), não conteúdo.
create table collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  vol text not null,
  file text not null,
  topic_idx int not null default 0,
  position int not null,
  added_at timestamptz default now(),
  primary key (collection_id, vol, file, topic_idx)
);

create index on collection_items(collection_id, position);

-- Alterações em study_recommendations: identificação da playlist origem
-- pra agrupamento visual no lado usuário.
alter table study_recommendations
  add column source_collection_id uuid references collections(id) on delete set null,
  add column source_collection_name text;  -- snapshot do nome no envio, não acompanha rename

create index on study_recommendations(source_collection_id);
```

**RLS:**
- `collections` e `collection_items`: SELECT/INSERT/UPDATE/DELETE só pra admins. User comum não enxerga (nem precisa — ele só lê `source_collection_name` da própria `study_recommendations`, que é o snapshot).
- `study_recommendations`: policies atuais inalteradas.

**Snapshot do nome em `source_collection_name`**: se admin renomear ou apagar a playlist depois, recomendações já enviadas mantêm o cabeçalho original ("📂 Sobre o Daimiroku") sem ficar quebrado.

### UI Admin — Aba "Playlists"

Nova aba em [admin-supabase.html](../../admin-supabase.html). Layout:

```
┌─────────────────────────────────────────────────┐
│ [+ Nova playlist]                               │
├─────────────────────────────────────────────────┤
│ 📂 Sobre o Johrei              5 itens   [⋯]   │
│ 📂 Iniciantes                  8 itens   [⋯]   │
│ 📂 2026-05 — Gratidão          6 itens   [⋯]   │
└─────────────────────────────────────────────────┘
```

Click na playlist abre painel detalhado:

```
┌────────────────────────────────────────────────────┐
│ ← Voltar    [Renomear] [Apagar] [📄 Imprimir]      │
│ Sobre o Johrei                                     │
├────────────────────────────────────────────────────┤
│ ⋮⋮ 1. Ensinamento de Meishu-Sama — O que é Johrei │
│ ⋮⋮ 2. Volume 2 — A força do Johrei                │
│ ⋮⋮ 3. ...                                          │
│                                                    │
│ [📤 Recomendar esta playlist]                     │
└────────────────────────────────────────────────────┘
```

Itens reordenáveis (drag handle `⋮⋮` muda `position`).

### Adicionar à playlist a partir da busca

Em [js/search.js](../../js/search.js), no modo admin:

- Novo botão **"Modo seleção"** no topo dos resultados.
- Ativo: cada resultado vira checkbox, aparece barra fixa inferior:
  > ✓ 4 selecionados → **[Adicionar à playlist…]**
- Menu abre lista de playlists existentes + "+ Nova playlist".

### Adicionar à playlist a partir do reader

No header do reader (admin only):

- Botão **"Adicionar à playlist"** ao lado dos controles existentes.
- Click abre menu compacto: lista das playlists do admin + "+ Nova playlist".
- Adiciona o ensinamento atual (`vol+file+topic` do contexto do reader) na playlist escolhida.
- Toast de confirmação.

### Recomendar a playlist (fluxo principal)

Botão "📤 Recomendar esta playlist" abre modal:

1. **Destinatário(s)** — reusa o seletor que já existe pra recomendação atual.
2. **Itens da playlist** com **checkboxes (todos marcados por default)**:
   > ☑ 1. O que é Johrei
   > ☑ 2. A força do Johrei
   > ☐ 3. (desmarcado — não vai dessa vez)
   > ☑ 4. ...
3. **Botão "Enviar"** → RPC `send_playlist_recommendations(collection_id, recipient_ids[], item_keys[])` itera e cria 1 `study_recommendations` por (item × destinatário) selecionado, **com `source_collection_id` e `source_collection_name` preenchidos**. Idempotente: se já existe recomendação ativa do mesmo item pro mesmo destinatário (independente da playlist origem), pula.

### Lado usuário — agrupamento visual em recomendacoes.html

Refit mínimo em [js/recomendacoes-page.js](../../js/recomendacoes-page.js):

- Ao carregar recomendações ativas/arquivadas, agrupar por `source_collection_id`.
- Renderizar cabeçalho colapsável por grupo:
  > **📂 Ensinamentos sobre Daimiroku (8)** [▼]
- Default expandido. Estado de colapso pode ser persistido por usuário (localStorage) — nice-to-have.
- Recomendações sem `source_collection_id` (modelo antigo ou avulsas) vão pra grupo "📥 Outras" no topo ou rodapé.
- **Arquivamento permanece por item** — cabeçalho não tem botão "arquivar todas". Se admin quiser oferecer isso depois, vira fast-follow.

### Imprimir apostila

Botão "📄 Imprimir" na playlist:

- Estende [js/pdf-booklet-ui.js](../../js/pdf-booklet-ui.js) pra aceitar `items: [{vol, file, topic}, ...]` em vez de só 1 item.
- Renderiza cada ensinamento em sequência, com capa opcional contendo o nome da playlist.
- (Detalhes de paginação, sumário, índice — fase de polimento.)

## Decisões registradas

| Decisão | Por quê |
|---|---|
| **MVP admin-only no curador**, **mínimo no usuário** | Valida o ganho de curadoria + envio em lote. Lado usuário ganha só agrupamento visual (sem refit do modal de salvos, sem card-tema, sem bandeja). |
| Schema sem `kind` (sem print_tray ainda) | Admin não precisa de bandeja — ele tem playlists nomeadas. Print_tray volta se/quando o usuário entrar. |
| `source_collection_name` é **snapshot** | Se admin renomear/apagar playlist, cabeçalho do grupo no usuário não quebra. |
| Sem snapshot de **itens** (tabela `recommendation_items`) | Cada recomendação continua sendo uma row independente em `study_recommendations`. Agrupamento é só visual (por `source_collection_id`). Arquivamento permanece por item. |
| Cherry-pick antes do envio (checkboxes default todos) | Playlist serve como template reutilizável; admin adapta caso a caso. |
| Arquivamento permanece **por item** no lado usuário | Mantém comportamento atual; evita complexidade do "arquivar tema todo" e estados parciais. Pode virar fast-follow. |
| Apostila é geração one-shot, não muda schema | Botão dispara o pdf-booklet com a lista atual. Sem persistir "apostila gerada". |

## Plano de implementação

### Fase 1 — Backend
- [x] **[CDF-001-01]** Migration SQL: `collections`, `collection_items`, índices.
- [x] **[CDF-001-02]** RLS policies (admin-only).
- [x] **[CDF-001-03]** RPCs: `create_collection`, `rename_collection`, `delete_collection`, `add_to_collection`, `remove_from_collection`, `reorder_collection_items`, `list_my_collections`, `get_collection_with_items`.
- [x] **[CDF-001-04]** RPC `send_playlist_recommendations(recipient_ids[], items[])` — cria batch de `study_recommendations` (idempotente).

### Fase 2 — UI admin
- [x] **[CDF-001-05]** Nova aba "Playlists" em [admin-supabase.html](../../admin-supabase.html): lista, criar, renomear, apagar.
- [x] **[CDF-001-06]** Painel de detalhe da playlist: lista de itens reordenáveis (drag), remover item.
- [x] **[CDF-001-07]** Modal "Recomendar esta playlist": destinatários + checkboxes + enviar.

### Fase 3 — Pontos de entrada
- [x] **[CDF-001-08]** Modo seleção múltipla nos resultados de busca ([js/search.js](../../js/search.js)) → "Adicionar à playlist…" (admin only).
- [x] **[CDF-001-09]** Botão "Adicionar à playlist" no header do reader (admin only).

### Fase 4 — Lado usuário (mínimo)
- [x] **[CDF-001-10]** Refit em [js/recomendacoes-page.js](../../js/recomendacoes-page.js): agrupar ativas/arquivadas por `source_collection_id`, cabeçalho colapsável "📂 nome (N)".
- [x] **[CDF-001-11]** Persistir estado colapsado/expandido por grupo em localStorage (nice-to-have).

### Fase 5 — Apostila
- [x] **[CDF-001-12]** Estender [js/pdf-booklet-ui.js](../../js/pdf-booklet-ui.js) pra aceitar lista de itens.
- [x] **[CDF-001-13]** Botão "Imprimir apostila" na playlist + capa simples com nome da playlist.

## Riscos

- **Admin acumular muitas playlists**: não previsto agora, mas como UI é uma lista simples, ~50 playlists ainda funcionam sem busca. Soft warning fica pra polimento.
- **Idempotência da recomendação**: se admin clicar "Enviar" duas vezes por engano, dobra recomendações. RPC checa `(user_id, vol, file, topic)` ativo antes de inserir.
- **Reordenação concorrente**: improvável (1 admin), mas usar `position int` server-side resolve.

## Para pensar depois (lado usuário)

Ideias já desenhadas e descartadas/adiadas pra fase futura, **preservadas aqui pra não perder o pensamento**:

### Refit do modal "Ensinamentos Salvos"
- Modal vira "biblioteca" estilo galeria de fotos: view "Todos" plana + sidebar com filtros (Sem playlist, Bandeja, playlists do usuário).
- Item pode estar em N playlists (chip "em 2 playlists").
- Apagar playlist preserva itens na biblioteca por default.

### Bandeja de impressão sincronizada
- Playlist especial (`kind='print_tray'`, 1 por usuário) sincronizada via Supabase.
- Botão "Adicionar à bandeja" em todos os lugares onde aparece ensinamento.
- "Imprimir bandeja" usa o mesmo pdf-booklet estendido.

### Recomendação como "tema" (card único com arquivar-tudo)
- `delivery_mode='tema'` em `study_recommendations`.
- Tabela snapshot `recommendation_items` pra arquivar-tudo de uma vez sem perder rastro item-a-item.
- Card único expansível com botão "Arquivar tema todo" + "Salvar tema como minha playlist".
- (O agrupamento visual simples por `source_collection_id` já entra na v1 — esse aqui é o nível mais alto, em que o tema vira **uma entidade arquivável**.)

### Cherry-pick do usuário ao receber
- "+" individual em cada item do tema → adiciona à biblioteca.
- "Salvar tema todo como minha playlist" → clona em `collections` nova.

### Outras questões em aberto
- Mobile (sidebar vira drawer/tabs).
- Empty states de modal vazio.
- Busca dentro dos salvos.
- Multi-select-and-print pra evitar fricção do "tem que adicionar a playlist pra imprimir".

### Não-objetivos (mesmo em fase futura)
- Compartilhamento usuário → usuário.
- Catálogo público navegável.
- Pasta sincronizada com template do admin (modo espelho — descartada por complexidade vs demanda).

## Notas

- Mexer no sistema `userHighlights` / [destaques.html](../../destaques.html) é sistema separado (trechos anotados) e **fora deste design** em qualquer fase.
- Storage estimado pra playlists do admin: trivial (~10 playlists × 20 itens × 70 bytes = 14KB).
