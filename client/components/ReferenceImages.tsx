import type { Question } from '../../shared/model';
import { assetUrl } from '../api';

/** Answer assets are served only after the backend authorizes published feedback. */
export function ReferenceImages({ question }: { question: Question }) {
  const images = question.solution?.referenceImages;
  if (!images?.length) return null;
  return (
    <details className="reference-originals">
      <summary>查看原卷参考答案与评分说明（{images.length}张）</summary>
      {images.map((image, i) => (
        <figure key={`${image.assetId}-${i}`}>
          <a
            href={assetUrl(image.assetId)}
            target="_blank"
            rel="noreferrer"
            aria-label={`放大参考答案原图${i + 1}`}
          >
            <img
              src={assetUrl(image.assetId)}
              alt={image.caption || `参考答案原图${i + 1}`}
              loading="lazy"
            />
          </a>
          {image.caption && <figcaption>{image.caption}</figcaption>}
        </figure>
      ))}
    </details>
  );
}
