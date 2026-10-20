import {useState} from 'react';
import {Code2,Eye,Type} from 'lucide-react';
import type {ResponseValue} from '../../shared/model';
import {Markdown} from './Markdown';
export function CalculationAnswer({value,onChange,disabled=false}:{value:ResponseValue;onChange:(value:ResponseValue)=>void;disabled?:boolean;context?:{attemptId:string;questionId:string};allowedModes?:string[]}){
 const[preview,setPreview]=useState(false);
 return<div className="calculation-answer"><div className="answer-tabs"><span className="answer-tab active"><Type size={17}/>文字与公式</span><button className="text-button preview-button" type="button" onClick={()=>setPreview(!preview)}>{preview?<Code2 size={16}/>:<Eye size={16}/>} {preview?'继续编辑':'预览'}</button></div>{preview?<div className="markdown-preview">{value.markdown?<Markdown text={value.markdown}/>:<p className="muted">还没有输入解题过程</p>}</div>:<textarea aria-label="计算题文字答案" className="answer-textarea" placeholder={'在这里写下你的思路和计算过程…\n\n可以直接输入文字，也支持 Markdown 与 $数学公式$。'} rows={8} disabled={disabled} value={value.markdown} onChange={e=>onChange({...value,markdown:e.target.value})}/>}
 <div className="editor-hint"><span>公式示例：<code>$v=\\frac&#123;s&#125;&#123;t&#125;$</code></span><span>保留过程，也保留思考。</span></div></div>;
}
