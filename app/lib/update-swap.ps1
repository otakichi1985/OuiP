param([Parameter(Mandatory=$true)][string]$Config,[switch]$TestNoLaunch)
$ErrorActionPreference='Stop'
$c=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$root=[IO.Path]::GetFullPath($c.root)
$candidate=[IO.Path]::GetFullPath($c.candidate)
$backup=$root+'.previous'
$swap=$root+'.swap-old'
$moved=$false
try {
  $p=Get-Process -Id $c.pid -ErrorAction SilentlyContinue
  if($p -and !$p.WaitForExit(60000)){throw 'App did not exit. Update was cancelled.'}
  $manifest=Get-Content -LiteralPath (Join-Path $candidate '.ouip-package.json') -Raw | ConvertFrom-Json
  if($manifest.product -ne 'OuiP'){throw 'Invalid update folder'}
  if(Test-Path -LiteralPath $swap){throw 'Previous swap is unfinished'}
  # Retry locks released by Chromium children; never terminate user processes.
  for($i=0;$i -lt 60;$i++) {
    try {Move-Item -LiteralPath $root -Destination $swap; $moved=$true; break}
    catch {if($i -eq 59){throw};Start-Sleep -Milliseconds 500}
  }
  Move-Item -LiteralPath $candidate -Destination $root
  if(!$c.rollback -and (Test-Path -LiteralPath $backup)){Remove-Item -LiteralPath $backup -Recurse -Force}
  Move-Item -LiteralPath $swap -Destination $backup
  $moved=$false
  if(!$TestNoLaunch){Start-Process -FilePath (Join-Path $root 'OuiP.exe') -WorkingDirectory $root}
  if(!$c.rollback){Remove-Item -LiteralPath ([IO.Path]::GetDirectoryName($candidate)) -Recurse -Force}
  'Update completed' | Set-Content -LiteralPath $c.log -Encoding UTF8
} catch {
  $errorText=$_.Exception.Message
  if($moved -and (Test-Path -LiteralPath $swap)) {
    if(Test-Path -LiteralPath $root){Move-Item -LiteralPath $root -Destination $candidate}
    Move-Item -LiteralPath $swap -Destination $root
  }
  $errorText | Set-Content -LiteralPath $c.log -Encoding UTF8
  if(!$TestNoLaunch -and (Test-Path -LiteralPath (Join-Path $root 'OuiP.exe'))){Start-Process -FilePath (Join-Path $root 'OuiP.exe') -WorkingDirectory $root}
}