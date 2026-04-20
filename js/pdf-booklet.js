// ============================================================
// PDF Booklet Generator — Mioshie College
// Client-side PDF generation using jsPDF
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';
const BUCKET = 'teachings';

let jsPDF;

async function loadJsPDF() {
  if (jsPDF) return jsPDF;
  const mod = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
  jsPDF = mod.jsPDF;
  return jsPDF;
}

async function fetchTeaching(vol, file) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${vol}/${file}`);

  if (error) throw new Error(`Failed to fetch ${vol}/${file}: ${error.message}`);
  return JSON.parse(await data.text());
}

function stripHTML(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

export async function generateBooklet(teachings, title = 'Apostila Mioshie College') {
  const PDFLib = await loadJsPDF();
  const doc = new PDFLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = 6;
  const fontSize = 10;
  const titleSize = 14;
  const sectionSize = 12;

  let y = 0;

  function addPage() {
    doc.addPage();
    y = pageHeight - margin;
  }

  function checkSpace(needed) {
    if (y - needed < margin) {
      addPage();
    }
  }

  function drawText(text, x, yPos, size, opts = {}) {
    doc.setFontSize(size);
    doc.setFont(opts.bold ? 'helvetica' : 'helvetica', opts.bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      checkSpace(lineHeight);
      doc.text(line, x, y);
      y -= lineHeight;
    }
    return y;
  }

  // Cover page
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(title, contentWidth);
  let titleY = pageHeight / 2 - titleLines.length * 8;
  for (const line of titleLines) {
    doc.text(line, margin, titleY);
    titleY += 10;
  }

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`${teachings.length} ensinamento(s)`, margin, titleY + 15);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`, margin, titleY + 22);
  doc.setTextColor(0, 0, 0);

  // Table of contents
  addPage();
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Índice', margin, y);
  y -= 12;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  for (const t of teachings) {
    checkSpace(10);
    const teachingTitle = t.json.title || t.file.replace('.html.json', '');
    doc.text(`• ${teachingTitle}`, margin, y);
    y -= 8;
  }

  // Content
  for (const t of teachings) {
    addPage();

    const teachingTitle = t.json.title || t.file.replace('.html.json', '');
    doc.setFontSize(titleSize);
    doc.setFont('helvetica', 'bold');
    doc.text(teachingTitle, margin, y);
    y -= 10;

    // Separator line
    doc.setDrawColor(180, 180, 180);
    doc.line(margin, y, pageWidth - margin, y);
    y -= 8;

    const topics = t.json.topics || [];
    for (const topic of topics) {
      checkSpace(15);

      const topicTitle = topic.title_ptbr || topic.title_pt || topic.title || topic.title_ja || '';
      if (topicTitle) {
        const cleanTitle = stripHTML(topicTitle);
        doc.setFontSize(sectionSize);
        doc.setFont('helvetica', 'bold');
        doc.text(cleanTitle, margin, y);
        y -= 8;
      }

      const content = topic.content_ptbr || topic.content_pt || topic.content || topic.content_ja || '';
      const plainText = stripHTML(content);

      doc.setFontSize(fontSize);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(plainText, contentWidth);
      for (const line of lines) {
        checkSpace(lineHeight);
        doc.text(line, margin, y);
        y -= lineHeight;
      }
      y -= 4;
    }
  }

  // Save
  doc.save(`${title.replace(/[^a-zA-Z0-9À-ú\s]/g, '').substring(0, 50)}.pdf`);
}

export async function generateFromSelection(volume, files, title) {
  const teachings = [];
  for (const file of files) {
    try {
      const json = await fetchTeaching(volume, file);
      teachings.push({ volume, file, json });
    } catch (e) {
      console.warn(`Skipping ${file}:`, e);
    }
  }
  if (teachings.length === 0) {
    alert('Nenhum ensinamento válido selecionado.');
    return;
  }
  await generateBooklet(teachings, title);
}

export async function generateFromCurrentVolume(volume, title) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { alert('Faça login primeiro.'); return; }

  const { data } = await supabase.storage.from(BUCKET).list(`${volume}/`);
  if (!data || data.length === 0) { alert('Nenhum arquivo encontrado.'); return; }

  const files = data.map(f => f.name).filter(n => n.endsWith('.json'));
  await generateFromSelection(volume, files, title || `Volume ${volume.slice(-1)}`);
}
