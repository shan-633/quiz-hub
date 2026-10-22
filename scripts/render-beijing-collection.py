"""Reproduce original question/answer crops from the supplied 220-page PDF.

Never uses OCR output as visible question text. WebP is lossless and pixel-checked.
"""
from pathlib import Path
import argparse, hashlib, json, math
from functools import lru_cache
import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / 'content-assets/beijing-2023-2026/metadata.json'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'output/import/beijing-2023-2026')
    args = parser.parse_args()
    metadata = json.loads(META.read_text(encoding='utf-8'))
    source = args.source or Path(metadata['source']['path'])
    if hashlib.sha256(source.read_bytes()).hexdigest() != metadata['source']['sha256']:
        raise ValueError('Source PDF fingerprint differs from the reviewed collection')
    args.output.mkdir(parents=True, exist_ok=True)
    assetdir = args.output / 'assets'
    assetdir.mkdir(exist_ok=True)
    document = fitz.open(source)
    assets = {}
    @lru_cache(maxsize=8)
    def page_image(number):
        page = document[number - 1]
        scale = 1400 / page.rect.width
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    def crop(region):
        key = 'fullpage-raster-v1:' + metadata['source']['sha256'] + json.dumps(region, sort_keys=True)
        aid = 'bjc-' + hashlib.sha256(key.encode()).hexdigest()[:32]
        if aid in assets:
            return aid
        page = document[region['page'] - 1]
        rect = fitz.Rect(region['rect'])
        if rect.is_empty or not page.rect.contains(rect):
            # Native PDF floats can differ by <0.01 points at a page edge.
            rect = rect & page.rect
        if rect.is_empty:
            raise ValueError(region)
        scale = 1400 / page.rect.width
        # Crop a complete page raster so JPEG decoding never depends on clip order.
        original = page_image(region['page']).crop((math.floor(rect.x0*scale), math.floor(rect.y0*scale), math.ceil(rect.x1*scale), math.ceil(rect.y1*scale)))
        file = assetdir / (aid + '.webp')
        if not file.exists():
            original.save(file, format='WEBP', lossless=True, method=4)
        decoded = Image.open(file).convert('RGB')
        if original.size != decoded.size or original.tobytes() != decoded.tobytes():
            raise ValueError('Lossless image check failed: ' + aid)
        assets[aid] = { 'id': aid, 'file': 'assets/' + file.name, 'width': original.width,
            'height': original.height, 'page': region['page'], 'rect': list(rect),
            'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
            'pixelSha256': hashlib.sha256(original.tobytes()).hexdigest() }
        return aid
    result = {'source': metadata['source'], 'papers': [], 'assets': []}
    for paper in metadata['papers']:
        item = dict(paper)
        item['questions'] = []
        for q in paper['questions']:
            item['questions'].append({**q,
                'stemImages': [{'assetId': crop(r), 'caption': f"原卷第{q['number']}题 · 汇编PDF第{r['page']}页"} for r in q['regions']],
                'referenceImages': [{'assetId': crop(r), 'caption': f"第{q['number']}题参考答案 · 汇编PDF第{r['page']}页"} for r in q.get('answerRegions', [])] })
        result['papers'].append(item)
        # Four representative original questions per paper, for visual QA.
        chosen = [item['questions'][0], item['questions'][min(15, len(item['questions'])-1)], item['questions'][-3], item['questions'][-1]]
        sheet = Image.new('RGB', (1400, 1600), '#e7ecea')
        draw = ImageDraw.Draw(sheet)
        for i, q in enumerate(chosen):
            images = [Image.open(assetdir / (r['assetId'] + '.webp')).convert('RGB') for r in q['stemImages']]
            combined = Image.new('RGB', (max(im.width for im in images), sum(im.height for im in images)), 'white')
            y = 0
            for im in images:
                combined.paste(im, (0,y)); y += im.height
            combined.thumbnail((690,760))
            x,y = (i%2)*700,(i//2)*800
            sheet.paste(combined, (x,y+30)); draw.text((x+8,y+8), f"{paper['key']} Q{q['number']}", fill='black')
        sheet.save(args.output / (paper['key'] + '-review.jpg'))
        print(paper['key'], len(item['questions']), 'prepared', flush=True)
    result['assets'] = list(assets.values())
    (args.output / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'papers': len(result['papers']), 'questions': sum(len(p['questions']) for p in result['papers']), 'assets': len(assets)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
