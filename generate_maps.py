import os
import re
import json

base_dir = os.path.dirname(os.path.abspath(__file__))
vols = ["mioshiec1", "mioshiec2", "mioshiec3", "mioshiec4"]

section_map = {}
global_titles = {}

for vol in vols:
    vol_path = os.path.join(base_dir, vol, "index.html")
    if not os.path.exists(vol_path): continue
    
    with open(vol_path, "r", encoding="utf-8") as f:
        html = f.read()
        
    section_map[vol] = {}
    
    parts = re.split(r'<h2\s+id="section-\d+".*?>', html)
    for i, part in enumerate(parts):
        if i == 0: continue
        
        m_pt = re.search(r'<span class="lang-pt">(.*?)</span>', part, re.DOTALL)
        m_ja = re.search(r'<span class="lang-ja"[^>]*>(.*?)</span>', part, re.DOTALL)

        sec_pt = re.sub(r'\s+', ' ', m_pt.group(1)).strip() if m_pt else ""
        sec_ja = re.sub(r'\s+', ' ', m_ja.group(1)).strip() if m_ja else ""

        cards = re.findall(r'<a.*?href=".*?(?:file=)([^"&]+)[^"]*".*?class="topic-card".*?>(.*?)</a>', part, re.DOTALL)
        for card_file, card_html in cards:
            title_pt = ""
            title_ja = ""
            cm_pt = re.search(r'<span class="lang-pt">(.*?)</span>', card_html, re.DOTALL)
            cm_ja = re.search(r'<span class="lang-ja"[^>]*>(.*?)</span>', card_html, re.DOTALL)
            if cm_pt: title_pt = re.sub(r'\s+', ' ', cm_pt.group(1)).strip()
            if cm_ja: title_ja = re.sub(r'\s+', ' ', cm_ja.group(1)).strip()
            
            section_map[vol][card_file] = {
                "section": sec_pt,
                "sectionJa": sec_ja,
                "pt": title_pt,
                "ja": title_ja
            }
            
            global_titles[f"{vol}/{card_file}"] = {
                "pt": title_pt,
                "ja": title_ja,
                "section": sec_pt,
                "sectionJa": sec_ja
            }

os.makedirs(os.path.join(base_dir, "site_data"), exist_ok=True)
with open(os.path.join(base_dir, "site_data", "section_map.js"), "w", encoding="utf-8") as f:
    f.write(f"window.SECTION_MAP = {json.dumps(section_map, ensure_ascii=False, separators=(',', ':'))};\n")
    
with open(os.path.join(base_dir, "site_data", "global_index_titles.js"), "w", encoding="utf-8") as f:
    f.write(f"window.GLOBAL_INDEX_TITLES = {json.dumps(global_titles, ensure_ascii=False, separators=(',', ':'))};\n")

print("Generated maps")
