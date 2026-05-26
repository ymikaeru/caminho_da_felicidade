// ============================================================
// gemini-retrad — Edge Function que retraduz artigos JP→PT
// com bijeção paragráfica ¶N obrigatória.
//
// Requer autenticação admin (mesmo padrão do gemini-suggest).
//
// Vars de ambiente (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto)
//   GEMINI_API_KEY                                               (já definida)
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://www.cmu.org.br',
  'https://cmu.org.br',
];

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

function numberParagraphs(text: string): { numbered: string; count: number } {
  const paras = (text || '').split(/\n\n+/).map((p: string) => p.trim()).filter(Boolean);
  const numbered = paras.map((p: string, i: number) => `¶${i + 1}\n${p}`).join('\n\n');
  return { numbered, count: paras.length };
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

    const body = await req.json();
    const { content_jp, title_jp, title_pt_atual, system_prompt } = body;

    if (!content_jp || typeof content_jp !== 'string') {
      return json({ error: 'content_jp obrigatório' }, 400);
    }
    if (!system_prompt || typeof system_prompt !== 'string') {
      return json({ error: 'system_prompt obrigatório' }, 400);
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'GEMINI_API_KEY não configurada no servidor' }, 500);

    const { numbered: content_jp_numbered, count: jp_count } = numberParagraphs(content_jp);

    const userMessage = JSON.stringify({
      items: [{
        id: 'article',
        title_jp: (title_jp || '').trim(),
        title_pt_atual: (title_pt_atual || '').trim(),
        content_jp_numbered,
      }]
    }, null, 2);

    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system_prompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return json({ error: `Gemini API ${geminiRes.status}`, detail }, 502);
    }

    const geminiData = await geminiRes.json();
    const text: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let parsed: Array<{ id: string; title_ptbr?: string; content_ptbr_numbered: string; paragraph_count: number }>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: 'Gemini devolveu JSON inválido', raw: text.slice(0, 500) }, 502);
    }

    const item = Array.isArray(parsed) ? parsed[0] : null;
    if (!item || !item.content_ptbr_numbered) {
      return json({ error: 'Resposta inesperada do Gemini', raw: text.slice(0, 500) }, 502);
    }

    const pt_count = (item.content_ptbr_numbered.match(/¶\d+/g) || []).length;

    return json({
      result: {
        content_ptbr_numbered: item.content_ptbr_numbered,
        title_ptbr: (item.title_ptbr || '').trim(),
        paragraph_count_jp: jp_count,
        paragraph_count_pt: pt_count,
        ok: pt_count === jp_count,
      }
    }, 200);

  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
