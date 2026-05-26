// ============================================================
// gemini-suggest — Edge Function que proxia chamadas ao Gemini API.
// Requer autenticação admin (mesmo padrão do admin-create-user).
//
// Vars de ambiente (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto)
//   GEMINI_API_KEY                                               (definir manualmente)
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://www.cmu.org.br',
  'https://cmu.org.br',
];

// Flash é ~4x mais rápido que Pro para respostas curtas como sugestão pontual.
// Pro reservado para gemini-retrad (retradução de artigos completos).
const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

serve(async (req: Request) => {
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) return json({ error: 'Token inválido' }, 401);

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') return json({ error: 'Acesso restrito a administradores' }, 403);

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') return json({ error: 'prompt obrigatório' }, 400);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'GEMINI_API_KEY não configurada no servidor' }, 500);

    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 512 },
          responseSchema: {
            type: 'object',
            properties: {
              erro_identificado:  { type: 'string' },
              trecho_atual:       { type: 'string' },
              correcao_sugerida:  { type: 'string' },
              justificativa:      { type: 'string' },
            },
            required: ['erro_identificado', 'trecho_atual', 'correcao_sugerida', 'justificativa'],
          },
        },
      }),
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return json({ error: `Gemini API ${geminiRes.status}`, detail }, 502);
    }

    const geminiData = await geminiRes.json();
    const text: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let result: Record<string, string>;
    try {
      result = JSON.parse(text);
    } catch {
      return json({ error: 'Gemini devolveu JSON inválido', raw: text.slice(0, 500) }, 502);
    }

    return json({ result }, 200);

  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
