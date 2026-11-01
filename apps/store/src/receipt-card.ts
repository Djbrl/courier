/**
 * The receipt shown inside a chat, for apps that support MCP Apps (a sandboxed page the tool result is sent to). It
 * talks to its host over postMessage and loads nothing from the network, so it needs no extra permissions.
 */
export const RECEIPT_CARD_URI = "ui://courier/receipt.html";
export const RECEIPT_CARD_MIME = "text/html;profile=mcp-app";

export const RECEIPT_CARD = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>[hidden]{display:none!important}
:root{color-scheme:light dark;--ink:#141414;--mute:#6b6862;--line:#e4e0d8;--bg:#fff;--ok:#0a7a3e}
@media (prefers-color-scheme:dark){:root{--ink:#f2efe9;--mute:#a5a198;--line:#3a3833;--bg:#1f1e1c;--ok:#5ad08f}}
*{box-sizing:border-box}body{margin:0;font:14px/1.4 system-ui,sans-serif;color:var(--ink);background:transparent}
.card{padding:12px 14px}
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
var card=document.getElementById("card"),next=1,wait={},polling=0;
function send(m){parent.postMessage(Object.assign({jsonrpc:"2.0"},m),"*")}
function resize(){send({method:"ui/notifications/size-changed",params:{height:document.documentElement.scrollHeight}})}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e}
function rpc(method,params,cb){var id=++next;if(cb)wait[id]=cb;send({id:id,method:method,params:params})}
function watchTicket(){
  if(polling)return;polling=setInterval(function(){
    rpc("tools/call",{name:"whoami",arguments:{}},function(res){
      var who=res&&res.structuredContent;
      if(!who||!who.visa)return;
      clearInterval(polling);
      document.getElementById("st").textContent="\\u2713 Budget set";
      document.getElementById("go").hidden=true;
      document.getElementById("foot").textContent="Carrying on\\u2026";resize();
      rpc("ui/message",{role:"user",content:[{type:"text",text:"My Courier budget is set. Carry on with the purchase."}]});
    });
  },3000);
}
function show(r){
  if(!r||!r.items||!r.total)return resize();
  var paid=r.status==="paid",needs=r.decision==="needs_ticket",url=needs?r.ticket_url:paid?r.receipt_url:r.approve_url;
  document.getElementById("st").textContent=needs?"Set a budget to buy this":paid?"\\u2713 Paid":"Waiting for you to pay";
  var list=document.getElementById("items");list.textContent="";
  r.items.forEach(function(i){
    var li=el("li"),disc=el("div","disc"),dot=el("i"),t=el("div","t");
    dot.style.setProperty("--h",Number(i.hue)||0);disc.appendChild(dot);
    t.appendChild(el("b","",i.title));if(i.artist)t.appendChild(el("small","",i.artist));
    li.appendChild(disc);li.appendChild(t);li.appendChild(el("span","","$"+i.price));list.appendChild(li);
  });
  document.getElementById("total").textContent="$"+r.total;
  document.getElementById("foot").textContent=needs?(r.agent||"Your courier")+" needs a budget from you first.":(r.agent?"Bought by "+r.agent:"")+(r.remaining_budget?" \\u00b7 $"+r.remaining_budget+" left on this errand":"");
  var go=document.getElementById("go");
  if(url&&/^https?:/.test(url)){go.href=url;go.textContent=needs?"Set a budget":paid?"See your receipt":"Pay with PayPal";go.hidden=false;
    go.onclick=function(e){e.preventDefault();rpc("ui/open-link",{url:url});if(needs)watchTicket()}}
  else go.hidden=true;
  card.hidden=false;resize();
}
addEventListener("message",function(e){
  if(e.source!==parent||!e.data)return;var m=e.data;
  if(m.id===1&&m.result){send({method:"ui/notifications/initialized",params:{}});resize()}
  if(m.id&&wait[m.id]){var cb=wait[m.id];delete wait[m.id];cb(m.result)}
  if(m.method==="ui/notifications/tool-result")show(m.params&&m.params.structuredContent);
});
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"courier-receipt",version:"1.0.0"},appCapabilities:{}}});
</script></body></html>`;
