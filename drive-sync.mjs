import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

// Credentials remain in Render environment variables; never saved with samples.
export function createDriveSync({rootFolderId, outboxRoot, fetchImpl = fetch, credentials = () => ({
  clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
})}) {
  let running = false;
  let auth = null;
  const quote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function token() {
    if (auth && auth.expiresAt > Date.now() + 60000) return auth.value;
    const c = await credentials();
    if (!c.clientId || !c.clientSecret || !c.refreshToken) throw new Error('drive_not_configured');
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,
        refresh_token:c.refreshToken,grant_type:'refresh_token'}), signal:AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('drive_auth_failed');
    const body = await response.json();
    if (!body.access_token) throw new Error('drive_auth_failed');
    auth = {value:body.access_token,expiresAt:Date.now()+(body.expires_in || 3600)*1000};
    return auth.value;
  }
  async function api(url, options = {}) {
    const response = await fetchImpl(url, {...options, headers:{...options.headers,
      authorization:`Bearer ${await token()}`},signal:AbortSignal.timeout(30000)});
    if (!response.ok) { if (response.status === 401) auth = null; throw new Error('drive_request_failed'); }
    return response.json();
  }
  async function folder(parentId, name) {
    const q = `'${quote(parentId)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${quote(name)}'`;
    const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`);
    if (found.files?.length) return found.files[0].id;
    const created = await api('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parentId]}),
    });
    return created.id;
  }
  async function upload(parentId, name, source) {
    const mime = name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : 'application/json';
    // Read back existing names to recover from an upload whose response was lost.
    const q = `'${quote(parentId)}' in parents and trashed = false and name = '${quote(name)}'`;
    const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`);
    if (found.files?.length) return found.files[0].id;
    const boundary = `goroku_${randomUUID()}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name,parents:[parentId]})}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const bytes = await readFile(source);
    const body = Buffer.concat([head,bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', {
      method:'POST',headers:{'content-type':`multipart/related; boundary=${boundary}`},body,
    })).id;
  }
  async function syncOne(sampleDir) {
    const syncPath = path.join(sampleDir,'drive-sync.json');
    const state = JSON.parse(await readFile(syncPath,'utf8'));
    if (state.status === 'uploaded') return state;
    const characterFolderId = state.characterFolderId || await folder(rootFolderId,state.characterFolder);
    const sampleFolderId = state.sampleFolderId || await folder(characterFolderId,state.sampleFolder);
    state.characterFolderId = characterFolderId;state.sampleFolderId = sampleFolderId;
    state.uploadedFiles ||= {};
    await writeFile(syncPath,JSON.stringify(state,null,2));
    for (const name of state.files) {
      if (state.uploadedFiles[name]) continue;
      const fileId = await upload(sampleFolderId,name,path.join(sampleDir,name));
      const meta = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents,size`);
      const local = await readFile(path.join(sampleDir,name));
      if (meta.name !== name || !meta.parents?.includes(sampleFolderId) || Number(meta.size)!==local.length) throw new Error('drive_verify_failed');
      state.uploadedFiles[name] = fileId;
      await writeFile(syncPath,JSON.stringify(state,null,2));
    }
    state.status = 'uploaded';state.uploadedAt = new Date().toISOString();
    state.folderUrl = `https://drive.google.com/drive/folders/${sampleFolderId}`;
    await writeFile(syncPath,JSON.stringify(state,null,2));
    // Keep the small layout/index; discard local media only after verified upload.
    await Promise.all(['確認.png','製作.svg'].map(name => unlink(path.join(sampleDir,name)).catch(()=>{})));
    return state;
  }
  async function drain() {
    const c = await credentials();
    if (running || !c.clientId || !c.clientSecret || !c.refreshToken) return;
    running = true;
    try {
      const counts = await readdir(outboxRoot,{withFileTypes:true}).catch(()=>[]);
      for (const count of counts) {
        if (!count.isDirectory() || !/^\d+文字$/.test(count.name)) continue;
        const dir = path.join(outboxRoot,count.name);
        for (const sample of await readdir(dir,{withFileTypes:true})) {
          if (!sample.isDirectory() || !/^[0-9a-f]{64}$/.test(sample.name)) continue;
          try { await syncOne(path.join(dir,sample.name)); }
          catch { /* Keep pending bytes for the next retry; never log credentials or customer text. */ }
        }
      }
    } finally { running = false; }
  }
  return {drain,syncOne};
}
