import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  const json = (body: object, status: number) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verifica se o chamador está autenticado
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return json({ error: 'Token inválido' }, 401);
    }

    // Verifica se o chamador é admin
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return json({ error: 'Acesso restrito a administradores' }, 403);
    }

    const { user_id } = await req.json();

    if (!user_id) {
      return json({ error: 'user_id é obrigatório' }, 400);
    }

    // Impede que o admin delete a si mesmo
    if (user_id === user.id) {
      return json({ error: 'Você não pode remover sua própria conta' }, 400);
    }

    // Impede remover o último admin do sistema — se o alvo é admin, confirma
    // que existe pelo menos mais um admin antes de prosseguir. Sem isso, uma
    // sequência de deletes poderia deixar o sistema sem nenhum administrador.
    const { data: targetProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user_id)
      .single();

    if (targetProfile?.role === 'admin') {
      const { count: adminCount, error: countErr } = await supabaseAdmin
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');

      if (countErr) {
        return json({ error: `Falha ao validar admins: ${countErr.message}` }, 500);
      }
      if ((adminCount ?? 0) <= 1) {
        return json({ error: 'Não é possível remover o último administrador do sistema.' }, 400);
      }
    }

    // Remove dados relacionados nas tabelas públicas em paralelo
    await Promise.all([
      supabaseAdmin.from('user_permissions').delete().eq('user_id', user_id),
      supabaseAdmin.from('access_logs').delete().eq('user_id', user_id),
      supabaseAdmin.from('reading_positions').delete().eq('user_id', user_id),
      supabaseAdmin.from('synced_favorites').delete().eq('user_id', user_id),
      supabaseAdmin.from('user_highlights').delete().eq('user_id', user_id),
      supabaseAdmin.from('search_logs').delete().eq('user_id', user_id),
    ]);

    // Remove o perfil
    await supabaseAdmin.from('user_profiles').delete().eq('id', user_id);

    // Remove do auth.users via Admin API (elimina o acesso de login)
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (deleteAuthError) {
      return json({ error: `Dados removidos, mas falha ao remover do auth: ${deleteAuthError.message}` }, 207);
    }

    return json({ success: true }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
