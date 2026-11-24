param([switch]$Unattended)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if (Test-Path -LiteralPath (Join-Path $root 'data')) { throw '目标 data 已存在，禁止覆盖。请使用全新解压目录。' }
if ($Unattended) {
    $backup = $env:SD_RESTORE_BACKUP_DIR
    if (!$backup) { throw '自动恢复需要显式指定备份目录。' }
} else {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择包含 schema113.sqlite 与附件 objects 的完整备份目录'
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
    $backup = $picker.SelectedPath
}
& (Join-Path $root 'runtime/node.exe') 'scripts/restore.mjs' $backup (Join-Path $root 'data')
if ($LASTEXITCODE -ne 0) { throw '恢复未通过，请检查备份。' }
Write-Host '数据已恢复，沿用原有账号密码。无需初始化管理员。'
