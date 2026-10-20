import { mkdirSync, writeFileSync } from 'node:fs';
import { buildRealBeijing2022, realSource } from '../server/content/beijing2022Real';
import { typeLabels } from '../shared/model';
import manifest from '../content-assets/beijing-2022/manifest.json';
const content = buildRealBeijing2022();
const directory = 'docs/beijing-2022-real';
mkdirSync(directory, { recursive: true });
const rows = content.analysis
  .map(
    (a) =>
      `| ${a.number} | ${a.title} | ${typeLabels[a.type]} | ${a.score} | ${a.knowledge} | ${a.template} | ${a.figures.length ? '图' + a.figures.join('、') : a.number === 11 ? '原数据表' : '无插图'}；PDF第${a.pages.join('、')}页 | ${a.scoring} |`,
  )
  .join('\n');
writeFileSync(
  `${directory}/逐题分析与来源.md`,
  `# 2022年北京中考物理真题：逐题分析与来源\n\n${realSource}\n\n## 原卷身份与范围\n\n使用用户工作目录内已有的2022北京中考完整试题与参考答案PDF。该文件是第三方公开资料重排合卷，并非宣称为官方原始扫描文件：共11页，1—8页为26道试题，9—10页为参考答案，第11页是宣传内容，未录入题目。正式试卷为26题、70分、70分钟。\n\n来源PDF：[本地完整文件](source.pdf)；[公开同源PDF](${manifest.sourceUrl})；[发布页面](https://www.gaokzx.com/c/202206/62404.html)。\n\n源文件SHA256：\`${manifest.sourceSha256}\`。\n\n## 逐题题型与输入方式\n\n| 题号 | 内容 | 题型 | 分值 | 知识点 | 复用模板 | 插图及来源页 | 网页评分 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n## 原图截图保证\n\n- 图1—图24及第11题数据表，共24个截图文件；图23、图24保留在同一幅来源组合图中。\n- 截图直接从PDF指定页矩形以216dpi渲染，没有AI生成、重绘、擦除水印或重新绘制刻度。来源水印与图中文字保留。\n- PNG与网页使用的无损WebP解码像素逐一相等；每张图的来源页、坐标、尺寸和文件/像素哈希在 [image-provenance.json](image-provenance.json)。\n- 可运行 \`python -X utf8 scripts/verify-real-figures.py\` 从附带PDF重新生成像素并逐一比较，不只核对清单。\n- 第10、18、21、24、25题的跨页图文已按题归并，未遗漏续图或材料。\n\n## 题干校录与答案处理\n\n题号、设问、条件、数据、选项顺序及每题分值来自原题。网页仅调整数学排版、单位空格与作答控件，不编造替代题。资料版的“平玻璃板面镜”“中国天限”排字错误分别校读为“平面镜”“中国天眼”，不改变设问。\n\n第20题资料版答案误印密度“27”；题干质量54g、体积20cm³，正确计算54÷20=2.7g/cm³。网页答案与解析明确注明这一校正，保留题干和原图。\n\n每题总分与原卷一致。来源仅给部分题目总分，未提供全部逐空分值细则；网页第19、20题按1＋1＋2分分配、第24题按1＋1＋2分分配，属于数字化练习配置，不冒称官方逐点评分细则。\n\n全卷52分可自动判分，18分待人工评阅。第21题两项实验结论、第22题两项实验步骤、第23题论证、第24题开放解释以及两道计算题保留人工评阅。第22题方案用独立开放小问承载原横线内容，可文字、手写或拍照；没有增加新设问。\n\n## 与旧原创卷的关系\n\n此前“北京中考风格·原创模拟卷”退出公开目录，保留旧题版本和已有作答记录；新题库与试卷使用独立ID、明确2022真题名称。启动演示模式默认安装真题，不再安装原创北京模拟卷。\n\n本次复用现有单选、多选、实验、科普阅读、计算模板，以及稳定填空、图像块和开放小问；无需新增自编题型。\n`,
);
writeFileSync(`${directory}/paper.json`, JSON.stringify(content, null, 2) + '\n');
writeFileSync(
  `${directory}/参考答案与校读说明.md`,
  `# 2022北京中考物理：参考答案与校读说明\n\n原参考答案在来源PDF第9—10页。以下解题说明为数字化校读补充，不替换原题；详见逐题分析与来源。\n\n${content.questions.map((q) => `## ${q.title}\n\n${q.solution!.choices.length ? '正确选项：' + q.solution!.choices.map((s) => s.toUpperCase()).join('、') + '。\n\n' : ''}${q.solution!.explanation}`).join('\n\n')}\n`,
);
console.log(
  `Exported real 2022 Beijing paper: ${content.questions.length} questions, 70 points, original figures 1-24.`,
);
