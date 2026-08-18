# build-helper.ps1 — 用 PyInstaller 把 runtime/ 打包成单文件 exe。
#
# 输出：runtime/bin/win32-x64/dsh-bigfishpet-helper.exe
# （lib/helper-process.js 的 bundledHelperPath 指向这里，存在即优先用 exe，
#   不再依赖用户机器上的 Python + PySide6。）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-helper.ps1
#
# 注意：
#   - 必须是 console 子系统（不要 --windowed）：Helper 通过 stdin/stdout 走
#     JSONL 协议，pythonw 会断掉协议管道。
#   - assets/ 以 data 打进包，helper.py 的 bundle_root() 用 sys._MEIPASS 定位，
#     源码目录运行时则回退到仓库根（两种模式都读 assets/pet-manifest.json）。

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Entry = Join-Path $Root 'runtime\helper.py'
$Assets = Join-Path $Root 'assets'
$Dist = Join-Path $Root 'runtime\bin\win32-x64'
$Work = Join-Path $Root '.build\helper-work'
$Spec = Join-Path $Root '.build\helper-spec'
$Name = 'dsh-bigfishpet-helper'

if (-not (Test-Path $Entry)) { throw "helper entry not found: $Entry" }
if (-not (Test-Path (Join-Path $Assets 'pet-manifest.json'))) { throw "assets manifest not found: $Assets" }

New-Item -ItemType Directory -Force -Path $Dist, $Work, $Spec | Out-Null

Write-Host "[build-helper] PyInstaller -> $Dist\$Name.exe"
& py -3 -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --console `
  --name $Name `
  --distpath $Dist `
  --workpath $Work `
  --specpath $Spec `
  --paths (Join-Path $Root 'runtime') `
  --add-data "$Assets;assets" `
  $Entry

if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed (exit $LASTEXITCODE)" }

$Exe = Join-Path $Dist "$Name.exe"
if (-not (Test-Path $Exe)) { throw "build output missing: $Exe" }

$SizeMB = [Math]::Round((Get-Item $Exe).Length / 1MB, 1)
Write-Host "[build-helper] OK: $Exe ($SizeMB MB)"
