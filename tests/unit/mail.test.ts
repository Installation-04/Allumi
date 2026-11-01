import { createServer, type Socket } from "node:net";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { smtpConfig,deliverMail } from "@/platform/mail";
import { invoiceMail } from "@/modules/sales/domain/email";
const cfg=vi.hoisted(()=>({SMTP_HOST:"127.0.0.1",SMTP_PORT:1,SMTP_FROM:"Allumi <sender@example.test>",SMTP_SECURITY:"plain" as "plain"|"starttls"|"tls",SMTP_USER:undefined,SMTP_PASSWORD:undefined}));
vi.mock("@/platform/env",()=>({env:()=>cfg}));
let mode: "accept"|"reject"|"disconnect"="accept";
const messages:string[]=[];const sockets=new Set<Socket>();
const server=createServer(socket=>{
 sockets.add(socket);socket.on("close",()=>sockets.delete(socket));socket.write("220 local.test ESMTP\r\n");let buffer="",data=false,body="";
 socket.on("data",chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf("\r\n"))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
  if(data){if(line==="."){if(mode==="disconnect"){socket.destroy();return;}messages.push(body);data=false;body="";socket.write("250 accepted\r\n");}else body+=line+"\r\n";continue;}
  if(line.startsWith("EHLO"))socket.write("250-local.test\r\n250 SIZE 1000000\r\n");
  else if(line==="STARTTLS")socket.write("502 TLS unavailable\r\n");
  else if(line.startsWith("RCPT") && mode==="reject")socket.write("550 mailbox unavailable\r\n");
  else if(line==="DATA"){data=true;socket.write("354 send data\r\n");}
  else if(line==="QUIT"){socket.end("221 bye\r\n");}
  else socket.write("250 OK\r\n");
 }});
});
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));cfg.SMTP_PORT=(server.address() as {port:number}).port;});
afterAll(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));});
it("requires encryption by default and validates one safe sender and paired credentials",()=>{
 expect(smtpConfig({...cfg,SMTP_SECURITY:"starttls"})).toMatchObject({secure:false,requireTLS:true,ignoreTLS:false});
 expect(smtpConfig({...cfg,SMTP_SECURITY:"tls"})).toMatchObject({secure:true,ignoreTLS:false});
 for(const SMTP_FROM of ["a@example.test, b@example.test","a@example.test\r\nBcc:b@example.test",""])expect(()=>smtpConfig({...cfg,SMTP_FROM})).toThrow();
 expect(()=>smtpConfig({...cfg,SMTP_USER:"user"})).toThrow();
});
it("sends a standalone multipart invoice to a local SMTP receiver with stable message id",async()=>{
 const message=invoiceMail({number:"F-00001",issuer:["Business <one>"],customer:["Client"],issueDate:"2026-06-01",dueDate:null,reference:null,memo:null,lines:[{description:"<img src=x>",quantity:"1",unitPrice:"100",amount:"$100.00"}],taxes:[],subtotal:"$100.00",total:"$100.00"},"en");
 expect(message.html).toContain("&lt;img src=x&gt;");expect(message.html).not.toContain("<img");
 expect(await deliverMail({...message,to:"customer@example.test",attemptId:"00000000-0000-7000-8000-000000000001"})).toBe("ACCEPTED");
 expect(messages).toHaveLength(1);expect(messages[0]).toContain("multipart/alternative");expect(messages[0]).toContain("customer@example.test");expect(messages[0]).toContain("00000000-0000-7000-8000-000000000001@example.test");
});

it("distinguishes explicit rejection from disconnection after DATA without retry",async()=>{
 const message={to:"customer@example.test",attemptId:"00000000-0000-7000-8000-000000000002",subject:"Test",text:"Invoice",html:"<p>Invoice</p>"};
 mode="reject";expect(await deliverMail(message)).toBe("FAILED");
 mode="disconnect";expect(await deliverMail(message)).toBe("UNKNOWN");
 mode="accept";expect(messages).toHaveLength(1);
});

it("refuses an unencrypted relay when STARTTLS is required",async()=>{
 cfg.SMTP_SECURITY="starttls";
 try {expect(await deliverMail({to:"customer@example.test",attemptId:"00000000-0000-7000-8000-000000000003",subject:"Test",text:"Invoice",html:"<p>Invoice</p>"})).toBe("FAILED");expect(messages).toHaveLength(1);}
 finally {cfg.SMTP_SECURITY="plain";}
});
