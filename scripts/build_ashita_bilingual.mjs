// Constrói data/books/ashita-no-ijitsu.bilingual.json
// Espelha a árvore do PT e adiciona title_ja a cada nó, extraído do MD japonês
// (de-espaçando o OCR e removendo o prefixo de numeração). Títulos perdidos no
// OCR ficam marcados {ja_missing:true} — nada é inventado.
import fs from 'fs';

const MD = 'data/books/Asu_No_Ijutsu_Wo_Ikiru.md';
const PT = 'data/books/ashita-no-ijitsu.json';
const OUT = process.env.OUT || 'data/books/ashita-no-ijitsu.bilingual.json';

const CJK = /[　-〿぀-ヿ㐀-鿿豈-﫿＀-￯‐-―]/;
function despace(s){
  let out='';
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c===' '){const p=out[out.length-1],n=s[i+1];if(p&&n&&CJK.test(p)&&CJK.test(n))continue;}
    out+=c;
  }
  return out.replace(/\s*[•·]\s*/g,'・').replace(/\s{2,}/g,' ').trim();
}

// remove prefixo de enumeração/marcador de OCR de títulos L2/L3
function stripEnum(s){
  let t = s.replace(/^#+\s*/,'').replace(/\*\*/g,'').trim();
  // repete: marcadores tipo (3), 3), ③, dígitos iniciais, bullets mal-OCR'dos
  let prev;
  do{
    prev=t;
    t = t.replace(/^[（(]\s*[0-9０-９]{1,2}\s*[)）]\s*/,'');        // (3) / （3）
    t = t.replace(/^[0-9０-９]{1,2}\s*[)）]\s*/,'');                  // 3)
    t = t.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/,'');        // ③
    t = t.replace(/^[0-9０-９]{1,2}(?=[^0-9０-９])\s*/,'');           // 3 / 21 / 55 (bleed)
    t = t.replace(/^[山凵∞lI|｜・　│└∟日口ロ]\s*/,'');        // bullets mal-OCR'dos (①→山, ⑧→∞, ⑪→日 etc.)
  } while(t!==prev);
  return t.trim();
}

// Títulos preenchidos MANUALMENTE pelo usuário (perdidos no OCR — cabeçalho comido na
// quebra de página, corpo presente). Reconstruídos a partir do contexto, não do OCR.
const MANUAL = {
  '2.4.6': '救世主のご神格ー『私はミロク』',
  '2.5.5': '最大の尊敬者に最大の言葉',
  '2.7.2': '碧雲荘でのご面会ー『メシヤが生まれた』',
};

// path -> linha-fonte no MD (1-based). null = perdido no OCR (ver MANUAL).
const MAP = {
  '1':1,
  '2':463,
  '2.1':21,'2.1.1':23,'2.1.2':37,'2.1.3':47,'2.1.4':69,
  '2.2':86,'2.2.1':88,'2.2.2':113,'2.2.3':136,'2.2.4':145,
  '2.3':161,'2.3.1':163,'2.3.2':200,'2.3.3':211,'2.3.4':222,'2.3.5':236,
  '2.3.6':270,'2.3.7':306,'2.3.8':319,'2.3.9':326,'2.3.10':393,'2.3.11':410,
  '2.4':464,'2.4.1':465,'2.4.2':623,'2.4.3':630,'2.4.4':649,'2.4.5':675,'2.4.6':null,
  '2.5':737,'2.5.1':738,'2.5.2':753,'2.5.3':796,'2.5.4':814,'2.5.5':null,'2.5.6':850,
  '2.5.7':879,'2.5.8':1018,'2.5.9':1062,'2.5.10':1088,'2.5.11':1174,'2.5.12':1193,'2.5.13':1242,
  '2.6':1279,'2.6.1':1281,'2.6.2':1306,'2.6.3':1365,
  '2.7':1407,'2.7.1':1408,'2.7.2':null,'2.7.3':1453,'2.7.4':1486,
  '2.8':1507,'2.8.1':1508,'2.8.2':1559,'2.8.3':1576,'2.8.4':1677,'2.8.5':1757,
  '2.8.6':1821,'2.8.7':1854,'2.8.8':1905,'2.8.9':1944,
  '3':2046,
  '3.1':2073,'3.1.1':2074,'3.1.2':2123,'3.1.3':2221,
  '3.2':2257,'3.2.1':2258,'3.2.2':2271,'3.2.3':2439,'3.2.4':2499,'3.2.5':2589,
  '3.2.6':2644,'3.2.7':2714,'3.2.8':2741,'3.2.9':2783,'3.2.10':2810,
  '3.3':2827,'3.3.1':2829,'3.3.2':2845,'3.3.3':2862,
  '3.4':2960,'3.4.1':2961,'3.4.2':3003,'3.4.3':3067,'3.4.4':3152,'3.4.5':3179,
  '3.5':3228,'3.5.1':3229,'3.5.2':3325,'3.5.3':3348,'3.5.4':3385,'3.5.5':3421,'3.5.6':3480,
  '3.6':3525,'3.6.1':3526,'3.6.2':3592,'3.6.3':3625,'3.6.4':3647,'3.6.5':3680,
  '3.6.6':3730,'3.6.7':3783,'3.6.8':3843,'3.6.9':3870,'3.6.10':3914,'3.6.11':3943,
  '3.6.12':3976,'3.6.13':4004,'3.6.14':4035,'3.6.15':4109,'3.6.16':4147,'3.6.17':4250,'3.6.18':4274,
  '3.7':4351,'3.7.1':4352,'3.7.2':4390,'3.7.3':4479,'3.7.4':4674,'3.7.5':4700,
  '3.7.6':4775,'3.7.7':4816,'3.7.8':4856,'3.7.9':4873,'3.7.10':4949,'3.7.11':4980,
  '3.7.12':4997,'3.7.13':5019,
  '4':5066,
  '4.1':5085,'4.2':5193,'4.3':5301,'4.4':5347,'4.5':5419,'4.6':5509,'4.7':5616,'4.8':5712,
};

