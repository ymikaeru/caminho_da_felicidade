# Backup do banco Supabase

O plano free do Supabase **não inclui backup automático**. A salvaguarda
contra perda de dados é fazer dump local via `pg_dump`.

## Setup (uma única vez)

### 1. Instalar o cliente Postgres

O `pg_dump` vem junto:

```powershell
winget install PostgreSQL.PostgreSQL
```

Após instalar, **reinicia o terminal** e confirma:

```powershell
pg_dump --version
```

Deve mostrar algo tipo `pg_dump (PostgreSQL) 17.x`.

### 2. Pegar a connection string direta

No Supabase Dashboard:

1. Abre o projeto
2. Clica em **Connect** (topo da página)
3. Aba **Direct** (não pooler, que tem timeout curto)
4. Copia a URI no formato:
   ```
   postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-[region].compute.amazonaws.com:5432/postgres
   ```
5. Troca `[YOUR-PASSWORD]` pela senha real do banco
   - Se não souber a senha, reseta em **Settings → Database → Database password**
   - Anota a nova senha em local seguro (Supabase só mostra UMA vez)

### 3. Adicionar no `.env.local`

Adiciona uma linha nova em `.env.local` (na raiz do projeto):

```env
SUPABASE_DB_URL=postgresql://postgres.[ref]:senha-real@aws-0-[region].compute.amazonaws.com:5432/postgres
```

O arquivo `.env.local` já está no `.gitignore` — não vai pro git.

## Fazer um backup

```powershell
.\scripts\backup-db.ps1
```

Gera arquivo `backups/backup-YYYY-MM-DD-HHmm.sql.zip` com schema + dados
do banco inteiro.

Tamanho esperado: ~30-60 MB comprimido (de ~200-300 MB de SQL).

## Restaurar um backup

### Para um banco vazio (novo)

```powershell
# 1. Descomprime
Expand-Archive backups/backup-2026-05-20-1430.sql.zip -DestinationPath backups/

# 2. Restaura no banco destino
psql "postgresql://..." -f backups/backup-2026-05-20-1430.sql
```

### Para reset total do banco existente (CUIDADO — apaga tudo!)

```powershell
psql "postgresql://..." -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "postgresql://..." -f backups/backup-2026-05-20-1430.sql
```

Em caso de desastre real, contate o suporte do Supabase também — eles podem
ter snapshot interno mesmo no free.

## Boas práticas

- **Roda ANTES de migrations grandes** (ALTER TABLE, DROP, alterações de schema)
- **1x por semana** para snapshot regular
- **Antes de testar coisas arriscadas** (ex: limpeza de dados, mudanças em RLS)
- **Copia o `.zip` pra fora do PC** periodicamente:
  - HD externo / pendrive
  - Google Drive / Dropbox / OneDrive **privado** (seu, não público)
- **Nunca commita backup no git** — `.gitignore` já protege, mas double-check

## Agendar automaticamente (opcional)

Windows Task Scheduler:

1. Abre "Agendador de Tarefas"
2. Criar Tarefa Básica → "Backup Supabase Semanal"
3. Trigger: semanal, domingo às 03:00
4. Ação: Iniciar programa
   - Programa: `powershell.exe`
   - Argumentos: `-ExecutionPolicy Bypass -File "C:\Mioshie_Sites\caminho_da_felicidade\scripts\backup-db.ps1"`
5. Salvar

Vai rodar sozinho. Lembra de eventualmente limpar backups antigos da pasta
`backups/` (ou criar um job de retenção que mantém só os últimos N).

## O que está em cada lugar

| Coisa | Onde está | Como recuperar se sumir |
|---|---|---|
| Schema (CREATE TABLE, RPCs, índices) | git (`supabase/migrations/`) | Reaplicar migrations |
| Dados do banco (usuários, grifos, favoritos, logs) | Só Supabase | **pg_dump (este script)** |
| Conteúdo dos ensinamentos (JSONs) | Supabase Storage | `npm run storage:pull` espelha local |
| Código do site (HTML, JS, CSS) | git | git clone |
