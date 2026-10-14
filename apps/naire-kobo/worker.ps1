param([Parameter(Mandatory=$true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
try {
    $root = $PSScriptRoot
    $job = Get-Content -LiteralPath $JobPath -Raw -Encoding utf8
    $rootJson = ConvertTo-Json -InputObject ($root.Replace('\','/')) -Compress
    $scriptJson = ConvertTo-Json -InputObject (($root + '\engine.jsx').Replace('\','/')) -Compress
    $illustrator = New-Object -ComObject Illustrator.Application
    $code = 'try { var NAIRE_ROOT=' + $rootJson + '; var NAIRE_JOB=' + $job + '; $.evalFile(new File(' + $scriptJson + ')); "OK"; } catch(e) { "ERROR: " + e + " (line " + e.line + ")"; }'
    $result = $illustrator.DoJavaScript($code)
    if ($result -ne 'OK') { throw $result }
    Write-Output 'OK'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
