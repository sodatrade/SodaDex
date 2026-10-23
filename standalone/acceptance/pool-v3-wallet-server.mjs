// Loopback-only bridge for the five approved TEST browser operations.
// The browser never receives a key. The runner enforces exact intents and cumulative caps.
import http from 'node:http'
import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const runner=fileURLToPath(new URL('../../scripts/sodadex/pool-v3-execution.mjs',import.meta.url))
http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:18769'||req.headers.origin||req.method!=='POST'||req.url!=='/pool-v3'||req.headers['x-soda-acceptance']!=='pool-v3'){res.writeHead(403);res.end();return}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){res.writeHead(413);res.end();return}}
 let request;try{request=JSON.parse(body)}catch{res.writeHead(400);res.end();return}
 execFile(process.execPath,[runner,'wallet',JSON.stringify(request)],{timeout:240000,maxBuffer:1048576},(error,stdout,stderr)=>{
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(error?{error:stderr.trim()||'Acceptance stopped'}:{result:JSON.parse(stdout)}))
 })
}).listen(18769,'127.0.0.1',()=>console.log('Approved pool-v3 acceptance bridge listening on loopback'))
