import { useRef, useState } from 'react';
import { randomId } from '../../../shared/browserIds';
import { Upload } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context';
export function ImageUploader({ onUploaded }: { onUploaded: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    toast = useToast();
  return (
    <>
      <button className="button small" disabled={busy} onClick={() => input.current?.click()}>
        <Upload size={14} />
        {busy ? '正在上传…' : '上传题干图片'}
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择题干图片"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
            const body = new FormData();
            body.append('kind', 'question');
            body.append('clientId', randomId());
            body.append('file', file);
            const result = await api('/uploads', { method: 'POST', body });
            onUploaded(result.id);
          } catch (error) {
            toast((error as Error).message, true);
          } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
          }
        }}
      />
    </>
  );
}
