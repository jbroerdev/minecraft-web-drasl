import mc from 'minecraft-protocol';

/** Loopback-only transport adapter; upstream always authenticates against Drasl. */
export function startOnlineBridge({claimSession,host='193.181.217.200',port=25565,listenPort=25579,drasl='https://drasl.xserverx.app'}) {
 const server=mc.createServer({host:'127.0.0.1',port:listenPort,version:'1.8.9','online-mode':false,keepAlive:false,hideErrors:true,motd:'Minecraft Drasl bridge'});
 server.on('login',downstream=>{
  const forwarded=(downstream.serverHost||'').split('\0');
  const session=claimSession(downstream.username,forwarded[2]||'');
  if(!session){downstream.end('Keine bestätigte Drasl-Sitzung für diesen Gateway-Beitritt.');return;}
  const upstream=mc.createClient({host,port,version:'1.8.9',username:session.profile.name,auth:'mojang',authServer:drasl+'/auth',sessionServer:drasl+'/session',session:{accessToken:session.accessToken,clientToken:session.clientToken,selectedProfile:session.profile},profilesFolder:false,skipValidation:true,keepAlive:false,hideErrors:true});
  let stopped=false;
  const stop=message=>{if(stopped)return;stopped=true;downstream.end(message);upstream.end();};
  downstream.on('raw',(buffer,meta)=>{if(!stopped&&meta.state===mc.states.PLAY&&upstream.state===mc.states.PLAY)upstream.writeRaw(buffer);});
  upstream.on('raw',(buffer,meta)=>{if(!stopped&&meta.state===mc.states.PLAY&&downstream.state===mc.states.PLAY)downstream.writeRaw(buffer);});
  upstream.on('packet',(data,meta)=>{
   if(meta.state===mc.states.LOGIN&&meta.name==='disconnect'){console.warn('Minecraft upstream rejected login:',JSON.stringify(data.reason));stop('Spielserver: '+data.reason);}
   if(meta.state===mc.states.PLAY&&meta.name==='login')console.log('Drasl upstream world joined:',session.profile.name,session.profile.id);
  });
  downstream.on('end',()=>stop('Verbindung geschlossen.'));
  upstream.on('end',()=>stop('Verbindung zum Spielserver beendet.'));
  downstream.on('error',()=>stop('Gateway-Verbindung fehlgeschlagen.'));
  upstream.on('error',error=>{console.warn('Drasl upstream connection failed:',error.code||error.message);stop('Drasl-Anmeldung beim Spielserver fehlgeschlagen.');});
 });
 server.on('listening',()=>console.log(`Online-Bridge: 127.0.0.1:${listenPort} -> ${host}:${port}`));
 server.on('error',error=>console.error('Online-Bridge:',error.code||error.message));
 return server;
}
