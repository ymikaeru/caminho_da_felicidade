const fs = require('fs');
const path = require('path');

const inputDir = 'C:\\Users\\ymika\\OneDrive\\Documentos\\Mioshie\\mioshie_college_offline\\SiteModerno\\site_data';
const outputDir = path.join(__dirname, '.claude', 'cleaned_jsons');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function processDirectory(dirPath, relativePath = '') {
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      const newRelativePath = path.join(relativePath, item);
      const outPath = path.join(outputDir, newRelativePath);
      if (!fs.existsSync(outPath)) fs.mkdirSync(outPath, { recursive: true });
      processDirectory(fullPath, newRelativePath);
    } else if (item.endsWith('.html.json')) {
      processFile(fullPath, relativePath, item);
    }
  }
}

function processFile(fullPath, relativePath, filename) {
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    
    // Novo formato minificado para a IA
    const cleaned = {
      file_path: `${relativePath}/${filename}`,
      topics: []
    };

    if (data.themes && data.themes[0] && data.themes[0].topics) {
      data.themes[0].topics.forEach((t, i) => {
        // Filtra apenas os campos essenciais para a revisão de tradução
        cleaned.topics.push({
          index: i,
          jp: {
            title: t.title || '',
            date: t.date || '',
            content: t.content || ''
          },
          ptbr: {
            title: t.title_ptbr || '',
            date: t.publication_title_ptbr || '',
            content: t.content_ptbr || ''
          }
        });
      });
    }

    if (cleaned.topics.length > 0) {
      const outPath = path.join(outputDir, relativePath, filename);
      fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 2));
      console.log(`✅ Processado: ${relativePath}/${filename} (${cleaned.topics.length} tópicos)`);
    }

  } catch (e) {
    console.error(`❌ Erro no arquivo ${filename}:`, e.message);
  }
}

console.log('Iniciando otimização dos JSONs para IA...');
processDirectory(inputDir);
console.log(`\n🎉 Concluído! Arquivos limpos salvos em: ${outputDir}`);
