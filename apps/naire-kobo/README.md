# 名入れ工房

商店風トートバッグM（商品番号9）の名入れを作成するWindowsアプリです。中央1～2文字・上段10文字・下段7文字に対応し、Illustratorで見本を作成した後、編集用AI・アウトラインPDF・透過PNG・確認画像・入力JSONを保存します。

## 起動

Windows、Python 3.10以上（Tkinterを含む）、IllustratorのCOM連携が必要です。元デザインで使う `HakusyuKointaiBold` と `HGPEdomojiKanteiryu` のフォントを、利用許諾に従ってPCへインストールしてください。

```powershell
python -m pip install -r requirements.txt
python app.py
```

Illustratorの元テンプレートを `source.ai` として、このREADMEと同じフォルダーへ配置します。テンプレート・フォント・注文データはこの公開リポジトリに含めません。既存PCの `source.ai` はそのまま利用できます。

## ブラウザーから起動

`ブラウザー起動設定.ps1` を実行すると、現在のWindowsユーザーに `oreryu-naire://open` を登録します。語録管理画面の「名入れ工房を開く」ボタンから起動できます。Chromeの外部アプリ起動確認が表示された場合は「開く」を選びます。アプリを移動した場合は設定スクリプトを再実行してください。

## 出力と寸法

寸法欄が空欄なら元テンプレートの大きさを使います。幅を指定すると、商品番号を含む全体の外接幅をそのmmに合わせます。印刷アートボードの周囲に約4.2mmの余白が付きます。量産用の寸法は別途確定してください。

商品番号9は出力に保持します。同名ファイルは上書きしません。プレビューは `.preview` に、ユーザー指定の出力は選択したフォルダーに保存します。生成データはGit管理から除外します。

受注の自動取り込み・プリンターへの送信は未対応です。このアプリはローカルのIllustratorを使い、Render上では実行しません。

## 確認

```powershell
python -m py_compile app.py
python app.py --smoke-test
```

後者はGUIの起動と終了を確認します。実際のIllustrator出力の確認には、テンプレートと必要なフォントを用意してください。
