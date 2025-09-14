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

  // ===== 修正版：目录 JSON（用于自动刷新） =====
  if (url.pathname === "/" && url.searchParams.get("list") === "1") {
    const list = await NOTES_KV.list();
    let result = [];
    for (const key of list.keys) {
      // 过滤静态图标
      if (key.name.match(/\.(ico|png|svg)$/i)) continue;

      try {
        const raw = await NOTES_KV.get(key.name);
        if (!raw) continue;

        // 尝试解析 JSON：若解析为对象且包含 content 字段 -> 当作笔记
        // 否则如果解析失败 -> 当作纯文本笔记
        // 如果解析成功但没有 content 字段（例如索引/metadata），则跳过
        let data;
        let isNote = false;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && parsed.hasOwnProperty('content')) {
            data = parsed;
            isNote = true;
          } else {
            // parsed JSON but not a note object (e.g. index array/object) -> skip
            continue;
          }
        } catch (e) {
          // not JSON -> treat as plain text note
          data = { content: String(raw), created_at: null, updated_at: null };
          isNote = true;
        }

        if (!isNote) continue;

        const text = String(data.content || '');
        if (!text.trim()) continue;

        result.push({
          name: key.name,
          created_at: data.created_at || null,
          updated_at: data.updated_at || null
        });
      } catch (err) {
        // 单个 key 异常不要中断整个列表
        console.error("list key error:", key.name, err);
        continue;
      }
    }

    // 按更新时间倒序排序（若无 updated 则用 created）
    result.sort((a,b)=>{
      let ta = a.updated_at || a.created_at || "";
      let tb = b.updated_at || b.created_at || "";
      return new Date(tb) - new Date(ta);
    });

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" }
    });
  }

// 目录页
if(url.pathname === "/"){
  let html = `<html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📒 Notes Directory</title>
  <style>
    body { font-family: sans-serif; background:#f0f0f0; padding:20px; }
    h1 { color:#333; }
    ul { list-style:none; padding:0; }
    li { margin:10px 0; }
    a { text-decoration:none; color:#0077cc; font-size:1.1em; }
    a:hover { text-decoration:underline; }
/* flex均分目录时间信息一行显示 */
    .time-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.8em;color:#555
    }
/* 自动深色模式 */
    @media (prefers-color-scheme: dark) {
      body { background:#121212; color:#f0f0f0; }
      h1 { color:#ddd; }
      a { color:#80b3ff; }
      .time-info { color:#ccc; }
    }
  </style>
  </head>
  <body>
  <h1>📒 Notes</h1><ul id="notesList"></ul>
<script>
function displayTime(t){return t?new Date(t).toLocaleString(undefined,{hour12:false}):"未知";}
async function loadList(){
try{
  const resp = await fetch("/?list=1");
  const arr = await resp.json();
  const ul = document.getElementById("notesList");
  ul.innerHTML="";
  arr.forEach(item=>{
    const li=document.createElement("li");
    li.innerHTML = '<a href="/'+encodeURIComponent(item.name)+'">'+item.name+'</a>'
                 + '<div class="time-info">创建: '+displayTime(item.created_at)+' | 更新: '+displayTime(item.updated_at)+'</div>';
    ul.appendChild(li);
  });
}catch(e){console.error("加载目录失败",e);}
}
loadList();
setInterval(loadList,5000);
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
<title>📒 ${noteName}</title>
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
        setTimeout(()=>status.textContent='', 3000); // 3秒后清空提示
        document.querySelector('.created').dataset.time = "";
        document.querySelector('.updated').dataset.time = "";
        updateTimeDisplays();
      } else {
        if(!auto) status.textContent='已保存: '+new Date().toLocaleString(undefined,{hour12:false});
        setTimeout(()=>status.textContent='', 3000); // 3秒后清空提示
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
setInterval(()=>save(true),1000);
</script>
</body>
</html>`,{ headers:{ "Content-Type":"text/html;charset=UTF-8" } });
}

function generateRandomNote(){
  const chars='234579abcdefghjkmnpqrstwxyz';
  return Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}
