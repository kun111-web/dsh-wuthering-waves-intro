param(
  [string]$DshCommand = 'dsh',
  [string]$Profile = 'desktop'
)
$ErrorActionPreference = 'Stop'
$pluginArchive = Join-Path $PSScriptRoot 'dist\dsh-wuthering-waves-intro-0.4.5.tgz'
$resolvedCommand = Get-Command -Name $DshCommand -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $resolvedCommand) { throw 'DSH CLI not found. Supply its full path with -DshCommand.' }
$DshCommand = $resolvedCommand.Source
if (-not (Test-Path -LiteralPath $pluginArchive)) { throw 'Run npm run pack:plugin first.' }
$pluginArchive = (Resolve-Path -LiteralPath $pluginArchive).Path
& $DshCommand plugin --profile $Profile add $pluginArchive
if ($LASTEXITCODE -ne 0) { throw "DSH plugin install failed: $LASTEXITCODE" }
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
$profileDir = Join-Path $dshRoot "profiles\$Profile"
$plugin = 'dsh-wuthering-waves-intro'
$profileManifest = Get-Content -LiteralPath (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$source = $profileManifest.dependencies.$plugin
$installed = Get-Content -LiteralPath (Join-Path $profileDir "node_modules\$plugin\package.json") -Raw | ConvertFrom-Json
if (-not $source -or -not $source.StartsWith('file:') -or $installed.version -ne '0.4.5') { throw 'Installed dependency or version did not match.' }
$sourcePath = $source.Substring(5)
if (-not [IO.Path]::IsPathRooted($sourcePath)) { $sourcePath = Join-Path $profileDir $sourcePath }
if ((Resolve-Path -LiteralPath $sourcePath).Path -ne $pluginArchive) { throw 'Installed archive path did not match.' }
Write-Host "$plugin@$($installed.version) <- $source"
