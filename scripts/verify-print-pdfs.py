"""Check real export samples and render every page for visual inspection (PyMuPDF/Pillow)."""
import json
import pathlib
import re
import fitz
from PIL import Image, ImageDraw

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'tmp/pdfs/print/manifest.json').read_text(encoding='utf-8'))
target = root / 'tmp/pdfs/print/render'
target.mkdir(parents=True, exist_ok=True)
report = []
for number, sample in enumerate(manifest):
    pdf = fitz.open(sample['file'])
    assert len(pdf) == sample['pages']
    headers, thumbs, images, pages = [], [], 0, []
    for index, page in enumerate(pdf):
        assert abs(page.rect.width - 595.28) < 1 and abs(page.rect.height - 841.89) < 1
        text = page.get_text()
        assert f'{index + 1} / {len(pdf)}' in text
        assert len(text.strip()) > 30, f'Nearly empty page: {sample["file"]}/{index+1}'
        assert '\ufffd' not in text, f'Invalid glyph: {sample["file"]}/{index+1}'
        headers += [int(x) for x in re.findall(r'^第 (\d+) 题$', text, re.M)]
        for block in page.get_text('blocks'):
            if re.fullmatch(r'\s*\d+ / \d+\s*', str(block[4])):
                continue
            # Ink bounds may hang outside the CSS box slightly (CJK punctuation/math).
            assert block[0] >= 40 and block[2] <= 555 and block[1] >= 35 and block[3] <= 800, (sample['file'], index+1, block[:4])
        images += len(page.get_images())
        page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False).save(target / f'final-{number}-{index+1}.png')
        thumb = Image.open(target / f'final-{number}-{index+1}.png')
        thumb.thumbnail((300,425))
        canvas = Image.new('RGB', (320,450), '#ddd')
        canvas.paste(thumb, ((320-thumb.width)//2, 10))
        ImageDraw.Draw(canvas).text((8,435), f'PDF {number+1} / Page {index+1}', fill='black')
        thumbs.append(canvas)
        pages.append({'page':index+1,'characters':len(text),'images':len(page.get_images())})
    assert headers == list(range(1,sample['questions']+1)), headers
    all_text = '\n'.join(page.get_text() for page in pdf)
    if number < 2:
        assert images == 24, images
        assert '标准答案' not in all_text and '参考解析' not in all_text
    if number == 3:
        assert all(f'第{i}段材料' in all_text for i in range(1,25))
        assert '根据第100次实验' in all_text
        assert all_text.count('实验次数') == 4  # repeated table headers on all four table pages
    sheet = Image.new('RGB', (960,450*((len(thumbs)+2)//3)), 'white')
    for i,thumb in enumerate(thumbs): sheet.paste(thumb, ((i%3)*320,(i//3)*450))
    sheet.save(target / f'contact-{number}.png')
    report.append({'file':sample['file'],'pages':len(pdf),'questions':headers,'imageOccurrences':images,'pageDetails':pages})
(root / 'tmp/pdfs/print/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'pages':x['pages'],'questions':len(x['questions']),'images':x['imageOccurrences']} for x in report]))
