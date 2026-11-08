export interface DatasetConfigurationFile {path:string;size:number}
export interface DatasetConfigurationState {ref:string;commitId:string;configured:boolean;reason?:string;canConfigure:boolean;tables:DatasetConfigurationFile[];readmes:DatasetConfigurationFile[]}
export interface DatasetConfigurationField {name:string;type:string;uniqueIdentity:boolean;attachmentCandidate:boolean}
export interface DatasetConfigurationTable {commitId:string;path:string;size:number;sha256:string;totalRows:number;fields:DatasetConfigurationField[]}
export interface DatasetConfigurationInput {ref:string;expectedCommit:string;path:string;readmePath?:string;identityField:string;attachmentFields:string[]}
export interface DatasetConfigurationResult {commitId:string;path:string;totalRows:number;identityField:string;readmePath:string;attachmentCount:number;sourceSha256:string;warnings:string[]}
