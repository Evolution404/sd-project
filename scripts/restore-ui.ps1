param([switch]$Unattended)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if ($Unattended) {
    $backup = $env:SD_RESTORE_BACKUP_DIR
    $target = $env:SD_RESTORE_TARGET_DIR
    if (!$backup -or !$target) { throw '自动恢复需要显式指定备份和独立目标目录。' }
} else {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择包含 schema113.sqlite 与附件 objects 的完整备份目录'
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
    $backup = $picker.SelectedPath
    $target = Read-Host '输入新数据目录的绝对路径（该目录必须不存在）'
}
if (!$target -or ![System.IO.Path]::IsPathRooted($target)) { throw '必须指定独立目标数据目录的绝对路径。' }
$target = [System.IO.Path]::GetFullPath($target)
if ($target -eq $root -or $target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw '数据目录不得位于程序目录内。' }
& (Join-Path $root 'runtime/node.exe') 'scripts/restore.mjs' $backup $target
if ($LASTEXITCODE -ne 0) { throw '恢复未通过，请检查备份。' }
Write-Host '数据已恢复。启动程序时选择该独立数据目录，沿用原有账号密码。'
