# Mioshie College

Site estático para leitura e busca dos ensinamentos de Meishu-Sama, hospedado via GitHub Pages em:
`https://ymikaeru.github.io/mioshie_college/`

---

## Estrutura de diretórios

```
mioshie_college/
├── SiteModerno/              # Raiz do site publicado
│   ├── index.html            # Página principal (hub de volumes)
│   ├── reader.html           # Leitor de ensinamentos
│   ├── admin.html            # Painel de administração
│   ├── auth-config.json      # Hashes de senha para autenticação client-side
│   ├── css/
│   │   ├── styles.css        # Fonte; edite aqui
│   │   └── styles.min.css    # Gerado por `npm run build:css`
│   ├── js/
│   │   ├── init-theme.js     # Inicialização de tema/modo (carregado em todas as páginas)
│   │   ├── search.js         # Lógica de busca full-text
│   │   ├── reader*.js        # Renderização e conteúdo do leitor
│   │   ├── nav.js            # Navegação lateral
│   │   ├── theme.js          # Troca de tema/modo em runtime
│   │   ├── toggle.js         # Toggles de UI
│   │   ├── login.js          # Autenticação client-side
│   │   └── access.js         # Controle de acesso por perfil
│   ├── mioshiec1/ … mioshiec4/   # Páginas de índice por volume
│   │   └── index.html
│   ├── site_data/
│   │   ├── mioshiec{1-4}_nav.json        # Estrutura de navegação por volume
│   │   ├── search_index_mioshiec{1-4}.json  # Índices de busca por volume
│   │   ├── search_index.json             # Índice completo (gerado por split_search_index)
│   │   ├── section_map.js                # Mapa de seções para breadcrumbs de busca
│   │   └── global_index_titles.js        # Títulos de publicações para resultados de busca
│   └── scripts/
│       ├── split_search_index.js   # Divide search_index.json em arquivos por volume
│       └── minify_assets.py        # Minifica JS para *.min.js
├── docs/
│   └── melhorias_sugeridas.md  # Lista de melhorias e status de implementação
└── README.md                   # Este arquivo
```

---

## Build

### Pré-requisitos

```bash
cd SiteModerno
npm install
```

### CSS

```bash
npm run build:css   # Compila styles.css → styles.min.css (com PostCSS + cssnano)
npm run watch:css   # Mesmo, mas recompila ao salvar
```

### Dividir índice de busca

Rode este script sempre que `site_data/search_index.json` for atualizado:

```bash
npm run split:index
# Gera: search_index_mioshiec1.json … search_index_mioshiec4.json
```

### Minificar JS

```bash
cd SiteModerno
python scripts/minify_assets.py
# Gera *.min.js para cada js/*.js
```

### Servidor local (sem cache)

```bash
cd SiteModerno
python nocache_server.py   # Serve em http://localhost:8000
```

---

## Como adicionar conteúdo

### Novo ensinamento em um volume existente

1. Adicione o arquivo JSON do ensinamento em `site_data/mioshiec{N}/` seguindo o formato dos existentes.
2. Atualize `site_data/mioshiec{N}_nav.json` com a entrada do novo ensinamento.
3. Atualize `site_data/search_index.json` com as entradas de busca do novo ensinamento.
4. Rode `npm run split:index` para regenerar os índices por volume.
5. Atualize `site_data/global_index_titles.js` e `section_map.js` se necessário.

### Novo volume

1. Crie a pasta `mioshiec5/index.html` seguindo a estrutura dos volumes existentes.
2. Adicione `site_data/mioshiec5_nav.json`.
3. Inclua o novo volume nos índices de busca e em `access.js`.
4. Atualize `sitemap.xml` com a nova URL.

---

## Autenticação

A autenticação é **100% client-side**:

- `js/login.js` lê `auth-config.json` via `fetch()` e compara o hash SHA-256 da senha digitada.
- Após login, o perfil é armazenado em `localStorage` (`user_role`, `user_name`).
- `js/access.js` lê esse valor para controlar quais volumes/ensinamentos ficam visíveis.

**Limitação de segurança**: o `auth-config.json` é publicamente acessível, e os hashes podem ser revertidos com rainbow tables. Não armazene conteúdo sensível que não possa ser visto por qualquer visitante.

---

## Busca

- O índice é dividido em 4 arquivos por volume (`search_index_mioshiec{1-4}.json`) para carregamento paralelo.
- O volume atual da página é carregado primeiro; os demais são baixados em paralelo com `Promise.allSettled`.
- A busca roda na main thread. Suporta múltiplos termos com `&` (lógica AND), correspondência exata, e busca bilíngue PT/JA.
- Cada busca executada é registrada em `localStorage` (chave `mioshie_search_log`) com query, número de resultados, e timestamp. Máximo de 200 entradas.

Para inspecionar o log de buscas no DevTools:
```js
JSON.parse(localStorage.getItem('mioshie_search_log'))
```

---

## Deploy (GitHub Pages)

O site é servido diretamente da branch `main`. Qualquer push para `main` atualiza o site.

A raiz do repositório tem um `index.html` que redireciona para `SiteModerno/index.html` via meta refresh. O GitHub Pages usa esse redirect para servir o site na URL raiz.
