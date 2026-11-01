/**
 * The receipt shown inside a chat, for apps that support MCP Apps (a sandboxed page the tool result is sent to). It
 * talks to its host over postMessage and loads nothing from the network, so it needs no extra permissions.
 */
export const RECEIPT_CARD_URI = "ui://courier/receipt.html";
export const RECEIPT_CARD_MIME = "text/html;profile=mcp-app";

export const RECEIPT_CARD = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--ink:#141414;--mute:#6b6862;--line:#e4e0d8;--bg:#fff;--ok:#0a7a3e}
@media (prefers-color-scheme:dark){:root{--ink:#f2efe9;--mute:#a5a198;--line:#3a3833;--bg:#1f1e1c;--ok:#5ad08f}}
*{box-sizing:border-box}body{margin:0;font:14px/1.4 system-ui,sans-serif;color:var(--ink);background:transparent}
.card{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:16px;max-width:460px}
.card[hidden]{display:none}.st{font-weight:700;color:var(--ok);margin:0 0 10px}
ul{list-style:none;margin:0;padding:0}li{display:flex;align-items:center;gap:12px;padding:6px 0}
.disc{flex:none;width:44px;height:44px;border-radius:50%;background:#141414;display:grid;place-items:center}
.disc i{width:16px;height:16px;border-radius:50%;background:hsl(var(--h) 90% 70%)}
.t{flex:1;min-width:0}.t b{display:block}.t small,.foot{color:var(--mute)}
.tot{display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:8px;padding-top:10px;font-weight:700}
.foot{font-size:12px;margin:6px 0 12px}.btn{display:inline-block;padding:8px 14px;border-radius:999px;background:var(--ink);color:var(--bg);font-weight:600;text-decoration:none}
</style></head><body>
<div class="card" id="card" hidden><p class="st" id="st"></p><ul id="items"></ul>
<div class="tot"><span>Total</span><span id="total"></span></div><p class="foot" id="foot"></p><a class="btn" id="go" target="_blank" rel="noopener"></a></div>
<script>
var card=document.getElementById("card"),next=1;
function send(m){parent.postMessage(Object.assign({jsonrpc:"2.0"},m),"*")}
function resize(){send({method:"ui/notifications/size-changed",params:{height:document.documentElement.scrollHeight}})}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e}
function show(r){
  if(!r||!r.items||!r.total)return resize();
  var paid=r.status==="paid",url=paid?r.receipt_url:r.approve_url;
  document.getElementById("st").textContent=paid?"\\u2713 Paid":"Waiting for you to pay";
  var list=document.getElementById("items");list.textContent="";
  r.items.forEach(function(i){
    var li=el("li"),disc=el("div","disc"),dot=el("i"),t=el("div","t");
    dot.style.setProperty("--h",Number(i.hue)||0);disc.appendChild(dot);
    t.appendChild(el("b","",i.title));if(i.artist)t.appendChild(el("small","",i.artist));
    li.appendChild(disc);li.appendChild(t);li.appendChild(el("span","","$"+i.price));list.appendChild(li);
  });
  document.getElementById("total").textContent="$"+r.total;
  document.getElementById("foot").textContent=(r.agent?"Bought by "+r.agent:"")+(r.remaining_budget?" \\u00b7 $"+r.remaining_budget+" left on this errand":"");
  var go=document.getElementById("go");
  if(url&&/^https?:/.test(url)){go.href=url;go.textContent=paid?"See your receipt":"Pay with PayPal";go.hidden=false;
    go.onclick=function(e){e.preventDefault();send({id:++next,method:"ui/open-link",params:{url:url}})}}
  else go.hidden=true;
  card.hidden=false;resize();
}
addEventListener("message",function(e){
  if(e.source!==parent||!e.data)return;var m=e.data;
  if(m.id===1&&m.result){send({method:"ui/notifications/initialized",params:{}});resize()}
  if(m.method==="ui/notifications/tool-result")show(m.params&&m.params.structuredContent);
});
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"courier-receipt",version:"1.0.0"},appCapabilities:{}}});
</script></body></html>`;
