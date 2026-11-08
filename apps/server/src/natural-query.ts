import type { FilePreview, QueryResult } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';

/** A bounded, explainable language interface. Never evaluates SQL or executable input. */
export function naturalQuery(table: FilePreview, prompt: string, options:{maxResultRows?:number;defaultLimit?:number;returnMatchingRowsForCount?:boolean}={}): QueryResult {
  if (table.kind !== 'table' || !table.columns || !table.rows) throw new ApiError(400, 'TABLE_REQUIRED', '请选择表格文件。');
  const input = prompt.trim();
  const columns = table.columns;
  let rows = [...table.rows];
  const operations: string[] = [];
  const limitMatch = input.match(/(?:前|最多|top\s*|limit\s*)(\d+)\s*(?:行|条|rows?)?/i);
  const maximum = Math.max(1,Math.min(options.maxResultRows??500,250000));
  const limit = limitMatch ? Math.max(1, Math.min(Number(limitMatch[1]), maximum)) : Math.min(options.defaultLimit??100,maximum);
  const count = /(?:多少|数量|总数|统计|count|how many)/i.test(input);
  const columnNames = columns.map(column=>column.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).sort((a,b)=>b.length-a.length).join('|');
  const sort = input.match(new RegExp(`(?:按\\s*|order\\s+by\\s+|sort\\s+by\\s+)(${columnNames})\\s*(升序|降序|从高到低|从低到高|ascending|descending|asc|desc)?`, 'i'));
  let remaining = input.replace(limitMatch?.[0] ?? /$^/, '').replace(sort?.[0] ?? /$^/, '');
  let predicates = 0;
  for (const column of columns) {
    const escaped = column.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const condition = new RegExp(`(?:^|[\\s,，；;])${escaped}\\s*(不等于|大于等于|小于等于|大于|小于|等于|包含|不包含|>=|<=|!=|==|=|>|<|contains|equals|is)\\s*(?:["“']([^"”']*)["”']|([^,，；;\\n]+?))(?=\\s+(?:and|并且|且|以及)\\s*|$|[,，；;])`, 'i');
    const match = remaining.match(condition);
    if (!match) continue;
    const operator = match[1]!.toLowerCase();
    const value = (match[2] ?? match[3] ?? '').trim();
    if (!value) throw new ApiError(400, 'QUERY_VALUE_REQUIRED', `${column.name} 需要比较值。`);
    const numeric = ['大于等于','小于等于','大于','小于','>=','<=','>','<'].includes(operator);
    if (numeric && !Number.isFinite(Number(value))) throw new ApiError(400, 'QUERY_NUMBER_REQUIRED', '数值比较需要有效数字。');
    rows = rows.filter(row => {
      const cell = row[column.name];
      const text = String(cell ?? '').toLowerCase(), expected = value.toLowerCase();
      if (['包含','contains'].includes(operator)) return text.includes(expected);
      if (operator === '不包含') return !text.includes(expected);
      if (['不等于','!='].includes(operator)) return text !== expected;
      if (['等于','==','=','equals','is'].includes(operator)) return text === expected;
      if (cell === null || cell === '' || !Number.isFinite(Number(cell))) return false;
      const actual = Number(cell), target = Number(value);
      if (['大于','>'].includes(operator)) return actual > target;
      if (['小于','<'].includes(operator)) return actual < target;
      if (['大于等于','>='].includes(operator)) return actual >= target;
      return actual <= target;
    });
    remaining = remaining.replace(match[0], ' ');
    predicates++;
    operations.push(`${column.name} ${operator} ${JSON.stringify(value)}`);
  }
  if (!predicates) {
    const quoted = input.match(/(?:包含|搜索|查找|contains?|search(?:\s+for)?|find)\s*["“']([^"”']+)["”']/i);
    const text = quoted?.[1] ?? remaining.replace(/(?:请|帮我|查询|查找|搜索|找出|显示|所有|记录|数据|行|条|统计|总数|数量|多少|一共|how many|count|show|find|all|rows?|records?|where)/gi, '').trim();
    if (text && !/^(and|并且|且|以及|的|有|是|\s)+$/i.test(text)) {
      rows = rows.filter(row => Object.values(row).some(value => String(value ?? '').toLowerCase().includes(text.toLowerCase())));
      operations.push(`全列文本包含 ${JSON.stringify(text)}`);
    }
  } else {
    const unparsed = remaining.replace(/(?:请|帮我|查询|查找|找出|显示|所有|记录|数据|统计|总数|数量|多少|行|条|的|有|是|and|并且|且|以及|how many|count|show|find|all|rows?|records?|where|[\s,，；;。.?？])/gi, '');
    if (unparsed) throw new ApiError(400, 'QUERY_NOT_UNDERSTOOD', `未识别的条件：${unparsed}。支持“score 大于 0.8”、“label 等于 approved”、AND、按列排序、前 N 行及统计数量。`);
  }
  if (sort) {
    const column = columns.find(c => c.name.toLowerCase() === sort[1]!.toLowerCase());
    if (!column) throw new ApiError(400, 'QUERY_UNKNOWN_COLUMN', `未知排序列：${sort[1]}`);
    const descending = /降|从高到低|desc/i.test(sort[2] ?? '');
    rows.sort((a,b) => {
      const left = a[column.name], right = b[column.name];
      const comparison = left !== '' && right !== '' && left !== null && right !== null && Number.isFinite(Number(left)) && Number.isFinite(Number(right)) ? Number(left)-Number(right) : String(left??'').localeCompare(String(right??''));
      return descending ? -comparison : comparison;
    });
    operations.push(`按 ${column.name} ${descending?'降序':'升序'}`);
  }
  const totalRows = rows.length;
  const scope = `读取 ${table.rows.length} / ${table.totalRows ?? table.rows.length} 行；${(table.totalRows??0)>table.rows.length?'结果仅基于已读取的行，不代表完整数据集。':'覆盖当前表格。'}`;
  if (count&&!options.returnMatchingRowsForCount) return { engine:'local-rules', columns:[{name:'count',dtype:'integer'}], rows:[{count:totalRows}], totalRows:1, explanation:`本地中英文规则查询（非 AI）。${operations.join('；') || '无过滤条件'}。匹配 ${totalRows} 行。${scope}` };
  return { engine:'local-rules',columns,rows:rows.slice(0,limit),totalRows,explanation:`本地中英文规则查询（非 AI）。${operations.join('；') || '无过滤条件'}；最多返回 ${limit} 行。${scope}` };
}
