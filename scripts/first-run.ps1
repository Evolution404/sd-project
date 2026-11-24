# Encoding: UTF-8 with BOM for Windows PowerShell 5.1.
param([switch]$Unattended)
$ErrorActionPreference = 'Stop'
$node = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\node.exe'
$root = Split-Path -Parent $PSScriptRoot
$env:DATA_DIR = Join-Path $root 'data'
if (!(Test-Path -LiteralPath $node)) { throw '找不到内置 Node.js，请检查 ZIP 是否完整解压。' }
Set-Location -LiteralPath $root
if ($Unattended) {
    if (!$env:SD_ADMIN_USER -or !$env:SD_ADMIN_PASSWORD) { throw '自动初始化需要显式提供管理员账号和密码。' }
    & $node 'scripts\init-admin.mjs'
    exit $LASTEXITCODE
}
Write-Host '输电项目全流程管理 - 首次管理员初始化'
Write-Host '仅允许首次创建账户，不提供默认密码。'
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
