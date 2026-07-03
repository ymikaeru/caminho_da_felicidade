// ============================================================
// fetchAll — paginação além do cap de 1000 linhas do PostgREST
// ============================================================
// O Supabase/PostgREST devolve no MÁXIMO 1000 linhas por request, em ordem
// arbitrária quando não há ORDER BY. Qualquer select de tabela grande
// (access_logs, reading_positions, site_events, user_highlights,
// synced_favorites, search_logs...) SEM paginação calcula estatística sobre
// um subconjunto aleatório — foi o que fez a "Escuta média" do Culto marcar
// 305% (o recorte de 1000 linhas tinha 24 sessões com play e 149 com tempo).
//
// Uso:
//   import { fetchAll } from '../fetch-all.js';
//   const res = await fetchAll(() => supabase.from('access_logs')
//     .select('user_id,created_at').gte('created_at', since));
//   // res = { data, error } — mesmo shape de um await direto.
//
// O callback deve CONSTRUIR a query do zero a cada chamada (os builders do
// PostgREST são mutáveis — reusar um builder acumularia .range()).
// `orderCol` deve existir na tabela (default created_at); a ordem estável é
// o que garante páginas sem sobreposição. Se a query do callback JÁ tem
// .order(...) próprio, passe orderCol = null para não duplicar.
// ============================================================
// Paginação ADAPTATIVA: a 1ª página sonda sozinha (a maioria das queries cabe
// em <1000 linhas = 1 request). Se veio cheia, as seguintes saem em ONDAS de
// 4 requests PARALELOS — a aba do Johrei (site_events com dezenas de milhares
// de heartbeats) caía em ~40 round-trips SERIAIS; em ondas viram ~10.
// Risco de páginas paralelas: escrita concorrente pode deslocar linhas entre
// páginas — o mesmo risco que já existia em série (analytics tolera).
export async function fetchAll(buildQuery, orderCol = 'created_at') {
  const PAGE = 1000, WAVE = 4;
  const fetchPage = (from) => {
    let q = buildQuery();
    if (orderCol) q = q.order(orderCol);
    return q.range(from, from + PAGE - 1);
  };

  const first = await fetchPage(0);
  if (first.error) return { data: first.data || [], error: first.error };
  const out = [...(first.data || [])];
  if (out.length < PAGE) return { data: out, error: null };

  for (let from = PAGE; ; from += WAVE * PAGE) {
    const results = await Promise.all(
      Array.from({ length: WAVE }, (_, i) => fetchPage(from + i * PAGE))
    );
    for (const { data, error } of results) {
      if (error) return { data: out, error };
      out.push(...(data || []));
      if (!data || data.length < PAGE) return { data: out, error: null };
    }
  }
}
