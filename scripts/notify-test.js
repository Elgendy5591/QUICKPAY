// Prüft den E-Mail-Versand über die Brevo-API (npm test)
const http=require('http');let got=null;
const m=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{got={url:q.url,key:q.headers['api-key'],body:JSON.parse(b)};r.setHeader('content-type','application/json');r.end('{"messageId":"x"}')})}).listen(4995,async()=>{
  Object.assign(process.env,{BREVO_API_KEY:'k1',BREVO_API_URL:'http://127.0.0.1:4995',MAIL_FROM:'Quickpay Unfallservice <test@gmail.com>'});
  const n=require('../src/notify.js');
  const ok=await n.sendMail('kunde@x.de','Betreff','Text');
  const pass=ok&&n.channels().email&&got.url==='/v3/smtp/email'&&got.key==='k1'&&got.body.sender.email==='test@gmail.com'&&got.body.to[0].email==='kunde@x.de';console.log(pass?'ok E-Mail über Brevo':'FEHLER Brevo');m.close();process.exit(pass?0:1);
});
