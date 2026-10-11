param([Parameter(Mandatory=$true)][string]$Config,[switch]$TestNoLaunch)
$ErrorActionPreference='Stop'
$c=$null
$moved=$false
$parentExited=$false
try {
  $c=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
  [Environment]::CurrentDirectory=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Config))
  Set-Location -LiteralPath ([Environment]::CurrentDirectory)
  $root=[IO.Path]::GetFullPath($c.root)
  $candidate=[IO.Path]::GetFullPath($c.candidate)
  $backup=$root+'.previous'
  $swap=$root+'.swap-old'
  'Worker started' | Add-Content -LiteralPath $c.log -Encoding UTF8
  if($c.ready) {
    $ack=@{pid=$PID;token=$c.token} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($c.ready+'.tmp',$ack)
    Move-Item -LiteralPath ($c.ready+'.tmp') -Destination $c.ready
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    while(!(Test-Path -LiteralPath $c.commit)) {
      if((Test-Path -LiteralPath $c.cancel) -or [DateTime]::UtcNow -gt $deadline){throw 'Handoff cancelled; runtime unchanged'}
      Start-Sleep -Milliseconds 100
    }
    if([IO.File]::ReadAllText($c.commit) -ne $c.token){throw 'Invalid handoff token'}
  }
  $p=Get-Process -Id $c.pid -ErrorAction SilentlyContinue
  if($p -and !$p.WaitForExit(60000)){throw 'App did not exit. Update was cancelled.'}
  $parentExited=$true
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
  if(!$TestNoLaunch){Start-Process -FilePath (Join-Path $root 'OuiP.exe') -WorkingDirectory ([IO.Path]::GetDirectoryName($Config))}
  if(!$c.rollback){Remove-Item -LiteralPath ([IO.Path]::GetDirectoryName($candidate)) -Recurse -Force}
  'Update completed' | Add-Content -LiteralPath $c.log -Encoding UTF8
} catch {
  $errorText=$_.Exception.Message
  if($moved -and (Test-Path -LiteralPath $swap)) {
    if(Test-Path -LiteralPath $root){Move-Item -LiteralPath $root -Destination $candidate}
    Move-Item -LiteralPath $swap -Destination $root
  }
  if($c -and $c.log){$errorText | Add-Content -LiteralPath $c.log -Encoding UTF8}else{Write-Error $errorText}
  if(!$TestNoLaunch -and $parentExited -and (Test-Path -LiteralPath (Join-Path $root 'OuiP.exe'))){Start-Process -FilePath (Join-Path $root 'OuiP.exe') -WorkingDirectory ([IO.Path]::GetDirectoryName($Config))}
  exit 1
}