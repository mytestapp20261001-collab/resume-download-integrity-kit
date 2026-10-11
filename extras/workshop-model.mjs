// Bounded, page-memory policy runner. No browser, storage, network or code evaluation.
export const HAND_LIMIT=20;
export const MOVES=Object.freeze(['rock','paper','scissors']);
export const RULES=Object.freeze(['opening','win','tie','loss']);
export const RULE_CARD_LIMIT=256;
export function serializeRuleCard(policy){
 if(!policy||RULES.some(key=>!MOVES.includes(policy[key])))throw Error('Invalid policy');
 return ['MYTEST-RULES/1',...RULES.map(key=>`${key}=${policy[key]}`)].join('\n');
}
export function parseRuleCard(value){
 if(typeof value!=='string'||value.length>RULE_CARD_LIMIT)throw Error('Invalid rule card');
 const lines=value.replace(/\r\n/g,'\n').trim().split('\n');
 if(lines.length!==5||lines[0]!=='MYTEST-RULES/1')throw Error('Invalid rule card');
 const policy={};
 for(const [i,key]of RULES.entries()){
  const match=lines[i+1].match(new RegExp(`^${key}=(rock|paper|scissors)$`));
  if(!match)throw Error('Invalid rule card');
  policy[key]=match[1];
 }
 return Object.freeze(policy);
}
export function emptyModel(){return {frequency:[0,0,0],transitions:[[0,0,0],[0,0,0],[0,0,0]],last:null};}
export function learn(model,move){
 const next={frequency:model.frequency.map(x=>x*.85),transitions:model.transitions.map(row=>row.map(x=>x*.85)),last:move};
 next.frequency[move]++;if(model.last!==null)next.transitions[model.last][move]++;return next;
}
export function prediction(model){
 const normalize=row=>{const total=row.reduce((a,b)=>a+b,0);return row.map(n=>(n+1)/(total+3));};
 const global=normalize(model.frequency),row=model.last===null?[0,0,0]:model.transitions[model.last],n=row.reduce((a,b)=>a+b,0),weight=n/(n+2),conditional=normalize(row);
 return global.map((p,i)=>(1-weight)*p+weight*conditional[i]);
}
export function choose(model,roll){
 if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Invalid random draw');
 const probabilities=prediction(model);let guess=0,cumulative=probabilities[0];while(guess<2&&roll>=cumulative)cumulative+=probabilities[++guess];
 return {guess:MOVES[guess],opponent:MOVES[(guess+1)%3]};
}
export function createRun(policy,draws){
 if(!policy||RULES.some(key=>!MOVES.includes(policy[key])))throw Error('Invalid policy');
 if(!Array.isArray(draws)||draws.length!==HAND_LIMIT||Array.from(draws).some(n=>!Number.isFinite(n)||n<0||n>=1))throw Error('Invalid draws');
 return {policy:Object.freeze(Object.fromEntries(RULES.map(key=>[key,policy[key]]))),draws:Object.freeze([...draws]),model:emptyModel(),hands:[],wins:0,ties:0,losses:0};
}
export function stepRun(run){
 if(run.hands.length>=HAND_LIMIT)return run;
 // Both decisions use earlier hands only. The current sampled guess is not an input to the policy.
 const locked=choose(run.model,run.draws[run.hands.length]);
 const rule=run.hands.at(-1)?.result||'opening',player=run.policy[rule];
 const a=MOVES.indexOf(player),b=MOVES.indexOf(locked.opponent),result=a===b?'tie':(a-b+3)%3===1?'win':'loss';
 const hand=Object.freeze({hand:run.hands.length+1,rule,player,...locked,result});
 return {...run,model:learn(run.model,a),hands:[...run.hands,hand],wins:run.wins+Number(result==='win'),ties:run.ties+Number(result==='tie'),losses:run.losses+Number(result==='loss')};
}
