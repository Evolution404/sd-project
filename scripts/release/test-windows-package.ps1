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
    $null = $script:server.Handle
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

    $data = Join-Path $work '独立业务数据'
    $restoredData = Join-Path $work '恢复数据'
    $missing = Join-Path $work '不存在的数据'
    Remove-Item Env:\DATA_DIR -ErrorAction SilentlyContinue
    Invoke-PackageCommand $oldRoot '启动服务.cmd' $false
    $env:DATA_DIR = $missing
    Invoke-PackageCommand $oldRoot '启动服务.cmd' $false
    Assert-True (!(Test-Path -LiteralPath $missing)) 'Start created an empty dataset.'
    $account = 'package-windows-admin'
    $password = [Guid]::NewGuid().ToString('N') + 'Win!'
    $env:SD_ADMIN_USER = $account
    $env:SD_ADMIN_PASSWORD = $password
    $env:SD_NEW_DATA_DIR = $data
    Invoke-PackageCommand $oldRoot '创建空数据集.cmd' $true
    Remove-Item Env:\SD_ADMIN_USER, Env:\SD_ADMIN_PASSWORD, Env:\SD_NEW_DATA_DIR
    $env:DATA_DIR = $data
    Invoke-PackageCommand $oldRoot '选择数据目录.cmd' $true
    Assert-True ((Read-Manifest (Join-Path $oldRoot 'data-location.json')).data_dir -eq $data) 'Selected path was not saved.'
    Remove-Item Env:\DATA_DIR
    $port = Get-FreePort
    $env:PORT = [string]$port
    $unmanaged = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $unmanaged.Start()
    try {
        $env:DATA_DIR = $data
        Invoke-PackageCommand $nextRoot '停止服务.cmd' $true
        Assert-True ($unmanaged.Server.IsBound) 'Stop affected an unmanaged listener.'
    } finally { $unmanaged.Stop() }
    Remove-Item Env:\DATA_DIR
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

    $env:DATA_DIR = $data
    $env:PORT = [string](Get-FreePort)
    Invoke-PackageCommand $nextRoot '启动服务.cmd' $false
    Invoke-PackageCommand $nextRoot '备份数据库.cmd' $false
    Invoke-PackageCommand $nextRoot '停止服务.cmd' $true
    Assert-True ($script:server.WaitForExit(10000)) 'The managed old CMD did not exit gracefully.'
    $oldExit = $script:server.ExitCode
    $oldOutput = Get-Content -LiteralPath (Join-Path $oldRoot 'acceptance.stdout') -Raw
    $oldErrors = Get-Content -LiteralPath (Join-Path $oldRoot 'acceptance.stderr') -Raw
    Assert-True ($oldExit -eq 0 -and $oldOutput -match 'Server stopped. Exit code: 0') ("Managed old CMD exit: [$oldExit]. `n$oldOutput`n$oldErrors")
    $script:server = $null
    Assert-True (!(Test-Path -LiteralPath (Join-Path $data '.sd-dataset.lock'))) 'Dataset lock was not released.'

    Invoke-PackageCommand $oldRoot '备份数据库.cmd' $true
    $backup = Get-ChildItem -LiteralPath (Join-Path $data 'backups') -Directory | Select-Object -First 1
    Assert-True ($backup) 'Backup CMD did not produce a backup.'
    $env:SD_RESTORE_BACKUP_DIR = $backup.FullName
    $env:SD_RESTORE_TARGET_DIR = $restoredData
    Invoke-PackageCommand $restoredRoot '恢复业务数据.cmd' $true
    Invoke-PackageCommand $restoredRoot '恢复业务数据.cmd' $false
    $env:DATA_DIR = $restoredData
    $restoredBase = Start-Package $restoredRoot '启动服务.cmd' (Get-FreePort)
    $restoredSession = Get-Session $restoredBase $account $password
    $restored = Invoke-RestMethod -Uri "$restoredBase/api/catalog/physical" -WebSession $restoredSession
    Assert-True ($restored.items.id -contains $tower.id) 'Restore did not preserve the tower identity.'
    Invoke-PackageCommand $restoredRoot '停止服务.cmd' $true
    Assert-True ($script:server.WaitForExit(10000)) 'Restored service did not stop.'
    $script:server = $null

    $env:DATA_DIR = $data
    Invoke-PackageCommand $nextRoot '选择数据目录.cmd' $true
    Remove-Item Env:\DATA_DIR
    $newBase = Start-Package $nextRoot '启动服务.cmd' $port
    $newSession = Get-Session $newBase $account $password
    $upgraded = Invoke-RestMethod -Uri "$newBase/api/catalog/physical" -WebSession $newSession
    Assert-True ($upgraded.items.id -contains $tower.id) 'Replacement program did not open the original tower identity.'
    Assert-True (Test-Path -LiteralPath (Join-Path $data 'schema113.sqlite')) 'Original dataset was removed.'
    foreach ($program in @($oldRoot,$restoredRoot,$nextRoot)) {
        Assert-True (!(Test-Path -LiteralPath (Join-Path $program 'data'))) 'A program created a private database.'
    }
    Invoke-PackageCommand $nextRoot '停止服务.cmd' $true
    Assert-True ($script:server.WaitForExit(10000)) 'Replacement program did not stop.'
    $script:server = $null

    # Abruptly terminate the actual Windows CMD / Node process tree.
    $crashBase = Start-Package $nextRoot '启动服务.cmd' $port
    $owner = Read-Manifest (Join-Path $data '.sd-dataset.lock/owner.json')
    Stop-Package
    $nodeProcess = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
    if ($nodeProcess) { $nodeProcess.WaitForExit(10000) | Out-Null }
    Assert-True (!(Get-Process -Id $owner.pid -ErrorAction SilentlyContinue)) 'Node process did not exit after forced close.'
    Assert-True (Test-Path -LiteralPath (Join-Path $data '.sd-dataset.lock')) 'Force-close test did not leave the old control record.'
    $restartBase = Start-Package $nextRoot '启动服务.cmd' $port
    $restartSession = Get-Session $restartBase $account $password
    $facts = Invoke-RestMethod -Uri "$restartBase/api/catalog/physical" -WebSession $restartSession
    Assert-True ($facts.items.id -contains $tower.id) 'Force-close restart lost a tower.'
    Invoke-PackageCommand $nextRoot '停止服务.cmd' $true
    Assert-True ($script:server.WaitForExit(10000)) 'Restarted service did not stop.'
    $script:server = $null
    [System.IO.File]::WriteAllText((Join-Path $data ('.sd-running-' + $port)),('a' * 48))
    $legacyBase = Start-Package $nextRoot '启动服务.cmd' $port
    $legacySession = Get-Session $legacyBase $account $password
    Invoke-RestMethod -Uri "$legacyBase/api/dashboard" -WebSession $legacySession | Out-Null
    Invoke-PackageCommand $nextRoot '停止服务.cmd' $true
    Assert-True ($script:server.WaitForExit(10000)) 'Legacy marker recovery service did not stop.'
    $script:server = $null
    Assert-True (!(Test-Path -LiteralPath (Join-Path $data ('.sd-running-' + $port)))) 'Old marker remained after recovery.'

    $demoBase = Start-Package $demoRoot '启动演示服务.cmd' (Get-FreePort)
    $demoSession = Get-Session $demoBase 'demo' 'demo'
    Invoke-RestMethod -Uri "$demoBase/api/dashboard" -WebSession $demoSession | Out-Null
    Write-Output 'WINDOWS_PACKAGE_VERIFIED bundled Node, CMD and PowerShell, explicit datasets, duplicate lock, permissions, backup, restore, replacement without data migration, forced-close recovery, legacy marker recovery, and synthetic demo'
} finally {
    Stop-Package
    foreach ($name in @('SD_ADMIN_USER', 'SD_ADMIN_PASSWORD', 'DATA_DIR', 'HOST', 'PORT', 'SD_TEST_LAUNCHER', 'SD_NEW_DATA_DIR', 'SD_RESTORE_TARGET_DIR', 'SD_RESTORE_BACKUP_DIR')) {
        Remove-Item ("Env:\" + $name) -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
