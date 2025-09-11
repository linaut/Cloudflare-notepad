// index.js
function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
  }[c]));
}

async function readNote(env, key) {
  const raw = await env.NOTES_KV.get(key);
  if (raw === null) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && "content" in obj) {
      // 不修改 KV
      if (typeof obj.created_at !== "number") obj.created_at = null;
      if (typeof obj.updated_at !== "number") obj.updated_at = null;
      return obj;
    }
  } catch {}
  return { content: raw, created_at: null, updated_at: null };
}

async function saveNote(env, key, content, existingObj) {
  const now = Date.now();
  const obj = existingObj && existingObj.created_at ? 
    { content, created_at: existingObj.created_at, updated_at: now } :
    { content, created_at: now, updated_at: now };
  await env.NOTES_KV.put(key, JSON.stringify(obj));
  return obj;
}

async function migratePrefixedKeys(env) {
  try {
    const list = await env.NOTES_KV.list({ prefix:"note:" });
    for(const k of list.keys){
      const oldKey = k.name;
      const newKey = oldKey.replace(/^note:/,"");
      const exists = await env.NOTES_KV.get(newKey);
      if(exists===null){
        const raw = await env.NOTES_KV.get(oldKey);
        if(raw!==null){
          try{
            const parsed = JSON.parse(raw);
            if(parsed && typeof parsed==="object" && "content" in parsed){
              await env.NOTES_KV.put(newKey, JSON.stringify(parsed));
            } else {
              const now = Date.now();
              await env.NOTES_KV.put(newKey, JSON.stringify({ content:raw, created_at:now, updated_at:now }));
            }
          }catch{
            const now = Date.now();
            await env.NOTES_KV.put(newKey, JSON.stringify({ content:raw, created_at:now, updated_at:now }));
          }
          await env.NOTES_KV.delete(oldKey);
        }
      }
    }
  } catch(e){console.log("migration error:",e);}
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const rawPath = url.pathname.slice(1);
    let noteName = rawPath ? decodeURIComponent(rawPath) : (url.searchParams.get("note") ? decodeURIComponent(url.searchParams.get("note")) : "");

    await migratePrefixedKeys(env);

    // root -> show index
    if(!noteName){
      const listResult = await env.NOTES_KV.list();
      const entries = [];
      const excludeKeys = ["index.json","favicon.ico",
        "apple-touch-icon.png",
        "apple-touch-icon-precomposed.png",
        "apple-touch-icon-120x120.png",
        "apple-touch-icon-120x120-precomposed.png"
      ];
      for(const k of listResult.keys){
        if(excludeKeys.includes(k.name)) continue;
        try{
          const dataRaw = await env.NOTES_KV.get(k.name);
          if(!dataRaw) continue;
          let obj;
          try{
            obj = JSON.parse(dataRaw);
            if(!obj||typeof obj!=="object"||!("content" in obj)) throw new Error();
          } catch {
            obj = { content:dataRaw, created_at:null, updated_at:null };
          }
          entries.push({ name:k.name, created_at:obj.created_at, updated_at:obj.updated_at });
        } catch { continue; }
      }
      entries.sort((a,b)=> (b.updated_at||0) - (a.updated_at||0));
      const rows = entries.map(e=>{
        return `<li><a href="/${encodeURIComponent(e.name)}">${escapeHtml(e.name)}</a>
          <br><small>创建: <span data-ts="${e.created_at||''}"></span> | 更新: <span data-ts="${e.updated_at||''}"></span></small></li>`;
      }).join("\n");
      return new Response(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes</title>
<style>
body{font-family:sans-serif;padding:16px;font-size:18px;background:#f6f7f8}
h1{font-size:20px}li{margin:10px 0}a{color:#0366d6;text-decoration:none}small{color:#666;font-size:14px}
.new-btn{display:inline-block;margin-top:12px;padding:8px 12px;background:#0366d6;color:#fff;border-radius:6px;text-decoration:none}
</style>
</head>
<body>
<h1>📒 笔记目录</h1>
<ul>${rows}</ul>
<p><a class="new-btn" href="/${encodeURIComponent(Math.random().toString(36).slice(2,7))}">➕ 新建随机笔记</a></p>
<script>
// 浏览器端渲染本地时间
document.querySelectorAll('[data-ts]').forEach(el=>{
  const ts = el.getAttribute('data-ts');
  if(ts) el.innerText = new Date(Number(ts)).toLocaleString();
});
</script>
</body>
</html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
    }

    const method = request.method.toUpperCase();

    if(method==="GET"){
      const rawParam = url.searchParams.has("raw");
      const data = await readNote(env,noteName);
      if(!data){
        const now=Date.now();
        await env.NOTES_KV.put(noteName,JSON.stringify({content:"",created_at:now,updated_at:now}));
        return Response.redirect(url.toString(),302);
      }
      if(rawParam) return new Response(data.content||"",{headers:{"Content-Type":"text/plain; charset=utf-8"}});

      const safeContent = escapeHtml(data.content||"");
      const safeTitle = escapeHtml(noteName);

      return new Response(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
body{margin:0;font-family:sans-serif;background:#f5f6f7}
.header{padding:12px 14px;background:#fff;border-bottom:1px solid #e6e6e6;display:flex;align-items:center;justify-content:space-between}
.title{font-size:18px}
.container{padding:12px}
textarea{width:100%;height:60vh;box-sizing:border-box;padding:12px;font-size:16px;line-height:1.5;resize:vertical}
.meta{margin-top:8px;color:#666;font-size:14px}
.btn{margin-top:8px;padding:10px 14px;font-size:16px;border-radius:6px;background:#0366d6;color:#fff;border:none}
</style>
</head>
<body>
<div class="header"><div class="title">📝 ${safeTitle}</div><div><a href="/" style="text-decoration:none;color:#0366d6">目录</a></div></div>
<div class="container">
<textarea id="content" aria-label="content">${safeContent}</textarea>
<br>
<button class="btn">💾 保存</button>
<div class="meta">创建: <span id="created"></span> | 最后更新: <span id="updated"></span></div>
</div>
<script>
const textarea=document.getElementById('content');
const createdEl=document.getElementById('created');
const updatedEl=document.getElementById('updated');
let lastValue=textarea.value;
const createdTs = ${data.created_at||'null'};
const updatedTs = ${data.updated_at||'null'};
if(createdTs) createdEl.innerText = new Date(createdTs).toLocaleString();
if(updatedTs) updatedEl.innerText = new Date(updatedTs).toLocaleString();

// 自动保存（每5秒）不弹提示
async function autoSave(){const cur=textarea.value;if(cur!==lastValue){lastValue=cur;lastValue=cur;await save(false);}}
setInterval(autoSave,5000);

// 保存函数
async function save(showAlert=true){
  const text=textarea.value;
  try{
    const res=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
    if(res.ok){
      const json=await res.json();
      updatedEl.innerText=new Date(json.updated_at).toLocaleString();
      if(showAlert) alert('💾 已保存');
    }else if(showAlert){alert('保存失败');}
  }catch(e){if(showAlert)alert('保存失败');console.error(e);}
}

// 手动保存按钮
document.querySelector('.btn').addEventListener('click',()=>save(true));
</script>
</body>
</html>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
    } else if(method==="POST"){
      const body=await request.json().catch(()=>({text:""}));
      const content=body.text||"";
      const existing=await readNote(env,noteName);
      const obj=await saveNote(env,noteName,content,existing);
      return new Response(JSON.stringify(obj),{headers:{"Content-Type":"application/json"}});
    }
    return new Response("Method Not Allowed",{status:405});
  }
};
