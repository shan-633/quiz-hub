import { mkdirSync, writeFileSync } from 'node:fs';
import { buildBeijingPaper, paperSource } from '../server/content/beijingPaper';
import { typeLabels, type Block } from '../shared/model';
const { paper, questions, analysis } = buildBeijingPaper();
const directory = 'docs/beijing-paper';
mkdirSync(directory, { recursive: true });
const sources = `## 参考来源与范围\n\n- [北京市官方2026中考安排](https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202604/t20260411_4579992.html)：物理笔试70分、实验操作10分，本卷只模拟笔试。\n- [北京考试报2026物理试题评析（北京日报刊载）](https://xinwen.bjd.com.cn/content/s6a3cde17e4b03fa51a8067f7.html)：参考重基础、实验实证、生活情境和阅读迁移的设计方向。\n- [2026北京卷公开转录](https://www.yeyulingfeng.com/wendang/91210055.html)：参考26题及24/6/28/4/8分的五部分结构、多选漏选规则；此为第三方转录，不将其视为官方授权题源。\n\n所有题干、选项、数据、图示与解析均为本项目重新编写；不逐字转载真题，不声称等同官方难度或预测命中。检索日期2026-10-20。\n`;
const rows = analysis
  .map(
    (a) =>
      `| ${a.number} | ${a.title} | ${typeLabels[a.type as keyof typeof typeLabels]} | ${a.score} | ${a.knowledge} | ${a.template} | ${a.reason} | ${a.assessment} |`,
  )
  .join('\n');
writeFileSync(
  `${directory}/题型分析与模板.md`,
  `# 北京中考风格·原创模拟卷（一）\n\n${paperSource}。全卷26题、70分，建议70分钟。\n\n## 逐题分析\n\n| 题号 | 题目 | 题型 | 分值 | 知识点 | 模板 | 选择理由 | 评分 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n## 新增的可复用能力\n\n1. 科普阅读题（reading）：共享材料＋填空/选择/开放小问，单独显示题型并校验小问分值。\n2. 实验·数据表与填空模板（experiment-table）：表格单元格与正文均可插入稳定空格。\n3. 实验·填空、作图与论证模板（experiment-mixed）：独立开放小问承载电路作图、解释或方案设计，文字/手写/照片可混用。\n4. 科普阅读·材料与混合小问模板（reading-mixed）：材料、信息提取、选择和论证三层结构。\n5. 北京式多选评分：新卷全对2分、漏选1分、错选/未选0分；旧题默认精确匹配规则保留。\n\n管理员在“题目管理 → 录入题目 → 题型 → 可复用模板”中使用三种新增模板。模板创建的是待编辑草稿，须填写真实题干、答案和解析后才可发布。\n\n计算题复用已有文字/Markdown、手写和照片输入，不重复造新画板。实验中的开放小问复用该输入组件，但按小问单独保存。第19题作图采用独立空白画板或照片，没有图上自动吸附、自动判图或OCR。\n\n## 评分边界\n\n客观题与客观空格共46分可自动判分；开放论证、作图和计算共24分待人工评阅。未提供人工评分工作台，不把待评阅当作最终总分。填写公式空格可使用界面提示的纯文本形式；复杂等价公式可由管理员扩充接受答案。\n\n${sources}`,
);
const render = (blocks: Block[]): string =>
  blocks
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
          return b.text.replace(/\{\{[^}]+\}\}/g, '________');
        case 'formula':
          return `$$${b.latex}$$`;
        case 'image':
          return `![${b.alt}](../../public${b.src})\n\n${b.caption}`;
        case 'table':
          return `| ${b.headers.join(' | ')} |\n| ${b.headers.map(() => '---').join(' | ')} |\n${b.rows.map((r) => `| ${r.map((c) => c.replace(/\{\{[^}]+\}\}/g, '________')).join(' | ')} |`).join('\n')}`;
        case 'group':
          return render(b.children);
        case 'subquestion':
          return `**${b.label}（${b.score}分）**\n\n${render(b.children)}${b.options ? '\n\n' + b.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n\n') : ''}`;
      }
    })
    .join('\n\n');
writeFileSync(
  `${directory}/完整试卷与参考解析.md`,
  `# ${paper.title}\n\n${paperSource}\n\n26题，70分，建议70分钟。\n\n${questions.map((q) => `## ${q.title}（${typeLabels[q.type]}，${q.score}分）\n\n${render(q.content)}${q.options.length ? '\n\n' + q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n\n') : ''}`).join('\n\n')}\n\n---\n\n# 参考答案与评分要点\n\n${questions.map((q) => `## ${q.title}\n\n${q.solution!.choices.length ? '正确选项：' + q.solution!.choices.map((i) => i.toUpperCase()).join('、') + '。\n\n' : ''}${q.solution!.explanation}`).join('\n\n')}\n\n${sources}`,
);
writeFileSync(
  `${directory}/paper.json`,
  JSON.stringify({ paper, questions, analysis }, null, 2) + '\n',
);
console.log(`Exported ${questions.length} questions and analysis to ${directory}`);
