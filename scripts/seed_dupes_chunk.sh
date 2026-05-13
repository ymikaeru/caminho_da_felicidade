#!/usr/bin/env bash
# Popula duplicate_pair_candidates em chunks de 500 linhas pra caber
# dentro do timeout do PostgREST/Cloudflare (~100s). Cada chunk leva
# ~30-40s. 17225 / 500 = ~35 chunks.

set -e

PROJECT_REF=succhmnbajvbpmoqrktq
TOTAL=17225
BATCH=500

start=$(date +%s)
inserted=0

for offset in $(seq 0 $BATCH $((TOTAL - 1))); do
  echo "[$(date +%H:%M:%S)] chunk offset=$offset ..."
  out=$(supabase db query --linked "
    with src as (
      select vol, file, topic_idx, embedding
      from teachings_topics
      where embedding is not null
      order by vol, file, topic_idx
      offset $offset limit $BATCH
    ),
    pairs as (
      select s.vol as va, s.file as fa, s.topic_idx as ta,
             n.vol as vb, n.file as fb, n.topic_idx as tb,
             (1 - (s.embedding <=> n.embedding))::real as sim
      from src s
      cross join lateral (
        select t2.vol, t2.file, t2.topic_idx, t2.embedding
        from teachings_topics t2
        where t2.embedding is not null
          and (t2.vol, t2.file, t2.topic_idx) <> (s.vol, s.file, s.topic_idx)
        order by t2.embedding <=> s.embedding
        limit 3
      ) n
    )
    insert into duplicate_pair_candidates (vol_a, file_a, topic_idx_a, vol_b, file_b, topic_idx_b, similarity)
    select va, fa, ta, vb, fb, tb, sim
    from pairs
    where (va, fa, ta) < (vb, fb, tb)
      and sim >= 0.85
    on conflict do nothing
    returning 1
  " 2>&1 || true)
  echo "$out" | tail -3
done

now=$(date +%s)
echo "Done in $((now - start))s"
