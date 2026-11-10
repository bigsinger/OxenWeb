export type DatasetPresentationColumn<T> =
  | {kind:'source';key:string;column:T}
  | {kind:'labels';key:'system:human-labels'};

/** Source order/visibility stays authoritative; the annotation column follows the visible id. */
export function datasetPresentationColumns<T extends {name:string}>(columns:readonly T[]):DatasetPresentationColumn<T>[] {
  const afterId=columns.findIndex(column=>column.name==='id')+1;
  const source=(column:T):DatasetPresentationColumn<T>=>({kind:'source',key:'source:'+column.name,column});
  return [
    ...columns.slice(0,afterId).map(source),
    {kind:'labels',key:'system:human-labels'},
    ...columns.slice(afterId).map(source),
  ];
}
