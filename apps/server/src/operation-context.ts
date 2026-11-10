import {AsyncLocalStorage} from 'node:async_hooks';
import type {OperationAnchors} from './operation-journal.js';

export interface OperationExecutionContext {
  id:string;
  writeAttempted:boolean;
  checkpoint:(anchors:OperationAnchors)=>Promise<void>;
  defer:()=>void;
  complete:(anchors:OperationAnchors)=>Promise<unknown>;
  uncertain:(reason:string)=>Promise<unknown>;
  holdAsync?:()=>()=>void;
}
export const operationContext=new AsyncLocalStorage<OperationExecutionContext>();
