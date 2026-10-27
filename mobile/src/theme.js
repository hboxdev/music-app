export const colors = {
  bg: '#121216',
  panel: '#1b1b21',
  raised: '#24242b',
  line: '#2c2c35',
  text: '#ececf1',
  muted: '#9a9aa6',
  accent: '#ff4f81',
  danger: '#ff6b6b',
};

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
