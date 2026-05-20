# Backup do banco Supabase via pg_dump.
# Pré-requisitos: pg_dump instalado + SUPABASE_DB_URL em .env.local.
# Detalhes: scripts/BACKUP.md

$ErrorActionPreference = 'Stop'

# 1) Lê SUPABASE_DB_URL do .env.local
# Nota: Join-Path com 3 args só existe no PS 7+. Pra compatibilidade
# com Windows PowerShell 5.1, encadeamos duas chamadas.
$envFile = Join-Path (Join-Path $PSScriptRoot '..') '.env.local'
if (-not (Test-Path $envFile)) {
    Write-Host "ERRO: .env.local nao encontrado." -ForegroundColor Red
    Write-Host "Adicione a linha SUPABASE_DB_URL=postgresql://... no arquivo .env.local"
    Write-Host "(veja scripts/BACKUP.md para detalhes)"
    exit 1
}

$dbUrl = $null
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*SUPABASE_DB_URL\s*=\s*(.+?)\s*$') {
        $dbUrl = $matches[1].Trim('"').Trim("'")
    }
}

if (-not $dbUrl) {
    Write-Host "ERRO: SUPABASE_DB_URL nao definido em .env.local" -ForegroundColor Red
    Write-Host "Veja scripts/BACKUP.md para como pegar a connection string."
    exit 1
}

# 2) Verifica pg_dump disponivel
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    Write-Host "ERRO: pg_dump nao encontrado no PATH." -ForegroundColor Red
    Write-Host "Instale o cliente Postgres: winget install PostgreSQL.PostgreSQL"
    Write-Host "Apos instalar, talvez precise reiniciar o terminal."
    exit 1
}

# 3) Garante pasta backups/
$backupDir = Join-Path (Join-Path $PSScriptRoot '..') 'backups'
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    Write-Host "Pasta criada: $backupDir"
}

# 4) Roda pg_dump
$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$sqlFile = Join-Path $backupDir "backup-$timestamp.sql"

Write-Host "Conectando e fazendo dump..." -ForegroundColor Cyan
$start = Get-Date

# Usar --dbname= explícito evita PowerShell parsear o URI como múltiplos
# argumentos (os ':' e '@' da connection string podem ser interpretados
# como separadores em algumas versões do PowerShell).
& pg_dump "--dbname=$dbUrl" `
    --no-owner `
    --no-acl `
    --no-comments `
    --quote-all-identifiers `
    -f $sqlFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: pg_dump falhou (exit code $LASTEXITCODE)" -ForegroundColor Red
    if (Test-Path $sqlFile) { Remove-Item $sqlFile }
    exit 1
}

$dumpDuration = (Get-Date) - $start
$sqlSize = (Get-Item $sqlFile).Length / 1MB
Write-Host ("Dump concluido em {0:N1}s ({1:N2} MB)" -f $dumpDuration.TotalSeconds, $sqlSize) -ForegroundColor Green

# 5) Comprime (zip — comprime ~5x texto SQL)
Write-Host "Comprimindo..." -ForegroundColor Cyan
$zipFile = "$sqlFile.zip"
Compress-Archive -Path $sqlFile -DestinationPath $zipFile -CompressionLevel Optimal -Force
Remove-Item $sqlFile

$zipSize = (Get-Item $zipFile).Length / 1MB
Write-Host ("Backup pronto: {0}" -f $zipFile) -ForegroundColor Green
Write-Host ("Tamanho: {0:N2} MB comprimido" -f $zipSize) -ForegroundColor Green
Write-Host ""
Write-Host "Lembrete: copie para HD externo ou nuvem privada (NAO commitar no git!)"
