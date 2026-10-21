import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {createLauncher} from './server.mjs';
const secret='a'.repeat(64),port=18790,origin=`http://127.0.0.1:${port}`;
const profile={id:'69338315dbd94b2e9b110e261016cee8',name:'test'};
let revoked=false;
const fetcher=async(url,opts)=>{const input=JSON.parse(opts.body);if(url.endsWith('/authenticate'))return input.password==='correct'?Response.json({accessToken:'private-upstream-token',clientToken:input.clientToken,selectedProfile:profile}):Response.json({error:'Forbidden'}, {status:403});if(url.endsWith('/validate'))return new Response(null,{status:revoked?403:204});return new Response(null,{status:204});};
const post=(path,data,headers={})=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
test('Drasl identity, forged tickets, origin, logout and upstream revocation',async()=>{
 const server=createLauncher({secret,port,fetcher});await new Promise(r=>server.listen(port,'127.0.0.1',r));
 try{
  assert.equal((await fetch(origin+'/game.html')).status,401);
  assert.equal((await post('/api/login',{username:'test',password:'correct'},{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/login',{username:'test',password:'wrong'})).status,401);
  const login=await post('/api/login',{username:'test',password:'correct'});assert.equal(login.status,200);const payload=await login.text();assert(!payload.includes('private-upstream-token'));
  const cookie=login.headers.get('set-cookie').split(';')[0];
  // Read the same injected session that the compiled client consumes.
  const htmlResponse=await fetch(origin+'/game.html',{headers:{Cookie:cookie}});
  // Real build is required for this integration test; no placeholder game is substituted.
  assert.equal(htmlResponse.status,200);const html=await htmlResponse.text();const runtime=JSON.parse(html.match(/window\.draslSession=(.*?);<\/script>/)[1]);
  assert.equal(runtime.name,'test');assert.equal(runtime.uuid,'69338315-dbd9-4b2e-9b11-0e261016cee8');assert(!html.includes('private-upstream-token'));
  const verify=(ticket,key=secret)=>post('/api/gateway/verify',{ticket},{'X-Drasl-Gateway-Secret':key});
  assert.equal((await verify(runtime.ticket,'wrong')).status,403);
  assert.equal((await verify('0'.repeat(64))).status,401);
  assert.deepEqual(await(await verify(runtime.ticket)).json(),{name:'test',uuid:runtime.uuid});
  assert.equal(server.claimBridgeSession('test','0'.repeat(32)),null);
  await verify(runtime.ticket);
  assert.equal(server.claimBridgeSession('test',runtime.uuid).profile.id,profile.id);
  assert.equal(server.claimBridgeSession('test',runtime.uuid),null);
  await verify(runtime.ticket);
  revoked=true;assert.equal((await verify(runtime.ticket)).status,401);revoked=false;
  assert.equal((await fetch(origin+'/game.html',{headers:{Cookie:cookie}})).status,401);
  const login2=await post('/api/login',{username:'test',password:'correct'});const cookie2=login2.headers.get('set-cookie').split(';')[0];const html2=await(await fetch(origin+'/game.html',{headers:{Cookie:cookie2}})).text();const runtime2=JSON.parse(html2.match(/window\.draslSession=(.*?);<\/script>/)[1]);
  assert.equal((await post('/api/logout',{}, {Cookie:cookie2})).status,200);
  assert.equal((await verify(runtime2.ticket)).status,401);
  assert.equal(server.claimBridgeSession('test',runtime2.uuid),null);
 } finally {await new Promise(r=>server.close(r));}
});
test('Embedding allowlist, HTTPS cookie and foreign-origin rejection',async()=>{
 const embedPort=18792;
 const server=createLauncher({secret,port:embedPort,publicOrigin:'https://minecraft.example.com',frameAncestors:['https://portal.example.com'],cookieSameSite:'None',fetcher});
 await new Promise(r=>server.listen(embedPort,'127.0.0.1',r));
 try{
  const page=await fetch(`http://127.0.0.1:${embedPort}/`);
  assert.equal(page.headers.get('x-frame-options'),null);
  assert.equal(page.headers.get('content-security-policy'),"frame-ancestors 'self' https://portal.example.com");
  const login=await fetch(`http://127.0.0.1:${embedPort}/api/login`,{method:'POST',headers:{Origin:'https://minecraft.example.com','Content-Type':'application/json'},body:JSON.stringify({username:'test',password:'correct'})});
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/SameSite=None/);assert.match(login.headers.get('set-cookie'),/; Secure/);
  const foreign=await fetch(`http://127.0.0.1:${embedPort}/api/logout`,{method:'POST',headers:{Origin:'https://portal.example.com'}});
  assert.equal(foreign.status,403);
 }finally{await new Promise(r=>server.close(r));}
 assert.throws(()=>createLauncher({secret,cookieSameSite:'None'}),/HTTPS/);
});


test('Cookie-free iframe login, assets and bearer logout',async()=>{
 const server=createLauncher({secret,port:18793,fetcher});await new Promise(r=>server.listen(18793,'127.0.0.1',r));
 const base='http://127.0.0.1:18793';
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'test',password:'correct'})});
  const {launchToken}=await login.json();assert.match(launchToken,/^[a-f0-9]{64}$/);
  const headers={Authorization:'Bearer '+launchToken};
  const game=await fetch(base+'/game.html',{headers});assert.equal(game.status,200);assert.match(await game.text(),/window.draslSession=/);
  assert.equal((await fetch(base+'/login-logo.png')).status,200);
  assert.equal((await fetch(base+'/login-dirt.png')).status,200);
  assert.equal((await fetch(base+'/game.html')).status,401);
  assert.equal((await fetch(base+'/api/logout',{method:'POST',headers:{...headers,Origin:base}})).status,200);
  assert.equal((await fetch(base+'/game.html',{headers})).status,401);
 }finally{await new Promise(r=>server.close(r));}
});

test('/ws forwards upgrade headers and binary data in both directions',async()=>{
 let upgraded='';const sockets=new Set();
 const gateway=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0),ready=false;
  socket.on('data',data=>{if(ready){socket.write(data);return;}buffer=Buffer.concat([buffer,data]);const end=buffer.indexOf('\r\n\r\n');if(end<0)return;
   upgraded=buffer.subarray(0,end).toString();socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');ready=true;if(buffer.length>end+4)socket.write(buffer.subarray(end+4));
  });
 });await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const launcher=createLauncher({secret,port:18794,gatewayPort:gateway.address().port});await new Promise(r=>launcher.listen(18794,'127.0.0.1',r));
 const socket=net.createConnection(18794,'127.0.0.1');socket.setTimeout(3000,()=>socket.destroy(new Error('Proxy test timed out')));
 try{
  await once(socket,'connect');const reply=once(socket,'data');socket.write('GET /ws HTTP/1.1\r\nHost: minecraft.example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  assert.match((await reply)[0].toString(),/101 Switching Protocols/);assert.match(upgraded,/^GET \/ HTTP/);assert.match(upgraded,/Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==/);
  const binary=Buffer.from([0,255,128,1,2,3]);const echo=once(socket,'data');socket.write(binary);assert.deepEqual((await echo)[0],binary);
 }finally{socket.destroy();for(const sock of sockets)sock.destroy();await new Promise(r=>launcher.close(r));await new Promise(r=>gateway.close(r));}
});
