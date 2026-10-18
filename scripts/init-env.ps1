$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    Write-Output '.env already exists; keeping your configuration.'
    exit 0
}
function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$content = [IO.File]::ReadAllText((Join-Path $repoRoot '.env.example'))
$content = $content.Replace('replace-with-random-password', (New-Secret))
$content = $content.Replace('replace-with-another-random-password', (New-Secret))
$content = $content.Replace('replace-with-at-least-32-random-characters', (New-Secret))
[IO.File]::WriteAllText($envPath, $content, (New-Object Text.UTF8Encoding($false)))
Write-Output 'Created .env with random local secrets. Do not commit this file.'
