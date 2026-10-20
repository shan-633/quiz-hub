$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
foreach ($version in @('1.0.0', '2.0.0', '3.0.0')) {
    $tag = 'v' + $version
    $archivePath = Join-Path $outputDirectory ('zhixu-physics-' + $tag + '-source.zip')
    git -C $projectRoot rev-parse --verify ('refs/tags/' + $tag) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Missing tag: ' + $tag) }
    git -C $projectRoot archive --format=zip ('--prefix=zhixu-physics-' + $tag + '/') ('--output=' + $archivePath) $tag
    if ($LASTEXITCODE -ne 0) { throw ('Archive failed: ' + $tag) }
    Get-Item -LiteralPath $archivePath | Select-Object Name, Length
}
