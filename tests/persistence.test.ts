import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import {putDraft,readDrafts,enqueueUpload,readUploads,removeUpload,removeDraft} from '../client/persistence';
import {emptyAnswer} from '../shared/domain';
it('草稿和待上传图片保留到 IndexedDB，并按用户隔离',async()=>{
 await putDraft('u1','a1',{questionId:'q1',data:{...emptyAnswer(),markdown:'离线内容'},baseRevision:2});
 expect((await readDrafts('u1','a1'))[0].data.markdown).toBe('离线内容');expect(await readDrafts('u2','a1')).toEqual([]);
 await enqueueUpload({key:'image1',userId:'u1',attemptId:'a1',questionId:'q1',file:new Blob(['test'],{type:'image/png'}),name:'test.png',createdAt:1});
 const entries=await readUploads('u1','a1');expect(entries[0].name).toBe('test.png');expect(entries[0].file.size).toBe(4);expect(await readUploads('u2','a1')).toEqual([]);
 await removeUpload('image1');await removeDraft('u1','a1','q1');expect(await readDrafts('u1','a1')).toEqual([]);expect(await readUploads('u1','a1')).toEqual([]);
});
