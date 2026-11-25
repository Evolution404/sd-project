param([ValidateSet("Start","Select","Backup","Stop")][string]$Action,[switch]$Unattended)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$node = Join-Path $root 'runtime/node.exe'
$config = Join-Path $root 'data-location.json'
if (!(Test-Path -LiteralPath $node)) { throw '请完整解压程序包。' }
$selected = $env:DATA_DIR
$explicit = ![string]::IsNullOrWhiteSpace($selected)
if (!$explicit -and (Test-Path -LiteralPath $config)) {
    $selected = (Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json).data_dir
}
if (!$explicit -and ($Action -eq 'Select' -or [string]::IsNullOrWhiteSpace($selected))) {
    if ($Unattended) { throw '必须显式指定 DATA_DIR 或已保存的数据目录。' }
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择独立数据目录（包含 schema113.sqlite），不会创建空库'
    $picker.ShowNewFolderButton = $false
    if ($selected -and (Test-Path -LiteralPath $selected -PathType Container)) { $picker.SelectedPath = $selected }
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
    $selected = $picker.SelectedPath
}
if (![System.IO.Path]::IsPathRooted($selected)) { throw '必须指定绝对数据路径。' }
$env:DATA_DIR = $selected
if ($Action -eq 'Stop') {
    & $node 'scripts/dataset.mjs' stop
    exit $LASTEXITCODE
}
& $node 'scripts/dataset.mjs' validate
if ($LASTEXITCODE -ne 0) { throw '数据目录校验失败。可运行「选择数据目录.cmd」重新选择。' }
if (!$explicit -or $Action -eq 'Select') {
    $json = @{data_dir=$selected} | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($config,$json,[System.Text.UTF8Encoding]::new($false))
}
if ($Action -eq 'Select') { Write-Host "已选择数据目录：$selected"; exit 0 }
if ($Action -eq 'Backup') {
    & $node 'scripts/backup.mjs'
    exit $LASTEXITCODE
}
$env:SD_MANAGED_SHUTDOWN = '1'
if (!$env:HOST) { $env:HOST = '0.0.0.0' }
if (!$env:PORT) { $env:PORT = '8787' }
Write-Host "数据目录：$selected"
Write-Host "本机访问：http://127.0.0.1:$env:PORT"
& $node 'dist/server/main.js'
$code = $LASTEXITCODE
Write-Host "Server stopped. Exit code: $code"
exit $code
