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
export async function fetchAll(buildQuery, orderCol = 'created_at') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = buildQuery();
    if (orderCol) q = q.order(orderCol);
    const { data, error } = await q.range(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
