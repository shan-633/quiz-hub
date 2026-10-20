import type { Block, Question } from './model';
import { blankRefs, walkBlocks } from './domain';
const uid = () => crypto.randomUUID();
export const syncScores = (q: Question) => recount(structuredClone(q));
export function insertTableBlank(
  original: Question,
  blockId: string,
  row: number,
  column: number,
): Question {
  const q = structuredClone(original),
    block = walkBlocks(q.content).find((b) => b.id === blockId);
  if (!block || block.type !== 'table' || !block.rows[row]) return q;
  const id = `blank-${uid().slice(0, 8)}`;
  block.rows[row][column] += ` {{${id}}}`;
  q.blanks.push({ id, label: `表格第 ${row + 1} 行第 ${column + 1} 列`, kind: 'text', score: 2 });
  q.solution!.blanks[id] = { accepted: [], ignoreWhitespace: true };
  return recount(q);
}
function recount(q: Question) {
  if (q.type === 'fill' || q.type === 'experiment') {
    const all = walkBlocks(q.content);
    for (const b of all)
      if (b.type === 'subquestion' && b.responseKind === 'blanks')
        b.score = blankRefs(b.children).reduce(
          (s, id) => s + (q.blanks.find((b) => b.id === id)?.score ?? 0),
          0,
        );
    q.score =
      q.blanks.reduce((s, b) => s + b.score, 0) +
      all.reduce(
        (s, b) => s + (b.type === 'subquestion' && b.responseKind !== 'blanks' ? b.score : 0),
        0,
      );
  }
  return q;
}
export function insertBlankAt(original: Question, blockId: string, position: number): Question {
  const q = structuredClone(original),
    b = walkBlocks(q.content).find((b) => b.id === blockId);
  if (!b || b.type !== 'paragraph') return q;
  const id = `blank-${uid().slice(0, 8)}`;
  b.text = b.text.slice(0, position) + ` {{${id}}} ` + b.text.slice(position);
  q.blanks.push({ id, label: `填空 ${q.blanks.length + 1}`, kind: 'text', score: 2 });
  q.solution!.blanks[id] = { accepted: [], ignoreWhitespace: true };
  return recount(q);
}
export function duplicateBlock(original: Question, id: string): Question {
  const q = structuredClone(original),
    source = walkBlocks(q.content).find((b) => b.id === id);
  if (!source) return q;
  const copied = structuredClone(source),
    refs = blankRefs([source]),
    blankMap = new Map(refs.map((id) => [id, `blank-${uid().slice(0, 8)}`]));
  for (const b of walkBlocks([copied])) {
    const old = b.id;
    b.id = uid();
    const replace = (text: string) =>
      text.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (m, id) => `{{${blankMap.get(id) ?? id}}}`);
    if (b.type === 'paragraph') b.text = replace(b.text);
    if (b.type === 'table') {
      b.headers = b.headers.map(replace);
      b.rows = b.rows.map((r) => r.map(replace));
    }
    if (b.type === 'subquestion') {
      const optionMap = new Map((b.options ?? []).map((o) => [o.id, uid()]));
      b.options = b.options?.map((o) => ({ ...o, id: optionMap.get(o.id)! }));
      if (q.solution?.partChoices?.[old])
        q.solution.partChoices[b.id] = q.solution.partChoices[old].map(
          (id) => optionMap.get(id) ?? id,
        );
    }
  }
  for (const [old, id] of blankMap) {
    const b = q.blanks.find((b) => b.id === old);
    if (b) {
      q.blanks.push({ ...b, id, label: `${b.label}（副本）` });
      q.solution!.blanks[id] = structuredClone(q.solution!.blanks[old]);
    }
  }
  const insert = (blocks: Block[]): Block[] =>
    blocks.flatMap((b) =>
      b.id === id ? [b, copied] : ['children' in b ? { ...b, children: insert(b.children) } : b],
    );
  q.content = insert(q.content);
  return recount(q);
}
export function removeBlock(original: Question, id: string): Question {
  const q = structuredClone(original),
    removed = walkBlocks(q.content).find((b) => b.id === id);
  if (!removed) return q;
  const refs = blankRefs([removed]);
  q.blanks = q.blanks.filter((b) => !refs.includes(b.id));
  for (const blank of refs) delete q.solution?.blanks[blank];
  for (const b of walkBlocks([removed]))
    if (q.solution?.partChoices) delete q.solution.partChoices[b.id];
  const remove = (blocks: Block[]): Block[] =>
    blocks
      .filter((b) => b.id !== id)
      .map((b) => ('children' in b ? { ...b, children: remove(b.children) } : b));
  q.content = remove(q.content);
  return recount(q);
}
export function reorderBlock(original: Question, sourceId: string, targetId: string): Question {
  const q = structuredClone(original);
  const reorder = (blocks: Block[]): Block[] => {
    const from = blocks.findIndex((b) => b.id === sourceId),
      to = blocks.findIndex((b) => b.id === targetId);
    if (from >= 0 && to >= 0) {
      const result = [...blocks],
        value = result.splice(from, 1)[0];
      result.splice(to, 0, value);
      return result;
    }
    return blocks.map((b) => ('children' in b ? { ...b, children: reorder(b.children) } : b));
  };
  q.content = reorder(q.content);
  return q;
}
export function removeBlank(original: Question, id: string): Question {
  const q = structuredClone(original);
  for (const b of walkBlocks(q.content)) {
    const replace = (s: string) => s.replaceAll(`{{${id}}}`, '');
    if (b.type === 'paragraph') b.text = replace(b.text);
    if (b.type === 'table') {
      b.headers = b.headers.map(replace);
      b.rows = b.rows.map((row) => row.map(replace));
    }
  }
  q.blanks = q.blanks.filter((b) => b.id !== id);
  delete q.solution?.blanks[id];
  return recount(q);
}
export function applyStarter(original: Question): Question {
  let q = structuredClone(original);
  q.content = [{ id: uid(), type: 'paragraph', text: '' }];
  q.blanks = [];
  q.solution = { choices: [], blanks: {}, partChoices: {}, explanation: '' };
  if (q.type === 'fill') q = insertBlankAt(q, q.content[0].id, 0);
  if (q.type === 'experiment') {
    q.content.push({
      id: uid(),
      type: 'image',
      src: '/diagrams/friction.svg',
      alt: '探究滑动摩擦力的实验装置',
      caption: '实验装置示意图',
      width: 90,
    });
    for (let i = 1; i <= 2; i++) {
      const id = uid();
      q.content.push({
        id: uid(),
        type: 'subquestion',
        label: `（${i}）`,
        score: 2,
        responseKind: 'blanks',
        children: [{ id, type: 'paragraph', text: '' }],
      });
      q = insertBlankAt(q, id, 0);
    }
  }
  return q;
}
