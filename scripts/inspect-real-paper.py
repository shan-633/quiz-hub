from pathlib import Path
import json
import fitz

root = Path(__file__).resolve().parents[1]
source = root.parent / 'research/杠杆中高难真题专项12题/sources/web_calc/2022_beijing_zhongkao_physics_with_answers.pdf'
doc = fitz.open(source)
out = root / 'docs/beijing-2022-real/source-pages'
out.mkdir(parents=True, exist_ok=True)
report = []
for i, page in enumerate(doc):
    if i >= 10:
        break
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(out / f'page-{i+1:02}.png')
    blocks = [{'box': [round(v,1) for v in b[:4]], 'text': b[4][:120].replace('\n',' ')} for b in page.get_text('blocks') if len(b)>4]
    images = [{'box': [round(v,1) for v in image['bbox']], 'size': [image['width'],image['height']]} for image in page.get_image_info()]
    report.append({'page': i+1, 'size':[page.rect.width,page.rect.height], 'blocks':blocks, 'images':images})
    print('PAGE',i+1)
    print(json.dumps({'blocks':blocks,'images':images},ensure_ascii=False))
(out.parent / 'page-layout.json').write_text(json.dumps(report,ensure_ascii=False,indent=2), encoding='utf-8')
