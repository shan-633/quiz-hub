"""Apply reviewed answer boundaries; never attach an entire answer sheet to one item."""
from pathlib import Path
import json, re, unicodedata
ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'content-assets/beijing-2023-2026/metadata.json'
cache = ROOT / 'tmp/pdfs/bj2023-26'
metadata = json.loads(path.read_text(encoding='utf-8'))
def data(n): return json.loads((cache / f'p{n:03}.json').read_text(encoding='utf-8'))
def bottom(n):
    d=data(n); ys=[l['bbox'][1] for l in d['lines'] if l['bbox'][1]>d['height']*.85 and re.search(r'第.{0,4}页|物理试卷|九年级统一测试|官方微信',l['text'])]
    return min(ys)-2 if ys else d['height']-8
def rect(n,y0,y1,x0=0,x1=None): return {'page':n,'rect':[x0,max(0,y0),data(n)['width'] if x1 is None else x1,min(y1,bottom(n))]}
for paper in metadata['papers']:
    if not paper['answerRegions']: continue  # Per-question excerpt already scoped, or missing answers.
    pages=sorted(set(r['page'] for r in paper['answerRegions']))
    anchors={}
    for n in pages:
        d=data(n)
        for line in sorted(d['lines'],key=lambda l:(l['bbox'][1],l['bbox'][0])):
            text=unicodedata.normalize('NFKC',line['text']).strip()
            match=re.match(r'^(\d{1,2})\s*[.、,。]',text)
            if match and 16<=int(match[1])<=len(paper['questions']) and line['bbox'][0]<d['width']*.42:
                anchors.setdefault(int(match[1]),(n,line['bbox'][1]-1))
    if paper['key']=='2023-dongcheng': anchors[22]=(55,548.6)
    for question in paper['questions']:
        number=question['number']
        if question['type'] in ['single','multiple']:
            question['answerRegions']=[]  # Correct option IDs are already independently checked.
            continue
        if number not in anchors: raise ValueError((paper['key'],number,'missing answer boundary'))
        page,y=anchors[number]
        end,end_y=anchors[number+1] if number<len(paper['questions']) else (pages[-1],bottom(pages[-1]))
        rr=[]
        for n in range(page,end+1):
            y0=y if n==page else 0; y1=end_y if n==end else bottom(n)
            if y1-y0>1: rr.append(rect(n,y0,y1))
        question['answerRegions']=rr
        if not rr: raise ValueError((paper['key'],number,'empty answer'))
    paper['notes'].append('参考答案按题号分别裁切；选择题以核对后的选项ID评分，不把整卷答案页附到单题。')
# The answer drawing for Q18 is printed beside Q16 and Q17; separate the columns.
paper=next(p for p in metadata['papers'] if p['key']=='2026-dongcheng')
w=data(219)['width'];cut=w*.60
for number in [16,17]:
    for r in paper['questions'][number-1]['answerRegions']: r['rect'][2]=cut
paper['questions'][17]['answerRegions']=[rect(219,789.4,936.6,0,cut),rect(219,580,936.6,cut,w)]
# Shared horizontal rows in the printed marking sheets need column boundaries as well.
def question(key, number): return next(p for p in metadata['papers'] if p['key']==key)['questions'][number-1]
def replace_page(q, page, regions):
    q['answerRegions']=[r for r in q['answerRegions'] if r['page']!=page]+regions
    q['answerRegions'].sort(key=lambda r:(r['page'],r['rect'][1],r['rect'][0]))
key='2025-haidian';w=data(137)['width'];cut=w*.64
for n in [16,17,18]:
    for r in question(key,n)['answerRegions']:r['rect'][2]=cut
q=question(key,19);a=q['answerRegions'][0]['rect'];q['answerRegions']=[rect(137,a[1],a[3],0,cut),rect(137,380,a[3],cut,w)]
key='2024-xicheng';w=data(87)['width'];cut=w*.70
q=question(key,23);a=q['answerRegions'][0]['rect'];q['answerRegions']=[rect(87,a[1],a[3],0,cut),rect(87,a[1],625,cut,w)]
q=question(key,24);a=q['answerRegions'][0]['rect'];q['answerRegions']=[rect(87,a[1],625,0,cut),rect(87,625,a[3])]
# Q26's circuit is drawn above its number on the next page, beside the section heading.
q=question(key,25);q['answerRegions']=[r for r in q['answerRegions'] if r['page']!=88]
q=question(key,26);q['answerRegions'][0]['rect'][1]=0
key='2024-dongcheng';w=data(105)['width'];cut=500
q=question(key,22);a=q['answerRegions'][0]['rect'];q['answerRegions']=[rect(105,a[1],540),rect(105,540,a[3],0,cut)]
q=question(key,23);a=q['answerRegions'][0]['rect'];replace_page(q,105,[rect(105,a[1],a[3],0,cut),rect(105,540,a[3],cut,w)])
key='2025-dongcheng';w=data(167)['width'];cut=w*.42
for r in question(key,20)['answerRegions']:r['rect'][2]=cut
q=question(key,21);a=q['answerRegions'][0]['rect'];q['answerRegions']=[rect(167,a[1],a[3],0,cut),rect(167,410,a[3],cut,w)]
key='2026-xicheng';w=data(199)['width'];cut=w*.58
q=question(key,23);a=q['answerRegions'][0]['rect'];q['answerRegions']=[rect(199,a[1],a[3],0,cut),rect(199,a[1],1030,cut,w)]
for r in question(key,24)['answerRegions']:
    if r['page']==199:r['rect'][2]=cut
path.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Answer references scoped by question')
