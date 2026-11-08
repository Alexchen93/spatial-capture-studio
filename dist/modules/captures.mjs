const DB='spatial-capture-v1',STORE='photos',PROJECTS='projects';
export function openStore(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,2);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});if(!db.objectStoreNames.contains(PROJECTS))db.createObjectStore(PROJECTS,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('儲存空間被其他頁面鎖定'))})}
function transaction(db,storeName,mode,action){return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),store=tx.objectStore(storeName);let req;try{req=action(store)}catch(e){reject(e);return}tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('儲存作業中斷'))})}
export const clearPhotos=db=>transaction(db,STORE,'readwrite',s=>s.clear());
export const listProjects=db=>transaction(db,PROJECTS,'readonly',s=>s.getAll());
export const getProject=(db,id)=>transaction(db,PROJECTS,'readonly',s=>s.get(id));
export const putProject=(db,project)=>transaction(db,PROJECTS,'readwrite',s=>s.put(project));
export const deleteProject=(db,id)=>transaction(db,PROJECTS,'readwrite',s=>s.delete(id));
