-- ============================================================
-- search_teachings_literal — busca por substring literal (ILIKE)
-- ============================================================
-- Motivação: o caminho híbrido (FTS + embedding) não acha termos em
-- kanji/kana quando o site_lang está em PT (pt_unaccent não tokeniza
-- bem CJK), e o vetor semântico devolve "vizinhos" ao invés do termo
-- exato. Pra busca "literal exata" (substring) o usuário precisa de
-- ILIKE puro nos campos PT e JA simultaneamente, sem FTS nem vetor.
--
-- Mesma assinatura de retorno do search_teachings_hybrid pra reuso do
-- client (_renderResultItem). Permissões aplicadas via _user_blocks()
-- como na híbrida.
--
-- Performance: ILIKE com leading wildcard é seq scan, mas a tabela
-- teachings_topics é pequena (~5k rows) e o GIN trigram nos campos
-- title_*/content_* (se existir) pode acelerar. Vol estimado: 300-800ms.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_teachings_literal(
  q text,
  lang text DEFAULT 'pt'::text,
  max_results integer DEFAULT 50,
  scope text DEFAULT 'all'::text
)
RETURNS TABLE(
  vol text, file text, topic_idx integer,
  title_pt text, title_ja text,
  nav_title_pt text, nav_title_ja text,
  snippet text, rank real,
  section_pt text, section_ja text,
  content_excerpt text
)
LANGUAGE plpgsql
STABLE
SET statement_timeout TO '15s'
AS $function$
#variable_conflict use_column
declare
  v_scope text := lower(coalesce(scope, 'all'));
  v_raw   text := coalesce(nullif(trim(q), ''), '');
  v_ilike text := replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_');
  v_pat   text := '%' || v_ilike || '%';
  v_limit int  := greatest(1, least(coalesce(max_results, 50), 100));
begin
  if v_raw = '' then
    return;
  end if;
  if v_scope not in ('all', 'title', 'content') then
    v_scope := 'all';
  end if;

  return query
  with
  blocks as (select volume, files from _user_blocks()),
  fully_blocked as (select volume from blocks where files is null),
  matched as (
    select
      t.vol, t.file, t.topic_idx,
      -- Score: título > nav_title > section > content. Match em
      -- qualquer language conta — usuário pode querer o termo PT
      -- mesmo estando em modo JA ou vice-versa.
      (
        (case when v_scope <> 'content' and (
            t.title_pt      ilike v_pat escape '\'
            or t.title_ja   ilike v_pat escape '\'
          ) then 4.0 else 0 end) +
        (case when v_scope <> 'content' and (
            t.nav_title_pt  ilike v_pat escape '\'
            or t.nav_title_ja ilike v_pat escape '\'
          ) then 2.0 else 0 end) +
        (case when v_scope <> 'content' and (
            t.section_pt    ilike v_pat escape '\'
            or t.section_ja ilike v_pat escape '\'
          ) then 1.0 else 0 end) +
        (case when v_scope <> 'title' and (
            t.content_pt    ilike v_pat escape '\'
            or t.content_ja ilike v_pat escape '\'
          ) then 0.5 else 0 end)
      )::real as r
    from teachings_topics t
    where t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol and b.files is not null and t.file = any(b.files)
      )
      and (
        (v_scope <> 'content' and (
          t.title_pt      ilike v_pat escape '\'
          or t.title_ja   ilike v_pat escape '\'
          or t.nav_title_pt ilike v_pat escape '\'
          or t.nav_title_ja ilike v_pat escape '\'
          or t.section_pt   ilike v_pat escape '\'
          or t.section_ja   ilike v_pat escape '\'
        ))
        or
        (v_scope <> 'title' and (
          t.content_pt ilike v_pat escape '\'
          or t.content_ja ilike v_pat escape '\'
        ))
      )
  ),
  ranked as (
    select vol, file, topic_idx, r
    from matched
    order by r desc, vol, file, topic_idx
    limit v_limit
  )
  select
    t.vol, t.file, t.topic_idx, t.title_pt, t.title_ja,
    coalesce(t.nav_title_pt, t0.nav_title_pt) as nav_title_pt,
    coalesce(t.nav_title_ja, t0.nav_title_ja) as nav_title_ja,
    -- Snippet: pega ±60 chars em volta do match. Escolhe content_ja se
    -- match for em JA, senão content_pt. Sem <mark> (client-side highlight
    -- já cuida via regex em _styleSnippet).
    case
      when v_scope = 'title' then ''
      when lang = 'ja' and position(lower(v_raw) in lower(coalesce(t.content_ja, ''))) > 0
        then substring(
          coalesce(t.content_ja, ''),
          greatest(1, position(lower(v_raw) in lower(coalesce(t.content_ja, ''))) - 60),
          180
        )
      when position(lower(v_raw) in lower(coalesce(t.content_pt, ''))) > 0
        then substring(
          coalesce(t.content_pt, ''),
          greatest(1, position(lower(v_raw) in lower(coalesce(t.content_pt, ''))) - 60),
          180
        )
      when position(lower(v_raw) in lower(coalesce(t.content_ja, ''))) > 0
        then substring(
          coalesce(t.content_ja, ''),
          greatest(1, position(lower(v_raw) in lower(coalesce(t.content_ja, ''))) - 60),
          180
        )
      else substring(coalesce(t.content_pt, t.content_ja, '') from 1 for 180)
    end as snippet,
    r.r as rank,
    coalesce(t.section_pt, t0.section_pt) as section_pt,
    coalesce(t.section_ja, t0.section_ja) as section_ja,
    substring(
      coalesce(
        case when lang = 'ja' then t.content_ja else t.content_pt end,
        t.content_pt,
        t.content_ja,
        ''
      )
      from 1 for 1500
    ) as content_excerpt
  from ranked r
  join teachings_topics t using (vol, file, topic_idx)
  left join teachings_topics t0
    on t0.vol = t.vol and t0.file = t.file and t0.topic_idx = 0
  order by r.r desc, t.vol, t.file, t.topic_idx;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.search_teachings_literal(text, text, integer, text)
  TO authenticated, anon;