// Títulos cujo INTERIOR tem OCR corrompido (caractere errado/perdido) — sinalizados
// p/ revisão manual contra o livro físico. NÃO corrigidos (seria back-translation, recusada).
const SUSPECT = {
  '2.3':   'truncado no OCR; provável "大先生を奉仕する/奉じて"',
  '2.4.5': '「上げあげる」 provável OCR de 「上げてやる」',
  '2.7':   '「メシャ」 provável OCR de 「メシヤ」',
  '3.2':   '「滟刘力」 provável OCR de 「神力」',
  '3.2.2': '「｜」 provável OCR do travessão 「ー」',
  '3.7.7': 'caractere 「偽」 perdido: provável 「人の眼は偽り得ても神の眼は偽り得ない」',
};

const lines = fs.readFileSync(MD,'utf8').split(/\r?\n/);
const pt = JSON.parse(fs.readFileSync(PT,'utf8'));

let stats={ok:0,missing:0,unmapped:0};
function titleFor(path, level){
  if(MANUAL[path]){ stats.ok++; return {title_ja:MANUAL[path], ja_reconstructed:true, ja_note:'preenchido manualmente — perdido no OCR (corpo presente)'}; }
  if(!(path in MAP)){ stats.unmapped++; return {ja_missing:true, ja_note:'sem mapeamento'}; }
  const ln = MAP[path];
  if(ln===null){ stats.missing++; return {title_ja:'', ja_missing:true, ja_note:'título perdido no OCR (corpo presente)'}; }
  const raw = despace(lines[ln-1]||'');
  const title_ja = (level===1) ? raw.replace(/\*\*/g,'').replace(/^#+\s*/,'').trim() : stripEnum(raw);
  stats.ok++;
  return { title_ja, title_ja_raw: raw, ja_src_line: ln };
}

function walk(arr, prefix){
  return arr.map((n,i)=>{
    const path = prefix ? prefix+'.'+(i+1) : String(i+1);
    const t = titleFor(path, n.level);
    const node = { id:n.id, title:n.title, level:n.level };
    Object.assign(node, t);
    if(SUSPECT[path]){ node.ja_ocr_suspect = true; node.ja_note = SUSPECT[path]; }
    if(n.content) node.content = n.content;
    node.children = (n.children&&n.children.length) ? walk(n.children, path) : [];
    return node;
  });
}

const out = {
  id: pt.id,
  title: pt.title,
  title_ja: '明日の医術を生きる',
  source_ja: 'data/books/Asu_No_Ijutsu_Wo_Ikiru.md',
  note: 'Títulos JA sincronizados ao PT por posição hierárquica. title_ja_raw = linha-fonte de-espaçada; title_ja = sem prefixo de numeração. ja_missing=título não recuperável no OCR (nada inventado). ja_ocr_suspect=título recuperado mas com OCR corrompido no interior (ver ja_note; revisar contra o livro físico).',
  ja_missing_paths: [],
  ja_reconstructed_paths: Object.keys(MANUAL),
  ja_ocr_suspect_paths: Object.keys({'2.3':1,'2.4.5':1,'2.7':1,'3.2':1,'3.2.2':1,'3.7.7':1}),
  sections: walk(pt.sections,'')
};

fs.writeFileSync(OUT, JSON.stringify(out,null,2),'utf8');
console.log('Escrito:', OUT);
console.log('Recuperados:', stats.ok, '| Perdidos(OCR):', stats.missing, '| Sem mapa:', stats.unmapped);
