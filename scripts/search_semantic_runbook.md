# Busca semântica — Runbook de deploy

Adiciona busca híbrida (FTS + embeddings) sobre a infraestrutura existente.
Provider de embeddings: **Voyage AI** (`voyage-3`, 1024-dim, multilíngue PT+JA).

## Arquitetura

```
[browser]
   │  supabase.functions.invoke('search-semantic', { q, lang, scope })
   ▼
[Edge Function search-semantic]
   ├─ POST https://api.voyageai.com/v1/embeddings  (input_type=query)
   └─ rpc.search_teachings_hybrid(q, q_embedding, lang, scope)
                              │
                              ├─ FTS path (top 50 por ts_rank_cd)
                              ├─ Vector path (top 50 por cosine distance)
                              └─ RRF fusion (k=60) → top max_results
```

**Fallback:** se Voyage falhar, a Edge Function passa `q_embedding=null` e o RPC degrada gracioso pra FTS-only. Se a Edge Function falhar inteira, `js/search.js` cai pro RPC antigo `search_teachings` direto. Zero downtime de busca.

## Pré-requisitos

- `search_fts_schema.sql`, `search_fts_rpc.sql`, `search_fts_nav_labels.sql` já aplicados (já é o caso).
- Conta Voyage AI ([voyageai.com](https://www.voyageai.com)) com API key. Free tier: 200M tokens/mês — sobra muito.

## Ordem de deploy

### 1. Migrations SQL

Cole no SQL Editor do Supabase, nessa ordem:

```bash
scripts/search_semantic_schema.sql    # cria extensão vector + coluna embedding + índice HNSW
scripts/search_semantic_rpc.sql       # cria search_teachings_hybrid
```

Confirma:

```sql
select count(*) from teachings_topics where embedding is null;  -- todos NULL agora
select * from search_teachings_hybrid('johrei', null, 'pt', 3);  -- funciona em modo FTS-only
```

### 2. Configurar segredo da Voyage

```bash
supabase secrets set VOYAGE_API_KEY=pa-XXXXXX
```

### 3. Gerar embeddings (one-shot)

```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
VOYAGE_API_KEY=pa-XXXXXX \
node scripts/generate_topic_embeddings.mjs
```

Tempo esperado: ~5-15 min pra ~17k topics (batches de 128). Custo estimado: $0.50–$1.20 único (depende do tamanho médio dos topics; pior caso ~2000 tokens cada).

Flags úteis:
- `--vols=mioshiec1` — só um volume (teste).
- `--dry-run` — não escreve, só conta.
- `--force` — reembedda mesmo rows que já têm embedding.

Confirma:

```sql
select count(*), vol from teachings_topics where embedding is not null group by vol order by vol;

-- Sanity end-to-end do RPC com um embedding real (isola problemas de cast):
select vol, file, topic_idx, rank
from search_teachings_hybrid(
  'morte após parto',
  (select embedding from teachings_topics where embedding is not null limit 1),
  'pt', 5
);
```

Se o sanity SQL falhar com erro de tipo (`cannot cast jsonb to vector`), é problema no Edge Function — não no RPC. Se passar, prossiga.

### 4. Deploy das Edge Functions

```bash
supabase functions deploy search-semantic
supabase functions deploy sync-teaching-topic  # versão atualizada com reembed automático
```

### 5. Verificar end-to-end

No browser, com user logado:

```js
// console
const { data, error } = await window.supabaseAuth.supabase.functions.invoke('search-semantic', {
  body: { q: 'morte após parto', lang: 'pt', max_results: 5 }
});
console.log(data);  // deve trazer 5 resultados + flag semantic: true
```

O modal de busca da UI agora usa esse fluxo automaticamente (sem mudança visual).

## Operação contínua

### Webhook de sync

O `sync-teaching-topic` agora reembedda automaticamente os topics afetados sempre que um JSON é alterado no Storage. Falha de Voyage = log warning, não derruba o sync FTS. Embedding fica stale até o próximo trigger ou reconcile manual.

### Reembed manual

Se Voyage estiver indisponível por um tempo, alguns rows ficam stale. Pra reembeddar tudo que estiver pendente:

```bash
node scripts/generate_topic_embeddings.mjs    # só rows com embedding NULL
node scripts/generate_topic_embeddings.mjs --force   # tudo
```

Pra invalidar e reembeddar um volume só (ex.: após retradução):

```sql
update teachings_topics set embedding = null where vol = 'mioshiec3';
```

```bash
node scripts/generate_topic_embeddings.mjs --vols=mioshiec3
```

## Sintonia fina

### Pesos FTS vs vetor no RRF

Hoje a fusão é simétrica (`1/(k+rnk_fts) + 1/(k+rnk_vec)`). Se quiser favorecer um lado:

```sql
-- em search_semantic_rpc.sql, no CTE 'fused':
(coalesce(W_FTS * 1.0 / (k_rrf + f.rnk), 0) + coalesce(W_VEC * 1.0 / (k_rrf + vc.rnk), 0))::real as score
```

Empirismo: começar 1:1 e ajustar baseado em `search_logs` + feedback. Se buscas literais ("Johrei", "Daijo") caírem em ranking → aumentar W_FTS. Se buscas conceituais ("morte após parto") ainda não acharem → aumentar W_VEC.

### Threshold de similaridade

Hoje aceita qualquer match vetorial. Pra cortar matches fracos:

```sql
-- no CTE vec_all, adicionar:
where ... and (1 - (v.embedding <=> q_embedding)) > 0.3
```

0.3 é conservador; testar com queries reais.

### Reranker (futuro)

Voyage tem `rerank-2` que melhora muito a precisão. Próximo passo natural: depois do RRF, pegar os top 30 candidatos, mandar pra `https://api.voyageai.com/v1/rerank`, reordenar com o score do rerank. Custo: ~$0.0001/busca. Latência: +100-200ms.

## Custos

- **Setup único**: $0.50–$1.20 (17k topics × 800–2000 tokens × $0.06/1M).
- **Por busca**: ~$0.0000018 (30 tokens query × $0.06/1M) — efetivamente gratuito.
- **Webhook sync**: paga só quando um JSON é editado. Negligível.

## Verificação pós-deploy de performance

Confirma que o HNSW está sendo usado (não seq scan):

```sql
explain analyze
select * from search_teachings_hybrid(
  'morte',
  (select embedding from teachings_topics where embedding is not null limit 1),
  'pt', 10
);
```

Procure por `Index Scan using idx_tt_embedding_hnsw` no plano. Se aparecer `Seq Scan on teachings_topics ... Sort`, significa que o planner não aplicou o índice — abrir issue, provavelmente requer ajuste no CTE `vec_all`.

## Rollback

Pra desligar a busca semântica e voltar ao FTS puro:

1. No Supabase dashboard → Edge Functions → delete `search-semantic`, OU mude `VOYAGE_API_KEY` pra valor inválido.
2. O `js/search.js` detecta falha da Edge Function e cai automaticamente pro RPC `search_teachings` antigo.
3. Opcional: `drop function search_teachings_hybrid;` e `alter table teachings_topics drop column embedding;` — só se quiser limpar mesmo.
