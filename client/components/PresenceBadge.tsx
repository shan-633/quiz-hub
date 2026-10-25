import { presenceLabels, type PresenceStatus } from '../../shared/presence';
export function PresenceBadge({ status }: { status?: PresenceStatus }) {
  if (!status) return <span className="presence-badge unknown">状态同步中</span>;
  return (
    <span className={`presence-badge ${status}`}>
      <i aria-hidden="true" />
      {presenceLabels[status]}
    </span>
  );
}
