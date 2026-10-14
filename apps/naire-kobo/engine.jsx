
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
    var source = new File(job.templatePath || (root.fsName + '/source.ai'));
    if (!source.exists) throw Error('source.ai が見つかりません。');
    var out = new Folder(job.outputDir || (root.fsName + '/output')); out.create();
    var id = String(job.id || 'sample').replace(/[\\\/:*?"<>|]/g, '_');
    var aiFile = new File(out.fsName + '/' + id + '.ai');
    if (aiFile.exists) throw Error('同名の出力が存在します: ' + id);
    app.textFonts.getByName('HakusyuKointaiBold');
    app.textFonts.getByName('HGPEdomojiKanteiryu');
    var oldInteraction=app.userInteractionLevel; app.userInteractionLevel=UserInteractionLevel.DONTDISPLAYALERTS; var workingSource=new File(out.fsName+'/template-work.ai');source.copy(workingSource.fsName); var src = app.open(workingSource), dst = null; if(!src) { for(var q=0;q<app.documents.length;q++) if(app.documents[q].fullName.fsName===workingSource.fsName) src=app.documents[q]; } if(!src) throw Error("作業コピーを開けませんでした。");
    try {
        var i;
        if(!job.layout || !job.layout.length) throw Error('商品とサイズをカタログから選んでください。');
        var sourceBoard=src.artboards[0].artboardRect;
        sourceBoard=[sourceBoard[0],sourceBoard[1],sourceBoard[2],sourceBoard[3]];
        dst=app.documents.add(DocumentColorSpace.CMYK,sourceBoard[2]-sourceBoard[0],sourceBoard[1]-sourceBoard[3]);
        try {dst.artboards[0].artboardRect=sourceBoard;} catch(boardPositionError) {
            // Preserve width/height even if the source origin lies outside the new canvas.
            var positionedBoard=dst.artboards[0].artboardRect;sourceBoard=[positionedBoard[0],positionedBoard[1],positionedBoard[2],positionedBoard[3]];
        }
        var sourceBackground=null;
        if(job.printBackground){
            if(job.background){sourceBackground=src.layers[job.background.layer].pageItems[job.background.item];}
            else {
                var centralBox=src.textFrames[job.layout[0].central].geometricBounds;
                var cx=(centralBox[0]+centralBox[2])/2,cy=(centralBox[1]+centralBox[3])/2,bestArea=Infinity;
                for(var bl=0;bl<src.layers.length;bl++){
                    var layer=src.layers[bl];
                    for(var bi=0;bi<Math.min(100,layer.pageItems.length);bi++){
                        var item=layer.pageItems[bi];
                        if(item.parent.typename!=='Layer'||item.typename!=='PathItem'||!item.filled)continue;
                        var bb=item.geometricBounds,area=(bb[2]-bb[0])*(bb[1]-bb[3]);
                        if(bb[0]<=cx&&bb[2]>=cx&&bb[1]>=cy&&bb[3]<=cy&&area<bestArea){sourceBackground=item;bestArea=area;}
                    }
                }
            }
            if(!sourceBackground||sourceBackground.typename!=='PathItem'||!sourceBackground.filled)throw Error('元AIの背景色が見つかりません。');
            var sbg=sourceBackground.geometricBounds;
            if(Math.abs((sbg[2]-sbg[0])-(sourceBoard[2]-sourceBoard[0]))>0.05||Math.abs((sbg[1]-sbg[3])-(sourceBoard[1]-sourceBoard[3]))>0.05)throw Error('背景と元アートボードの寸法が一致しません。 board='+sourceBoard+' bg='+sbg);
        }
        var copies=[], measuredRings=[], numberCopies=[], numberTargets=[];
        function ringShape(document,group){
            var best=null,area=-1;
            function visit(item){
                if(item.typename==='PathItem') {var sb=item.geometricBounds,sa=(sb[2]-sb[0])*(sb[1]-sb[3]);if(sa>area){area=sa;best=item;}}
                else if(item.typename==='CompoundPathItem'){for(var sj=0;sj<item.pathItems.length;sj++)visit(item.pathItems[sj]);}
                else if(item.typename==='GroupItem'){for(var sk=0;sk<item.pageItems.length;sk++)visit(item.pageItems[sk]);}
            }
            visit(group);
            return best;
        }
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
        for(var partIndex=0;partIndex<job.layout.length;partIndex++) {
            var firstCopyIndex=copies.length;
            var part=job.layout[partIndex];
            var central=src.textFrames[part.central], ring=src.groupItems[part.ring];
            if(!central || !ring) throw Error('選択した版が見つかりません。');
            var ringCopy=ring.duplicate(dst,ElementPlacement.PLACEATEND);
            var sourceShape=ringShape(src,ring);
            if(!sourceShape)throw Error('丸枠の図形が見つかりません。商品テンプレートの対応を確認してください。');
            if(sourceShape)measuredRings.push({copy:ringCopy,width:sourceShape.width,height:sourceShape.height});
            var rb=ring.geometricBounds, db=ringCopy.geometricBounds;
            ringCopy.translate(rb[0]-db[0],rb[1]-db[1]);
            // Some templates group variable text with the ring. Replace it once only.
            for(var ri=ringCopy.textFrames.length-1;ri>=0;ri--) {
                var rn=ringCopy.textFrames[ri].name;
                if(rn==='①-1文字'||rn==='①-2文字'||rn==='1文字'||rn==='2文字'||rn==='②'||rn==='③'||rn==='上段'||rn==='下段') ringCopy.textFrames[ri].remove();
            }
            copies.push(ringCopy);
            replace(central,job.mark,0);
            if(part.year!==null && part.year!==undefined)replace(src.textFrames[part.year],job.year,8);
            if(part.shop!==null && part.shop!==undefined)replace(src.textFrames[part.shop],job.shop,5);
            var numberCopy;
            if(part.marker!==null&&part.marker!==undefined){
                numberCopy=src.textFrames[part.marker].duplicate(dst,ElementPlacement.PLACEATEND);
            }else{
                numberCopy=dst.textFrames.add();numberCopy.contents=String(job.printId||job.productCode||'9');
                numberCopy.textRange.characterAttributes.size=12;
                numberCopy.textRange.characterAttributes.textFont=app.textFonts.getByName('HGPEdomojiKanteiryu');
                numberCopy.textRange.characterAttributes.fillColor=central.textRange.characterAttributes.fillColor;
            }
            numberCopy.textRange.characterAttributes.fillColor=central.textRange.characterAttributes.fillColor;
            var nb=numberCopy.geometricBounds;
            if(nb[1]-nb[3]>12)numberCopy.resize(12/(nb[1]-nb[3])*100,12/(nb[1]-nb[3])*100);
            nb=numberCopy.geometricBounds;
            numberCopy.translate((part.bounds[0]+part.bounds[2]-nb[0]-nb[2])/2,part.bounds[1]+(nb[1]-nb[3])+8*72/25.4-nb[1]);
            numberCopy.name=partIndex===0?'DTF商品識別番号':'DTF商品識別番号-前面';
            numberTargets.push({number:numberCopy,items:copies.slice(firstCopyIndex)});
            copies.push(numberCopy);numberCopies.push(numberCopy);
            if(partIndex>0){
                // Place the chest and back on a compact sheet; never scale their artwork to match.
                var originalPart=part.bounds, mainPart=job.layout[0].bounds;
                var dx=(mainPart[0]+mainPart[2]-originalPart[0]-originalPart[2])/2;
                var dy=mainPart[1]+80-originalPart[3];
                for(var pi=firstCopyIndex;pi<copies.length;pi++)copies[pi].translate(dx,dy);
            }
        }
        var artworkCopies=[];
        for(var ac=0;ac<copies.length;ac++)if(copies[ac].name.indexOf('DTF商品識別番号')!==0)artworkCopies.push(copies[ac]);
        var collarRight=job.layout[0].bounds[2]+36;
        for(var ci=0;ci<(job.collarFrames || []).length;ci++){
            var collar=replace(src.textFrames[job.collarFrames[ci]],job.collarText || job.shop,0);artworkCopies.push(collar);
            var cb=collar.geometricBounds;
            collar.translate(collarRight-cb[0],job.layout[0].bounds[1]-cb[1]);
            collarRight+=cb[2]-cb[0]+18;
        }
        var design=dst.groupItems.add();
        for(i=0;i<copies.length;i++) copies[i].move(design,ElementPlacement.PLACEATEND);
        var bounds=design.geometricBounds;
        var scale=job.widthMM ? (Number(job.widthMM)*72/25.4)/(bounds[2]-bounds[0])*100 : (Number(job.templateScale)||1)*100;
        if(!isFinite(scale) || scale<=0) throw Error('寸法が不正です。');
        design.resize(scale,scale);
        var measures=[];
        for(var mi=0;mi<measuredRings.length;mi++){
            var expected=measuredRings[mi],actual=ringShape(dst,expected.copy);
            if(!actual || Math.abs(actual.width-expected.width*scale/100)>0.05 || Math.abs(actual.height-expected.height*scale/100)>0.05)throw Error('元テンプレートの図形寸法を保持できませんでした。');
            measures.push('{'+'"widthPt":'+actual.width+',"heightPt":'+actual.height+',"sourceWidthPt":'+expected.width+',"sourceHeightPt":'+expected.height+',"scale":'+scale/100+'}');
        }
        var metrics=new File(out.fsName+'/'+id+'-metrics.json');metrics.open('w');metrics.write('['+measures.join(',')+']');metrics.close();
        bounds=design.geometricBounds;
        var boardWidth=sourceBoard[2]-sourceBoard[0],boardHeight=sourceBoard[1]-sourceBoard[3];
        var backgroundCopy=null;
        if(sourceBackground){
            var sourceBackgroundBounds=sourceBackground.geometricBounds;
            design.translate(sourceBoard[0]-sourceBackgroundBounds[0],sourceBoard[1]-sourceBackgroundBounds[1]);
            backgroundCopy=sourceBackground.duplicate(dst,ElementPlacement.PLACEATEND);
            backgroundCopy.hidden=false;backgroundCopy.locked=false;
            var copiedBackgroundBounds=backgroundCopy.geometricBounds;
            backgroundCopy.translate(sourceBoard[0]-copiedBackgroundBounds[0],sourceBoard[1]-copiedBackgroundBounds[1]);
            backgroundCopy.name='元AIの背景色';backgroundCopy.zOrder(ZOrderMethod.SENDTOBACK);
        }else{
            var artworkBounds=[Infinity,-Infinity,-Infinity,Infinity];
            for(var ac=0;ac<artworkCopies.length;ac++){var ab=artworkCopies[ac].geometricBounds;artworkBounds[0]=Math.min(artworkBounds[0],ab[0]);artworkBounds[1]=Math.max(artworkBounds[1],ab[1]);artworkBounds[2]=Math.max(artworkBounds[2],ab[2]);artworkBounds[3]=Math.min(artworkBounds[3],ab[3]);}
            design.translate((sourceBoard[0]+sourceBoard[2]-artworkBounds[0]-artworkBounds[2])/2,(sourceBoard[1]+sourceBoard[3]-artworkBounds[1]-artworkBounds[3])/2);
        }
        bounds=[Infinity,-Infinity,-Infinity,Infinity];
        for(var ac=0;ac<artworkCopies.length;ac++){var ab=artworkCopies[ac].geometricBounds;bounds[0]=Math.min(bounds[0],ab[0]);bounds[1]=Math.max(bounds[1],ab[1]);bounds[2]=Math.max(bounds[2],ab[2]);bounds[3]=Math.min(bounds[3],ab[3]);}
        if(bounds[0]<sourceBoard[0]-0.5||bounds[2]>sourceBoard[2]+0.5||bounds[1]>sourceBoard[1]+0.5||bounds[3]<sourceBoard[3]-0.5)throw Error('柄が元アートボードに収まりません。幅指定を小さくしてください。アートボードは変更しません。 board='+sourceBoard+' artwork='+bounds);
        // Recheck spacing after text fitting, resizing and placement.
        for(var nt=0;nt<numberTargets.length;nt++){
            var target=numberTargets[nt],inkTop=-Infinity;
            for(var it=0;it<target.items.length;it++)inkTop=Math.max(inkTop,target.items[it].geometricBounds[1]);
            var numberBounds=target.number.geometricBounds;
            target.number.translate(0,inkTop+8*72/25.4*scale/100-numberBounds[3]);
        }
        // Keep identifiers in all board-clipped exports without resizing the board or designs.
        for(var ni=0;ni<numberCopies.length;ni++){
            var number=numberCopies[ni],nb=number.geometricBounds;
            if(nb[0]<sourceBoard[0]||nb[2]>sourceBoard[2]||nb[1]>sourceBoard[1]||nb[3]<sourceBoard[3]){
                number.translate(sourceBoard[2]-1-nb[2],sourceBoard[1]-1-nb[1]);
            }
        }
        dst.artboards[0].artboardRect=sourceBoard;
        var opts=new IllustratorSaveOptions();opts.pdfCompatible=true;
        dst.saveAs(aiFile,opts);
        var png=new ExportOptionsPNG24();png.transparency=!job.printBackground;png.artBoardClipping=true;png.horizontalScale=200;png.verticalScale=200;
        dst.exportFile(new File(out.fsName+'/'+id+'.png'),ExportType.PNG24,png);
        var previewBackground=null;
        if(!backgroundCopy){
            previewBackground=dst.pathItems.rectangle(sourceBoard[1],sourceBoard[0],boardWidth,boardHeight);
            var black=new CMYKColor();black.black=100;previewBackground.fillColor=black;previewBackground.stroked=false;previewBackground.zOrder(ZOrderMethod.SENDTOBACK);
        }
        png.transparency=false;
        dst.exportFile(new File(out.fsName+'/'+id+'-preview.png'),ExportType.PNG24,png);
        if(previewBackground)previewBackground.remove();
        for(i=dst.textFrames.length-1;i>=0;i--) dst.textFrames[i].createOutline();
        var pdf=new PDFSaveOptions();pdf.preserveEditability=false;
        dst.saveAs(new File(out.fsName+'/'+id+'-outlined.pdf'),pdf);
        dst.close(SaveOptions.DONOTSAVECHANGES);dst=null;
        if(typeof NAIRE_JOB==='undefined') alert('出力しました: '+out.fsName+'\n実注文に使う前に文字と寸法を確認してください。');
    } finally {
        if(dst) dst.close(SaveOptions.DONOTSAVECHANGES);
        try { if(src) src.close(SaveOptions.DONOTSAVECHANGES); } catch(closeError) {} try{workingSource.remove();}catch(removeError){} app.userInteractionLevel=oldInteraction;
    }
})();







