"""Render original PDF rectangles only. No drawing, retouching or OCR-generated figures."""
from pathlib import Path
import hashlib
import json
import shutil
import fitz
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root.parent / 'research/杠杆中高难真题专项12题/sources/web_calc/2022_beijing_zhongkao_physics_with_answers.pdf'
docdir = root / 'docs/beijing-2022-real'
assets = root / 'content-assets/beijing-2022'
docdir.mkdir(parents=True, exist_ok=True)
assets.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, docdir / 'source.pdf')
doc = fitz.open(source)
rectangles = [
 ('fig-01',1,[465,285,562,391],[1],[1]),
 ('fig-02',1,[40,390,465,529],[2],[2]),
 ('fig-03',1,[40,652,480,789],[3],[4]),
 ('fig-04',2,[433,32,562,157],[4],[5]),
 ('fig-05',2,[476,171,563,325],[5],[6]),
 ('fig-06',2,[476,342,557,433],[6],[7]),
 ('fig-07',2,[457,435,558,530],[7],[8]),
 ('fig-08',2,[35,588,399,671],[8],[9]),
 ('fig-09',3,[35,32,537,177],[9],[10]),
 ('table-11',3,[348,216,566,299],[],[11]),
 ('fig-10',3,[447,366,558,490],[10],[12]),
 ('fig-11',4,[397,32,568,177],[11],[14]),
 ('fig-12',4,[480,174,568,362],[12],[15]),
 ('fig-13',4,[84,420,181,587],[13],[16]),
 ('fig-14',4,[211,449,364,587],[14],[17]),
 ('fig-15',4,[407,449,521,587],[15],[17]),
 ('fig-16',5,[35,33,177,140],[16],[18]),
 ('fig-17',5,[35,162,319,316],[17],[19]),
 ('fig-18',5,[39,525,227,696],[18],[20]),
 ('fig-19',5,[226,464,565,698],[19],[21]),
 ('fig-20',6,[35,345,176,457],[20],[23]),
 ('fig-21',7,[102,33,502,268],[21],[24]),
 ('fig-22',8,[35,33,157,155],[22],[25]),
 ('fig-23-24',8,[116,234,490,329],[23,24],[26]),
]
records = []
for name, page_no, rect, figures, questions in rectangles:
    pix = doc[page_no-1].get_pixmap(matrix=fitz.Matrix(3,3), clip=fitz.Rect(rect), alpha=False)
    png = assets / f'{name}.png'
    pix.save(png)
    im = Image.open(png).convert('RGB')
    webp = assets / f'{name}.webp'
    im.save(webp, format='WEBP', lossless=True, method=6)
    decoded = Image.open(webp).convert('RGB')
    assert im.size == decoded.size and im.tobytes() == decoded.tobytes(), name
    records.append({'id':f'bj2022-{name}', 'name':name,'page':page_no,'rect':rect,'scale':3,'figures':figures,'questions':questions,'width':im.width,'height':im.height,'png':f'{name}.png','webp':f'{name}.webp','pngSha256':hashlib.sha256(png.read_bytes()).hexdigest(),'webpSha256':hashlib.sha256(webp.read_bytes()).hexdigest(),'pixelSha256':hashlib.sha256(im.tobytes()).hexdigest()})
manifest = {'exam':'2022年北京市初中学业水平考试物理','localSource':str(source),'sourceUrl':'https://cdn.gaokzx.com/zixunzhan/202403/ec4449f3-f743-4d24-82d9-913c62e57330.pdf','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourcePages':len(doc),'questionPages':list(range(1,9)),'answerPages':[9,10],'excludedPages':[11],'method':'PyMuPDF raster crop at 216dpi; lossless WebP pixel-identical to PNG; source watermarks retained','assets':records}
(assets/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(docdir/'image-provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Compact contact sheet for visual review. Full resolution originals remain in assets.
thumbs=[]
from PIL import ImageDraw
for record in records:
    im=Image.open(assets/record['png']).convert('RGB')
    im.thumbnail((340,220))
    cell=Image.new('RGB',(380,265),'white')
    cell.paste(im,((380-im.width)//2,28+(220-im.height)//2))
    ImageDraw.Draw(cell).text((12,8),f"{record['name']} | PDF p{record['page']} | Q{record['questions']}",fill='black')
    thumbs.append(cell)
sheet=Image.new('RGB',(4*380,6*265),'#d8e0df')
for i,im in enumerate(thumbs): sheet.paste(im,((i%4)*380,(i//4)*265))
sheet.save(docdir/'original-figure-contact-sheet.png')
print(f'Prepared {len(records)} original crops; figures 1-24 + Q11 table; all lossless pixel checks passed.')
