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

def generate(job):
    folder=CACHE / uuid.uuid4().hex
    folder.mkdir(parents=True)
    data=dict(job, outputDir=str(folder))
    job_path=folder/'job.json'
    job_path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'worker.ps1'),'-JobPath',str(job_path)],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        message=(result.stderr or result.stdout).decode('utf-8',errors='replace').strip()
        raise RuntimeError(message or 'Illustratorでの作成に失敗しました。')
    for suffix in ('.ai','.png','-outlined.pdf','-preview.png'):
        if not (folder/(job['id']+suffix)).is_file(): raise RuntimeError('出力が揃いませんでした。')
    (folder/'入力内容.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    return folder

def export_files(folder, job, destination):
    destination=Path(destination)
    destination.mkdir(parents=True,exist_ok=True)
    names=[job['id']+s for s in ('.ai','-outlined.pdf','.png','-preview.png')]
    names.append(job['id']+'-入力内容.json')
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
        self.title('名入れ工房 | 商店風トートバッグ')
        self.geometry('1120x820'); self.minsize(940,730)
        self.configure(bg='#f3f1ec')
        self.events=queue.Queue();self.busy=False;self.result=None;self.image=None
        style=ttk.Style(self); style.theme_use('clam')
        style.configure('TFrame',background='#f3f1ec')
        style.configure('TLabel',background='#f3f1ec',font=('Yu Gothic UI',11))
        style.configure('TButton',font=('Yu Gothic UI',11),padding=9)
        style.configure('Title.TLabel',font=('Yu Gothic UI',24,'bold'))
        style.configure('Accent.TButton',background='#1b5c52',foreground='white')
        top=ttk.Frame(self,padding=(26,20));top.pack(fill='x')
        ttk.Label(top,text='名入れ工房',style='Title.TLabel').pack(anchor='w')
        ttk.Label(top,text='商店風トートバッグ M   /   商品番号 9').pack(anchor='w',pady=(5,0))
        body=ttk.Frame(self,padding=(26,0,26,12));body.pack(fill='both',expand=True)
        left=ttk.Frame(body,width=330);left.pack(side='left',fill='y',padx=(0,24));left.pack_propagate(False)
        self.fields={}
        for key,label,default,helper in [
            ('mark','丸の中','俺流','1文字、または縦2段の2文字'),
            ('year','上段','創業平成二十二年','10文字まで'),
            ('shop','下段','俺流総本家','7文字まで'),
            ('id','保存名・注文番号','sample','同じ名前のファイルは上書きしません'),
            ('width','デザインの幅（mm）','','空欄：元データの大きさ。番号も含む全体の幅')]:
            ttk.Label(left,text=label).pack(anchor='w',pady=(9,3))
            value=tk.StringVar(value=default);self.fields[key]=value
            entry=ttk.Entry(left,textvariable=value,font=('Yu Gothic UI',13));entry.pack(fill='x',ipady=4)
            count=ttk.Label(left,text=helper,font=('Yu Gothic UI',9),wraplength=310);count.pack(anchor='w',pady=(3,0))
            value.trace_add('write',lambda *args:self.changed())
        ttk.Label(left,text='長い文字は文字間を詰め、横幅を縮めます。\n商品番号9は印刷データにも残します。',wraplength=310).pack(anchor='w',pady=14)
        self.preview_button=ttk.Button(left,text='① 見本を作成',style='Accent.TButton',command=self.preview);self.preview_button.pack(fill='x')
        self.save_button=ttk.Button(left,text='② AI・PDF・PNGを出力',command=self.save,state='disabled');self.save_button.pack(fill='x',pady=8)
        ttk.Button(left,text='出力フォルダーを開く',command=self.open_output).pack(fill='x')
        right=ttk.Frame(body);right.pack(side='left',fill='both',expand=True)
        ttk.Label(right,text='仕上がり確認',font=('Yu Gothic UI',14,'bold')).pack(anchor='w',pady=(8,10))
        self.canvas=tk.Canvas(right,bg='#161a19',highlightthickness=0);self.canvas.pack(fill='both',expand=True)
        self.canvas.bind('<Configure>',lambda e:self.draw())
        ttk.Label(right,text='黒地は画面確認用です。印刷用データと透過PNGには入りません。',font=('Yu Gothic UI',9),wraplength=620).pack(anchor='w',pady=8)
        self.status=tk.StringVar(value='内容を入力して「見本を作成」を押してください。')
        ttk.Label(self,textvariable=self.status,padding=(26,10),wraplength=1050).pack(fill='x')
        self.output=ROOT/'出力'
        self.protocol('WM_DELETE_WINDOW',self.close)
        self.after(150,self.poll)
        self.after(50,self.show_on_start)

    def show_on_start(self):
        self.update_idletasks()
        screen_width,screen_height=self.winfo_screenwidth(),self.winfo_screenheight()
        width=min(1120,max(640,screen_width-60))
        height=min(820,max(500,screen_height-100))
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

    def preview(self):
        if self.busy:return
        try: job=validate(*(self.fields[k].get().strip() for k in ('mark','year','shop','id','width')))
        except ValueError as e: messagebox.showerror('入力を確認してください',str(e));return
        self.busy=True;self.preview_button.configure(state='disabled');self.save_button.configure(state='disabled')
        self.status.set('Illustratorで見本を作成しています…')
        def work():
            try:self.events.put(('ok',job,generate(job)))
            except Exception as e:self.events.put(('error',str(e)))
        threading.Thread(target=work,daemon=True).start()

    def poll(self):
        try:
            event=self.events.get_nowait()
            self.busy=False;self.preview_button.configure(state='normal')
            if event[0]=='error':
                self.status.set('作成に失敗しました。');messagebox.showerror('作成エラー',event[1])
            else:
                _,job,folder=event
                self.image=Image.open(folder/(job['id']+'-preview.png')).copy();self.draw()
                current=tuple(self.fields[k].get().strip() for k in ('mark','year','shop','id','width'))
                try: matches=validate(*current)==job
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
        messagebox.showinfo('出力完了','編集用AI・印刷用PDF・透過PNG・確認画像・入力内容を保存しました。')

    def open_output(self):
        self.output.mkdir(parents=True,exist_ok=True);os.startfile(str(self.output))

    def close(self):
        if self.busy:messagebox.showinfo('作成中','Illustratorの作成が終わるまでお待ちください。');return
        self.destroy()

if __name__=='__main__':
    if '--smoke-test' in sys.argv:
        app=App();app.update();app.after(300,app.destroy);app.mainloop();print('GUI OK')
    else:App().mainloop()
