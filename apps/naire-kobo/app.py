"""Local Illustrator-backed name personalization application."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import uuid
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk
from catalog import load_catalog, attach_product, parse_launch, launch_background, image_path
import webbrowser

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / '.preview'

def validate(mark, year, shop, order, width):
    for label, value, limit in [('中央',mark,2),('上段',year,10),('下段',shop,7)]:
        if not value or len(value)>limit or any(c in value for c in '\r\n'):
            raise ValueError(f'{label}は1～{limit}文字で入力してください。')
        if any(ord(c)>0xffff for c in value):
            raise ValueError(f'{label}の補助漢字・絵文字はこの版では対応していません。')
    if not order or order.endswith(('.', ' ')) or any(c in order for c in '\\/:*?"<>|') or any(ord(c)<32 for c in order):
        raise ValueError('保存名に使えない文字があります。')
    if order.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}:
        raise ValueError('この保存名はWindowsで使用できません。')
    width_mm = None
    if width.strip():
        try: width_mm=float(width)
        except ValueError: raise ValueError('幅はmm単位の数字で入力してください。')
        if not 10<=width_mm<=1000: raise ValueError('幅は10～1000mmで入力してください。')
    return dict(mark=mark,year=year,shop=shop,id=order,widthMM=width_mm)

def generate_one(job):
    folder=CACHE / uuid.uuid4().hex
    folder.mkdir(parents=True)
    data=dict(job, outputDir=str(folder))
    job_path=folder/'job.json'
    job_path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'worker.ps1'),'-JobPath',str(job_path)],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        message=(result.stderr or result.stdout).decode('utf-8' if (result.stderr or result.stdout).startswith(b'\xef\xbb\xbf') else 'cp932',errors='replace').strip()
        raise RuntimeError(message or 'Illustratorでの作成に失敗しました。')
    for suffix in ('.ai','.png','-outlined.pdf','-preview.png'):
        if not (folder/(job['id']+suffix)).is_file(): raise RuntimeError('出力が揃いませんでした。')
    # Select a readable screen background without altering the manufacturing output.
    with Image.open(folder/(job['id']+'.png')).convert('RGBA') as image:
        if not job.get('printBackground'):
            ink_box=image.getchannel('A').getbbox()
            if ink_box:
                image=image.crop((max(0,ink_box[0]-20),max(0,ink_box[1]-20),min(image.width,ink_box[2]+20),min(image.height,ink_box[3]+20)))
        image.thumbnail((900,900),Image.Resampling.LANCZOS)
        pixels=[rgb for rgb in image.resize((100,100)).getdata() if rgb[3]>200]
        light=not pixels or sum(sum(rgb[:3])/3 for rgb in pixels)/len(pixels)>128
        background=Image.new('RGBA',image.size,'white' if job.get('printBackground') else ('black' if light else 'white'))
        background.alpha_composite(image)
        background.convert('RGB').save(folder/(job['id']+'-preview.png'))
    (folder/'入力内容.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    return folder

def generate(job):
    if len(job['layout'])<2:
        return generate_one(job)
    folder=CACHE / uuid.uuid4().hex
    folder.mkdir(parents=True)
    names=[];previews=[]
    for part,side in zip(job['layout'],('back','front')):
        side_job=dict(job,layout=[part],id=job['id']+'-'+side,printSide=side)
        side_folder=generate_one(side_job)
        for suffix in ('.ai','-outlined.pdf','.png','-preview.png'):
            name=side_job['id']+suffix
            shutil.move(str(side_folder/name),str(folder/name));names.append(name)
        with Image.open(folder/(side_job['id']+'-preview.png')) as image:
            image=image.convert('RGB');image.thumbnail((440,800),Image.Resampling.LANCZOS);previews.append(image.copy())
        metrics=side_folder/(side_job['id']+'-metrics.json')
        if metrics.exists():shutil.move(str(metrics),str(folder/metrics.name))
        for temporary_name in ('job.json','入力内容.json'):(side_folder/temporary_name).unlink(missing_ok=True)
        if not any(side_folder.iterdir()):
            try:side_folder.rmdir()
            except OSError:pass
    from PIL import ImageDraw
    preview=Image.new('RGB',(920,max(p.height for p in previews)+50),'#eeeeee')
    for index,(side,image) in enumerate(zip(('BACK','FRONT'),previews)):
        ImageDraw.Draw(preview).text((index*460+15,15),side,fill='black')
        preview.paste(image,(index*460+(460-image.width)//2,40))
    preview_name=job['id']+'-preview.png';preview.save(folder/preview_name);names.append(preview_name)
    (folder/'入力内容.json').write_text(json.dumps(dict(job,outputSides=['back','front']),ensure_ascii=False,indent=2),encoding='utf-8')
    names.append(job['id']+'-入力内容.json')
    (folder/'output-files.json').write_text(json.dumps(names,ensure_ascii=False),encoding='utf-8')
    return folder

def export_files(folder, job, destination):
    destination=Path(destination)
    destination.mkdir(parents=True,exist_ok=True)
    manifest=folder/'output-files.json'
    names=json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else [job['id']+s for s in ('.ai','-outlined.pdf','.png','-preview.png','-入力内容.json')]
    copied=[]
    try:
        for name in names:
            source=folder/('入力内容.json' if name.endswith('-入力内容.json') else name)
            target=destination/name
            with target.open('xb') as output, source.open('rb') as original:
                copied.append(target)
                shutil.copyfileobj(original,output)
    except Exception:
        for target in copied: target.unlink(missing_ok=True)
        raise

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('名入れ工房 | 商店風 商品カタログ')
        self.geometry('1120x820'); self.minsize(940,730)
        self.configure(bg='#f3f1ec')
        self.events=queue.Queue();self.busy=False;self.result=None;self.image=None
        self.products=load_catalog();self.selected_product=None;self.selected_variant=None
        style=ttk.Style(self); style.theme_use('clam')
        style.configure('TFrame',background='#f3f1ec')
        style.configure('TLabel',background='#f3f1ec',font=('Yu Gothic UI',11))
        style.configure('TButton',font=('Yu Gothic UI',11),padding=9)
        style.configure('Title.TLabel',font=('Yu Gothic UI',24,'bold'))
        style.configure('Accent.TButton',background='#1b5c52',foreground='white')
        top=ttk.Frame(self,padding=(26,20));top.pack(fill='x')
        ttk.Label(top,text='名入れ工房',style='Title.TLabel').pack(anchor='w')
        self.product_label=ttk.Label(top,text='① カタログから作る商品を選んでください');self.product_label.pack(anchor='w',pady=(5,0))
        self.catalog_button=ttk.Button(top,text='商品カタログから選ぶ',command=self.open_catalog);self.catalog_button.pack(anchor='w',pady=(8,0))
        self.variant_name=tk.StringVar()
        self.variant_picker=ttk.Combobox(top,textvariable=self.variant_name,state='readonly',width=60)
        self.variant_picker.pack(anchor='w',pady=(8,0));self.variant_picker.bind('<<ComboboxSelected>>',self.choose_variant)
        self.background_name=tk.StringVar();self.background_picker=ttk.Combobox(top,textvariable=self.background_name,state='readonly',width=60)
        self.background_picker.bind('<<ComboboxSelected>>',lambda e:self.changed())
        body=ttk.Frame(self,padding=(26,0,26,12));body.pack(fill='both',expand=True)
        left_outer=ttk.Frame(body,width=350);left_outer.pack(side='left',fill='y',padx=(0,20));left_outer.pack_propagate(False)
        left_canvas=tk.Canvas(left_outer,width=330,highlightthickness=0,bg='#f3f1ec')
        left_scroll=ttk.Scrollbar(left_outer,orient='vertical',command=left_canvas.yview);left_scroll.pack(side='right',fill='y')
        left_canvas.pack(side='left',fill='both',expand=True);left_canvas.configure(yscrollcommand=left_scroll.set)
        left=ttk.Frame(left_canvas);left_item=left_canvas.create_window((0,0),window=left,anchor='nw')
        left.bind('<Configure>',lambda e:left_canvas.configure(scrollregion=left_canvas.bbox('all')))
        left_canvas.bind('<Configure>',lambda e:left_canvas.itemconfigure(left_item,width=e.width))
        self.fields={}
        for key,label,default,helper in [
            ('mark','丸の中','俺流','1文字、または縦2段の2文字'),
            ('year','上段','創業平成二十二年','10文字まで'),
            ('shop','下段','俺流総本家','7文字まで'),
            ('id','保存名・注文番号','sample','同じ名前のファイルは上書きしません'),
            ('width','柄の幅を変更する場合のみ（mm）','','アートボードは元AIのサイズを保持します。収まらない指定は出力できません')]:
            ttk.Label(left,text=label).pack(anchor='w',pady=(9,3))
            value=tk.StringVar(value=default);self.fields[key]=value
            entry=ttk.Entry(left,textvariable=value,font=('Yu Gothic UI',13));entry.pack(fill='x',ipady=4)
            count=ttk.Label(left,text=helper,font=('Yu Gothic UI',9),wraplength=310);count.pack(anchor='w',pady=(3,0))
            value.trace_add('write',lambda *args:self.changed())
        self.collar_value=tk.StringVar();self.collar_frame=ttk.Frame(left)
        ttk.Label(self.collar_frame,text='襟の文字（ハッピ用・20文字まで）').pack(anchor='w')
        self.collar_entry=ttk.Entry(self.collar_frame,textvariable=self.collar_value,font=('Yu Gothic UI',13));self.collar_entry.pack(fill='x',ipady=4)
        ttk.Label(self.collar_frame,text='空欄なら下段の店名を両襟へ入れます。',font=('Yu Gothic UI',9)).pack(anchor='w',pady=3)
        self.collar_value.trace_add('write',lambda *args:self.changed())
        ttk.Label(left,text='長い文字は文字間を詰め、横幅を縮めます。\n選択商品の識別番号を印刷データに残します。',wraplength=310).pack(anchor='w',pady=14)
        self.preview_button=ttk.Button(left,text='① 見本を作成',style='Accent.TButton',command=self.preview);self.preview_button.pack(fill='x')
        self.save_button=ttk.Button(left,text='② AI・PDF・PNGを出力',command=self.save,state='disabled');self.save_button.pack(fill='x',pady=8)
        ttk.Button(left,text='出力フォルダーを開く',command=self.open_output).pack(fill='x')
        right=ttk.Frame(body);right.pack(side='left',fill='both',expand=True)
        ttk.Label(right,text='仕上がり確認',font=('Yu Gothic UI',14,'bold')).pack(anchor='w',pady=(8,10))
        self.canvas=tk.Canvas(right,bg='#161a19',highlightthickness=0);self.canvas.pack(fill='both',expand=True)
        self.canvas.bind('<Configure>',lambda e:self.draw())
        ttk.Label(right,text='タオル類の背景は元AIの色でAI・PDF・PNGにも入ります。アートボードは元AIのサイズを保持します。',font=('Yu Gothic UI',9),wraplength=620).pack(anchor='w',pady=8)
        self.status=tk.StringVar(value='内容を入力して「見本を作成」を押してください。')
        ttk.Label(self,textvariable=self.status,padding=(26,10),wraplength=1050).pack(fill='x')
        self.output=ROOT/'出力'
        self.protocol('WM_DELETE_WINDOW',self.close)
        self.after(150,self.poll)
        self.after(50,self.show_on_start)
        if '--smoke-test' not in sys.argv:
            launch_product,launch_variant=parse_launch(sys.argv[1:])
            if launch_product:
                self.select_product(launch_product)
                if launch_variant:
                    self.variant_picker.current(next(i for i,v in enumerate(launch_product['variants']) if v['id']==launch_variant['id']));self.choose_variant()
                launch_bg=launch_background(sys.argv[1:],launch_product)
                if launch_bg:self.background_picker.current(next(i for i,b in enumerate(launch_product["backgrounds"]) if b["id"]==launch_bg["id"]))
            else:self.after(300,self.open_catalog)

    def open_catalog(self):
        if self.busy:return
        if hasattr(self,'catalog_window') and self.catalog_window.winfo_exists():self.catalog_window.lift();return
        window=tk.Toplevel(self);self.catalog_window=window;window.title('商店風 商品カタログ');window.geometry('1060x760')
        heading=ttk.Frame(window,padding=16);heading.pack(fill='x')
        ttk.Label(heading,text='作る商品を選択',style='Title.TLabel').pack(anchor='w')
        ttk.Label(heading,text='楽天の商品画像と商品番号で選びます。選択後にサイズ・版を指定してください。').pack(anchor='w')
        search=tk.StringVar();ttk.Entry(heading,textvariable=search,width=50).pack(anchor='w',pady=(8,0))
        canvas=tk.Canvas(window,highlightthickness=0,bg='#f3f1ec');scroll=ttk.Scrollbar(window,orient='vertical',command=canvas.yview)
        scroll.pack(side='right',fill='y');canvas.pack(fill='both',expand=True);canvas.configure(yscrollcommand=scroll.set)
        cards=ttk.Frame(canvas);container=canvas.create_window((0,0),window=cards,anchor='nw')
        cards.bind('<Configure>',lambda e:canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>',lambda e:canvas.itemconfigure(container,width=e.width))
        window.bind('<MouseWheel>',lambda e:canvas.yview_scroll(-int(e.delta/120),'units'))
        self.catalog_photos=[]
        def render(*args):
            for child in cards.winfo_children():child.destroy()
            self.catalog_photos.clear();shown=0
            for product in self.products:
                if search.get().strip().lower() not in (product['name']+' '+product['id']).lower():continue
                card=ttk.Frame(cards,padding=10);card.grid(row=shown//4,column=shown%4,sticky='nsew',padx=5,pady=5);shown+=1
                picture_path=image_path(product)
                if picture_path.exists():
                    image=Image.open(picture_path).convert('RGB');image.thumbnail((215,170));photo=ImageTk.PhotoImage(image);self.catalog_photos.append(photo)
                    button=ttk.Button(card,image=photo,command=lambda p=product:self.select_product(p));button.pack()
                ttk.Label(card,text=product['name'],wraplength=215,font=('Yu Gothic UI',11,'bold')).pack(anchor='w',pady=(5,0))
                ttk.Label(card,text=product['id'],font=('Yu Gothic UI',9)).pack(anchor='w')
                ttk.Button(card,text='この商品を作る',command=lambda p=product:self.select_product(p)).pack(fill='x',pady=5)
                ttk.Button(card,text='楽天で確認',command=lambda p=product:webbrowser.open(p['rakutenUrl'])).pack(fill='x')
            for col in range(4):cards.columnconfigure(col,weight=1)
        search.trace_add('write',render);render();window.transient(self);window.lift()

    def select_product(self,product):
        self.selected_product=product;variants=product['variants']
        self.variant_picker['values']=[self.variant_title(v) for v in variants]
        self.fields['width'].set('');self.selected_variant=None
        self.background_picker.pack_forget();self.background_name.set('')
        if product.get('backgrounds'):
            self.background_picker['values']=['背景色：'+b['name']+'（元AI）' for b in product['backgrounds']]
            self.background_picker.set('背景色を選択してください');self.background_picker.pack(anchor='w',pady=(8,0))
        self.collar_value.set('');self.collar_frame.pack_forget()
        if product.get('collarFrames'):self.collar_frame.pack(fill='x',before=self.preview_button,pady=8)
        self.product_label.configure(text=product['name']+'  / '+product['id']+('  ／ 背面・前面（胸）を別ファイルで出力' if len(variants[0]['layouts']['1'])>1 else ''))
        if len(variants)==1:self.variant_picker.current(0);self.choose_variant()
        else:self.variant_picker.set('サイズ・版を選択してください');self.changed()
        if hasattr(self,'catalog_window') and self.catalog_window.winfo_exists():self.catalog_window.destroy()

    def variant_title(self,variant):
        return f"{'背景色：' if self.selected_product.get('printBackground') and not self.selected_product.get('backgrounds') else ''}{variant['name']}  / 柄の配置枠 {variant['designWidthMm']:g} × {variant['designHeightMm']:g} mm"

    def choose_variant(self,event=None):
        if not self.selected_product:return
        index=self.variant_picker.current()
        if index<0:self.selected_variant=None;return
        self.selected_variant=self.selected_product['variants'][index]
        self.product_label.configure(text=self.selected_product['name']+'  / '+self.selected_product['id']+('  ／ 背面・前面（胸）を別ファイルで出力' if len(self.selected_variant['layouts']['1'])>1 else ''))
        self.changed()

    def show_on_start(self):
        self.update_idletasks()
        screen_width,screen_height=self.winfo_screenwidth(),self.winfo_screenheight()
        width=min(1120,max(640,screen_width-60))
        height=min(960,max(500,screen_height-100))
        self.minsize(min(940,width),min(730,height))
        self.geometry(f'{width}x{height}+{max(0,(screen_width-width)//2)}+{max(0,(screen_height-height)//2)}')
        self.deiconify()
        self.lift()
        self.attributes('-topmost',True)
        self.focus_force()
        self.after(1500,lambda:self.attributes('-topmost',False))

    def changed(self):
        self.result=None
        if hasattr(self,'save_button'): self.save_button.configure(state='disabled')
        if hasattr(self,'status'):self.status.set('入力を変更しました。見本を作成し直してください。')

    def selected_background(self):
        index=self.background_picker.current()
        colors=self.selected_product.get("backgrounds",[]) if self.selected_product else []
        return colors[index] if 0<=index<len(colors) else None

    def preview(self):
        if self.busy:return
        try:
            if not self.selected_product or not self.selected_variant:raise ValueError('カタログから商品を選んでください。')
            job=attach_product(validate(*(self.fields[k].get().strip() for k in ('mark','year','shop','id','width'))),self.selected_product,self.selected_variant,self.selected_background())
            if job.get('collarFrames'):
                collar=self.collar_value.get().strip() or job['shop']
                if len(collar)>20 or any(c in collar for c in '\r\n') or any(ord(c)>0xffff for c in collar):raise ValueError('襟の文字は20文字以内の1行で入力してください。')
                job['collarText']=collar
        except ValueError as e: messagebox.showerror('入力を確認してください',str(e));return
        self.busy=True;self.preview_button.configure(state='disabled');self.save_button.configure(state='disabled')
        self.catalog_button.configure(state='disabled');self.variant_picker.configure(state='disabled')
        self.collar_entry.configure(state='disabled');self.background_picker.configure(state='disabled')
        self.status.set('Illustratorで見本を作成しています…')
        def work():
            try:self.events.put(('ok',job,generate(job)))
            except Exception as e:self.events.put(('error',str(e)))
        threading.Thread(target=work,daemon=True).start()

    def poll(self):
        try:
            event=self.events.get_nowait()
            self.busy=False;self.preview_button.configure(state='normal')
            self.catalog_button.configure(state='normal');self.variant_picker.configure(state='readonly')
            self.collar_entry.configure(state='normal');self.background_picker.configure(state='readonly')
            if event[0]=='error':
                self.status.set('作成に失敗しました。');messagebox.showerror('作成エラー',event[1])
            else:
                _,job,folder=event
                self.image=Image.open(folder/(job['id']+'-preview.png')).copy();self.draw()
                current=tuple(self.fields[k].get().strip() for k in ('mark','year','shop','id','width'))
                try: matches=attach_product(validate(*current),self.selected_product,self.selected_variant,self.selected_background())==dict(job,collarText=job["shop"]) and (self.collar_value.get().strip() or job["shop"])==job["collarText"]
                except ValueError:matches=False
                if matches:
                    self.result=(job,folder);self.save_button.configure(state='normal')
                    self.status.set('見本を作成しました。内容を確認して出力してください。寸法：'+('元データの大きさ' if job['widthMM'] is None else str(job['widthMM'])+'mm幅'))
                else:self.status.set('作成中に入力が変わりました。表示は変更前の見本です。作成し直してください。')
        except queue.Empty:pass
        self.after(150,self.poll)

    def draw(self):
        self.canvas.delete('all')
        w=max(1,self.canvas.winfo_width());h=max(1,self.canvas.winfo_height())
        if self.image:
            picture=self.image.copy();picture.thumbnail((max(1,w-24),max(1,h-24)),Image.Resampling.LANCZOS)
            self.photo=ImageTk.PhotoImage(picture);self.canvas.create_image(w/2,h/2,image=self.photo)
        else:self.canvas.create_text(w/2,h/2,text='ここにIllustratorで作成した\n見本が表示されます',fill='#c1c8c4',font=('Yu Gothic UI',15),justify='center')

    def save(self):
        if not self.result:return
        selected=filedialog.askdirectory(title='出力先フォルダー',initialdir=str(self.output if self.output.exists() else ROOT))
        if not selected:return
        job,folder=self.result
        try:export_files(folder,job,selected)
        except FileExistsError:messagebox.showerror('保存名が重複しています','同名のファイルがあります。別の保存名で見本を作成するか、別のフォルダーを選んでください。');return
        except Exception as e:messagebox.showerror('保存エラー',str(e));return
        self.output=Path(selected);self.status.set('出力しました：'+selected)
        messagebox.showinfo('出力完了','編集用AI・印刷用PDF・PNG・確認画像・入力内容を保存しました。前後がある商品は -back が背面、-front が前面です。')

    def open_output(self):
        self.output.mkdir(parents=True,exist_ok=True);os.startfile(str(self.output))

    def close(self):
        if self.busy:messagebox.showinfo('作成中','Illustratorの作成が終わるまでお待ちください。');return
        self.destroy()

if __name__=='__main__':
    if '--smoke-test' in sys.argv:
        app=App();app.update();app.after(300,app.destroy);app.mainloop();print('GUI OK')
    else:App().mainloop()
