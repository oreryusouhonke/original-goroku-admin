$ErrorActionPreference = 'Stop'
$naireAppPath = Join-Path $PSScriptRoot 'app.py'
if (-not (Test-Path -LiteralPath $naireAppPath -PathType Leaf)) { throw '名入れ工房のapp.pyが見つかりません。' }
$nairePython = (Get-Command pythonw.exe -ErrorAction Stop).Source
$naireProtocolKey = 'HKCU:\Software\Classes\oreryu-naire'
New-Item -Path $naireProtocolKey -Force | Out-Null
Set-Item -LiteralPath $naireProtocolKey -Value 'URL:俺流 名入れ工房'
New-ItemProperty -LiteralPath $naireProtocolKey -Name 'URL Protocol' -PropertyType String -Value '' -Force | Out-Null
New-Item -Path "$naireProtocolKey\shell\open\command" -Force | Out-Null
# 起動先は固定。URLの商品・版IDはアプリ内のカタログで照合する。
Set-Item -LiteralPath "$naireProtocolKey\shell\open\command" -Value ('"' + $nairePython + '" "' + $naireAppPath + '" "%1"')
Write-Output '名入れ工房のブラウザー起動設定を登録しました。'
