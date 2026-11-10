import test from 'node:test';
import assert from 'node:assert/strict';
import {workbenchHasUnfinishedInput,sampleFieldCheckpointHasUnfinishedInput} from '../../../scripts/analysis/field-adoption-inputs.js';
import {createSampleFieldDraft} from '../../web/src/sample-field-config.js';

const view=()=>({version:2,operations:[],selected:'one',selectedRows:['one'],inspectorOpen:true,editing:false,json:'{"id":"one"}',jsonBaseline:'{"id":"one"}',drawer:'',feedback:'',fine:{pointer:'',note:'',values:{}},bulkValues:{},evaluationBulk:{patch:{},rowIds:[]},search:'Search view',sort:{column:'source.id',direction:'desc'},page:2,retainedInputs:[]});
test('default empty evaluation objects, open detail panels and view preferences are not unfinished editing',()=>{
  for(const extra of [{},{evaluationBulk:{}},{drawer:'evaluation'},{drawer:'file'},{drawer:'labels'},{editing:true},{drawer:'append'},{drawer:'feedback',feedback:'   '},{cellEdit:{text:'same',baseline:'same',kind:'string',originalKind:'string',presence:'value',originalPresence:'value'}}])assert.equal(workbenchHasUnfinishedInput(JSON.parse(JSON.stringify({...view(),...extra}))),false,JSON.stringify(extra));
  assert.equal(workbenchHasUnfinishedInput({...view(),evaluationBulk:{patch:{visibility:'holdout'},rowIds:['one']}}),false,'Closed applied/discarded bulk state is not a fresh pending change');
});
test('actual draft operations, changed cells and active un-applied panels still block adoption',()=>{
  for(const extra of [{operations:[{op:'update',rowId:'one',record:{id:'one',text:'Synthetic change'}}]},{editing:true,json:'{unfinished'},{cellEdit:{text:'changed',baseline:'same',kind:'string',originalKind:'string',presence:'value',originalPresence:'value'}},{drawer:'append',json:'{"id":"new"}'},{drawer:'evaluation',evaluationBulk:{patch:{familyId:null},rowIds:['one']}},{drawer:'evaluation',evaluationBulk:{patch:{suites:[]},rowIds:['one']}},{drawer:'bulk',bulkValues:{risk:'uncertain'}},{drawer:'fine',fine:{pointer:'/text',values:{},note:''}},{drawer:'feedback',feedback:'Synthetic unfinished feedback'}])assert.equal(workbenchHasUnfinishedInput({...view(),...extra}),true,JSON.stringify(extra));
  assert.equal(workbenchHasUnfinishedInput({...view(),retainedInputs:[{...view(),editing:true,json:'unfinished'}]}),true);assert.equal(workbenchHasUnfinishedInput({...view(),retainedInputs:[view()]}),false);
  assert.throws(()=>workbenchHasUnfinishedInput({version:3,operations:[]}));
});
const fields=()=>{const baseConfiguration={title:{displayName:'标题',type:'string' as const,width:{mode:'fixed' as const,value:180},visible:true,export:true}};return{version:1,baseConfiguration,drafts:[createSampleFieldDraft('id'),createSampleFieldDraft('title',baseConfiguration.title)],newId:'',selected:'title',search:'Search fields',message:'View-only navigation'};};
test('field configuration preflight ignores search and selection but compares against the saved baseline',()=>{
  assert.equal(sampleFieldCheckpointHasUnfinishedInput(JSON.parse(JSON.stringify(fields()))),false);
  assert.equal(sampleFieldCheckpointHasUnfinishedInput({...fields(),selected:'id',search:'other',message:'Changed commit description',newId:'  '}),false);
  const checkbox=fields();checkbox.drafts[1]!.visible=false;assert.equal(sampleFieldCheckpointHasUnfinishedInput(checkbox),true);
  const width=fields();width.drafts[1]!.description='Changed help';assert.equal(sampleFieldCheckpointHasUnfinishedInput(width),true);
  const reset=fields();reset.drafts[1]=createSampleFieldDraft('title');assert.equal(sampleFieldCheckpointHasUnfinishedInput(reset),true,'Resetting config creates a new initial signature but is still unsaved relative to saved config');
  const removed=fields();removed.drafts=removed.drafts.filter(field=>field.id!=='title');assert.equal(sampleFieldCheckpointHasUnfinishedInput(removed),true);
  const added=fields(),draft=createSampleFieldDraft('new_column');draft.enabled=true;added.drafts.push(draft);assert.equal(sampleFieldCheckpointHasUnfinishedInput(added),true);
  assert.equal(sampleFieldCheckpointHasUnfinishedInput({...fields(),newId:'new_column'}),true);
});
