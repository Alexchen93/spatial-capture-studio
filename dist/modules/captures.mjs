const DB='spatial-capture-v1',STORE='photos';
export function openStore(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('儲存空間被其他頁面鎖定'))})}
function transaction(db,mode,action){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let req;try{req=action(store)}catch(e){reject(e);return}tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('儲存作業中斷'))})}
export const listPhotos=db=>transaction(db,'readonly',s=>s.getAll());
export const putPhoto=(db,item)=>transaction(db,'readwrite',s=>s.put(item));
export const deletePhoto=(db,id)=>transaction(db,'readwrite',s=>s.delete(id));
export const clearPhotos=db=>transaction(db,'readwrite',s=>s.clear());
