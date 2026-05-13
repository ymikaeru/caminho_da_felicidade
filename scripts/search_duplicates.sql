-- ============================================================
-- Mioshie Zenshu — Detecção de tópicos duplicados via embeddings
-- ============================================================
-- Tabela: duplicate_decisions  — persiste decisões do admin (dispensar pares
--                                 que ele já julgou "intencionalmente
--                                 distintos") pra não reaparecerem.
-- RPCs:
--   - find_duplicate_topics(threshold, limit_n)
--       lista pares (A, B) com cosine similarity >= threshold, pulando
--       pares já dispensados. Cada lado inclui contagem de tópicos no
--       arquivo pai, pra UI saber se é seguro deletar o arquivo inteiro.
--   - dismiss_duplicate_pair(...)
--       admin marca o par como decidido='dismissed'.
--
-- Pré-requisitos: search_semantic_schema.sql aplicado (coluna embedding).
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Tabela de decisões
-- ------------------------------------------------------------
-- Pares são armazenados com ordering canônico A < B (lexicograficamente),
-- pra evitar duplicação simétrica (não armazenar A→B e B→A).
create table if not exists duplicate_decisions (
  vol_a text not null,
  file_a text not null,
  topic_idx_a int not null,
  vol_b text not null,
  file_b text not null,
  topic_idx_b int not null,
  decision text not null check (decision in ('dismissed', 'deleted_a', 'deleted_b')),
  decided_by uuid,
  decided_at timestamptz not null default now(),
  primary key (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b),
  -- Garante ordem canônica A < B
  constraint canonical_order check (
    (vol_a, file_a, topic_idx_a) < (vol_b, file_b, topic_idx_b)
  )
);

comment on table duplicate_decisions is
  'Registro de decisões admin sobre pares de tópicos potencialmente duplicados. '
  'Ordering canônico: (vol_a, file_a, topic_idx_a) < (vol_b, file_b, topic_idx_b).';

alter table duplicate_decisions enable row level security;

drop policy if exists "dd_admin_read" on duplicate_decisions;
create policy "dd_admin_read"
  on duplicate_decisions for select to authenticated
  using (public.is_admin());

drop policy if exists "dd_admin_write" on duplicate_decisions;
create policy "dd_admin_write"
  on duplicate_decisions for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- Tabela materializada de candidatos a duplicata
-- ------------------------------------------------------------
-- Computar pairwise top-K em tempo real custaria ~20 min (17k linhas ×
-- ~70ms por busca HNSW), inviável dentro do timeout do PostgREST.
-- Precomputamos os pares em refresh_duplicate_candidates() (~minutos)
-- e cacheamos aqui. UI consulta direto a tabela = instantâneo.
--
-- Threshold guardado é AGREVAGE (0.85): captura uma rede mais larga.
-- A UI pode filtrar mais fino (ex.: ≥0.95) sem recomputar.
-- ------------------------------------------------------------
create table if not exists duplicate_pair_candidates (
  vol_a text not null,
  file_a text not null,
  topic_idx_a int not null,
  vol_b text not null,
  file_b text not null,
  topic_idx_b int not null,
  similarity real not null,
  computed_at timestamptz not null default now(),
  primary key (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b),
  constraint canonical_order_pc check (
    (vol_a, file_a, topic_idx_a) < (vol_b, file_b, topic_idx_b)
  )
);

create index if not exists idx_dpc_similarity
  on duplicate_pair_candidates (similarity desc);

alter table duplicate_pair_candidates enable row level security;

drop policy if exists "dpc_admin_read" on duplicate_pair_candidates;
create policy "dpc_admin_read"
  on duplicate_pair_candidates for select to authenticated
  using (public.is_admin());

drop policy if exists "dpc_service_write" on duplicate_pair_candidates;
create policy "dpc_service_write"
  on duplicate_pair_candidates for all
  to service_role
  using (true) with check (true);

-- ------------------------------------------------------------
-- RPC: refresh_duplicate_candidates
-- ------------------------------------------------------------
-- Repopula duplicate_pair_candidates do zero. Custoso (~5-20 min
-- dependendo do tamanho do corpus) — chamar com pg_cron ou manualmente
-- pelo admin via botão "Recalcular".
--
-- threshold_floor: similaridade mínima pra guardar (default 0.85, dá
-- ~rede ampla, UI filtra acima). top_k controla quantos vizinhos
-- examinar por linha (default 3 cobre 99% dos pares ≥0.95).
-- ------------------------------------------------------------
create or replace function refresh_duplicate_candidates(
  threshold_floor real default 0.85,
  top_k int default 3
)
returns int
language plpgsql security definer
set search_path = public
set statement_timeout to '1800s'  -- 30 min hard cap
as $$
declare
  n_inserted int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  truncate duplicate_pair_candidates;

  insert into duplicate_pair_candidates
    (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b, similarity)
  with pairs as (
    select
      t1.vol as va, t1.file as fa, t1.topic_idx as ta,
      n.vol as vb, n.file as fb, n.topic_idx as tb,
      (1 - (t1.embedding <=> n.embedding))::real as sim
    from teachings_topics t1
    cross join lateral (
      select t2.vol, t2.file, t2.topic_idx, t2.embedding
      from teachings_topics t2
      where t2.embedding is not null
        and (t2.vol, t2.file, t2.topic_idx) <> (t1.vol, t1.file, t1.topic_idx)
      order by t2.embedding <=> t1.embedding
      limit greatest(1, least(top_k, 10))
    ) n
    where t1.embedding is not null
  )
  select va, fa, ta, vb, fb, tb, sim
  from pairs
  where (va, fa, ta) < (vb, fb, tb)
    and sim >= threshold_floor;

  get diagnostics n_inserted = row_count;
  return n_inserted;
end;
$$;

revoke all on function refresh_duplicate_candidates(real, int) from public;
grant execute on function refresh_duplicate_candidates(real, int) to authenticated;

-- ------------------------------------------------------------
-- RPC: find_duplicate_topics — agora só lê do cache, fast.
-- ------------------------------------------------------------
-- Pula pares já dispensados via duplicate_decisions e enriquece com
-- títulos atuais + contagem de tópicos por arquivo pai.
-- ------------------------------------------------------------
create or replace function find_duplicate_topics(
  threshold real default 0.95,
  limit_n int default 200
)
returns table(
  vol_a text, file_a text, topic_idx_a int,
  title_pt_a text, file_topic_count_a int,
  vol_b text, file_b text, topic_idx_b int,
  title_pt_b text, file_topic_count_b int,
  similarity real
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with
  file_counts as (
    select vol, file, count(*)::int as n
    from teachings_topics
    group by vol, file
  ),
  pending as (
    select c.*
    from duplicate_pair_candidates c
    left join duplicate_decisions d
      on d.vol_a = c.vol_a and d.file_a = c.file_a and d.topic_idx_a = c.topic_idx_a
     and d.vol_b = c.vol_b and d.file_b = c.file_b and d.topic_idx_b = c.topic_idx_b
    where d.vol_a is null
      and c.similarity >= threshold
  )
  select
    p.vol_a, p.file_a, p.topic_idx_a, ta.title_pt, coalesce(ca.n, 0),
    p.vol_b, p.file_b, p.topic_idx_b, tb.title_pt, coalesce(cb.n, 0),
    p.similarity
  from pending p
  left join teachings_topics ta
    on ta.vol = p.vol_a and ta.file = p.file_a and ta.topic_idx = p.topic_idx_a
  left join teachings_topics tb
    on tb.vol = p.vol_b and tb.file = p.file_b and tb.topic_idx = p.topic_idx_b
  left join file_counts ca on ca.vol = p.vol_a and ca.file = p.file_a
  left join file_counts cb on cb.vol = p.vol_b and cb.file = p.file_b
  order by p.similarity desc
  limit greatest(1, least(coalesce(limit_n, 200), 1000));
end;
$$;

revoke all on function find_duplicate_topics(real, int) from public;
grant execute on function find_duplicate_topics(real, int) to authenticated;

-- ------------------------------------------------------------
-- RPC: dismiss_duplicate_pair — admin marca par como "intencionalmente distinto"
-- ------------------------------------------------------------
create or replace function dismiss_duplicate_pair(
  p_vol_a text, p_file_a text, p_topic_idx_a int,
  p_vol_b text, p_file_b text, p_topic_idx_b int
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  -- Normaliza pro ordering canônico antes de inserir.
  if (p_vol_a, p_file_a, p_topic_idx_a) > (p_vol_b, p_file_b, p_topic_idx_b) then
    insert into duplicate_decisions (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b, decision, decided_by)
    values (p_vol_b, p_file_b, p_topic_idx_b, p_vol_a, p_file_a, p_topic_idx_a, 'dismissed', v_user)
    on conflict (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b)
    do update set decision = 'dismissed', decided_by = v_user, decided_at = now();
  else
    insert into duplicate_decisions (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b, decision, decided_by)
    values (p_vol_a, p_file_a, p_topic_idx_a, p_vol_b, p_file_b, p_topic_idx_b, 'dismissed', v_user)
    on conflict (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b)
    do update set decision = 'dismissed', decided_by = v_user, decided_at = now();
  end if;
end;
$$;

revoke all on function dismiss_duplicate_pair(text, text, int, text, text, int) from public;
grant execute on function dismiss_duplicate_pair(text, text, int, text, text, int) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select * from find_duplicate_topics(0.95, 10);
-- select count(*) from find_duplicate_topics(0.95, 1000);
-- ------------------------------------------------------------
