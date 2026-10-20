import {describe,it,expect} from 'vitest';
import {AnswerSyncEngine} from '../client/syncEngine';
import {emptyAnswer} from '../shared/domain';
import type {AnswerData,SavedAnswer} from '../shared/model';
const data=(markdown:string):AnswerData=>({...emptyAnswer(),markdown});
describe('答案同步状态机',()=>{
 it('保存期间的新编辑不会被旧响应覆盖，最后一笔会继续同步',async()=>{
  let finish:(a:SavedAnswer)=>void=()=>{},started:()=>void=()=>{};const firstStarted=new Promise<void>(r=>{started=r;}),sent:any[]=[];
  const engine=new AnswerSyncEngine({},async(id,value,revision)=>{sent.push({id,value,revision});if(sent.length===1)return await new Promise<SavedAnswer>(r=>{finish=r;started();});return{data:value,revision:revision+1,updatedAt:'now'};});
  await engine.update('q',data('第一笔'));const flushing=engine.flush();await firstStarted;
  await engine.update('q',data('最后一笔'));finish({data:data('第一笔'),revision:1,updatedAt:'now'});await flushing;
  expect(sent.map(s=>s.value.markdown)).toEqual(['第一笔','最后一笔']);expect(sent[1].revision).toBe(1);expect(engine.values.q.markdown).toBe('最后一笔');expect(engine.status).toBe('saved');
 });
 it('断网后保持本机草稿，重试时使用最新内容',async()=>{
  let online=false;const persisted:any[]=[];
  const engine=new AnswerSyncEngine({},async(id,value,revision)=>{if(!online)throw new TypeError('Failed to fetch');return{data:value,revision:revision+1,updatedAt:'now'};},{put:async(id,draft)=>{persisted.push(draft);},remove:async()=>{}});
  await engine.update('q',data('离线过程'));await expect(engine.flush()).rejects.toThrow();expect(engine.status).toBe('local');expect(persisted.at(-1).data.markdown).toBe('离线过程');online=true;await engine.flush();expect(engine.status).toBe('saved');
 });
 it('恢复本机草稿时不丢内容，跨页面冲突需要显式选择',async()=>{
  const engine=new AnswerSyncEngine({q:{data:data('服务器'),revision:2,updatedAt:'now'}},async(id,value,revision)=>({data:value,revision:revision+1,updatedAt:'now'}));
  engine.restore([{questionId:'q',data:data('本地'),baseRevision:1}]);expect(engine.status).toBe('conflict');expect(engine.conflicts.q.local.markdown).toBe('本地');expect(engine.conflicts.q.remote.data.markdown).toBe('服务器');
  await engine.resolve('q','local');await engine.flush();expect(engine.values.q.markdown).toBe('本地');expect(engine.revisions.q).toBe(3);
 });
});
