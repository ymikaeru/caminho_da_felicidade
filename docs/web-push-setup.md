# Web Push — avisos de recomendação de estudo

Aviso no aparelho do usuário (mesmo com o site fechado) quando o admin
recomenda um Ensinamento. Implementado em 11/06/2026.

## Como funciona

```
admin recomenda (qualquer fluxo: Ensinamento / trecho grifado / áudio)
        │ INSERT em study_recommendations
        ▼
trigger trg_push_on_recommend (pg_net, assíncrono, melhor-esforço)
        ▼
Edge Function send-push
  • lê do banco as recomendações com push_notified_at IS NULL (≤3 dias)
  • 1 aviso por usuário com a contagem ("Você recebeu N recomendações…")
  • envia Web Push pras inscrições do usuário (push_subscriptions)
  • carimba push_notified_at (idempotente; inscrição morta é apagada)
        ▼
sw.js mostra a notificação → clique abre recomendacoes.html
```

O usuário ativa na **Central de Recomendações** (cartão "🔔 Ativar avisos",
injetado por `js/push-notifications.js`). Quem não ativar continua com o
badge do envelope + o banner de não-vistas (fallback, `recommendations.js`).

## Deploy — 3 passos manuais (uma vez)

As chaves VAPID estão em **`.env.push-vapid.local`** (gitignored — NÃO commitar).
A pública também está hardcoded em `js/push-notifications.js` (ela é pública mesmo).

1. **Migration** — SQL Editor do dashboard → colar e rodar
   `supabase/migrations/push_notifications_v1.sql`
   (cria `push_subscriptions`, coluna `push_notified_at`, trigger + pg_net).

2. **Secrets da função** (terminal, na raiz do projeto):
   ```
   supabase secrets set --project-ref succhmnbajvbpmoqrktq ^
     VAPID_PUBLIC_KEY=<do .env.push-vapid.local> ^
     VAPID_PRIVATE_KEY=<do .env.push-vapid.local> ^
     VAPID_SUBJECT=mailto:messianica@cmu.org.br
   ```

3. **Deploy da função**:
   ```
   supabase functions deploy send-push --project-ref succhmnbajvbpmoqrktq
   ```

## Teste de ponta a ponta

1. No site publicado (ou localhost), logado: Central de Recomendações →
   cartão 🔔 → **Ativar avisos** → aceitar a permissão.
2. Conferir no dashboard: `select * from push_subscriptions;` → 1 linha.
3. Recomendar um Ensinamento de teste pra si mesmo (admin).
4. A notificação deve chegar em segundos. Clique → abre a Central.
5. `select push_notified_at from study_recommendations order by created_at desc limit 1;`
   → deve estar carimbado.

## iPhone / iPad (iOS 16.4+)

Push só funciona com o site **instalado na Tela de Início** (Safari →
Compartilhar → Adicionar à Tela de Início) e aberto pelo ícone. O cartão
da Central já mostra esse passo a passo automaticamente nesses aparelhos.
Android e desktop funcionam direto no navegador.

## Troubleshooting

- **Trigger disparou?** `select * from net._http_response order by created desc limit 5;`
  (respostas das chamadas pg_net; status 200 = função respondeu).
- **Função processou?** Dashboard → Edge Functions → send-push → Logs.
  A resposta tem `{sent, users, pending, cleaned}`.
- **Flush manual** (re-processa pendentes de até 3 dias):
  ```
  curl -X POST https://succhmnbajvbpmoqrktq.supabase.co/functions/v1/send-push ^
    -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" -d "{}"
  ```
- **Inscrição sumiu?** Push services matam endpoints antigos (404/410) —
  a função limpa a linha; o usuário reativa no cartão.
- **Trocar as chaves VAPID** invalida TODAS as inscrições existentes
  (todo mundo precisa reativar). Só troque se a privada vazar.
