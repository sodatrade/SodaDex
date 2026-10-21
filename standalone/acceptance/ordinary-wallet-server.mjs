// Loopback bridge. All calls are independently checked against the next rehearsed intent.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const runner=fileURLToPath(new URL('./ordinary-public-wallet.mjs',import.meta.url))
http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:18770'||req.headers.origin||req.method!=='POST'||req.url!=='/ordinary'||req.headers['x-soda-acceptance']!=='ordinary'){res.writeHead(403);res.end();return}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){res.writeHead(413);res.end();return}}
 let request;try{request=JSON.parse(body)}catch{res.writeHead(400);res.end();return}
 const args=request.method==='status'?['status']:['wallet',JSON.stringify(request)]
 execFile(process.execPath,[runner,...args],{timeout:240000,maxBuffer:1048576},(error,stdout,stderr)=>{
  res.setHeader('Content-Type','application/json');if(error){process.stderr.write(stderr);res.end(JSON.stringify({error:'Acceptance stopped; inspect local journal and runner'}));return}
  res.end(JSON.stringify({result:JSON.parse(stdout)}))
 })
}).listen(18770,'127.0.0.1',()=>console.log('Ordinary TEST acceptance bridge: loopback 18770'))
