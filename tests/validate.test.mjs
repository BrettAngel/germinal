import test from 'node:test'; import assert from 'node:assert/strict';
import * as V from '../lib/validate.js';
const good='A'.repeat(V.CELL_DATA_LENGTH);
test('expected length', ()=>{ assert.equal(V.CELL_DATA_LENGTH, 1584000); });
test('client encoder length', ()=>{ const b=Buffer.alloc(900*660*2); assert.equal(b.toString('base64').length, V.CELL_DATA_LENGTH); });
test('themes accepted', ()=>{ for(const [i,o] of [['love','love'],[' Love ','love'],['Climate  Change','climate change'],['new-year 2027','new-year 2027'],[undefined,'love'],[null,'love'],['','love'],['x'.repeat(40),'x'.repeat(40)]]) assert.deepEqual(V.validateTheme(i),{ok:true,value:o}); });
test('themes rejected', ()=>{ for(const t of ['<img src=x onerror=alert(1)>','x'.repeat(41),'joy!','été','a"b',"a'b",'a/b',123,{}]) assert.equal(V.validateTheme(t).ok,false, String(t)); });
test('share ids', ()=>{ for(const id of ['x7k2ab','keepalive','test','a1']) assert.ok(V.validateShareId(id).ok); for(const id of ['','X7K2AB','a-b','<x>','a'.repeat(13),'../x',null]) assert.equal(V.validateShareId(id).ok,false); });
test('generation', ()=>{ for(const g of [0,1,16,1000000]) assert.ok(V.validateGeneration(g).ok); assert.equal(V.validateGeneration(undefined).value,1); for(const g of [-1,1.5,'3',NaN,Infinity,1000001,null===0]) assert.equal(V.validateGeneration(g).ok,false, String(g)); });
test('cellData', ()=>{ assert.ok(V.validateCellData(good).ok); for(const c of [undefined,'',good.slice(1),good+'A','!'+good.slice(1),123]) assert.equal(V.validateCellData(c).ok,false); });
test('save body', ()=>{
  const r=V.validateSaveBody({theme:'Love',generation:16,parentId:null,cellData:good,contributorId:'dev_abc123xyz0'});
  assert.ok(r.ok); assert.equal(r.value.theme,'love'); assert.equal(r.value.stabMap,null);
  assert.equal(V.validateSaveBody({cellData:good}).value.contributorId,'anonymous');
  for(const b of [null,[],'x',{cellData:good,theme:'<b>'},{cellData:good,parentId:'<x>'},{cellData:good,contributorId:'<x>'},{cellData:good,stabMap:5},{cellData:good,generation:-1},{theme:'love'}]) assert.equal(V.validateSaveBody(b).ok,false, JSON.stringify(b).slice(0,60));
});
