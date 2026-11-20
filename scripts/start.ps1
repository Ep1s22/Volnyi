$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$runtimeName = $null
$portable = Join-Path $runtime 'node-v22.13.1-win-x64\node.exe'
$candidates = @(
    $portable,
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe'
)

function Test-Node {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    try {
        $result = & $Path --version 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $result) {
            return $false
        }

        $match = [regex]::Match($result, '^v(\d+)\.(\d+)')
        if (-not $match.Success) {
            return $false
        }

        $major = [int]$match.Groups[1].Value
        $minor = [int]$match.Groups[2].Value
        return $major -gt 22 -or ($major -eq 22 -and $minor -ge 13)
    } catch {
        return $false
    }
}

$node = $candidates | Where-Object { Test-Node $_ } | Select-Object -First 1
if (-not $node) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        Write-Host 'Node.js is blocked on this PC. Starting the site with Python fallback.'
        $root = (Resolve-Path $root).Path
        $server = Start-Process -FilePath $pythonCommand.Source `
            -ArgumentList @('server.py') `
            -WorkingDirectory $root `
            -PassThru
        $runtimeName = 'Python'
        $node = $runtimeName
    } else {
    Write-Host 'Working Node.js installation not found. Downloading portable Node.js 22.13.1...' -ForegroundColor Yellow

    $zip = Join-Path $runtime 'node.zip'
    $extract = Join-Path $runtime 'node-v22.13.1-win-x64'
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null

    try {
        Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.13.1/node-v22.13.1-win-x64.zip' -OutFile $zip
        if (Test-Path -LiteralPath $extract) {
            Remove-Item -LiteralPath $extract -Recurse -Force
        }
        Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force
        Remove-Item -LiteralPath $zip -Force
    } catch {
        Write-Host "Failed to download Node.js: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Reinstall Node.js from https://nodejs.org/' -ForegroundColor Red
        exit 1
    }

    $node = $portable
    if (-not (Test-Node $node)) {
        Write-Host 'Downloaded Node.js cannot start. Windows blocks executable files.' -ForegroundColor Red
        exit 1
    }
    }
}

Set-Location $root
if ($runtimeName -ne 'Python') {
    Write-Host "Starting server with $node"
    $server = Start-Process -FilePath $node `
        -ArgumentList @('--disable-warning=ExperimentalWarning', 'server.js') `
        -WorkingDirectory $root `
        -PassThru
}

$url = 'http://localhost:8081'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300

    if ($server.HasExited) {
        Write-Host "Server stopped with exit code $($server.ExitCode)." -ForegroundColor Red
        exit 1
    }

    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 1 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {}
}

if (-not $ready) {
    Write-Host 'Server did not respond within 9 seconds.' -ForegroundColor Red
    exit 1
}

Write-Host "Site is ready: $url"
Start-Process $url
