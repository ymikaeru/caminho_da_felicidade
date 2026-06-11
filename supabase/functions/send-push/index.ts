// ============================================================
// send-push — avisa por Web Push as recomendações de estudo pendentes
// ============================================================
// Disparada pelo trigger trg_push_on_recommend (pg_net) a cada INSERT
// em study_recommendations; também pode ser chamada à mão (flush).
//
// Segurança: o payload do chamador é IGNORADO — a função lê do banco
// as recomendações com push_notified_at IS NULL e avisa só os usuários
// donos delas. Chamadas repetidas são no-op (carimbo de idempotência).
//
// Secrets necessários (supabase secrets set):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// ============================================================
import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const ALLOWED_ORIGINS = [
  'https://www.cmu.org.br',
  'https://cmu.org.br',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = ALLOWED_ORIGINS.includes(origin) || isLocalhost;
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:messianica@cmu.org.br';
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'VAPID keys não configuradas' }, 500);
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // recomendações criadas há até 3 dias e ainda não avisadas
    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const { data: pending, error: pendErr } = await supa
      .from('study_recommendations')
      .select('id, user_id, expires_at')
      .is('push_notified_at', null)
      .gte('created_at', since);
    if (pendErr) return json({ error: pendErr.message }, 500);

    const now = Date.now();
    const valid = (pending || []).filter((r) => !r.expires_at || Date.parse(r.expires_at) > now);
    if (!valid.length) return json({ sent: 0, users: 0, pending: 0 });

    // agrupa por usuário (1 aviso por usuário, com a contagem)
    const perUser = new Map<string, number>();
    for (const r of valid) perUser.set(r.user_id, (perUser.get(r.user_id) || 0) + 1);

    const { data: subs, error: subErr } = await supa
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', [...perUser.keys()]);
    if (subErr) return json({ error: subErr.message }, 500);

    let sent = 0;
    const dead: string[] = [];
    await Promise.all((subs || []).map(async (s) => {
      const n = perUser.get(s.user_id) || 1;
      const payload = JSON.stringify({
        title: 'Caminho da Felicidade',
        body: n > 1
          ? `📖 Você recebeu ${n} novas recomendações de estudo.`
          : '📖 Você recebeu uma nova recomendação de estudo.',
        url: 'recomendacoes.html',
        tag: 'rec-study',
      });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);   // inscrição morta → limpa
        else console.error('push fail', s.endpoint.slice(0, 60), code);
      }
    }));

    if (dead.length) await supa.from('push_subscriptions').delete().in('id', dead);

    // carimba TODAS as pendentes (mesmo de usuários sem inscrição —
    // pra esses o aviso é o badge/banner do site; não fica re-tentando)
    await supa.from('study_recommendations')
      .update({ push_notified_at: new Date().toISOString() })
      .in('id', valid.map((r) => r.id));

    return json({ sent, users: perUser.size, pending: valid.length, cleaned: dead.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
