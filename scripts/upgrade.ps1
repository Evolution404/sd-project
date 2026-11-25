param([switch]$Unattended)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
Write-Host '输电项目全流程管理：一键升级（保留旧程序和数据）'
Write-Host '请先通知用户结束业务操作并关闭训练实例。由本包启动的受管旧服务将等待已开始的请求完成后关闭。'
if ($Unattended) {
    $old = $env:SD_UPGRADE_SOURCE_DIR
    $port = $env:PORT
    if (!$old -or !$port) { throw '自动升级需要显式指定旧程序目录和端口。' }
} else {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '请选择旧版本完整解压目录（包含 data、runtime、BUILD-MANIFEST.json）'
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
    $old = $picker.SelectedPath
    $port = Read-Host '旧服务端口（默认8787）'
}
if ([string]::IsNullOrWhiteSpace($port)) { $port = '8787' }
& (Join-Path $root 'runtime/node.exe') 'scripts/upgrade.mjs' $old $port
if ($LASTEXITCODE -ne 0) { throw '升级未通过，原版本保留。' }
Write-Host '数据已验证恢复至新版本，旧目录保持完整。'
if ($Unattended) { return }
$choice = Read-Host '现在启动新版本（Y/n）'
if ($choice -notmatch '^[nN]$') {
    $env:PORT = $port
    & (Join-Path $root '启动服务.cmd')
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
}
