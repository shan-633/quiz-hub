import katex from 'katex';
import type {AnswerData,Block,Grade,Question,QuestionType,ResponseValue} from './model';
export const emptyResponse=():ResponseValue=>({choiceIds:[],blankValues:{},markdown:'',drawingPages:[],imagePages:[]});
export const emptyAnswer=():AnswerData=>({...emptyResponse(),parts:{},flagged:false});
export function publicQuestion(q:Question):Question {const {solution,...safe}=q;return safe;}
export function walkBlocks(blocks:Block[]):Block[]{return blocks.flatMap(b=>[b,...('children'in b?walkBlocks(b.children):[])]);}
export function blankRefs(blocks:Block[]):string[]{return walkBlocks(blocks).flatMap(b=>{
 const text=b.type==='paragraph'?b.text:b.type==='table'?[...b.headers,...b.rows.flat()].join(' '):'';
 return [...text.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g)].map(m=>m[1]);
});}
const equalSet=(a:string[],b:string[])=>new Set(a).size===a.length&&a.length===b.length&&a.every(x=>b.includes(x));
const hasOpen=(a:ResponseValue)=>!!a.markdown.trim()||a.imagePages.length>0||a.drawingPages.some(p=>p.strokes.some(s=>s.points.length>0));
export function isAnswered(q:Question,a:AnswerData):boolean {
 if(q.type==='single'||q.type==='multiple')return a.choiceIds.length>0;
 if(q.type==='calculation')return hasOpen(a);
 return q.blanks.every(b=>!!a.blankValues[b.id]?.trim())&&walkBlocks(q.content).filter(b=>b.type==='subquestion'&&b.responseKind!=='blanks').every(b=>b.type==='subquestion'&&(b.responseKind==='open'?hasOpen(a.parts[b.id]??emptyResponse()):(a.parts[b.id]?.choiceIds.length??0)>0));
}
export function gradeQuestion(q:Question,a:AnswerData):Grade {
 const details:Grade['details']={};let earned=0,pending=false;
 const add=(id:string,max:number,ok:boolean,manual=false)=>{const points=ok&&!manual?max:0;details[id]={earned:points,max,pending:manual};earned+=points;pending||=manual;};
 if(q.type==='calculation')add('open',q.score,false,hasOpen(a));
 else if(q.type==='single'||q.type==='multiple')add('choices',q.score,equalSet(a.choiceIds,q.solution?.choices??[]));
 else {
  for(const blank of q.blanks){
   const value=a.blankValues[blank.id]?.trim()??'',rule=q.solution?.blanks[blank.id];let ok=false;
   if(value&&rule){if(blank.kind==='number'){const n=Number(value);ok=Number.isFinite(n)&&rule.accepted.some(v=>Number.isFinite(Number(v))&&Math.abs(n-Number(v))<=(rule.tolerance??0));}
    else {const normalize=(v:string)=>rule.ignoreWhitespace?v.replace(/\s/g,''):v.trim();ok=rule.accepted.some(v=>normalize(v)===normalize(value));}}
   add(blank.id,blank.score,ok,blank.kind==='manual'&&!!value);
  }
  for(const block of walkBlocks(q.content)){if(block.type!=='subquestion'||block.responseKind==='blanks')continue;const part=a.parts[block.id]??emptyResponse();add(block.id,block.score,equalSet(part.choiceIds,q.solution?.partChoices?.[block.id]??[]),block.responseKind==='open'&&hasOpen(part));}
 }
 const answered=isAnswered(q,a);return{earned,max:q.score,pending,status:pending?'pending':earned===q.score?'correct':earned>0?'partial':answered?'incorrect':'unanswered',details};
}
export function validateQuestion(q:Question):string[]{
 const issues:string[]=[];const blocks=walkBlocks(q.content);const refs=blankRefs(q.content);
 if(!q.title.trim())issues.push('请填写题目标题');
 if(!blocks.some(b=>b.type==='image'||b.type==='table'||(b.type==='paragraph'&&b.text.trim())||(b.type==='formula'&&b.latex.trim())))issues.push('请填写题干内容');
 if(!Number.isFinite(q.score)||q.score<=0)issues.push('总分必须大于零');
 if(new Set(blocks.map(b=>b.id)).size!==blocks.length)issues.push('内容块 ID 重复');
 if(new Set(q.blanks.map(b=>b.id)).size!==q.blanks.length)issues.push('空格 ID 重复');
 if(refs.length!==new Set(refs).size)issues.push('每个空格只能在正文中出现一次');
 for(const id of refs)if(!q.blanks.some(b=>b.id===id))issues.push(`空格 ${id} 没有答案配置`);
 for(const blank of q.blanks){
  if(!refs.includes(blank.id))issues.push(`空格 ${blank.id} 未出现在题干中`);
  const rule=q.solution?.blanks[blank.id];if(blank.kind!=='manual'&&(!rule||!rule.accepted.length||rule.accepted.some(x=>!x.trim())))issues.push(`请填写 ${blank.label} 的标准答案`);
  if(blank.kind==='number'&&rule?.accepted.some(x=>!Number.isFinite(Number(x))))issues.push(`${blank.label} 的数值答案无效`);
 }
 const checkOptions=(options:{id:string;text:string}[],correct:string[],single:boolean)=>{
  if(options.length<2||options.some(o=>!o.text.trim()))issues.push('至少填写两个非空选项');
  if(new Set(options.map(o=>o.id)).size!==options.length)issues.push('选项 ID 重复');
  if(single&&correct.length!==1)issues.push('单选题必须设置一个正确选项');
  if(!single&&!correct.length)issues.push('多选题至少设置一个正确选项');
  if(new Set(correct).size!==correct.length||correct.some(id=>!options.some(o=>o.id===id)))issues.push('正确选项必须来自当前选项且不能重复');
 };
 if(q.type==='single'||q.type==='multiple')checkOptions(q.options,q.solution?.choices??[],q.type==='single');
 if(q.type==='fill'||q.type==='experiment'){
  const parts=blocks.filter(b=>b.type==='subquestion'&&b.responseKind!=='blanks');
  const sum=q.blanks.reduce((s,b)=>s+b.score,0)+parts.reduce((s,b)=>s+(b.type==='subquestion'?b.score:0),0);
  if(!q.blanks.length&&!parts.length)issues.push('至少添加一个空格或子题');
  if(Math.abs(sum-q.score)>0.001)issues.push('填空及子题分值之和必须等于总分');
  for(const b of blocks)if(b.type==='subquestion'){
   if(b.responseKind==='single'||b.responseKind==='multiple')checkOptions(b.options??[],q.solution?.partChoices?.[b.id]??[],b.responseKind==='single');
   if(b.responseKind==='blanks'&&Math.abs(blankRefs(b.children).reduce((s,id)=>s+(q.blanks.find(x=>x.id===id)?.score??0),0)-b.score)>0.001)issues.push(`${b.label} 的空格分值与小问分值不一致`);
  }
 }
 for(const b of blocks){
  if(b.type==='formula'){try{if(!b.latex.trim())throw new Error();katex.renderToString(b.latex,{throwOnError:true});}catch{issues.push('存在无法渲染的公式');}}
  if(b.type==='image'&&(!b.alt.trim()||(!b.assetId&&!b.src)))issues.push('请补全图片与替代文字');
  if(b.type==='table'&&(!b.headers.length||b.rows.some(r=>r.length!==b.headers.length)))issues.push('表格各行列数必须一致');
 }
 if(!q.solution?.explanation.trim())issues.push('请填写参考解析');
 if(q.type==='calculation'&&!q.allowedModes?.length)issues.push('计算题至少允许一种作答方式');
 return [...new Set(issues)];
}
export function newQuestion(type:QuestionType,bankId:string):Question{
 const id=crypto.randomUUID(),blockId=crypto.randomUUID();
 return{id,version:0,bankId,type,title:'',score:type==='calculation'?8:type==='fill'||type==='experiment'?4:3,difficulty:'基础',tags:[],content:[{id:blockId,type:'paragraph',text:''}],options:type==='single'||type==='multiple'?['a','b','c','d'].map(id=>({id,text:''})):[],blanks:[],solution:{choices:[],blanks:{},partChoices:{},explanation:''},state:'draft',allowedModes:['text','drawing','photo']};
}
