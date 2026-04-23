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

    const { email, password, display_name } = await req.json();

    if (!email || !password) {
      return json({ error: 'Email e senha são obrigatórios' }, 400);
    }

    if (password.length < 6) {
      return json({ error: 'A senha deve ter pelo menos 6 caracteres' }, 400);
    }

    // Cria o usuário via Admin API — NÃO altera a sessão do admin logado
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      user_metadata: {
        display_name: display_name || email.split('@')[0],
        role: 'user',
      },
      email_confirm: true, // não exige confirmação de email
    });

    if (error) {
      return json({ error: error.message }, 400);
    }

    // Cria o perfil na tabela user_profiles
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: data.user.id,
        display_name: display_name || email.split('@')[0],
        role: 'user',
      }, { onConflict: 'id' });

    if (profileError) {
      return json({
        error: `Usuário criado no auth, mas falha no perfil: ${profileError.message}`,
      }, 207);
    }

    return json({ user: { id: data.user.id, email: data.user.email } }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
