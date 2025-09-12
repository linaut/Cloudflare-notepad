addEventListener("fetch", event => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const request = event.request;
  let url;
  try { url = new URL(request.url); } catch(e){ return new Response("Invalid URL", {status:400}); }

  let noteName;
  try { noteName = decodeURIComponent(url.pathname.slice(1)) || generateRandomNote(); } catch(e){ noteName = generateRandomNote(); }

  const method = request.method;
  const isRaw = url.searchParams.has("raw");

  // POST 保存逻辑
  if(method === "POST"){
    const text = await request.text();

    if(!text.trim()){
      try { await NOTES_KV.delete(noteName); } 
      catch(e){ console.error("删除 KV 失败:", e); }
      return new Response(JSON.stringify({ deleted:true }), { headers:{ "Content-Type":"application/json" } });
    }

    let existingObj;
    try {
      const existingNote = await NOTES_KV.get(noteName);
      existingObj = existingNote ? JSON.parse(existingNote) : null;
    } catch(e){ existingObj=null; }

    // 如果原来是旧笔记（没有时间字段），保持已有内容，不覆盖已有时间
    const createdAt = existingObj?.created_at || new Date().toISOString();
    const updatedAt = new Date().toISOString();

    try {
      await NOTES_KV.put(noteName, JSON.stringify({ content:text, created_at:createdAt, updated_at:updatedAt }));
    } catch(e){ console.error("保存 KV 失败:", e); return new Response("KV 保存失败",{status:500}); }

    return new Response(JSON.stringify({ created_at:createdAt, updated_at:updatedAt }),
      { headers:{ "Content-Type":"application/json" } });
  }

  // RAW 请求
  if(isRaw){
    try{
      let note = await NOTES_KV.get(noteName);
      if(note){
        try { note = JSON.parse(note).content; } catch(e) {}
        return new Response(note,{ headers:{ "Content-Type":"text/plain;charset=UTF-8" } });
      }
      else return new Response("Not found",{status:404});
    } catch(e){ return new Response("KV 获取失败",{status:500}); }
  }

  // 目录页
  if(url.pathname === "/"){
    const list = await NOTES_KV.list();
    let html = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Notes Directory</title></head><body><h1>📒 Notes</h1><ul>`;
    for(const key of list.keys){
      if(!key.name.match(/\.(ico|png|svg)$/i)){
        try{
          let note = await NOTES_KV.get(key.name);
          if(!note) continue;
          let data;
          try { data = JSON.parse(note); } catch(e){ data={ content: note, created_at:null, updated_at:null }; }
          if(!data.content.trim()) continue; // 自动跳过空内容
          html += `<li><a href="/${encodeURIComponent(key.name)}">${key.name}</a> | 创建: <span class="created" data-time="${data.created_at||''}"></span> | 更新: <span class="updated" data-time="${data.updated_at||''}"></span></li>`;
        } catch(e){ continue; }
      }
    }
    html += `</ul>
<script>
const displayTime=t=>t?new Date(t).toLocaleString(undefined,{hour12:false}):"未知";
document.querySelectorAll('.created').forEach(el=>el.textContent=displayTime(el.dataset.time));
document.querySelectorAll('.updated').forEach(el=>el.textContent=displayTime(el.dataset.time));
</script>
</body></html>`;
    return new Response(html,{ headers:{ "Content-Type":"text/html;charset=UTF-8" } });
  }

  // 编辑页
  let note;
  try { note = await NOTES_KV.get(noteName); } catch(e){ note=null; }
  let noteObj;
  if(note){
    try { noteObj = JSON.parse(note); } 
    catch(e){ noteObj={ content: note, created_at:null, updated_at:null }; }
  } else noteObj={ content:"", created_at:null, updated_at:null };

  const content = noteObj.content || "";
  const createdAtISO = noteObj.created_at || "";
  const updatedAtISO = noteObj.updated_at || "";

  return new Response(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${noteName}</title>
<style>
body{margin:0;background:#ebeef1;}
.container{position:absolute;top:20px;right:20px;bottom:20px;left:20px;}
#content{margin:0;padding:20px;overflow-y:auto;resize:none;width:100%;height:100%;box-sizing:border-box;border:1px solid #ddd;outline:none;font-size:1em;}
#saveBtn{position:absolute;top:10px;right:10px;padding:5px 10px;}
#status{position:absolute;bottom:10px;right:10px;color:#555;}
@media (prefers-color-scheme: dark){body{background:#333b4d;}#content{background:#24262b;color:#fff;border-color:#495265;}}
</style>
</head>
<body>
<div class="container">
<textarea id="content">${content}</textarea>
<button id="saveBtn">💾 保存</button>
<div id="status"></div>
<div>创建: <span class="created" data-time="${createdAtISO}"></span> | 更新: <span class="updated" data-time="${updatedAtISO}"></span></div>
</div>
<script>
const textarea=document.getElementById('content');
const saveBtn=document.getElementById('saveBtn');
const status=document.getElementById('status');
let previousContent=textarea.value;

function displayTime(t){return t?new Date(t).toLocaleString(undefined,{hour12:false}):"未知";}
function updateTimeDisplays(){
  document.querySelectorAll('.created').forEach(el=>el.textContent=displayTime(el.dataset.time));
  document.querySelectorAll('.updated').forEach(el=>el.textContent=displayTime(el.dataset.time));
}
updateTimeDisplays();

async function save(auto=false){
  if(previousContent!==textarea.value){
    const temp=textarea.value;
    try{
      const resp=await fetch(window.location.href,{method:'POST',body:temp});
      const data=await resp.json();
      previousContent=temp;
      if(data.deleted){
        textarea.value="";
        if(!auto) status.textContent='笔记已删除';
      } else {
        if(!auto) status.textContent='已保存: '+new Date().toLocaleString(undefined,{hour12:false});
        if(data.updated_at){
          document.querySelector('.updated').dataset.time = data.updated_at;
        }
        if(data.created_at && !document.querySelector('.created').dataset.time){
          document.querySelector('.created').dataset.time = data.created_at;
        }
        updateTimeDisplays();
      }
    } catch(e){ console.error("保存请求失败", e); }
  }
}

saveBtn.addEventListener('click',()=>save(false));
setInterval(()=>save(true),5000);
</script>
</body>
</html>`,{ headers:{ "Content-Type":"text/html;charset=UTF-8" } });
}

function generateRandomNote(){
  const chars='234579abcdefghjkmnpqrstwxyz';
  return Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}
