import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
const created=[];
async function format(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await format(p);else if(p.endsWith('.ts')&&!p.endsWith('.d.ts')){const source=await fs.readFile(p,'utf8');await fs.writeFile(p,ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true)));created.push(p);}}}
await format('src');
console.log('Formatted',created.length,'TypeScript modules');
