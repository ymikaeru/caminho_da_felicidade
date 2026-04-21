import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
