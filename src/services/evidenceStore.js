const DATABASE_NAME = 'sahara-ai-evidence';
const DATABASE_VERSION = 1;
const STORE_NAME = 'files';

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is not supported by this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local evidence storage.'));
    request.onblocked = () => reject(new Error('Local evidence storage is blocked by another browser tab.'));
  });
}

export async function saveEvidenceFiles(files, location) {
  const database = await openDatabase();
  const timestamp = new Date().toISOString();
  const additions = Array.from(files, (file, index) => ({
    id: `evidence-${Date.now()}-${index}-${file.name}`,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    time: timestamp,
    location,
    status: 'File saved in this browser',
    hasStoredFile: true,
    blob: file,
  }));

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    additions.forEach((item) => store.put(item));
    transaction.oncomplete = () => {
      database.close();
      resolve(additions.map(({ blob, ...metadata }) => metadata));
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not save selected files locally.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Local evidence save was cancelled.'));
    };
  });
}

export async function getEvidenceFile(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      database.close();
      if (!request.result?.blob) {
        reject(new Error('The saved attachment is not available in this browser.'));
        return;
      }
      resolve(request.result.blob);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error('Could not read the saved attachment.'));
    };
  });
}

export async function removeEvidenceFile(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not delete the local attachment.'));
    };
  });
}

export async function clearEvidenceFiles() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not clear local evidence files.'));
    };
  });
}
