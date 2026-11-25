// Prüft die Ersteinrichtung des ersten Büro-Zugangs (npm test)
process.env.DATA_DIR=require('os').tmpdir()+'/kf-setup-'+Date.now();process.env.SETUP_CODE='abc123XYZ';
const app=require('../server.js');
const s=app.listen(3996,async()=>{
  const B='http://localhost:3996',j=(p,b)=>fetch(B+p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{}).then(async r=>[r.status,await r.json(),r.headers.get('set-cookie')]);
  const ok=(c,m)=>{if(!c){console.log('FEHLER',m);process.exit(1)}console.log('ok',m)};
  let r=await j('/api/setup');ok(r[1].needed===true,'Einrichtung nötig');
  r=await j('/api/setup',{code:'falsch',email:'a@b.de',name:'A',password:'geheim12345'});ok(r[0]===403,'falscher Code abgelehnt');
  r=await j('/api/setup',{code:'abc123XYZ',email:'a@b.de',name:'A',password:'kurz'});ok(r[0]===400,'kurzes Passwort abgelehnt');
  r=await j('/api/setup',{code:'abc123XYZ',email:'buero@q.de',name:'Büro',password:'geheim12345'});ok(r[0]===200&&/kf_session=/.test(r[2]),'Büro angelegt + angemeldet');
  const ck=r[2].split(';')[0];const me=await fetch(B+'/api/me',{headers:{cookie:ck}}).then(r=>r.json());ok(me.user.role==='buero','Rolle buero');
  r=await j('/api/setup');ok(r[1].needed===false,'danach nicht mehr nötig');
  r=await j('/api/setup',{code:'abc123XYZ',email:'x@b.de',name:'X',password:'geheim12345'});ok(r[0]===403,'zweiter Versuch gesperrt');
  r=await j('/api/auth/login',{email:'buero@q.de',password:'geheim12345'});ok(r[0]===200,'Login klappt');
  s.close();process.exit(0);
});
