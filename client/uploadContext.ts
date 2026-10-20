import {createContext} from 'react';
import type {PendingUpload} from './persistence';
export interface AnswerContext {attemptId:string;questionId:string;partId?:string}
export interface UploadOperations {pending:PendingUpload[];busy:boolean;error:string;add:(files:File[],context:AnswerContext)=>Promise<void>;retry:()=>Promise<void>;remove:(key:string)=>Promise<void>}
export const UploadContext=createContext<UploadOperations|null>(null);
