const cfg=window.GROUNDSCORE_CONFIG||{};
const configured=cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.includes("YOUR_")&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_ANON_KEY.includes("YOUR_");
const state={match:null,innings:[],balls:[],players:[]};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,opts={}){
  const h={apikey:cfg.SUPABASE_ANON_KEY,Authorization:`Bearer ${cfg.SUPABASE_ANON_KEY}`,"Content-Type":"application/json",Prefer:opts.prefer||"return=representation"};
  const r=await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`,{...opts,headers:{...h,...(opts.headers||{})}});
  const t=await r.text();if(!r.ok)throw new Error(t||r.statusText);return t?JSON.parse(t):[];
}
const selectTeam=t=>t==="team1"?state.match.team1:state.match.team2;
const parsePlayers=s=>s.split(",").map(x=>x.trim()).filter(Boolean);
const oversText=n=>`${Math.floor(n/6)}.${n%6}`;
const currentInnings=()=>state.innings.find(x=>x.innings_no===state.match.current_innings);
const currentBattingTeam=()=>currentInnings()?.batting_team;
const currentBowlingTeam=()=>currentInnings()?.bowling_team;
const show=id=>["setupView","scoreView","summaryView"].forEach(x=>$(x).classList.toggle("hidden",x!==id));

async function init(){
  if(!configured){$("configNotice").classList.remove("hidden");$("configNotice").textContent="Supabase is not configured. Set the two values in config.js, then deploy.";return}
  const id=localStorage.getItem("groundscore_match_id");
  if(id){try{await loadMatch(id);return}catch(e){localStorage.removeItem("groundscore_match_id")}}
  show("setupView");
}
async function createMatch(){
  $("setupError").textContent="";
  const scorer=$("scorerName").value.trim(),team1=$("team1").value.trim(),team2=$("team2").value.trim();
  const p1=parsePlayers($("players1").value),p2=parsePlayers($("players2").value);
  const overs=Number($("overs").value),tw=$("tossWinner").value,td=$("tossDecision").value;
  if(!scorer||!team1||!team2||team1===team2||!overs||!tw||!td||p1.length<2||p2.length<2){$("setupError").textContent="Complete all fields and add at least 2 players per team.";return}
  try{
    const tossTeam=tw==="team1"?team1:team2;
    const firstBat=td==="bat"?tw:(tw==="team1"?"team2":"team1"),firstBowl=firstBat==="team1"?"team2":"team1";
    const m=(await api("matches",{method:"POST",body:JSON.stringify({team1,team2,overs,toss_winner:tossTeam,toss_decision:td,status:"live",current_innings:1,created_by:scorer})}))[0];
    await api("players",{method:"POST",body:JSON.stringify([...p1.map(name=>({match_id:m.id,team:"team1",name})),...p2.map(name=>({match_id:m.id,team:"team2",name}))])});
    await api("innings",{method:"POST",body:JSON.stringify({match_id:m.id,innings_no:1,batting_team:firstBat,bowling_team:firstBowl,status:"live"})});
    localStorage.setItem("groundscore_match_id",m.id);localStorage.setItem("groundscore_scorer",scorer);
    await loadMatch(m.id);
  }catch(e){$("setupError").textContent=e.message}
}
async function loadMatch(id){
  state.match=(await api(`matches?id=eq.${encodeURIComponent(id)}&select=*`))[0];
  if(!state.match)throw Error("Match not found");
  state.innings=await api(`innings?match_id=eq.${id}&select=*&order=innings_no.asc`);
  state.players=await api(`players?match_id=eq.${id}&select=*&order=name.asc`);
  state.balls=await api(`balls?match_id=eq.${id}&select=*&order=created_at.desc`);
  state.match.status==="finished"?renderSummary():renderScore();
}
function renderScore(){
  show("scoreView");
  $("matchTitle").textContent=`${state.match.team1} vs ${state.match.team2}`;
  $("tossText").textContent=`Toss: ${state.match.toss_winner} won and chose to ${state.match.toss_decision}`;
  $("matchStatus").textContent=`Innings ${state.match.current_innings}`;
  $("activeScorer").textContent=localStorage.getItem("groundscore_scorer")||"—";
  const inn=currentInnings(),bs=state.balls.filter(b=>b.innings_no===inn.innings_no);
  const total=bs.reduce((s,b)=>s+Number(b.total_runs),0),wickets=bs.filter(b=>b.wicket).length,legal=bs.filter(b=>!["wide","no-ball"].includes(b.extra_type)).length;
  $("inningsLabel").textContent=`${selectTeam(inn.batting_team)} batting`;
  $("scoreText").textContent=`${total}/${wickets}`;$("oversText").textContent=`${oversText(legal)} overs`;$("runRate").textContent=legal?(total/(legal/6)).toFixed(2):"0.00";$("ballText").textContent=`Ball ${legal+1}`;
  fillPlayerSelects();renderBalls(bs.slice(0,10));
}
function fillPlayerSelects(){
  const bat=state.players.filter(p=>p.team===currentBattingTeam()),bowl=state.players.filter(p=>p.team===currentBowlingTeam());
  for(const id of ["striker","nonStriker","dismissedBatsman"]){const e=$(id),old=e.value;e.innerHTML=bat.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");if(old)e.value=old}
  const e=$("bowler"),old=e.value;e.innerHTML=bowl.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");if(old)e.value=old;
  $("dismissedWrap").classList.toggle("hidden",!$("wicket").value);
}
function renderBalls(bs){
  $("ballsList").innerHTML=bs.length?bs.map(b=>{
    const batter=state.players.find(p=>p.id===b.striker_id)?.name||"—",bowler=state.players.find(p=>p.id===b.bowler_id)?.name||"—";
    let r=`${b.total_runs} run${b.total_runs===1?"":"s"}`;if(b.wicket)r+=` · ${esc(b.wicket)}`;if(b.extra_type)r+=` · ${esc(b.extra_type)}`;
    return `<div class="ball"><strong>${b.over_number}.${b.ball_number}</strong><span>${esc(batter)} vs ${esc(bowler)} — ${r}</span><span class="muted">${esc(b.scorer_name)}</span></div>`;
  }).join(""):`<div class="empty">No balls recorded yet.</div>`;
}
async function addBall(){
  $("scoreError").textContent="";
  const scorer=localStorage.getItem("groundscore_scorer")||"";
  if(!scorer){$("scoreError").textContent="Set your scorer name.";return}
  const inn=currentInnings(),prior=state.balls.filter(b=>b.innings_no===inn.innings_no),legal=prior.filter(b=>!["wide","no-ball"].includes(b.extra_type)).length;
  const extra=$("extraType").value,wicket=$("wicket").value,runs=Number($("runs").value),extraRuns=extra?1:0;
  const payload={match_id:state.match.id,innings_no:inn.innings_no,over_number:Math.floor(legal/6),ball_number:(legal%6)+1,striker_id:$("striker").value,non_striker_id:$("nonStriker").value,bowler_id:$("bowler").value,runs,runs_off_bat:runs,extra_type:extra||null,extra_runs:extraRuns,total_runs:runs+extraRuns,wicket:wicket||null,dismissed_batsman_id:wicket?$("dismissedBatsman").value:null,scorer_name:scorer};
  try{await api("balls",{method:"POST",body:JSON.stringify(payload)});await loadMatch(state.match.id)}catch(e){$("scoreError").textContent=e.message}
}
async function endInnings(){
  const inn=currentInnings(),next=state.match.current_innings+1;
  if(next>2){return finishMatch()}
  await api(`innings?id=eq.${inn.id}`,{method:"PATCH",body:JSON.stringify({status:"completed"})});
  await api("innings",{method:"POST",body:JSON.stringify({match_id:state.match.id,innings_no:next,batting_team:inn.bowling_team,bowling_team:inn.batting_team,status:"live"})});
  await api(`matches?id=eq.${state.match.id}`,{method:"PATCH",body:JSON.stringify({current_innings:next})});
  await loadMatch(state.match.id);
}
async function finishMatch(){
  await api(`matches?id=eq.${state.match.id}`,{method:"PATCH",body:JSON.stringify({status:"finished",finished_at:new Date().toISOString()})});
  localStorage.removeItem("groundscore_match_id");await loadMatch(state.match.id);
}
function playerName(id){return state.players.find(p=>p.id===id)?.name||"Unknown"}
function renderSummary(){
  show("summaryView");
  const scores=state.innings.map(i=>{const bs=state.balls.filter(b=>b.innings_no===i.innings_no);return{i,total:bs.reduce((s,b)=>s+Number(b.total_runs),0),w:bs.filter(b=>b.wicket).length,legal:bs.filter(b=>!["wide","no-ball"].includes(b.extra_type)).length}});
  let result="Match drawn / no result";
  if(scores.length>=2){
    if(scores[0].total>scores[1].total)result=`${selectTeam(scores[0].i.batting_team)} won by ${scores[0].total-scores[1].total} runs`;
    else if(scores[1].total>scores[0].total)result=`${selectTeam(scores[1].i.batting_team)} won by ${Math.max(0,10-scores[1].w)} wickets`;
    else result="Match tied";
  }
  $("resultText").textContent=result;$("summaryToss").textContent=`Toss: ${state.match.toss_winner} won and chose to ${state.match.toss_decision}`;
  const bat={},bowl={};state.balls.forEach(b=>{bat[b.striker_id]=(bat[b.striker_id]||0)+Number(b.runs_off_bat);if(b.wicket&&["bowled","caught","lbw","stumped","hit wicket"].includes(b.wicket))bowl[b.bowler_id]=(bowl[b.bowler_id]||0)+1});
  $("battingSummary").innerHTML=Object.entries(bat).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,v])=>`<div class="row"><span>${esc(playerName(id))}</span><strong>${v}</strong></div>`).join("")||`<div class="empty">No batting data.</div>`;
  $("bowlingSummary").innerHTML=Object.entries(bowl).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,v])=>`<div class="row"><span>${esc(playerName(id))}</span><strong>${v} wicket${v===1?"":"s"}</strong></div>`).join("")||`<div class="empty">No credited wickets.</div>`;
  $("inningsSummary").innerHTML=scores.map(s=>{const rr=s.legal?(s.total/(s.legal/6)).toFixed(2):"0.00";return `<div class="row"><span>${esc(selectTeam(s.i.batting_team))}</span><strong>${s.total}/${s.w} · RR ${rr}</strong></div>`}).join("");
  const moments=[];state.balls.forEach(b=>{if(b.runs_off_bat===6)moments.push(`Six by ${playerName(b.striker_id)} in over ${b.over_number}`);if(b.runs_off_bat===4)moments.push(`Four by ${playerName(b.striker_id)} in over ${b.over_number}`);if(b.wicket)moments.push(`${playerName(b.dismissed_batsman_id)} dismissed ${b.wicket}`)});
  $("momentsSummary").innerHTML=moments.slice(0,8).map(x=>`<div class="row"><span>${esc(x)}</span></div>`).join("")||`<div class="empty">No special moments recorded.</div>`;
}
$("createMatchBtn").onclick=createMatch;$("addBallBtn").onclick=addBall;$("wicket").onchange=fillPlayerSelects;$("endInningsBtn").onclick=endInnings;$("finishMatchBtn").onclick=finishMatch;$("refreshBtn").onclick=()=>loadMatch(state.match.id);$("summaryNewMatchBtn").onclick=()=>show("setupView");
init();
