import {useState,useEffect,useCallback} from 'react';
import {api} from './api';
export function useLoad<T>(path:string){const[data,setData]=useState<T|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[loading,setLoading]=useState(true);const reload=useCallback(()=>setVersion(v=>v+1),[]);
 useEffect(()=>{let alive=true;setLoading(true);setError('');api<T>(path).then(result=>{if(alive)setData(result);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[path,version]);return{data,setData,error,loading,reload};}
