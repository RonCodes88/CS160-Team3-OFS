import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {webpack} = require('next/dist/compiled/webpack/webpack');
const root=process.cwd();
const output=await mkdtemp(path.join(tmpdir(),'ofs-browser-components-'));
const compiler=webpack({mode:'development',devtool:'source-map',entry:path.join(root,'e2e/harness/entry.tsx'),
  output:{path:output,filename:'fixture.js'},
  resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':path.join(root,'src'),
    'next/navigation$':path.join(root,'e2e/harness/navigation.tsx'),'next/link$':path.join(root,'e2e/harness/navigation.tsx'),
    '@stripe/stripe-js$':path.join(root,'e2e/harness/stripe.tsx'),'@stripe/react-stripe-js$':path.join(root,'e2e/harness/stripe.tsx')}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(root,'e2e/harness/transpile.cjs')}]},
});
await new Promise((resolve,reject)=>compiler.run((error,stats)=>{
  if(error || stats.hasErrors())reject(error??new Error(stats.toString({all:false,errors:true})));else resolve();
}));
compiler.close(()=>{});
const server=createServer(async(req,res)=>{
  if(req.url==='/fixture.js'||req.url==='/fixture.js.map') {
    res.setHeader('Content-Type',req.url.endsWith('.map')?'application/json':'application/javascript; charset=utf-8');
    res.end(await readFile(path.join(output,req.url.slice(1))));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
server.listen(3002,'localhost');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
