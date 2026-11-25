# Encoding: UTF-8 with BOM for Windows PowerShell 5.1.
param([switch]$Unattended)
$ErrorActionPreference = 'Stop'
$node = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\node.exe'
$root = Split-Path -Parent $PSScriptRoot
$target = $env:SD_NEW_DATA_DIR
if (!$target -and !$Unattended) { $target = Read-Host '输入新空数据集的绝对目录（必须不存在）' }
if (!$target -or ![System.IO.Path]::IsPathRooted($target)) { throw '必须指定独立数据目录的绝对路径。' }
$target = [System.IO.Path]::GetFullPath($target)
if ($target -eq $root -or $target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw '数据目录不得位于程序目录内。' }
if (Test-Path -LiteralPath $target) { throw '目标数据目录已存在，禁止覆盖。' }
$env:DATA_DIR = $target
if (!(Test-Path -LiteralPath $node)) { throw '找不到内置 Node.js，请检查 ZIP 是否完整解压。' }
Set-Location -LiteralPath $root
if ($Unattended) {
    if (!$env:SD_ADMIN_USER -or !$env:SD_ADMIN_PASSWORD) { throw '自动初始化需要显式提供管理员账号和密码。' }
    & $node 'scripts\init-admin.mjs'
    exit $LASTEXITCODE
}
Write-Host '输电项目全流程管理 - 创建独立空数据集'
Write-Host '仅创建新的空数据集，不覆盖或修改既有数据，不提供默认密码。'
$username = Read-Host '请输入管理员用户名（字母、数字，默认 admin）'
if ([string]::IsNullOrWhiteSpace($username)) { $username = 'admin' }
$secure = Read-Host '请输入管理员密码' -AsSecureString
$confirm = Read-Host '请再次输入管理员密码' -AsSecureString
$ptr = [IntPtr]::Zero
$confirmPtr = [IntPtr]::Zero
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $confirmPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $verify = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPtr)
    if ($plain -cne $verify) { throw '两次密码不一致。' }
    $env:SD_ADMIN_USER = $username
    $env:SD_ADMIN_PASSWORD = $plain
    & $node 'scripts\init-admin.mjs'
    if ($LASTEXITCODE -ne 0) { throw '管理员创建失败，请阅读上方错误信息。' }
}
finally {
    Remove-Item Env:\SD_ADMIN_USER -ErrorAction SilentlyContinue
    Remove-Item Env:\DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\SD_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($confirmPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPtr) }
}
