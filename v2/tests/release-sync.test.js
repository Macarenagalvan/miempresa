import { closeDb, resetOpenCache } from "../js/storage/db.js";
import { DB_NAME } from "../js/config.js";
import { addTradeImage, attachmentsRepo, ATTACHMENT_MAX_BYTES } from "../js/storage/repos/attachments.js";
import { applyRestoreTransaction } from "../js/services/backup.js";
import { richV2 } from "./slice12.payloads.js";
import { createMemoryCloud, setSyncCloud, resetSyncCloud } from "../js/services/sync-cloud.js";
import { markAllLocalDirty, pushDirty, pullNow, resetSyncEngine, setOnlineOverride } from "../js/services/sync-engine.js";
import { getLedgerEntry } from "../js/storage/repos/sync-ledger.js";
import { resolveConflictUseCloud, resolveConflictKeepLocal } from "../js/services/sync-resolve.js";

async function freshDevice() {
  await closeDb(); resetOpenCache(); resetSyncEngine();
  await new Promise((resolve,reject)=>{
    const req=indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess=resolve; req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error("Base de prueba bloqueada"));
  });
  setOnlineOverride(true);
}

export async function run() {
  let n=0;
  const check=(ok,message)=>{if(!ok)throw new Error(message);n++;};
  const bytes=new Uint8Array(1024*1024).map((_,i)=>i%251);
  const same=async record=>{
    const got=new Uint8Array(await record.blob.arrayBuffer());
    return got.length===bytes.length && got.every((v,i)=>v===bytes[i]);
  };
  await freshDevice();
  const fixture=richV2();fixture.attachments=[];
  await applyRestoreTransaction(fixture);
  const image=await addTradeImage(fixture.trades[0].id,{
    name:"TEST-sync.png",mime:"image/png",blob:new Blob([bytes],{type:"image/png"}),phase:"BEFORE",
  });
  let failed=false;
  try {await addTradeImage(fixture.trades[0].id,{mime:"image/png",size:1,blob:new Blob([new Uint8Array(ATTACHMENT_MAX_BYTES+1)])});}
  catch {failed=true;}
  check(failed,"Tamaño real limita imágenes");
  const cloud=createMemoryCloud();
  // Force the exact JSON boundary used by RPC, so a Blob cannot survive by reference.
  const jsonCloud={
    pushRecord:async input=>cloud.pushRecord(JSON.parse(JSON.stringify(input))),
    pullRecords:async()=>JSON.parse(JSON.stringify(await cloud.pullRecords())),
  };
  setSyncCloud(jsonCloud);await markAllLocalDirty();await pushDirty();
  const wire=cloud.rows.get("attachments::"+image.id);
  check(typeof wire.payload.dataBase64==="string" && !wire.payload.blob,"Push usa bytes JSON");
  check(!(await getLedgerEntry("attachments",image.id)).dirty,"Push confirmado limpia pendiente");
  await freshDevice();await pullNow();
  let restored=await attachmentsRepo.get(image.id);
  check(await same(restored),"Segundo dispositivo reconstruye 1 MB exacto");
  check(restored.phase==="BEFORE" && restored.entityId===image.entityId,"Fase y relación conservadas");

  wire.revision++;wire.payload={...wire.payload,name:"TEST-remote.png"};
  await attachmentsRepo.put({...restored,name:"TEST-local.png"});
  await pushDirty();
  check((await resolveConflictUseCloud("attachments",image.id)).ok,"Resolver conflicto usando nube");
  restored=await attachmentsRepo.get(image.id);
  check(restored.name==="TEST-remote.png" && await same(restored),"Resolución nube conserva bytes");
  wire.revision++;
  await attachmentsRepo.put({...restored,name:"TEST-keep-local.png"});
  await pushDirty();
  check((await resolveConflictKeepLocal("attachments",image.id)).ok,"Resolver conflicto conservando local");
  check(cloud.rows.get("attachments::"+image.id).payload.name==="TEST-keep-local.png","Resolución local transmite JSON");
  setSyncCloud({pushRecord:async()=>{throw new Error("TEST offline");}});
  await attachmentsRepo.put({...await attachmentsRepo.get(image.id),name:"TEST-pending.png"});
  failed=false;try {await pushDirty();} catch {failed=true;}
  check(failed && (await getLedgerEntry("attachments",image.id)).dirty,"Fallo de red conserva pendiente");
  check(await same(await attachmentsRepo.get(image.id)),"Fallo de red conserva imagen");
  setSyncCloud(jsonCloud);await pushDirty();
  check(!(await getLedgerEntry("attachments",image.id)).dirty,"Reintento confirma pendiente");
  const corrupted={...cloud.rows.get("attachments::"+image.id),revision:100,payload:{...wire.payload,dataBase64:"???"}};
  setSyncCloud({pullRecords:async()=>[corrupted]});
  failed=false;try{await pullNow();}catch{failed=true;}
  check(failed && await same(await attachmentsRepo.get(image.id)),"Pull corrupto conserva copia local");
  resetSyncCloud();resetSyncEngine();
  document.getElementById("out").textContent+=`\nRelease sync JSON: ${n} tests OK\n`;
}
