export async function assertScrollableResultGrid(page) {
  const gridScroll = page.getByTestId('query-result-grid-scroll');
  await gridScroll.waitFor();

  const metrics = await gridScroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));

  if (metrics.scrollHeight <= metrics.clientHeight) {
    throw new Error(
      `Result grid is not vertically scrollable. clientHeight=${metrics.clientHeight}, scrollHeight=${metrics.scrollHeight}, overflowY=${metrics.overflowY}`,
    );
  }

  return gridScroll;
}
