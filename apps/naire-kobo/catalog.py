from pathlib import Path
import json,hashlib
from urllib.parse import urlparse,parse_qs
ROOT=Path(__file__).resolve().parent
def load_catalog():
 path=ROOT/'catalog.json'
 return json.loads(path.read_text(encoding='utf-8'))['products'] if path.exists() else []
def image_path(product):
 local=ROOT/product['image']
 return local if local.exists() else ROOT.parent.parent/'public'/'naire-catalog'/(product['id']+'.jpg')
def parse_launch(arguments):
 for argument in arguments:
  parsed=urlparse(argument)
  if parsed.scheme!='oreryu-naire' or parsed.netloc!='open':continue
  query=parse_qs(parsed.query)
  product_id=query.get('product',[''])[0];variant_id=query.get('variant',[''])[0]
  product=next((p for p in load_catalog() if p['id']==product_id),None)
  if product is None:return None,None
  variant=next((v for v in product['variants'] if v['id']==variant_id),None)
  return product,variant
 return None,None
def attach_product(job,product,variant):
 template=(ROOT/product['template']).resolve()
 if ROOT/'templates' not in template.parents:raise ValueError('テンプレートの保存先が不正です。')
 if not template.is_file():raise ValueError('商品のIllustratorテンプレートが見つかりません。')
 if hashlib.sha256(template.read_bytes()).hexdigest()!=product['templateSha256']:raise ValueError('テンプレートが変更されています。カタログとの対応を確認してください。')
 return dict(job,templatePath=str(template),layout=variant['layouts'][str(len(job['mark']))],templateScale=variant['scale'],productCode=product['id'],productName=product['name'],productVariant=variant['name'],printId=product['printId'],collarFrames=product.get('collarFrames',[]),collarText=job['shop'])
