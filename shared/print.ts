export interface PrintOptions {
  mode: 'reading' | 'writing';
  fontSize: 'standard' | 'large';
}
export const printModeLabels = { reading: '阅读版', writing: '作答版' };
export const printFontLabels = { standard: '标准 · 12 磅', large: '大字 · 14 磅' };
export const printPage = { width: 210, height: 297, top: 16, right: 18, bottom: 18, left: 18 };
export const answerSpaceMm = (score: number, calculation = false) =>
  calculation
    ? Math.min(80, Math.max(48, 32 + score * 4))
    : Math.min(48, Math.max(24, 18 + score * 4));
