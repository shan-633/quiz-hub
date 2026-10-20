import {Link,useNavigate} from 'react-router-dom';
import {ArrowUpRight,RotateCcw,Clock3,CheckCircle2} from 'lucide-react';
import {useLoad} from '../useLoad';
import {useToast} from '../context';
import {api,json} from '../api';
import {Loading,ErrorState,EmptyState,formatDate} from '../components/ui';
export function HistoryPage(){const{data,loading,error,reload}=useLoad<any[]>('/attempts'),navigate=useNavigate(),toast=useToast();
 const again=async(id:string)=>{try{const a=await api('/attempts',{method:'POST',body:json({libraryId:id,fresh:true})});navigate(`/attempts/${a.id}`);}catch(e){toast((e as Error).message,true);}};
 return<div className="page"><div className="page-heading"><div className="eyebrow">YOUR LEARNING JOURNEY</div><h1>每一步思考，都有迹可循。</h1><p>继续未完成的练习，或回看已经走过的解题过程。</p></div>{loading?<Loading/>:error?<ErrorState message={error} retry={reload}/>:!data?.length?<EmptyState title="第一份练习，等你开始" description="挑选感兴趣的题库，完成的练习会保存在这里。"><Link className="button primary" to="/library">浏览试卷与题库<ArrowUpRight size={18}/></Link></EmptyState>:<div className="history-list">{data.map(a=><article className="history-card" key={a.id}><div className={`history-icon ${a.status==='submitted'?'done':''}`}>{a.status==='submitted'?<CheckCircle2/>:<Clock3/>}</div><div className="history-copy"><span className={`status-tag ${a.status==='submitted'?'status-published':'status-draft'}`}>{a.status==='submitted'?'已提交':'进行中'}</span><h2>{a.title}</h2><p>{a.questionCount} 道题 · {a.status==='active'?`已保存 ${a.answeredCount} 题`:a.pending?'包含主观题，待评阅':`得分 ${a.earned} 分`}<span>更新于 {formatDate(a.updatedAt)}</span></p></div><div className="history-actions">{a.status==='submitted'&&<button className="text-button" onClick={()=>void again(a.libraryId)}><RotateCcw size={16}/>再练一次</button>}<Link className={`button ${a.status==='active'?'primary':''}`} to={`/attempts/${a.id}`}>{a.status==='active'?'继续练习':'查看作答'}<ArrowUpRight size={17}/></Link></div></article>)}</div>}</div>;
}
