export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

const INDEX_KEY = "__index__";
const SESSION_KEY_PREFIX = "note_session_";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none';",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

function getSafeCookieName(name) {
  let hash = 0;
  const str = String(name || "");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hashHex = Math.abs(hash).toString(36).padStart(12, '0').slice(0, 12);
  return `note_auth_${hashHex}`;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(part => {
    const [name, ...valueParts] = part.trim().split('=');
    if (name) {
      cookies[name.trim()] = decodeURIComponent(valueParts.join('=').trim());
    }
  });
  return cookies;
}

function htmlEscape(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function handleRequest(request, env) {
  try {
    let url = new URL(request.url);

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 404 });
    }

    let noteName;
    try { 
      noteName = decodeURIComponent(url.pathname.slice(1)) || generateRandomNote(); 
    } catch(e){ 
      noteName = generateRandomNote(); 
    }

    function isValidNoteName(name){
      if(!name || name.length > 50) return false;
      if(/[-\u001F\u007F\/\\]/.test(name)) return false;
      return true;
    }

    if(!isValidNoteName(noteName) && url.pathname !== "/"){
      return new Response(`<script>alert("笔记名非法");history.back();</script>`, 
        { headers:{ "Content-Type":"text/html;charset=UTF-8", ...SECURITY_HEADERS } });
    }

    const method = request.method;
    const isRaw = url.searchParams.has("raw");

    // 密码验证
    if(method === "POST" && url.searchParams.has("password")) {
      const formData = await request.formData();
      const password = formData.get("password");

      if(password === (env.FIXED_PASSWORD || "")) {
        const sessionToken = crypto.randomUUID();
        const kvSessionKey = `${SESSION_KEY_PREFIX}${noteName}`;
        const cookieName = getSafeCookieName(noteName);

        await env.NOTES_KV.put(kvSessionKey, sessionToken, { expirationTtl: 3600 });

        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `${cookieName}=${sessionToken}; Path=/; Max-Age=3600; Secure; SameSite=Strict`,
            ...SECURITY_HEADERS
          }
        });
      } else {
        return new Response(JSON.stringify({ success: false, error: "密码错误" }), { 
          status: 401, 
          headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } 
        });
      }
    }

    // 保存笔记
    if(method === "POST" && !url.searchParams.has("password")) {
      const text = await request.text();
      const encryptedFlag = url.searchParams.get("encrypt") === "1";

      if(!text.trim()){
        await env.NOTES_KV.delete(noteName);
        await updateIndex(noteName, null, env);
        return new Response(JSON.stringify({ deleted:true }), { headers:{ "Content-Type":"application/json", ...SECURITY_HEADERS } });
      }

      let existingObj = null;
      const existingNote = await env.NOTES_KV.get(noteName);
      if(existingNote) existingObj = JSON.parse(existingNote);

      const createdAt = existingObj?.created_at || new Date().toISOString();
      const updatedAt = new Date().toISOString();

      await env.NOTES_KV.put(noteName, JSON.stringify({ 
        content: text, 
        created_at: createdAt, 
        updated_at: updatedAt, 
        encrypted: encryptedFlag 
      }));
      await updateIndex(noteName, { created_at: createdAt, updated_at: updatedAt, encrypted: encryptedFlag }, env);

      return new Response(JSON.stringify({ created_at:createdAt, updated_at:updatedAt, encrypted: encryptedFlag }),
        { headers:{ "Content-Type":"application/json", ...SECURITY_HEADERS } });
    }

    // 获取笔记
    let note = await env.NOTES_KV.get(noteName);
    let noteObj = note ? JSON.parse(note) : { content:"", created_at:null, updated_at:null, encrypted:false };
    const encryptedFlag = noteObj.encrypted || false;

    if(isRaw){
      if(encryptedFlag) {
        const kvSessionKey = `${SESSION_KEY_PREFIX}${noteName}`;
        const cookieName = getSafeCookieName(noteName);
        const cookies = parseCookies(request.headers.get("Cookie") || "");
        const sessionToken = cookies[cookieName];
        const storedToken = await env.NOTES_KV.get(kvSessionKey);

        if(!sessionToken || sessionToken !== storedToken) {
          return new Response("需要密码验证", { status: 401, headers: { "Content-Type": "text/plain;charset=UTF-8", ...SECURITY_HEADERS } });
        }
      }
      const content = note ? JSON.parse(note).content : "Not found";
      return new Response(content, { headers:{ "Content-Type":"text/plain;charset=UTF-8", ...SECURITY_HEADERS } });
    }

    // 目录 JSON
    if(url.pathname === "/" && url.searchParams.get("list") === "1"){
      let indexData = await env.NOTES_KV.get(INDEX_KEY);
      let arr = indexData ? JSON.parse(indexData) : [];
      arr.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      return new Response(JSON.stringify(arr), { headers:{ "Content-Type":"application/json", ...SECURITY_HEADERS } });
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
.time-info { display: flex; justify-content: space-between; font-size: 12px; color:#555; margin-top:2px;}
@media (prefers-color-scheme: dark) {
  body { background:#121212; color:#f0f0f0; }
  h1 { color:#ddd; }
  a { color:#80b3ff; }
  .time-info { color:#f0f0f0; }
}
</style>
</head>
<body>
<h1>📒 Notes</h1><ul id="notesList"></ul>
<script>
function getSafeCookieName(name) {
  let hash = 0;
  const str = String(name || "");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hashHex = Math.abs(hash).toString(36).padStart(12, '0').slice(0, 12);
  return \`note_auth_\${hashHex}\`;
}

function displayTime(t){return t?new Date(t).toLocaleString(undefined,{hour12:false}):"未知";}

async function loadList(){
  try{
    const resp = await fetch("/?list=1");
    let arr = await resp.json();

    arr.sort((a, b) => {
      const timeA = new Date(b.updated_at || b.created_at);
      const timeB = new Date(a.updated_at || a.created_at);
      return timeA - timeB;
    });

    const ul = document.getElementById("notesList");
    ul.innerHTML = "";

    const cookieHeader = document.cookie || "";
    const cookies = {};
    cookieHeader.split(';').forEach(part => {
      const [name, ...val] = part.trim().split('=');
      if (name) cookies[name.trim()] = decodeURIComponent(val.join('=').trim());
    });

    arr.forEach(item => {
      let icon = '';
      if (item.encrypted) {
        const cookieName = getSafeCookieName(item.name);
        if (cookies[cookieName] || sessionStorage.getItem(cookieName) === "1") {
          icon = '🔓';
        } else {
          icon = '🔐';
        }
      }
      const li = document.createElement("li");
      li.innerHTML = icon + '<a href="/' + encodeURIComponent(item.name) + '">' + item.name + '</a>'
                   + '<div class="time-info">创建: ' + displayTime(item.created_at) 
                   + ' | 更新: ' + displayTime(item.updated_at) + '</div>';
      ul.appendChild(li);
    });

  } catch(e){ 
    console.error("加载目录失败", e); 
  }
}

loadList();
setInterval(loadList, 3000);
</script>
</body></html>`;
      return new Response(html,{ headers:{ "Content-Type":"text/html;charset=UTF-8", ...SECURITY_HEADERS } });
    }

    // 密码输入页
    if(encryptedFlag) {
      const kvSessionKey = `${SESSION_KEY_PREFIX}${noteName}`;
      const cookieName = getSafeCookieName(noteName);
      const cookies = parseCookies(request.headers.get("Cookie") || "");
      const sessionToken = cookies[cookieName];
      const storedToken = await env.NOTES_KV.get(kvSessionKey);

      if(!sessionToken || sessionToken !== storedToken) {
        return new Response(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📒 输入密码 - ${htmlEscape(noteName)}</title>
<style>
body { font-family: sans-serif; background:#f0f0f0; padding:20px; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; }
.container { background:#fff; padding:20px; border-radius:5px; box-shadow:0 0 10px rgba(0,0,0,0.1); text-align:center; }
input { padding:10px; margin:10px 0; width:200px; }
button { padding:10px 20px; cursor:pointer; }
.error { color:red; display:none; }
@media (prefers-color-scheme: dark) {
  body { background:#121212; }
  .container { background:#24262b; color:#fff; }
  input, button { background:#333b4d; color:#fff; border:1px solid #495265; }
}
</style>
</head>
<body>
<div class="container">
  <h2>请输入密码访问笔记: ${htmlEscape(noteName)}</h2>
  <input type="password" id="password" placeholder="输入密码" onkeydown="if(event.key === 'Enter') submitPassword();">
  <div class="error" id="errorMsg"></div>
  <button onclick="submitPassword()">提交</button>
</div>
<script>
function getSafeCookieName(name) {
  let hash = 0;
  const str = String(name || "");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hashHex = Math.abs(hash).toString(36).padStart(12, '0').slice(0, 12);
  return \`note_auth_\${hashHex}\`;
}

async function submitPassword() {
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  const formData = new FormData();
  formData.append('password', password);
  try {
    const resp = await fetch(window.location.href + '?password=1', { method: 'POST', body: formData });
    const data = await resp.json();
    if(data.success) {
      const cookieName = getSafeCookieName(window.location.pathname.slice(1));
      sessionStorage.setItem(cookieName, "1");
      window.location.reload();
    } else {
      errorMsg.textContent = data.error || '密码错误';
      errorMsg.style.display = 'block';
    }
  } catch(e) {
    errorMsg.textContent = '验证失败';
    errorMsg.style.display = 'block';
  }
}
</script>
</body>
</html>`, { headers: { "Content-Type": "text/html;charset=UTF-8", ...SECURITY_HEADERS } });
      }
    }

    // ==================== 编辑页 - 修复删除后时间不消失的问题 ====================
    const content = noteObj.content || "";
    const createdAtISO = noteObj.created_at || "";
    const updatedAtISO = noteObj.updated_at || "";

    return new Response(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📒 ${htmlEscape(noteName)}</title>
<style>
body{margin:0;background:#ebeef1;}
.container{position:absolute;top:20px;right:20px;bottom:20px;left:20px;display:flex;flex-direction:column;}
#content{flex:1;margin:0;padding:20px;overflow-y:auto;resize:none;width:100%;box-sizing:border-box;border:1px solid #ddd;outline:none;font-size:1em;}
.controls{display:flex;justify-content:space-between;align-items:center;margin-top:5px;font-size:12px;}
.actions{display:flex;gap:10px;}
#saveBtn{padding:2px 6px;font-size:12px;}
@media (prefers-color-scheme: dark){
  body{background:#333b4d;}
  #content{background:#24262b;color:#fff;border-color:#495265;}
  #status{color:#ccc;}
  .controls div, .controls span { color:#ccc; } 
}
</style>
</head>
<body>
<div class="container">
<textarea id="content">${htmlEscape(content)}</textarea>
<div class="controls">
<div>创建: <span class="created" data-time="${createdAtISO}"></span><br>
     更新: <span class="updated" data-time="${updatedAtISO}"></span></div>
  <div class="actions">
    <label><input type="checkbox" id="encryptToggle"${encryptedFlag?' checked':''}/> 密码保护</label>
    <button id="saveBtn">💾 保存</button>
  </div>
</div>
<div id="status"></div>
</div>
<script>
const textarea = document.getElementById('content');
const saveBtn = document.getElementById('saveBtn');
const encryptToggle = document.getElementById('encryptToggle');
const status = document.getElementById('status');
let previousContent = textarea.value;

function refreshTimes() {
  function displayTime(t){ 
    return t ? new Date(t).toLocaleString(undefined, {hour12: false}) : "未知"; 
  }
  document.querySelector('.created').textContent = displayTime(document.querySelector('.created').dataset.time);
  document.querySelector('.updated').textContent = displayTime(document.querySelector('.updated').dataset.time);
}

async function save(auto = false) {
  const temp = textarea.value;

  if (previousContent !== temp || !auto) {
    try {
      const resp = await fetch(window.location.href + '?encrypt=' + (encryptToggle.checked ? "1" : "0"), {
        method: 'POST', 
        body: temp
      });
      const data = await resp.json();
      previousContent = temp;

      if (data.deleted) {
        textarea.value = "";
        // 关键修复：删除笔记时清空时间显示
        document.querySelector('.created').dataset.time = "";
        document.querySelector('.updated').dataset.time = "";
        if (!auto) status.textContent = '笔记已删除';
        setTimeout(() => status.textContent = '', 3000);
      } else {
        if (!auto) status.textContent = '已保存: ' + new Date().toLocaleString(undefined, {hour12: false});
        setTimeout(() => status.textContent = '', 3000);

        if (data.updated_at) {
          document.querySelector('.updated').dataset.time = data.updated_at;
        }
        if (data.created_at) {
          document.querySelector('.created').dataset.time = data.created_at;
        }
      }

      refreshTimes();   // 无论保存还是删除，都刷新一次时间显示

    } catch(e) {
      console.error("保存请求失败", e);
    }
  }
}

saveBtn.addEventListener('click', () => save(false));
setInterval(() => save(true), 1000);
refreshTimes();   // 页面加载时初始化显示
</script>
</body>
</html>`, { headers: { "Content-Type": "text/html;charset=UTF-8", ...SECURITY_HEADERS } });

  } catch (err) {
    console.error("Worker Error:", err);
    return new Response(`<h1>Worker Error</h1><p>${htmlEscape(err.message || err)}</p>`, {
      status: 500,
      headers: { "Content-Type": "text/html;charset=UTF-8", ...SECURITY_HEADERS }
    });
  }
}

async function updateIndex(name, timesObj, env){
  let indexData = await env.NOTES_KV.get(INDEX_KEY);
  let arr = indexData ? JSON.parse(indexData) : [];
  arr = arr.filter(item => item.name !== name);
  if (timesObj) {
    arr.push({ name, created_at: timesObj.created_at, updated_at: timesObj.updated_at, encrypted: timesObj.encrypted });
  }
  await env.NOTES_KV.put(INDEX_KEY, JSON.stringify(arr));
}

function generateRandomNote(){
  const chars = '234579abcdefghjkmnpqrstwxyz';
  return Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}
