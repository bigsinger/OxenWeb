export interface DatasetColumnWidth { mode: 'fixed' | 'weight'; value: number }
export interface DatasetLayoutColumn { id: string; autoWidth: number; width?: DatasetColumnWidth }
/** System columns and explicit fixed widths never participate in proportional expansion. */
export function datasetTableLayout(columns: DatasetLayoutColumn[], available: number, systemWidth = 266, minimum = 48): { widths: Record<string, number>; total: number } {
  const widths: Record<string, number> = Object.create(null), weighted: DatasetLayoutColumn[] = [], automatic: DatasetLayoutColumn[] = [];
  let occupied = systemWidth;
  for (const column of columns) {
    if (column.width?.mode === 'weight' && column.width.value > 0) weighted.push(column);
    else {
      const width = column.width?.mode === 'fixed' ? column.width.value : column.autoWidth;
      widths[column.id] = Math.max(minimum, width); occupied += widths[column.id]!;
      if (!column.width) automatic.push(column);
    }
  }
  if (weighted.length) {
    let free = Math.max(available - occupied, minimum * weighted.length), remaining = [...weighted];
    while (remaining.length) {
      const weights = remaining.reduce((sum, column) => sum + column.width!.value, 0), small = remaining.filter(column => free * column.width!.value / weights < minimum);
      if (!small.length) { for (const column of remaining) widths[column.id] = free * column.width!.value / weights; break; }
      for (const column of small) { widths[column.id] = minimum; free -= minimum; }
      remaining = remaining.filter(column => !small.includes(column));
    }
  } else if (automatic.length && available > occupied) {
    const extra = (available - occupied) / automatic.length;
    for (const column of automatic) widths[column.id]! += extra;
  }
  return { widths, total: systemWidth + Object.values(widths).reduce((sum, width) => sum + width, 0) };
}
