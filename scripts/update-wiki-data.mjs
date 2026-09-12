/**
 * Rebuilds the offline PKHunt Wiki datasets. Run with:
 *   node scripts/update-wiki-data.mjs
 *
 * The app never fetches the Wiki at runtime. This script refuses to write if
 * all 19 moveset pages, the Movedex and the species/move integrity checks are
 * not complete, then replaces the three generated files in one final step.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const site=path.resolve(here,'..');
const out=path.join(site,'data');
const base='https://pkhunt.online/en/wiki';
const sourceUrls=[...Array(19)].map((_,i)=>`${base}/catalogs/movesets/parte-${String(i+1).padStart(2,'0')}`);
const movesUrl=`${base}/catalogs/moves`;
const date=new Date().toISOString().slice(0,10);

function decode(s=''){
  return s.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
}
function cells(row){return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>decode(m[1]));}
function tableRows(table){return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>cells(m[1])).filter(row=>row.length);}
async function text(url){
  const response=await fetch(url,{headers:{'user-agent':'PKHuntTools-WikiRefresh/1.0'}});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.text();
}
async function loadVar(file,key){
  const context={window:{}};
  vm.runInNewContext(await fs.readFile(file,'utf8'),context,{timeout:1000});
  return context.window[key];
}
function sourceSpeciesName(name){
  // The Wiki and the existing species catalogue presently agree except for
  // typographic spacing. Keep all reconciliation explicit in this map.
  const aliases={'Farfetch’d':"Farfetch'd",'Type: Null':'Type Null'};
  return aliases[name]||name;
}
function parseMovesetPage(html){
  const result=[];
  // Next renders the navigation h3s before the article. Parsing only wk-doc
  // prevents a navigation heading from being paired with the first article
  // table by a permissive cross-section expression.
  const article=html.slice(html.indexOf('<div class="wk-doc">'));
  const rx=/<h3(?:\s[^>]*)?[^>]*>([\s\S]*?)<\/h3>\s*<table>([\s\S]*?)<\/table>/gi;
  for(const match of article.matchAll(rx)){
    const species=decode(match[1]);
    const levels=[],tms=[];
    for(const row of tableRows(match[2])){
      if(row.length<5)continue;
      const [source,name,type,power,cooldown]=row;
      if(/^\d+$/.test(source))levels.push({level:Number(source),name,type,power,cooldown});
      else if(source==='TM')tms.push(name);
    }
    if(species&&(levels.length||tms.length))result.push({species,levels,tms});
  }
  return result;
}
function parseMovedex(html){
  const first=html.match(/<table>([\s\S]*?)<\/table>/i)?.[1]||'';
  const moves={};
  for(const row of tableRows(first)){
    if(row.length<6||row[0]==='Move')continue;
    const [name,type,power,cooldown,kind,range]=row;
    moves[name]={name,type,power:power==='—'?'— (status)':power,cooldown,category:kind==='Damage'?'Dano':'Utilitário/Status',range:range==='Single'?'Alvo único':'Área'};
  }
  return moves;
}
function js(value){return JSON.stringify(value);}
async function main(){
  const [species,movesHtml,...movesetHtml]=await Promise.all([
    loadVar(path.join(out,'pokemon-v5.1.0.js'),'PKHuntPokemonData'),text(movesUrl),...sourceUrls.map(text)
  ]);
  const byName=new Set(Object.values(species).map(p=>p.name));
  const parsed=movesetHtml.flatMap(parseMovesetPage);
  if(parsed.length<745)throw new Error(`Only ${parsed.length} moveset species parsed; refusing partial update.`);
  const learnsets={},compatibility={},unmatched=[];
  for(const item of parsed){
    const name=sourceSpeciesName(item.species);
    if(!byName.has(name)){unmatched.push(item.species);continue;}
    learnsets[name]=item.levels;
    compatibility[name]=[...new Set(item.tms)].sort((a,b)=>a.localeCompare(b));
  }
  const movedex=parseMovedex(movesHtml);
  const allReferenced=new Set([...Object.values(learnsets).flat().map(move=>move.name),...Object.values(compatibility).flat()]);
  const missing=[...allReferenced].filter(move=>!movedex[move]);
  if(Object.keys(learnsets).length<745)throw new Error(`Only ${Object.keys(learnsets).length} species matched the local catalogue: ${unmatched.join(', ')}`);
  if(Object.keys(movedex).length<360)throw new Error(`Movedex has ${Object.keys(movedex).length} entries (<360); refusing partial update.`);
  if(missing.length)throw new Error(`Wiki TM/level move missing from Movedex: ${missing.join(', ')}`);
  const meta={sourceUrls:[...sourceUrls,movesUrl],sourceUpdated:'2026-09-03',generatedAt:date,sourceSpecies:parsed.length,matchedSpecies:Object.keys(learnsets).length,movedexMoves:Object.keys(movedex).length,unmatchedSpecies:unmatched,validation:{pages:19,knownMoveReferences:allReferenced.size,missingMovedexReferences:0}};
  const files={
    'learnsets-v6.19.1.js':`window.PKHuntLearnsetsMeta=${js(meta)};\nwindow.PKHuntLearnsetsData=${js(learnsets)};\n`,
    'tm-compatibility-v6.19.1.js':`window.PKHuntTMCompatibilityMeta=${js(meta)};\nwindow.PKHuntTMCompatibilityData=${js(compatibility)};\n`,
    'moves-v6.19.1.js':`window.PKHuntMovesMeta=${js(meta)};\nwindow.PKHuntMovesData=${js(movedex)};\n`,
    'wiki-update-report.json':JSON.stringify(meta,null,2)+'\n'
  };
  const staging=path.join(out,'.wiki-stage-'+Date.now());
  await fs.mkdir(staging,{recursive:true});
  try{
    for(const [file,contents] of Object.entries(files))await fs.writeFile(path.join(staging,file),contents);
    for(const file of Object.keys(files))await fs.rename(path.join(staging,file),path.join(out,file));
  }finally{await fs.rm(staging,{recursive:true,force:true});}
  console.log(JSON.stringify({ok:true,...meta},null,2));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
