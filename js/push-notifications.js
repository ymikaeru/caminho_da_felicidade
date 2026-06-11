// ============================================================
// Web Push — avisos de recomendação de estudo (usuário-side)
// ============================================================
// Injeta um cartão "Ativar avisos" na Central de Recomendações.
// Fluxo: registra sw.js → pede permissão → PushManager.subscribe
// → grava endpoint+chaves em push_subscriptions (RLS: cada usuário
// gerencia as próprias inscrições). O envio é da Edge Function
// send-push, disparada por trigger no banco.
//
// iPhone/iPad: o push só existe com o site instalado na Tela de
// Início (iOS 16.4+) — fora disso o cartão vira um passo a passo.
// ============================================================

(function () {
  const VAPID_PUBLIC_KEY = 'BPzYtSgjmNLkRmcsyIZIpLYNJLOgKRgYRqrrGkMEVDPujs0sEf-hmjUAEKWGZkssavPhS8EvEnnWseaofCfIryA';

  function _supa() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function _ensureStyle() {
    if (document.getElementById('pushCardStyle')) return;
    const s = document.createElement('style');
    s.id = 'pushCardStyle';
    s.textContent = `
      .push-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid var(--border);
        border-radius:12px;padding:14px 18px;margin:0 0 24px}
      .push-card-icon{font-size:1.4rem;flex:none}
      .push-card-text{flex:1 1 240px;min-width:0}
      .push-card-title{font-weight:600;color:var(--text-main);margin:0 0 2px;font-size:.98rem}
      .push-card-desc{color:var(--text-muted);font-size:.86rem;margin:0;line-height:1.45}
      .push-card-btn{flex:none;border:1px solid var(--accent);color:var(--accent);background:transparent;
        border-radius:24px;padding:8px 18px;font:inherit;font-size:.9rem;cursor:pointer;transition:opacity .15s}
      .push-card-btn:hover{opacity:.8}
      .push-card-btn[disabled]{opacity:.5;cursor:default}
      .push-card-btn.on{border-style:dashed;color:var(--text-muted);border-color:var(--border)}
      .push-card-steps{margin:6px 0 0;padding-left:18px;color:var(--text-muted);font-size:.86rem;line-height:1.6}
    `;
    document.head.appendChild(s);
  }

  async function _registration() {
    return navigator.serviceWorker.register('sw.js');
  }

  async function _currentSub() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? await reg.pushManager.getSubscription() : null;
    } catch (_) { return null; }
  }

  async function _saveSub(sub) {
    const supa = _supa();
    if (!supa) throw new Error('sem conexão com o servidor');
    const j = sub.toJSON();
    const row = {
      endpoint: sub.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      ua: navigator.userAgent.slice(0, 200),
    };
    let { error } = await supa.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) {
      // endpoint pode ter pertencido a OUTRO usuário neste aparelho:
      // gera uma inscrição nova (unsubscribe → subscribe) e regrava
      await sub.unsubscribe().catch(() => {});
      const reg = await _registration();
      const fresh = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const fj = fresh.toJSON();
      ({ error } = await supa.from('push_subscriptions').upsert({
        endpoint: fresh.endpoint, p256dh: fj.keys.p256dh, auth: fj.keys.auth, ua: row.ua,
      }, { onConflict: 'endpoint' }));
      if (error) throw new Error(error.message);
    }
  }

  async function _enable() {
    const reg = await _registration();
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await _saveSub(sub);
    return 'on';
  }

  async function _disable() {
    const sub = await _currentSub();
    if (sub) {
      const supa = _supa();
      if (supa) await supa.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe().catch(() => {});
    }
  }

  function _render(card, state) {
    const T = {
      off: {
        icon: '🔔',
        title: 'Avisos de recomendação',
        desc: 'Receba uma notificação neste aparelho quando um novo Ensinamento for recomendado pra você — mesmo com o site fechado.',
        btn: '🔔 Ativar avisos',
      },
      on: {
        icon: '✅',
        title: 'Avisos ativados neste aparelho',
        desc: 'Você será avisado quando receber uma nova recomendação de estudo.',
        btn: 'Desativar',
      },
      denied: {
        icon: '🔕',
        title: 'Avisos bloqueados pelo navegador',
        desc: 'Para ativar, libere as notificações deste site nas configurações do navegador (cadeado ao lado do endereço) e recarregue a página.',
        btn: null,
      },
      ios: {
        icon: '📲',
        title: 'Para receber avisos no iPhone/iPad',
        desc: 'O aviso só funciona com o site instalado como aplicativo:',
        steps: ['Toque em <b>Compartilhar</b> (□↑) no Safari', 'Escolha <b>Adicionar à Tela de Início</b>', 'Abra o site pelo novo ícone e volte aqui pra ativar'],
        btn: null,
      },
      busy: { icon: '⏳', title: 'Um instante…', desc: '', btn: null },
      error: {
        icon: '⚠️',
        title: 'Não deu pra ativar os avisos',
        desc: 'Tente de novo; se persistir, avise o administrador.',
        btn: '🔔 Tentar de novo',
      },
    }[state];
    card.innerHTML = `
      <span class="push-card-icon">${T.icon}</span>
      <span class="push-card-text">
        <p class="push-card-title">${T.title}</p>
        <p class="push-card-desc">${T.desc}</p>
        ${T.steps ? `<ol class="push-card-steps">${T.steps.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}
      </span>
      ${T.btn ? `<button class="push-card-btn ${state === 'on' ? 'on' : ''}" type="button">${T.btn}</button>` : ''}`;
    const btn = card.querySelector('.push-card-btn');
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (state === 'on') { await _disable(); _render(card, 'off'); }
        else {
          _render(card, 'busy');
          const r = await _enable();
          _render(card, r === 'denied' ? 'denied' : 'on');
        }
      } catch (e) {
        console.error('push enable:', e);
        _render(card, 'error');
      }
    };
  }

  async function _initialState() {
    if (!supported) return (isIOS && !isStandalone) ? 'ios' : null;
    if (Notification.permission === 'denied') return 'denied';
    const sub = await _currentSub();
    if (!sub) return 'off';
    // tem inscrição no navegador — confere se está gravada pra ESTE usuário
    try {
      const supa = _supa();
      const { data } = await supa.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
      return data ? 'on' : 'off';
    } catch (_) { return 'on'; }
  }

  async function init() {
    const anchor = document.querySelector('.rec-header');
    if (!anchor) return;                          // só na Central de Recomendações
    if (!supported && !(isIOS && !isStandalone)) return;   // navegador sem suporte e sem dica útil
    _ensureStyle();
    const card = document.createElement('div');
    card.className = 'push-card';
    anchor.insertAdjacentElement('afterend', card);
    _render(card, 'busy');
    const st = await _initialState();
    if (!st) { card.remove(); return; }
    _render(card, st);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
