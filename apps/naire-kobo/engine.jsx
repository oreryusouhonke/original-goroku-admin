
/* Original template is read only. Output is created in a new document. */
(function () {
    var root = typeof NAIRE_ROOT !== 'undefined' ? new Folder(NAIRE_ROOT) : File($.fileName).parent;
    var job = (typeof NAIRE_JOB !== 'undefined') ? NAIRE_JOB : null;
    if (!job) {
        var mark = prompt('中央の丸の文字（1文字または2文字）', '俺流');
        if (mark === null) return;
        var year = prompt('上段の文字（10文字まで）', '創業平成二十二年');
        if (year === null) return;
        var shop = prompt('下段の店名（7文字まで）', '俺流総本家');
        if (shop === null) return;
        var orderId = prompt('保存名（注文番号など。同名は上書きしません）', 'sample');
        if (orderId === null) return;
        job = {mark: mark, year: year, shop: shop, id: orderId};
    }
    if (!/^[^\r\n]{1,2}$/.test(job.mark)) throw Error('中央は1文字または2文字で指定してください。');
    if (!job.year || job.year.length > 10 || /[\r\n]/.test(job.year)) throw Error('上段は1～10文字で指定してください。');
    if (!job.shop || job.shop.length > 7 || /[\r\n]/.test(job.shop)) throw Error('下段は1～7文字で指定してください。');
    var source = new File(root.fsName + '/source.ai');
    if (!source.exists) throw Error('source.ai が見つかりません。');
    var out = new Folder(job.outputDir || (root.fsName + '/output')); out.create();
    var id = String(job.id || 'sample').replace(/[\\\/:*?"<>|]/g, '_');
    var aiFile = new File(out.fsName + '/' + id + '.ai');
    if (aiFile.exists) throw Error('同名の出力が存在します: ' + id);
    app.textFonts.getByName('HakusyuKointaiBold');
    app.textFonts.getByName('HGPEdomojiKanteiryu');
    var oldInteraction=app.userInteractionLevel; app.userInteractionLevel=UserInteractionLevel.DONTDISPLAYALERTS; var src = app.open(source), dst = null; if(!src) { for(var q=0;q<app.documents.length;q++) if(app.documents[q].fullName.fsName===source.fsName) src=app.documents[q]; } if(!src) throw Error("作業コピーを開けませんでした。");
    try {
        var central = null, years = [], shops = [], i;
        for (i=0;i<src.textFrames.length;i++) {
            var t=src.textFrames[i];
            if(t.name === (job.mark.length===1 ? '①-1文字' : '①-2文字')) central=t;
            if(t.name==='②') years.push(t);
            if(t.name==='③') shops.push(t);
        }
        if(!central || years.length!==2 || shops.length!==2) throw Error('テンプレート構造が想定と異なります。');
        years.sort(function(a,b){return a.left-b.left;});
        shops.sort(function(a,b){return a.left-b.left;});
        var side=job.mark.length===1 ? 0 : 1;
        var cx=(central.geometricBounds[0]+central.geometricBounds[2])/2, ring=null;
        for(i=0;i<src.groupItems.length;i++){
            var g=src.groupItems[i], b=g.geometricBounds;
            if(g.parent.typename==='Layer' && Math.abs((b[0]+b[2])/2-cx)<20 && b[1]>-150 && b[3]<-530) ring=g;
        }
        if(!ring) throw Error('丸枠を識別できません。');
        // The small number above each design is a required DTF product identifier.
        var productNumber=null, nearest=Number.MAX_VALUE;
        for(i=0;i<src.textFrames.length;i++) {
            var numberFrame=src.textFrames[i], nb=numberFrame.geometricBounds;
            if(/^\d+$/.test(numberFrame.contents) && nb[1]>-40 && nb[3]<-40) {
                var distance=Math.abs((nb[0]+nb[2])/2-cx);
                if(distance<nearest) {nearest=distance;productNumber=numberFrame;}
            }
        }
        if(!productNumber || nearest>100) throw Error('DTF商品識別番号を識別できません。');
        dst=app.documents.add(DocumentColorSpace.CMYK,566.9291,566.9291);
        var copies=[];
        copies.push(ring.duplicate(dst,ElementPlacement.PLACEATEND));
        var rb=ring.geometricBounds, db=copies[0].geometricBounds;
        copies[0].translate(rb[0]-db[0],rb[1]-db[1]);
        function replace(original, value, baseCount) {
            var box=original.geometricBounds, p=original.duplicate(dst,ElementPlacement.PLACEATEND);
            if(p.kind===TextType.AREATEXT) { p.remove(); p=dst.textFrames.add(); p.name=original.name; p.textRange.characterAttributes.textFont=original.textRange.characterAttributes.textFont; p.textRange.characterAttributes.size=original.textRange.characterAttributes.size; p.textRange.characterAttributes.fillColor=original.textRange.characterAttributes.fillColor; }
            p.contents=value;
            if(p.characters.length!==value.length) throw Error('文字差し替え失敗');
            // Above the usual 8/5 characters, tighten spacing before narrowing glyphs.
            if(baseCount) p.textRange.characterAttributes.tracking = -Math.min(60, Math.max(0,value.length-baseCount)*30);
            // Measure actual glyph outlines, including vertical two-character composition.
            var probe=p.duplicate(), outlined=probe.createOutline(), b=outlined.geometricBounds;
            var w=b[2]-b[0], h=b[1]-b[3]; outlined.remove();
            if(w<=0 || h<=0) throw Error('文字を描画できません。');
            var maxW=box[2]-box[0], maxH=box[1]-box[3];
            var sx=maxW/w*100, sy=maxH/h*100;
            if(baseCount) {
                // Preserve the original glyph height. Compress only the horizontal axis.
                p.resize(sy,sy);
                probe=p.duplicate();outlined=probe.createOutline();b=outlined.geometricBounds;outlined.remove();
                var horizontal=Math.min(100,maxW/(b[2]-b[0])*100);
                p.resize(horizontal,100);
            } else {var s=Math.min(sx,sy);p.resize(s,s);}
            probe=p.duplicate();outlined=probe.createOutline();b=outlined.geometricBounds;outlined.remove();
            if(b[2]-b[0]>maxW+0.1 || b[1]-b[3]>maxH+0.1) throw Error('文字が規定の範囲に収まりません。');
            p.translate((box[0]+box[2]-b[0]-b[2])/2,(box[1]+box[3]-b[1]-b[3])/2);
            copies.push(p);return p;
        }
        replace(central,job.mark,0);
        replace(years[side],job.year,8);
        replace(shops[side],job.shop,5);
        var numberCopy=productNumber.duplicate(dst,ElementPlacement.PLACEATEND);
        var sourceNumberBounds=productNumber.geometricBounds, copiedNumberBounds=numberCopy.geometricBounds;
        numberCopy.translate(sourceNumberBounds[0]-copiedNumberBounds[0],sourceNumberBounds[1]-copiedNumberBounds[1]);
        numberCopy.name='DTF商品識別番号';
        copies.push(numberCopy);
        var design=dst.groupItems.add();
        for(i=0;i<copies.length;i++) copies[i].move(design,ElementPlacement.PLACEATEND);
        var bounds=design.geometricBounds;
        var scale=job.widthMM ? (Number(job.widthMM)*72/25.4)/(bounds[2]-bounds[0])*100 : 100;
        if(!isFinite(scale) || scale<=0) throw Error('寸法が不正です。');
        design.resize(scale,scale);
        bounds=design.geometricBounds;
        var margin=12, width=bounds[2]-bounds[0], height=bounds[1]-bounds[3];
        design.translate(margin-bounds[0],height+margin-bounds[1]);
        dst.artboards[0].artboardRect=[0,height+margin*2,width+margin*2,0];
        var opts=new IllustratorSaveOptions();opts.pdfCompatible=true;
        dst.saveAs(aiFile,opts);
        var png=new ExportOptionsPNG24();png.transparency=true;png.artBoardClipping=true;png.horizontalScale=200;png.verticalScale=200;
        dst.exportFile(new File(out.fsName+'/'+id+'.png'),ExportType.PNG24,png);
        // Black background is only for the screen preview, never the print output.
        var bg=dst.pathItems.rectangle(height+margin*2,0,width+margin*2,height+margin*2);
        var black=new CMYKColor();black.black=100;bg.fillColor=black;bg.stroked=false;
        bg.zOrder(ZOrderMethod.SENDTOBACK);
        png.transparency=false;
        dst.exportFile(new File(out.fsName+'/'+id+'-preview.png'),ExportType.PNG24,png);
        bg.remove();
        for(i=dst.textFrames.length-1;i>=0;i--) dst.textFrames[i].createOutline();
        var pdf=new PDFSaveOptions();pdf.preserveEditability=false;
        dst.saveAs(new File(out.fsName+'/'+id+'-outlined.pdf'),pdf);
        dst.close(SaveOptions.DONOTSAVECHANGES);dst=null;
        if(typeof NAIRE_JOB==='undefined') alert('出力しました: '+out.fsName+'\n実注文に使う前に文字と寸法を確認してください。');
    } finally {
        if(dst) dst.close(SaveOptions.DONOTSAVECHANGES);
        try { if(src) src.close(SaveOptions.DONOTSAVECHANGES); } catch(closeError) {} app.userInteractionLevel=oldInteraction;
    }
})();







