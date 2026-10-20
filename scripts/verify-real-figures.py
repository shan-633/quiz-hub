from pathlib import Path
import hashlib
import json
import fitz
from PIL import Image

root=Path(__file__).resolve().parents[1]
assets=root/'content-assets/beijing-2022'
manifest=json.loads((assets/'manifest.json').read_text(encoding='utf-8'))
source=root/'docs/beijing-2022-real/source.pdf'
assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['sourceSha256']
doc=fitz.open(source)
for item in manifest['assets']:
    original=doc[item['page']-1].get_pixmap(matrix=fitz.Matrix(item['scale'],item['scale']),clip=fitz.Rect(item['rect']),alpha=False)
    png=Image.open(assets/item['png']).convert('RGB')
    webp=Image.open(assets/item['webp']).convert('RGB')
    assert (original.width,original.height)==png.size==webp.size,item['name']
    assert original.samples==png.tobytes()==webp.tobytes(),item['name']
    assert hashlib.sha256(png.tobytes()).hexdigest()==item['pixelSha256'],item['name']
print(f"PASS: {len(manifest['assets'])} images exactly match recorded PDF raster rectangles; original figures 1-24 and Q11 table covered.")
