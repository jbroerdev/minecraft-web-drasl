import http from 'node:http';
import {createConnection} from 'node:net';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, extname, sep} from 'node:path';

const DRASL='https://drasl.xserverx.app';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const body=async req=>{let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>8192)throw Error('body-limit');}return JSON.parse(value);};
const uuid=id=>id.replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5');

export function createLauncher({secret,gateway='ws://127.0.0.1:8081/',port=8790,fetcher=fetch,drasl=DRASL,sessionMillis=3600000,publicOrigin,frameAncestors=[],cookieSameSite='Strict',gatewayPort=8081}={}) {
 if(!secret||secret.length<32)throw Error('Gateway secret must contain at least 32 characters');
 const target=new URL(gateway);if(target.protocol!=='wss:'&&!(target.protocol==='ws:'&&['127.0.0.1','localhost'].includes(target.hostname)))throw Error('Remote gateway requires wss://');
 gateway=target.href;
 const sessions=new Map(),tickets=new Map(),attempts=new Map(),bridgeGrants=new Map();
 const origin=publicOrigin?new URL(publicOrigin).origin:`http://127.0.0.1:${port}`,cookie='mc_drasl',secureCookie=origin.startsWith('https:')?'; Secure':'';
  const allowedFrames=frameAncestors.map(value=>{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.origin!==value)throw Error('FRAME_ANCESTORS requires exact origins');return url.origin;});
 if(!['Strict','Lax','None'].includes(cookieSameSite))throw Error('Invalid cookie SameSite');
 if(cookieSameSite==='None'&&!secureCookie)throw Error('SameSite=None requires PUBLIC_ORIGIN with HTTPS');
 const getId=req=>{const bearer=req.headers.authorization;if(typeof bearer==='string'&&/^Bearer [a-f0-9]{64}$/.test(bearer))return bearer.slice(7);return (req.headers.cookie||'').split(/;\s*/).find(x=>x.startsWith(cookie+'='))?.slice(cookie.length+1);};
 const getSession=req=>{const s=sessions.get(getId(req));return s&&s.expires>Date.now()?s:null;};
 const request=async(path,payload)=>fetcher(drasl+path,{method:'POST',headers:{'Content-Type':'application/json','Connection':'close'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
 const discard=id=>{const s=sessions.get(id);if(s)tickets.delete(s.ticket);sessions.delete(id);return s;};
 const root=resolve(fileURLToPath(new URL('../web-dist/',import.meta.url)));
 const server=http.createServer(async(req,res)=>{try{
  const path=new URL(req.url,origin).pathname;
  res.setHeader('Referrer-Policy','no-referrer');if(!allowedFrames.length)res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Content-Security-Policy',"frame-ancestors 'self'"+(allowedFrames.length?' '+allowedFrames.join(' '):''));
  if(path==='/api/gateway/verify'&&req.method==='POST'){
   if(!same(req.headers['x-drasl-gateway-secret'],secret))return json(res,403,{error:'Gateway rejected'});
   const {ticket}=await body(req),s=tickets.get(ticket);
   if(!s||s.expires<=Date.now())return json(res,401,{error:'Session expired'});
   const valid=await request('/auth/validate',{accessToken:s.accessToken,clientToken:s.clientToken});
   if(tickets.get(ticket)!==s||s.expires<=Date.now())return json(res,401,{error:'Session expired'});
   if(!valid.ok){for(const [id,value]of sessions)if(value===s)discard(id);return json(res,401,{error:'Drasl session rejected'});}
   bridgeGrants.set(s.profile.name,{session:s,expires:Date.now()+20000});
   return json(res,200,{name:s.profile.name,uuid:uuid(s.profile.id)});
  }
  if(req.method==='POST'){
   if(req.headers.origin!==origin)return json(res,403,{error:'Origin rejected'});
   if(path==='/api/logout'){
    const s=discard(getId(req));res.setHeader('Set-Cookie',`${cookie}=; HttpOnly; SameSite=${cookieSameSite}; Path=/; Max-Age=0${secureCookie}`);
    if(s)await request('/auth/invalidate',{accessToken:s.accessToken,clientToken:s.clientToken}).catch(()=>{});
    return json(res,200,{});
   }
   if(path!=='/api/login')return json(res,404,{});
   const ip=req.socket.remoteAddress,now=Date.now(),attempt=attempts.get(ip)||{count:0,until:now+60000};
   if(attempt.until<=now){attempt.count=0;attempt.until=now+60000;}if(++attempt.count>12)return json(res,429,{error:'Zu viele Versuche. Bitte eine Minute warten.'});attempts.set(ip,attempt);
   const input=await body(req);
   if(typeof input.username!=='string'||typeof input.password!=='string'||!input.username.trim()||!input.password)return json(res,400,{error:'Bitte beide Felder ausfüllen.'});
   const clientToken=randomBytes(16).toString('hex');
   const response=await request('/auth/authenticate',{agent:{name:'Minecraft',version:1},username:input.username.trim(),password:input.password,clientToken});
   const data=await response.json();
   if(!response.ok)return json(res,response.status===403?401:502,{error:response.status===403?'Spielername oder Passwort/Minecraft-Token falsch.':'Drasl-Anmeldung fehlgeschlagen.'});
   const profile=data.selectedProfile;
   if(!data.accessToken||!profile||!/^\w{1,16}$/.test(profile.name)||!(/^[a-f0-9]{32}$/i.test(profile.id)||/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(profile.id)))return json(res,502,{error:'Drasl lieferte kein gültiges Spielerprofil.'});
   const old=discard(getId(req));if(old)await request('/auth/invalidate',{accessToken:old.accessToken,clientToken:old.clientToken}).catch(()=>{});
   const id=randomBytes(32).toString('hex'),ticket=randomBytes(32).toString('hex');const s={accessToken:data.accessToken,clientToken:data.clientToken||clientToken,profile,ticket,expires:now+sessionMillis};sessions.set(id,s);tickets.set(ticket,s);
   res.setHeader('Set-Cookie',`${cookie}=${id}; HttpOnly; SameSite=${cookieSameSite}; Path=/; Max-Age=${Math.floor(sessionMillis/1000)}${secureCookie}`);
   return json(res,200,{profile,launchToken:id});
  }
  if(req.method!=='GET')return json(res,405,{});
  if(path==='/')return await sendFile(res,new URL('./index.html',import.meta.url),'text/html; charset=utf-8');
  if(path==='/api/session'){const s=getSession(req);return s?json(res,200,{profile:s.profile}):json(res,401,{});}
  if(path==='/game.html'){
   const s=getSession(req);if(!s)return json(res,401,{error:'Bitte anmelden.'});
   let html=await readFile(resolve(root,'index.html'),'utf8');
   const runtime={name:s.profile.name,uuid:uuid(s.profile.id),gateway,ticket:s.ticket};
   html=html.replace('<head>','<head><script>window.draslSession='+JSON.stringify(runtime).replaceAll('<','\\u003c')+';</script>');
   html=html.replace('servers: [','servers: [{addr: window.draslSession.gateway, name: "Minecraft"},');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html);
  }
  if(!/^\/(?:classes\.js|input-focus\.js|performance\.js|assets\.epk|favicon\.png|login-(?:logo|dirt)\.png|lang\/[A-Za-z_]+\.lang)$/.test(path))return json(res,404,{});
  let decoded;try{decoded=decodeURIComponent(path);}catch{return json(res,400,{});}
  const file=resolve(root,'.'+decoded);if(!file.startsWith(root+sep))return json(res,403,{});
  const types={'.js':'text/javascript; charset=utf-8','.epk':'application/octet-stream','.png':'image/png','.json':'application/json','.txt':'text/plain'};
  return await sendFile(res,file,types[extname(file)]||'application/octet-stream');
 }catch(error){if(error.code==='ENOENT')return json(res,503,{error:'Client-Build fehlt noch.'});return json(res,error instanceof SyntaxError?400:502,{error:'Anfrage fehlgeschlagen. Bitte erneut versuchen.'});}});
 // Keep the WebSocket gateway internal; the public endpoint shares the launcher port.
 server.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws'||req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'){
   socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;
  }
  const upstream=createConnection({host:'127.0.0.1',port:gatewayPort});
  const timer=setTimeout(()=>{upstream.destroy();socket.destroy();},10000);timer.unref();
  const stop=()=>{clearTimeout(timer);upstream.destroy();socket.destroy();};
  upstream.on('error',stop);socket.on('error',stop);
  socket.on('close',()=>{clearTimeout(timer);upstream.destroy();});
  upstream.on('close',()=>{clearTimeout(timer);socket.destroy();});
  upstream.once('connect',()=>{
   clearTimeout(timer);
   if(socket.destroyed){upstream.destroy();return;}
   let headers='GET / HTTP/'+req.httpVersion+'\r\n';
   for(let i=0;i<req.rawHeaders.length;i+=2)headers+=req.rawHeaders[i]+': '+req.rawHeaders[i+1]+'\r\n';
   upstream.write(headers+'\r\n');if(head.length)upstream.write(head);
   socket.pipe(upstream);upstream.pipe(socket);
  });
 });
 const timer=setInterval(()=>{for(const [id,s]of sessions)if(s.expires<=Date.now())discard(id);for(const [ip,a]of attempts)if(a.until<=Date.now())attempts.delete(ip);},60000);timer.unref();server.on('close',()=>clearInterval(timer));
 server.claimBridgeSession=(name,id)=>{const grant=bridgeGrants.get(name);bridgeGrants.delete(name);if(!grant||grant.expires<=Date.now())return null;const s=grant.session;if(tickets.get(s.ticket)!==s||s.expires<=Date.now()||s.profile.id.replaceAll('-','').toLowerCase()!==id.replaceAll('-','').toLowerCase())return null;return s;};
 return server;
}
async function sendFile(res,path,type){const data=await readFile(path);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const state=new URL('./.runtime/',import.meta.url);await mkdir(state,{recursive:true});const key=new URL('gateway-secret',state);let secret;try{secret=(await readFile(key,'utf8')).trim();}catch{secret=randomBytes(32).toString('hex');await writeFile(key,secret,{mode:0o600});}
 const port=Number(process.env.PORT||8790);const server=createLauncher({secret,port,publicOrigin:process.env.PUBLIC_ORIGIN,frameAncestors:(process.env.FRAME_ANCESTORS||'').split(',').map(s=>s.trim()).filter(Boolean),cookieSameSite:process.env.COOKIE_SAME_SITE||'Strict',gateway:process.env.DRASL_GATEWAY_URL||'ws://127.0.0.1:8081/'});server.listen(port,process.env.BIND_HOST||'127.0.0.1',()=>console.log(`Minecraft mit Drasl: http://127.0.0.1:${port}`));
 const {startOnlineBridge}=await import('./online-bridge.mjs');startOnlineBridge({claimSession:server.claimBridgeSession,host:process.env.MINECRAFT_HOST||'193.181.217.200',port:Number(process.env.MINECRAFT_PORT||25565)});
}
