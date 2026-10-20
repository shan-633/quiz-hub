import {useRef,useState,useEffect,useCallback} from 'react';
import type {AnswerData,Attempt,SavedAnswer} from '../shared/model';
import {emptyAnswer} from '../shared/domain';
import {api,json} from './api';
export function useAnswerSync(attempt:Attempt){
 const initial=Object.fromEntries(Object.entries(attempt.answers).map(([id,a])=>[id,a.data]));
 const[answers,setAnswers]=useState<Record<string,AnswerData>>(initial),[status,setStatus]=useState<'saved'|'saving'|'error'>('saved'),[error,setError]=useState('');
 const values=useRef(initial),revisions=useRef(Object.fromEntries(Object.entries(attempt.answers).map(([id,a])=>[id,a.revision]))),dirty=useRef(new Set<string>()),running=useRef<Promise<void>|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const flush=useCallback(async()=>{if(running.current)await running.current;if(!dirty.current.size)return;
  const promise=(async()=>{setStatus('saving');try{while(dirty.current.size){const id=[...dirty.current][0],data=structuredClone(values.current[id]),snapshot=JSON.stringify(data);const saved=await api<SavedAnswer>(`/attempts/${attempt.id}/answers/${id}`,{method:'PUT',body:json({data,expectedRevision:revisions.current[id]??0})});revisions.current[id]=saved.revision;if(JSON.stringify(values.current[id])===snapshot)dirty.current.delete(id);}setStatus('saved');setError('');}catch(e){setStatus('error');setError((e as Error).message);throw e;}})();running.current=promise;try{await promise;}finally{running.current=null;}
 },[attempt.id]);
 const update=(id:string,value:AnswerData)=>{values.current={...values.current,[id]:value};setAnswers(values.current);dirty.current.add(id);setStatus('saving');if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void flush().catch(()=>{}),600);};
 useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(dirty.current.size){event.preventDefault();}};window.addEventListener('beforeunload',before);return()=>{window.removeEventListener('beforeunload',before);if(timer.current)clearTimeout(timer.current);};},[]);
 return{answers,update,flush,status,error,get:(id:string)=>answers[id]??emptyAnswer()};
}
