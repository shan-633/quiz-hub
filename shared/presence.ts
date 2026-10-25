export type PresenceStatus = 'offline' | 'online' | 'practicing' | 'examining';
export type PresenceSnapshot = Record<string, PresenceStatus>;
export const presenceLabels: Record<PresenceStatus, string> = {
  offline: '离线',
  online: '在线',
  practicing: '做题中',
  examining: '考试中',
};
