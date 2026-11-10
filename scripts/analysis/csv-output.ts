/** Spreadsheet display only; canonical sample identities remain unchanged in JSONL. */
export function analysisCsvCell(value:unknown):string{
 const text=typeof value==='string'?value:JSON.stringify(value)??'';
 const safe=/^[\s\uFEFF]*[=+\-@]/u.test(text)?"'"+text:text;
 return '"'+safe.replaceAll('"','""')+'"';
}
