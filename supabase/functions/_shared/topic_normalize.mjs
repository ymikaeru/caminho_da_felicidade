// ============================================================
// Topic normalization — shared by seeder (Node) and webhook (Deno).
// ============================================================
// Replica EXATAMENTE a lógica de admin-supabase.html ~5541-5605
// (a antiga `rebuildSearchIndex`). Manter em sincronia: divergência
// entre este módulo e o admin-side é a causa raiz mais comum de drift.
//
// É plano JS (.mjs) sem deps para que tanto Node quanto Deno
// possam importar com `import {...} from './topic_normalize.mjs'`.
// ============================================================

const QUOTED_RE = /[“”""「]([^“”""」]{5,150})[“”""」]/;
const BOLD_RE = /<(?:b|strong)(?:\s[^>]*)?>(?:<font[^>]*)?>?([\s\S]+?)<\/(?:b|strong)>/i;

export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveTitle(topic) {
  const br = (topic.topic_title_br || '').trim();
  if (br) return br;
  const raw = (topic.title_ptbr || topic.title_pt || topic.title || '').trim();
  if (raw) {
    const mq = raw.match(QUOTED_RE);
    if (mq && mq[1].length < 150) return mq[1].trim();
  }
  const content = topic.content_ptbr || topic.content_pt || '';
  if (content) {
    const mb = content.slice(0, 400).match(BOLD_RE);
    if (mb) {
      const t = mb[1].replace(/<[^>]+>/g, '').trim();
      if (t && t.length > 3 && t.length < 150) return t;
    }
  }
  return raw;
}

// Resultado por topic indexável.
// Importante: topic_idx é flat sobre todos os themes[].topics[].
// Topics com content_pt vazio são pulados, MAS topic_idx ainda incrementa
// (preserva os links do reader.html?topic=N).
export function extractTopicsFromJson({ vol, file, json }) {
  const out = [];
  let topicIdx = 0;
  let topicsSeen = 0;
  let topicsSkipped = 0;

  if (!json || !Array.isArray(json.themes)) {
    return { rows: out, topicsSeen, topicsSkipped };
  }

  for (const theme of json.themes) {
    if (!Array.isArray(theme.topics)) continue;
    for (const topic of theme.topics) {
      topicsSeen++;
      const titlePt = resolveTitle(topic);
      const cleanPt = stripHtml(topic.content_ptbr || topic.content_pt || topic.content || '');

      if (!cleanPt) {
        topicIdx++;
        topicsSkipped++;
        continue;
      }

      const titleJaRaw = (topic.topic_title_ja || topic.title_ja || topic.title || '').trim();
      const titleJa = titleJaRaw && titleJaRaw !== titlePt ? titleJaRaw : null;

      const cleanJaRaw = stripHtml(topic.content_ja || topic.content || '');
      const contentJa = cleanJaRaw && cleanJaRaw !== cleanPt ? cleanJaRaw : null;

      out.push({
        vol,
        file,
        topic_idx: topicIdx,
        title_pt: titlePt || null,
        content_pt: cleanPt,
        title_ja: titleJa,
        content_ja: contentJa,
      });
      topicIdx++;
    }
  }

  return { rows: out, topicsSeen, topicsSkipped };
}
