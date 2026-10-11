export function operatorPage() {
  const nonce = crypto.randomUUID();
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Yunhai tool approval</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:0 20px;color:#17314c}input,textarea,select,button{font:inherit;padding:8px;margin:5px 0}input,textarea{width:95%}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef4f7;padding:16px}fieldset{margin:24px 0}label{display:block}button:disabled{cursor:default}</style>
<h1>Yunhai tool approval</h1><p>Separate operator channel. Inspect the trusted task, agent, exact target, version and expiry before approving. Synthetic business data only.</p>
<label>Local fixture token (leave blank when using Cloudflare Access)<input id="token" type="password" autocomplete="off"></label>
<fieldset><legend>Create a trusted task</legend><label>Agent subject<input id="subject" value="partner-one-writer"></label><label>User task<textarea id="task">Disable wh-a-1 after reviewing its status.</textarea></label><label>Permitted action<select id="action"><option value="inspect">Inspect only</option><option value="disable_webhook">Disable webhook</option></select></label><label>Exact webhook<input id="target" value="wh-a-1"></label><button id="create">Create task</button></fieldset>
<fieldset><legend>Review an agent request</legend><label>Review ID<input id="reviewId"></label><button id="load">Load review</button><pre id="review">No review loaded.</pre><label><input id="confirm" type="checkbox" style="width:auto"> I independently approve the displayed action and exact target.</label><button id="approve" disabled>Approve this operation</button></fieldset><pre id="output" role="status"></pre>
<script nonce="${nonce}">
let loaded;
const el = id => document.getElementById(id);
const output = data => {el('output').textContent=JSON.stringify(data,null,2)};
async function api(path,body){const headers={'Content-Type':'application/json'};if(el('token').value)headers.Authorization='Bearer '+el('token').value;const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data}
function reset(){loaded=undefined;el('confirm').checked=false;el('approve').disabled=true}
el('reviewId').oninput=reset;el('token').oninput=reset;
el('create').onclick=async()=>{try{output(await api('/operator/tasks',{subject:el('subject').value,text:el('task').value,action:el('action').value,webhookId:el('target').value}))}catch(e){output({error:e.message})}};
el('load').onclick=async()=>{reset();try{const data=await api('/operator/reviews/'+encodeURIComponent(el('reviewId').value));loaded=data.review;el('review').textContent=JSON.stringify(data,null,2)}catch(e){el('review').textContent=e.message}};
el('confirm').onchange=()=>{el('approve').disabled=!loaded||loaded.verdict!=='aligned'||!el('confirm').checked};
el('approve').onclick=async()=>{if(!loaded||!el('confirm').checked)return;const id=loaded.id;reset();try{output(await api('/operator/approvals',{reviewId:id}))}catch(e){output({error:e.message})}};
</script></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
