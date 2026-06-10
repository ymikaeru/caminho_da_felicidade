// ============================================================
// chart-theme.js — defaults do Chart.js a partir dos tokens do tema
// ============================================================
// O Chart.js não lê CSS: textos de eixo/legenda e linhas de grade são
// definidos na criação do gráfico. Sem isto, no modo noturno os eixos
// ficavam cinza-escuro sobre fundo escuro. Importado uma vez por admin.js;
// os gráficos são criados depois (nas abas), já herdando os defaults.
// Trocar de modo recarrega a página (toggleAdminMode), então não precisa
// re-temar gráficos vivos.
import Chart from 'chart.js/auto';

const css = getComputedStyle(document.documentElement);
const token = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;

Chart.defaults.color = token('--text-muted', '#6B6964');
Chart.defaults.borderColor = token('--border', 'rgba(0,0,0,0.1)');
