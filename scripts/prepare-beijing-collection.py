"""Read the supplied collection; cache OCR coordinates and unretouched page renders.

OCR is an indexing aid only. Question/answer artwork must be cropped from the source.
"""
from pathlib import Path
import argparse, concurrent.futures, hashlib, json, os
import fitz

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tmp/pdfs/bj2023-26'
SOURCE = Path(r'D:/Program Files/WeixinData/xwechat_files/Chris633_9e4f/msg/file/2026-10/北京中考物理真题与重点区一模汇编（2023-2026）.pdf')

def prepare(number):
    output = OUT / f'p{number:03}.json'
    if output.exists():
        return number
    with fitz.open(SOURCE) as document:
        page = document[number - 1]
        native = page.get_text()
        ocr = len(native.strip()) < 150
        tp = page.get_textpage_ocr(language='chi_sim', dpi=180, full=True,
            tessdata=os.path.join(os.environ['TEMP'], 'bjweb-tessdata')) if ocr else page.get_textpage()
        lines = []
        for block in page.get_text('dict', textpage=tp)['blocks']:
            for line in block.get('lines', []):
                lines.append({'bbox': list(line['bbox']), 'text': ''.join(s['text'] for s in line['spans'])})
        data = {'page': number, 'width': page.rect.width, 'height': page.rect.height,
                'ocr': ocr, 'text': page.get_text(textpage=tp), 'lines': lines}
        output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(str(OUT / f'p{number:03}.png'))
    return number

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    with fitz.open(SOURCE) as document:
        count = len(document)
    (OUT / 'source.json').write_text(json.dumps({'path': str(SOURCE), 'pages': count,
        'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2), encoding='utf-8')
    with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
        for number in pool.map(prepare, range(1, count + 1)):
            if number % 10 == 0:
                print(f'Prepared {number}/{count}', flush=True)
