// ============================================================
// chart-theme.js — defaults do Chart.js a partir dos tokens do tema
// ============================================================
// O Chart.js não lê CSS: textos de eixo/legenda e linhas de grade são
// definidos na criação do gráfico. Sem isto, no modo noturno os eixos
// ficavam cinza-escuro sobre fundo escuro. Importado uma vez por admin.js;
// os gráficos são criados depois (nas abas), já herdando os defaults.
//
// O toggle de modo NÃO recarrega a página (o gate de PIN é por load — um
// reload deslogava o admin): toggleAdminMode chama window._applyChartTheme
// e re-renderiza a aba ativa, que recria os gráficos com os defaults novos.
import Chart from 'chart.js/auto';

function applyChartTheme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
  Chart.defaults.color = token('--text-muted', '#6B6964');
  Chart.defaults.borderColor = token('--border', 'rgba(0,0,0,0.1)');
}

applyChartTheme();
window._applyChartTheme = applyChartTheme;
