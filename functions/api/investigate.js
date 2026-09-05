<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>WhereWePraying — Mosque Site Investigator</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 900px; margin: 30px auto; padding: 0 16px; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.4rem; }
  textarea { width: 100%; height: 140px; font-family: monospace; font-size: 13px; padding: 8px; box-sizing: border-box; }
  button { background: #0f6b4c; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 10px; margin-right: 8px; }
  button:disabled { background: #999; cursor: not-allowed; }
  button.secondary { background: #444; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .conf-high { color: #0f6b4c; font-weight: bold; }
  .conf-medium { color: #b06d00; font-weight: bold; }
  .conf-low { color: #b00020; font-weight: bold; }
  #sqlOut { width: 100%; height: 200px; font-family: monospace; font-size: 12px; margin-top: 10px; display: none; }
  #progress { margin-top: 10px; font-size: 13px; color: #555; }
</style>
</head>
<body>

<h1>Mosque Site Investigator</h1>
<p>Paste one mosque website URL per line, then click Investigate. This calls your existing <code>/api/investigate</code> endpoint on this site — nothing to install.</p>

<textarea id="urls" placeholder="https://example-mosque-1.org.uk
https://example-mosque-2.org.uk
https://example-mosque-3.org.uk"></textarea>

<br>
<button id="runBtn" onclick="runAll()">Investigate All</button>
<button class="secondary" onclick="clearResults()">Clear</button>
<div id="progress"></div>

<table id="resultsTable" style="display:none">
  <thead>
    <tr><th>URL</th><th>Adapter Type</th><th>Confidence</th><th>Detail</th></tr>
  </thead>
  <tbody id="resultsBody"></tbody>
</table>

<button id="sqlBtn" class="secondary" style="display:none" onclick="showSql()">Generate SQL for D1</button>
<textarea id="sqlOut" readonly></textarea>

<script>
let results = [];

async function runAll() {
  const raw = document.getElementById('urls').value;
  const urls = raw.split('\n').map(u => u.trim()).filter(Boolean);
  if (!urls.length) return;

  const runBtn = document.getElementById('runBtn');
  const progress = document.getElementById('progress');
  const table = document.getElementById('resultsTable');
  const body = document.getElementById('resultsBody');
  const sqlBtn = document.getElementById('sqlBtn');

  runBtn.disabled = true;
  table.style.display = 'table';
  body.innerHTML = '';
  results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    progress.textContent = `Checking ${i + 1} of ${urls.length}: ${url}`;
    let data;
    try {
      const res = await fetch(`/api/investigate?url=${encodeURIComponent(url)}`);
      data = await res.json();
    } catch (e) {
      data = { url, adapter_type: 'error', confidence: 'low', detail: { error: String(e) } };
    }
    results.push(data);

    const row = document.createElement('tr');
    const confClass = data.confidence === 'high' ? 'conf-high' : data.confidence === 'medium' ? 'conf-medium' : 'conf-low';
    row.innerHTML = `
      <td>${escapeHtml(data.url || url)}</td>
      <td>${escapeHtml(data.adapter_type || '')}</td>
      <td class="${confClass}">${escapeHtml(data.confidence || '')}</td>
      <td><pre style="white-space:pre-wrap;margin:0">${escapeHtml(JSON.stringify(data.detail || {}, null, 0))}</pre></td>
    `;
    body.appendChild(row);
  }

  progress.textContent = `Done — checked ${urls.length} site(s).`;
  runBtn.disabled = false;
  sqlBtn.style.display = 'inline-block';
}

function showSql() {
  const lines = results
    .filter(r => r.adapter_type && !['unreachable', 'error', 'needs_manual_review'].includes(r.adapter_type))
    .map(r => {
      const config = JSON.stringify(r.detail || {}).replace(/'/g, "''");
      const url = (r.url || '').replace(/'/g, "''");
      return `UPDATE mosques SET adapter_type = '${r.adapter_type}', adapter_config = '${config}' WHERE website_url = '${url}';`;
    });

  const out = document.getElementById('sqlOut');
  out.value = lines.length
    ? lines.join('\n') + '\n\n-- Review adapter_config above before running — it is a starting point,\n-- e.g. for google_sheet_iframe you still need to add the sheet_id/gid/columns manually.'
    : '-- No sites with a usable adapter_type were found in this batch.';
  out.style.display = 'block';
}

function clearResults() {
  document.getElementById('urls').value = '';
  document.getElementById('resultsBody').innerHTML = '';
  document.getElementById('resultsTable').style.display = 'none';
  document.getElementById('sqlOut').style.display = 'none';
  document.getElementById('sqlBtn').style.display = 'none';
  document.getElementById('progress').textContent = '';
  results = [];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
</script>

</body>
</html>
