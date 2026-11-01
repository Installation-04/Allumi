import { createServer, type Socket } from "node:net";
/** Local test-only relay. It never connects to any external mail server. */
export function smtpReceiver() {
  const messages:string[]=[];
  const sockets=new Set<Socket>();
  const server=createServer(socket=>{
    sockets.add(socket);socket.on("close",()=>sockets.delete(socket));socket.write("220 test.invalid ESMTP\r\n");
    let buffer="",data=false,body="";
    socket.on("data",chunk=>{
      buffer+=chunk.toString();let end;
      while((end=buffer.indexOf("\r\n"))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(data){if(line==="."){messages.push(body);body="";data=false;socket.write("250 accepted\r\n");}else body+=line+"\r\n";continue;}
        if(line.startsWith("EHLO"))socket.write("250-test.invalid\r\n250 SIZE 1000000\r\n");
        else if(line==="DATA"){data=true;socket.write("354 send data\r\n");}
        else if(line==="QUIT")socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  return {messages,listen:(port:number)=>new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);}),close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
