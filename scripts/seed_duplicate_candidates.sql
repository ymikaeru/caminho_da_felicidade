-- One-shot: popular duplicate_pair_candidates pela primeira vez.
-- Pode levar 5-20 min dependendo do tamanho. Statement_timeout liberado.
set statement_timeout to '3600s';

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
    limit 3
  ) n
  where t1.embedding is not null
)
select va, fa, ta, vb, fb, tb, sim
from pairs
where (va, fa, ta) < (vb, fb, tb)
  and sim >= 0.85;

select count(*) as candidates_inserted, min(similarity) as min_sim, max(similarity) as max_sim
from duplicate_pair_candidates;
