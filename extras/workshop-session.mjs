#!/usr/bin/env node
// Experimental process-memory carrier. No files, network, startup play or telemetry.
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {HAND_LIMIT,MOVES,RULES,createRun,stepRun} from './workshop-model.mjs';

let run=null,closed=false;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const state=()=>({active:run!==null&&run.hands.length<HAND_LIMIT,playedHands:run?.hands.length??0,handLimit:HAND_LIMIT});
const summary=()=>({...state(),policy:run?.policy??null,score:run?{wins:run.wins,ties:run.ties,losses:run.losses}:null});
const help={activity:'none',status:'idle',name:'MyTest experimental step-controlled local workshop',commands:{start:'{"action":"start","policy":{"opening":"rock","win":"paper","tie":"scissors","loss":"rock"}}',step:'{"action":"step"}',status:'{"action":"status"}',leave:'{"action":"leave"}',close:'{"action":"close"}'},rules:'Start chooses four moves without playing. Each explicit step reveals one hand using the unchanged frequency/transition statistical opponent; it is not an independent attending AI. Leave at any point, or automatically finish at20hands.',privacy:'Memory only. No network, file/state storage or automatic telemetry. Caller-retained output/events are an explicit saved copy.',promotion:'Transparent experimental MyTest activity. It is not an engineering step, permission source or claimed productivity benefit.'};
emit(help);
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{
 if(closed)return;
 try{
  const msg=JSON.parse(line);
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||!['start','step','status','leave','close','help'].includes(msg.action))throw Error('Use a listed explicit JSON action.');
  const allowed=msg.action==='start'?['action','policy']:['action'];
  if(Object.keys(msg).some(k=>!allowed.includes(k)))throw Error('Unexpected fields; no action applied.');
  if(msg.action==='help'){emit({...help,status:'help',...state()});return;}
  if(msg.action==='status'){emit({activity:run?'private_local_workshop':'none',status:'snapshot',...summary()});return;}
  if(msg.action==='start'){
   if(run!==null)throw Error('A run already exists; leave it before starting another.');
   if(!msg.policy||typeof msg.policy!=='object'||Array.isArray(msg.policy)||Object.keys(msg.policy).length!==RULES.length||RULES.some(k=>!Object.hasOwn(msg.policy,k)||!MOVES.includes(msg.policy[k])))throw Error('Explicit opening/win/tie/loss moves required.');
   const draws=Array.from({length:HAND_LIMIT},()=>randomBytes(4).readUInt32BE()/2**32);
   run=createRun(msg.policy,draws);emit({activity:'private_local_workshop',status:'started',...summary()});return;
  }
  if(msg.action==='step'){
   if(run===null||run.hands.length>=HAND_LIMIT)throw Error('No unfinished run; no hand played.');
   run=stepRun(run);const h=run.hands.at(-1);
   emit({activity:'private_local_workshop',status:run.hands.length===HAND_LIMIT?'finished_at_limit':'stepped',...summary(),hand:{hand:h.hand,rule:h.rule,player:h.player,opponent:h.opponent,result:h.result}});return;
  }
  const before=summary();const hadRun=run!==null;run=null;
  emit({activity:hadRun?'private_local_workshop':'none',status:msg.action==='close'?'closed':'left',previous:before,memory:'Run discarded; no automatic persistence.',...state()});
  if(msg.action==='close')input.close();
 }catch(error){emit({activity:'none',status:'rejected',error:error.message,...state()});}
});
input.on('close',()=>{closed=true;run=null;emit({activity:'none',status:'process_input_closed',memory:'Process run discarded.'});});
