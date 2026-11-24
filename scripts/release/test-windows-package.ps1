param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][string]$ExpectedCommit
)
$ErrorActionPreference = 'Stop'

function Assert-True($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Read-Manifest([string]$Path) {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Verify-Archive([string]$File, [string]$ReceiptName) {
    $receipt = Read-Manifest (Join-Path $PackageDirectory $ReceiptName)
    Assert-True ($receipt.git_commit -ceq $ExpectedCommit) 'Package commit differs from the checked-out commit.'
    Assert-True (!$receipt.worktree_dirty) 'Package was created from a dirty worktree.'
    Assert-True ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ieq $receipt.sha256) 'ZIP hash differs from the receipt.'
}

function Invoke-PackageCommand([string]$Root, [string]$Name, [bool]$Success) {
    & (Join-Path $Root $Name) --unattended
    Assert-True (($LASTEXITCODE -eq 0) -eq $Success) ('Unexpected CMD exit status for ' + $Name)
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port }
    finally { $listener.Stop() }
}

function Start-Package([string]$Root, [string]$Command, [int]$Port) {
    $env:PORT = [string]$Port
    $env:HOST = '127.0.0.1'
    $env:SD_TEST_LAUNCHER = Join-Path $Root $Command
    $stdout = Join-Path $Root 'acceptance.stdout'
    $stderr = Join-Path $Root 'acceptance.stderr'
    $script:server = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c call "%SD_TEST_LAUNCHER%" --unattended' -WorkingDirectory $Root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $base = 'http://127.0.0.1:' + $Port
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        if ($script:server.HasExited) { throw ('Shipped CMD exited before readiness. ' + (Get-Content -LiteralPath $stderr -Raw)) }
        try {
            $response = Invoke-WebRequest -Uri $base -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return $base }
        } catch {}
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Shipped CMD did not serve the application.'
}

function Stop-Package {
    if ($script:server -and !$script:server.HasExited) {
        # Only stop the command tree created by this test.
        & taskkill.exe /PID $script:server.Id /T /F | Out-Null
        Assert-True ($script:server.WaitForExit(10000)) 'The test server process did not exit.'
    }
    $script:server = $null
}

function Get-Session([string]$Base, [string]$Username, [string]$Password) {
    $credential = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$Base/api/login" -Method Post -ContentType 'application/json' -Body $credential -SessionVariable session | Out-Null
    return $session
}

function Write-Fact([string]$Base, $Session, [string]$Path, $Value) {
    $headers = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
    $payload = [System.Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Compress -Depth 5))
    return Invoke-RestMethod -Uri "$Base/api$Path" -Method Post -ContentType 'application/json; charset=utf-8' -Headers $headers -WebSession $Session -Body $payload
}

$PackageDirectory = (Resolve-Path -LiteralPath $PackageDirectory).Path
$windowsZip = Join-Path $PackageDirectory 'sd-project-win10-x64.zip'
$demoZip = Join-Path $PackageDirectory 'sd-project-win10-x64-demo.zip'
Verify-Archive $windowsZip 'RELEASE-MANIFEST.json'
Verify-Archive $demoZip 'DEMO-RELEASE-MANIFEST.json'

