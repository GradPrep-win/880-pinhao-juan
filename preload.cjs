const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  dbGet: (sql, params) => ipcRenderer.invoke('db-get', sql, params).then((r) => {
    if (!r.ok) throw new Error(r.err);
    return r.row;
  }),
});
