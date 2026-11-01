import { createHash } from "node:crypto";

/**
 * The card shown inside a chat, for apps that support MCP Apps (a sandboxed page the tool result is sent to). It
 * talks to its host over postMessage and loads nothing from the network, so it needs no extra permissions.
 */
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
.bud{display:flex;align-items:center;gap:8px;margin:0 0 10px}.bud span{font-weight:700}.bud input{width:96px;height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit;font-weight:700}
.bud button{height:36px;padding:0 14px;border:0;border-radius:999px;background:var(--ink);color:var(--bg);font:inherit;font-weight:600;cursor:pointer}.bud button:disabled{opacity:.5}
.alt{font-size:12px;color:var(--mute)}
.foot{font-size:12px;margin:6px 0 12px}.btn{display:inline-block;padding:8px 14px;border-radius:999px;background:var(--ink);color:var(--bg);font-weight:600;text-decoration:none}
</style></head><body>
<div class="card" id="card" hidden><p class="st" id="st"></p><ul id="items"></ul>
<div class="tot"><span>Total</span><span id="total"></span></div><p class="foot" id="foot"></p><div class="bud" id="bud" hidden><span>$</span><input id="amt" type="number" min="1" max="500" step="1" aria-label="Budget in dollars"><button type="button" id="set">Set budget</button></div><a class="btn" id="go" target="_blank" rel="noopener"></a></div>
<script>
var card=document.getElementById("card"),next=1,wait={},polling=0,agent="Your courier";
function send(m){parent.postMessage(Object.assign({jsonrpc:"2.0"},m),"*")}
function resize(){send({method:"ui/notifications/size-changed",params:{height:document.documentElement.scrollHeight}})}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e}
function rpc(method,params,cb){var id=++next;if(cb)wait[id]=cb;send({id:id,method:method,params:params})}
function byId(id){return document.getElementById(id)}
function budgetSet(){
  if(polling)clearInterval(polling);
  byId("st").textContent="\\u2713 Budget set";byId("bud").hidden=true;byId("go").hidden=true;
  byId("foot").textContent=agent+" is carrying on\\u2026";resize();
}
function watchTicket(){
  if(polling)return;polling=setInterval(function(){
    rpc("tools/call",{name:"whoami",arguments:{}},function(res){
      var who=res&&res.structuredContent;
      if(who&&who.visa)budgetSet();
    });
  },3000);
}
function asLink(go,url){
  go.className="btn";go.textContent="Set a budget";
  go.onclick=function(e){e.preventDefault();rpc("ui/open-link",{url:url});watchTicket()};
}
/* The budget is typed here, by the person: the model can't reach this tool or see its one-time pass. */
function budgetForm(r,pass,go){
  byId("bud").hidden=false;byId("amt").value=r.suggested_budget||"";
  go.className="alt";go.textContent="Or set it on Courier";
  go.onclick=function(e){e.preventDefault();rpc("ui/open-link",{url:r.ticket_url});watchTicket()};
  byId("set").onclick=function(){
    var n=Number(byId("amt").value),b=byId("set");
    if(!byId("amt").reportValidity()||!n)return;
    b.disabled=true;
    rpc("tools/call",{name:"set_budget",arguments:{budget:n,pass:pass}},function(res){
      b.disabled=false;
      var out=res&&res.structuredContent;
      if(out&&out.issued)return budgetSet();
      byId("bud").hidden=true;
      if(out&&out.url){rpc("ui/open-link",{url:out.url});asLink(go,out.url);go.textContent="Continue on PayPal";byId("foot").textContent="One approval on PayPal, then "+agent+" carries on.";watchTicket()}
      else{asLink(go,r.ticket_url);byId("foot").textContent="That didn\\u2019t work here. Set it on Courier instead."}
      resize();
    });
  };
}
function show(r,meta){
  if(!r||!r.items||!r.total)return resize();
  var paid=r.status==="paid",needs=r.decision==="needs_ticket",url=needs?r.ticket_url:paid?r.receipt_url:r.approve_url;
  agent=r.agent||"Your courier";
  byId("st").textContent=needs?"Set a budget to buy this":paid?"\\u2713 Paid":"Waiting for you to pay";
  var list=byId("items");list.textContent="";
  r.items.forEach(function(i){
    var li=el("li"),disc=el("div","disc"),dot=el("i"),t=el("div","t");
    dot.style.setProperty("--h",Number(i.hue)||0);disc.appendChild(dot);
    t.appendChild(el("b","",i.title));if(i.artist)t.appendChild(el("small","",i.artist));
    li.appendChild(disc);li.appendChild(t);li.appendChild(el("span","","$"+i.price));list.appendChild(li);
  });
  byId("total").textContent="$"+r.total;
  byId("foot").textContent=needs?"The most "+agent+" can spend on this errand:":(r.agent?"Bought by "+r.agent:"")+(r.remaining_budget?" \\u00b7 $"+r.remaining_budget+" left on this errand":"");
  var go=byId("go"),pass=meta&&meta["courier/budget_pass"];
  byId("bud").hidden=true;
  if(url&&/^https?:/.test(url)){go.href=url;go.hidden=false;
    if(needs&&pass)budgetForm(r,pass,go);
    else if(needs){asLink(go,url);byId("foot").textContent=agent+" needs a budget from you first."}
    else{go.className="btn";go.textContent=paid?"See your receipt":"Pay with PayPal";go.onclick=function(e){e.preventDefault();rpc("ui/open-link",{url:url})}}}
  else go.hidden=true;
  card.hidden=false;resize();
}
addEventListener("message",function(e){
  if(e.source!==parent||!e.data)return;var m=e.data;
  if(m.id===1&&m.result){send({method:"ui/notifications/initialized",params:{}});resize()}
  if(m.id&&wait[m.id]){var cb=wait[m.id];delete wait[m.id];cb(m.result)}
  if(m.method==="ui/notifications/tool-result")show(m.params&&m.params.structuredContent,m.params&&m.params._meta);
});
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"courier-receipt",version:"1.0.0"},appCapabilities:{}}});
</script></body></html>`;

// Chat apps keep a card by its address, so a new card needs a new address or people keep seeing the old one.
export const RECEIPT_CARD_URI = `ui://courier/receipt-${createHash("sha256").update(RECEIPT_CARD).digest("hex").slice(0, 10)}.html`;