$work = Join-Path $env:RUNNER_TEMP ('SD Project 验收 ' + [Guid]::NewGuid())
$oldRoot = Join-Path $work '初始版本'
$restoredRoot = Join-Path $work '恢复版本'
$nextRoot = Join-Path $work '升级版本'
$demoRoot = Join-Path $work '合成演示'
$script:server = $null
try {
    Expand-Archive -LiteralPath $windowsZip -DestinationPath $oldRoot
    Expand-Archive -LiteralPath $windowsZip -DestinationPath $restoredRoot
    Expand-Archive -LiteralPath $windowsZip -DestinationPath $nextRoot
    Expand-Archive -LiteralPath $demoZip -DestinationPath $demoRoot
    Assert-True (!(Test-Path -LiteralPath (Join-Path $oldRoot 'data'))) 'Formal ZIP contains data.'
    Assert-True ((& (Join-Path $oldRoot 'runtime/node.exe') --version) -ceq 'v24.22.3') 'Bundled Windows Node version differs.'
    $manifest = Read-Manifest (Join-Path $oldRoot 'BUILD-MANIFEST.json')
    Assert-True ($manifest.git_commit -ceq $ExpectedCommit) 'Embedded manifest differs from checked-out commit.'
    $demoMarker = Read-Manifest (Join-Path $demoRoot 'data/DEMO-DATA.json')
    Assert-True ($demoMarker.asset_basis -ceq 'synthetic-fixture') 'The demo does not declare a synthetic asset source.'

    $account = 'package-windows-admin'
    $password = [Guid]::NewGuid().ToString('N') + 'Win!'
    $env:SD_ADMIN_USER = $account
    $env:SD_ADMIN_PASSWORD = $password
    Invoke-PackageCommand $oldRoot '初始化管理员.cmd' $true
    Remove-Item Env:\SD_ADMIN_USER, Env:\SD_ADMIN_PASSWORD
    $port = Get-FreePort
    $base = Start-Package $oldRoot '启动服务.cmd' $port
    try {
        Invoke-WebRequest -Uri "$base/api/dashboard" -UseBasicParsing | Out-Null
        throw 'Anonymous access to the dashboard was allowed.'
    } catch {
        Assert-True ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) 'Anonymous access did not return 401.'
    }
    $session = Get-Session $base $account $password
    $units = Invoke-RestMethod -Uri "$base/api/catalog/units?page_size=100" -WebSession $session
    Assert-True ($units.items.Count -eq 22) 'Required reference units are missing.'
    $tower = Write-Fact $base $session '/catalog/physical' @{ asset_no = 'WINDOWS-PACKAGE-TEST' }
    Assert-True ($tower.id) 'The administrator cannot register a tower on Windows.'

    $env:SD_UPGRADE_SOURCE_DIR = $oldRoot
    Invoke-PackageCommand $nextRoot '一键升级.cmd' $false
    Assert-True (!(Test-Path -LiteralPath (Join-Path $nextRoot 'data'))) 'A running-service upgrade created a destination data directory.'
    Stop-Package

    Invoke-PackageCommand $oldRoot '备份数据库.cmd' $true
    $backup = Get-ChildItem -LiteralPath (Join-Path $oldRoot 'data/backups') -Directory | Select-Object -First 1
    Assert-True ($backup) 'Backup CMD did not produce a backup.'
    $env:SD_RESTORE_BACKUP_DIR = $backup.FullName
    Invoke-PackageCommand $restoredRoot '恢复业务数据.cmd' $true
    Invoke-PackageCommand $restoredRoot '恢复业务数据.cmd' $false
    $restoredBase = Start-Package $restoredRoot '启动服务.cmd' (Get-FreePort)
    $restoredSession = Get-Session $restoredBase $account $password
    $restored = Invoke-RestMethod -Uri "$restoredBase/api/catalog/physical" -WebSession $restoredSession
    Assert-True ($restored.items.id -contains $tower.id) 'Restore did not preserve the tower identity.'
    Stop-Package

    $env:PORT = [string]$port
    Invoke-PackageCommand $nextRoot '一键升级.cmd' $true
    Assert-True ((Read-Manifest (Join-Path $nextRoot 'data/UPGRADE-RECEIPT.json')).verified) 'Upgrade did not verify its candidate.'
    Assert-True (Test-Path -LiteralPath (Join-Path $oldRoot 'data/schema113.sqlite')) 'Upgrade removed the original database.'
    Invoke-PackageCommand $nextRoot '一键升级.cmd' $false
    $newBase = Start-Package $nextRoot '启动服务.cmd' $port
    $newSession = Get-Session $newBase $account $password
    $upgraded = Invoke-RestMethod -Uri "$newBase/api/catalog/physical" -WebSession $newSession
    Assert-True ($upgraded.items.id -contains $tower.id) 'Upgrade did not preserve the tower identity.'
    Stop-Package

    $demoBase = Start-Package $demoRoot '启动演示服务.cmd' (Get-FreePort)
    $demoSession = Get-Session $demoBase 'demo' 'DemoOnly-2026!'
    Invoke-RestMethod -Uri "$demoBase/api/dashboard" -WebSession $demoSession | Out-Null
    Write-Output 'WINDOWS_PACKAGE_VERIFIED bundled Node, CMD and PowerShell, initialization, permissions, backup, restore, upgrade protection, and synthetic demo'
} finally {
    Stop-Package
    foreach ($name in @('SD_ADMIN_USER', 'SD_ADMIN_PASSWORD', 'DATA_DIR', 'HOST', 'PORT', 'SD_TEST_LAUNCHER', 'SD_UPGRADE_SOURCE_DIR', 'SD_RESTORE_BACKUP_DIR')) {
        Remove-Item ("Env:\" + $name) -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
