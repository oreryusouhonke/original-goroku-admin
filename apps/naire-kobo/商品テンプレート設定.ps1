param([string]$SourceFolder = (Join-Path $env:USERPROFILE 'Desktop\帆前掛け商店風'))
$ErrorActionPreference = 'Stop'
$catalogProducts = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'catalog.json') -Raw -Encoding utf8 | ConvertFrom-Json).products
foreach ($catalogProduct in ($catalogProducts | Sort-Object template -Unique)) {
    $catalogSource = Join-Path $SourceFolder $catalogProduct.templateOriginalName
    $catalogTarget = Join-Path $PSScriptRoot $catalogProduct.template
    if (-not (Test-Path -LiteralPath $catalogSource -PathType Leaf)) { throw ('原本が見つかりません: ' + $catalogSource) }
    if ((Get-FileHash -LiteralPath $catalogSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $catalogProduct.templateSha256) { throw ('原本の版が異なります: ' + $catalogSource) }
    if (Test-Path -LiteralPath $catalogTarget) {
        if ((Get-FileHash -LiteralPath $catalogTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $catalogProduct.templateSha256) { throw ('既存テンプレートを上書きできません: ' + $catalogTarget) }
        continue
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $catalogTarget) -Force | Out-Null
    Copy-Item -LiteralPath $catalogSource -Destination $catalogTarget
}
Write-Output '23商品の元テンプレートを確認・配置しました。'
