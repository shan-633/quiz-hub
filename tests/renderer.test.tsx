// @vitest-environment jsdom
import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {QuestionRenderer} from '../client/components/QuestionRenderer';
import {emptyAnswer} from '../shared/domain';
import type {Question} from '../shared/model';
afterEach(cleanup);
const question:Question={id:'fill',version:1,bankId:'bank',type:'fill',title:'平均速度',score:2,difficulty:'基础',tags:[],content:[{id:'p',type:'paragraph',text:'速度为 {{speed}} m/s。'}],options:[],blanks:[{id:'speed',label:'速度',score:2,kind:'number',unit:'m/s'}],state:'published'};
it('正文中的空格修改使用稳定 ID，保持其他答案',()=>{
 const onChange=vi.fn();render(<QuestionRenderer question={question} answer={{...emptyAnswer(),markdown:'保留草稿'}} onChange={onChange}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'速度'}),{target:{value:'6'}});
 expect(onChange.mock.calls[0][0].blankValues).toEqual({speed:'6'});
 expect(onChange.mock.calls[0][0].markdown).toBe('保留草稿');
});
it('单选与多选使用对应的语义控件',()=>{
 render(<QuestionRenderer question={{...question,type:'multiple',blanks:[],content:[{id:'t',type:'paragraph',text:'请选择'}],options:[{id:'a',text:'甲'},{id:'b',text:'乙'}]}} answer={emptyAnswer()} onChange={()=>{}}/>);
 expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});
it('只读作答禁止编辑，题干不渲染脚本为可执行 HTML',()=>{
 render(<QuestionRenderer question={{...question,content:[{id:'p',type:'paragraph',text:'<script>alert(1)</script> {{speed}}'}]}} answer={emptyAnswer()} onChange={()=>{}} disabled/>);
 expect((screen.getByRole('textbox',{name:'速度'}) as HTMLInputElement).disabled).toBe(true);
 expect(document.querySelector('script')).toBeNull();
});
