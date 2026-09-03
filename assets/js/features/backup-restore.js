
/* ===== deferred feature script 15 ===== */
(function(){
/* ============================================================
   BACKUP & RESTORE :: full account data export/import, wired
   into Settings. Download builds a JSON file client-side from
   /api/user/backup and hands it to the native share sheet on
   iOS/Android (falls back to a plain download link on desktop).
   Restore uses a native file picker, confirms, then POSTs the
   file straight back to the same endpoint.
   ============================================================ */
(function(){
  const $ = (id) => document.getElementById(id);

  // deviceHeaders: shared, defined once in wwp-core.js — no local copy needed.

  function showBackupMsg(text){
    const el = $('backupMessage');
    const err = $('backupError');
    if(err) err.classList.add('hidden');
    if(el){ el.textContent = text; el.classList.remove('hidden'); }
  }
  function showBackupErr(text){
    const el = $('backupError');
    const msg = $('backupMessage');
    if(msg) msg.classList.add('hidden');
    if(el){ el.textContent = text; el.classList.remove('hidden'); }
  }

  async function downloadBackup(){
    const btn = $('downloadBackupBtn');
    if(!btn) return;
    const authed = window.WWP_getAuthState && window.WWP_getAuthState().authenticated;
    if(!authed){ showBackupErr('Sign in first to back up your account.'); return; }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Preparing…';

    try{
      const res = await fetch('/api/user/backup', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      if(!res.ok){ showBackupErr(data.error || 'Could not build backup.'); return; }

      const dateStr = new Date().toISOString().slice(0,10);
      const filename = `wherewepraying-backup-${dateStr}.json`;
      const jsonText = JSON.stringify(data, null, 2);
      const file = new File([jsonText], filename, { type: 'application/json' });

      if(navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: 'WhereWePraying? backup' });
          showBackupMsg('Backup ready — choose where to save it.');
          return;
        }catch(shareErr){
          // User cancelled the share sheet, or share failed — fall through to download link.
        }
      }

      const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showBackupMsg('Backup downloaded.');
    }catch(e){
      showBackupErr('Network error. Please try again.');
    }finally{
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function pickRestoreFile(){
    const authed = window.WWP_getAuthState && window.WWP_getAuthState().authenticated;
    if(!authed){ showBackupErr('Sign in first to restore a backup.'); return; }
    $('restoreBackupInput')?.click();
  }

  async function handleRestoreFile(e){
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!file) return;

    const confirmed = confirm('Restoring will overwrite your current prayer times, journal, Qur\'an, du\'a, and guide data on this account with what\'s in this backup file. Continue?');
    if(!confirmed) return;

    const btn = $('restoreBackupBtn');
    if(btn){ btn.disabled = true; btn.textContent = 'Restoring…'; }

    try{
      const text = await file.text();
      const res = await fetch('/api/user/backup', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: text
      });
      const data = await res.json();
      if(!res.ok){ showBackupErr(data.error || 'Could not restore this backup.'); return; }
      showBackupMsg(`Restored: ${(data.restored || []).join(', ') || 'nothing found'}. Refresh the page to see your data.`);
    }catch(err){
      showBackupErr('That file could not be read. Please try again.');
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = 'Restore from file'; }
    }
  }

  $('downloadBackupBtn')?.addEventListener('click', downloadBackup);
  $('restoreBackupBtn')?.addEventListener('click', pickRestoreFile);
  $('restoreBackupInput')?.addEventListener('change', handleRestoreFile);
})();

})();