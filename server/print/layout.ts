/** Runs only inside the isolated print browser, after embedded resources are ready. */
export async function preparePrintLayout(): Promise<string> {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  if ([...document.images].some((img) => !img.naturalWidth))
    return '有题干图片无法解码，请教师检查图片';
  if (!document.fonts.check('12px ZhixuPrint')) return '中文打印字体未就绪，请重试';
  const main = document.querySelector('main')!;
  const error = '题目中有过宽的公式或表格，请教师拆分过长内容后再生成';
  // A formula may overlap a sibling column without overflowing the whole page.
  for (const group of document.querySelectorAll<HTMLElement>('.print-options.two-columns')) {
    if (
      [...group.querySelectorAll<HTMLElement>('.print-option>div')].some(
        (el) => el.scrollWidth > el.clientWidth + 2,
      )
    )
      group.classList.remove('two-columns');
  }
  for (const formula of document.querySelectorAll<HTMLElement>('.katex')) {
    const container =
      formula.closest<HTMLElement>(
        '.print-option>div,.print-table th,.print-table td,.print-formula,.print-paragraph',
      ) ?? main;
    const style = getComputedStyle(container);
    const available =
      container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const width = Math.max(formula.scrollWidth, formula.getBoundingClientRect().width);
    if (width > available + 1) {
      formula.style.fontSize = `${Math.max(12, (parseFloat(getComputedStyle(formula).fontSize) * available) / width)}px`;
      if (Math.max(formula.scrollWidth, formula.getBoundingClientRect().width) > available + 2)
        return error;
    }
  }
  if (
    main.scrollWidth > main.clientWidth + 3 ||
    [
      ...document.querySelectorAll<HTMLElement>(
        '.print-option>div,.print-table th,.print-table td',
      ),
    ].some((el) => el.scrollWidth > el.clientWidth + 2)
  )
    return error;
  // Measure after column changes/font fitting, so pagination uses final heights.
  const pageHeight = (263 * 96) / 25.4;
  const heading = document.querySelector('.document-heading')!.getBoundingClientRect().height;
  document
    .querySelectorAll<HTMLElement>('.print-group.mediaAside,.print-subquestion')
    .forEach((el) => {
      if (el.getBoundingClientRect().height > pageHeight * 0.88) el.classList.add('long-unit');
    });
  document.querySelectorAll<HTMLElement>('.print-question').forEach((el, i) => {
    const room = (pageHeight - (i === 0 ? heading + 30 : 0)) * 0.95;
    const limit =
      document.body.classList.contains('mode-writing') && el.classList.contains('type-calculation')
        ? room
        : Math.min(room, pageHeight * 0.43);
    if (el.getBoundingClientRect().height < limit) el.classList.add('keep-question');
  });
  return '';
}
