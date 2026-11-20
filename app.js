const cfg=window.GROUNDSCORE_CONFIG||{};
const configured=!!(cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.includes("YOUR_")&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_ANON_KEY.includes("YOUR_"));
const state={tournament:null,match:null,innings:[],balls:[],players:[],members:[],poll:null,milestones:new Set()};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,opts={}){const headers={apikey:cfg.SUPABASE_ANON_KEY,"Content-Type":"application/json",Prefer:opts.prefer||"return=representation"};const r=await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`,{...opts,headers:{...headers,...(opts.headers||{})}});const t=await r.text();if(!r.ok)throw new Error(t||r.statusText);return t?JSON.parse(t):[]}
const show=id=>{["homeView","tournamentCreateView","tournamentListView","joinView","tournamentView","matchSetupView","scoreView","summaryView"].forEach(x=>$(x).classList.toggle("hidden",x!==id));$("homeBtn").classList.toggle("hidden",id==="homeView")};
const parsePlayers=s=>[...new Set(s.split(",").map(x=>x.trim()).filter(Boolean))];
const overText=n=>`${Math.floor(n/6)}.${n%6}`;
const currentInnings=()=>state.innings.find(x=>x.innings_no===state.match.current_innings);
const teamName=t=>t==="team1"?state.match.team1:state.match.team2;
const playerName=id=>state.players.find(p=>p.id===id)?.name||"Unknown";
const localScorer=()=>localStorage.getItem("groundscore_scorer")||"";
const legal=b=>!["wide","no-ball"].includes(b.extra_type);
async function init(){if(!configured){$("configNotice").classList.remove("hidden");$("configNotice").textContent="Supabase is not configured. Check config.js.";show("homeView");return}const sharedMatch=new URLSearchParams(window.location.search).get("match");if(sharedMatch){try{await loadMatch(sharedMatch);return}catch(e){$("configNotice").classList.remove("hidden");$("configNotice").textContent="Could not load this scorecard: "+e.message}}await loadHome()}
async function loadHome(){try{const ts=await api("tournaments?select=*&order=event_date.desc.nullslast,created_at.desc");renderTournamentCards($("homeTournaments"),ts.slice(0,6),false);show("homeView")}catch(e){$("homeTournaments").innerHTML=`<div class="empty">${esc(e.message)}</div>`;show("homeView")}}
function renderTournamentCards(target,ts,joinMode){target.innerHTML=ts.length?ts.map(t=>`<article class="tournament-card"><div><div class="pill">${esc(t.status||"upcoming")}</div><h2>${esc(t.name)}</h2><p class="muted">${t.event_date?esc(new Date(t.event_date+"T00:00:00").toLocaleDateString()):"Date not set"} · ${esc(t.venue||"Venue TBA")}</p></div><div class="tournament-actions"><button class="secondary" data-view="${t.id}">View scores</button>${joinMode?`<button class="primary" data-join="${t.id}">Join</button>`:`<button class="ghost" data-view="${t.id}">Open</button>`}</div></article>`).join(""):`<div class="card empty">No tournaments yet. Start one and invite the group.</div>`;target.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openTournament(b.dataset.view));target.querySelectorAll("[data-join]").forEach(b=>b.onclick=()=>openJoin(b.dataset.join))}
async function listTournaments(){show("tournamentListView");$("tournamentList").innerHTML='<div class="empty">Loading tournaments…</div>';try{const ts=await api("tournaments?select=*&order=event_date.desc.nullslast,created_at.desc");renderTournamentCards($("tournamentList"),ts,true)}catch(e){$("tournamentList").innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
async function addMember(tid,name){const found=await api(`tournament_members?tournament_id=eq.${tid}&name=eq.${encodeURIComponent(name)}&select=*`);if(found.length)return found[0];return(await api("tournament_members",{method:"POST",body:JSON.stringify({tournament_id:tid,name})}))[0]}
async function createTournament(){const name=$("tournamentName").value.trim(),organizer=$("organizerName").value.trim();$("tournamentCreateError").textContent="";if(!name||!organizer){$("tournamentCreateError").textContent="Enter tournament name and your name.";return}try{const t=(await api("tournaments",{method:"POST",body:JSON.stringify({name,event_date:$("tournamentDate").value||null,venue:$("tournamentVenue").value.trim()||null,status:"upcoming",created_by:organizer})}))[0];await addMember(t.id,organizer);localStorage.setItem("groundscore_member",organizer);localStorage.setItem("groundscore_scorer",organizer);await openTournament(t.id)}catch(e){$("tournamentCreateError").textContent=e.message}}
async function openJoin(tid){state.tournament=(await api(`tournaments?id=eq.${tid}&select=*`))[0];const ms=await api(`tournament_members?tournament_id=eq.${tid}&select=*&order=name.asc`);state.members=ms;$("joinTournamentTitle").textContent=state.tournament.name;$("joinTournamentMeta").textContent=[state.tournament.event_date,state.tournament.venue].filter(Boolean).join(" · ");$("existingMember").innerHTML='<option value="">Choose your name if already listed</option>'+ms.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("");$("newMemberName").value="";$("joinError").textContent="";show("joinView")}
async function confirmJoin(){const name=$("existingMember").value||$("newMemberName").value.trim();$("joinError").textContent="";if(!name){$("joinError").textContent="Select your name or enter a new name.";return}try{await addMember(state.tournament.id,name);localStorage.setItem("groundscore_member",name);localStorage.setItem("groundscore_scorer",name);await openTournament(state.tournament.id)}catch(e){$("joinError").textContent=e.message}}
async function openTournament(tid){state.tournament=(await api(`tournaments?id=eq.${tid}&select=*`))[0];await refreshTournament();show("tournamentView")}
async function refreshTournament(){const tid=state.tournament.id;const [matches,members]=await Promise.all([api(`matches?tournament_id=eq.${tid}&select=*&order=created_at.desc`),api(`tournament_members?tournament_id=eq.${tid}&select=*&order=name.asc`)]);state.members=members;$("tournamentTitle").textContent=state.tournament.name;$("tournamentMeta").textContent=[state.tournament.event_date?new Date(state.tournament.event_date+"T00:00:00").toLocaleDateString():"Date TBA",state.tournament.venue||"Venue TBA",state.tournament.status].join(" · ");$("memberList").innerHTML=members.map(m=>`<span class="member-chip">${esc(m.name)}</span>`).join("")||"No members yet";$("tournamentMatches").innerHTML=matches.length?matches.map(m=>`<article class="tournament-card"><div><div class="pill">${m.status==="finished"?"finished":"live"}</div><h2>${esc(m.team1)} vs ${esc(m.team2)}</h2><p class="muted">${m.overs} overs · Scorer ${esc(m.created_by)}</p></div><div class="tournament-actions"><button class="primary" data-match="${m.id}">${m.status==="finished"?"Scorecard":"Follow live"}</button></div></article>`).join(""):'<div class="card empty">No matches yet. Start the first game.</div>';$("tournamentMatches").querySelectorAll("[data-match]").forEach(b=>b.onclick=()=>loadMatch(b.dataset.match))}
async function startMatchSetup(){const ms=await api(`tournament_members?tournament_id=eq.${state.tournament.id}&select=*&order=name.asc`);state.members=ms;$("matchScorer").innerHTML='<option value="">Select scorer</option>'+ms.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("");const saved=localScorer()||localStorage.getItem("groundscore_member");if(saved)$("matchScorer").value=saved;$("setupError").textContent="";show("matchSetupView")}
async function createMatch(){const scorer=$("matchScorer").value,team1=$("team1").value.trim(),team2=$("team2").value.trim(),p1=parsePlayers($("players1").value),p2=parsePlayers($("players2").value),overs=Number($("overs").value),tw=$("tossWinner").value,td=$("tossDecision").value;if(!scorer||!team1||!team2||team1.toLowerCase()===team2.toLowerCase()||overs<1||overs>50||!tw||!td||p1.length<2||p2.length<2){$("setupError").textContent="Choose scorer, distinct teams, 1–50 overs, toss details and at least two players per side.";return}try{await api(`tournaments?id=eq.${state.tournament.id}`,{method:"PATCH",body:JSON.stringify({status:"live"})});const firstBat=td==="bat"?tw:tw==="team1"?"team2":"team1",firstBowl=firstBat==="team1"?"team2":"team1";const m=(await api("matches",{method:"POST",body:JSON.stringify({tournament_id:state.tournament.id,team1,team2,overs,toss_winner:tw==="team1"?team1:team2,toss_decision:td,status:"live",current_innings:1,created_by:scorer})}))[0];const players=[...p1.map(name=>({match_id:m.id,tournament_id:state.tournament.id,team:"team1",name})),...p2.map(name=>({match_id:m.id,tournament_id:state.tournament.id,team:"team2",name}))];await api("players",{method:"POST",body:JSON.stringify(players)});await api("innings",{method:"POST",body:JSON.stringify({match_id:m.id,innings_no:1,batting_team:firstBat,bowling_team:firstBowl,status:"live"})});localStorage.setItem("groundscore_scorer",scorer);await loadMatch(m.id)}catch(e){$("setupError").textContent=e.message}}
async function loadMatch(id){stopPolling();state.match=(await api(`matches?id=eq.${id}&select=*`))[0];if(!state.match)throw Error("Match not found");if(state.match.tournament_id)state.tournament=(await api(`tournaments?id=eq.${state.match.tournament_id}&select=*`))[0];const [innings,players,balls]=await Promise.all([api(`innings?match_id=eq.${id}&select=*&order=innings_no.asc`),api(`players?match_id=eq.${id}&select=*&order=name.asc`),api(`balls?match_id=eq.${id}&select=*&order=created_at.asc`)]);state.innings=innings;state.players=players;state.balls=balls;if(state.match.status==="finished"){renderSummary();return}renderScore();state.poll=setInterval(()=>loadMatchData(id).catch(()=>{}),12000)}
async function loadMatchData(id){
 const [m,innings,balls]=await Promise.all([
  api("matches?id=eq."+id+"&select=*"),
  api("innings?match_id=eq."+id+"&select=*&order=innings_no.asc"),
  api("balls?match_id=eq."+id+"&select=*&order=created_at.asc")
 ]);
 if(!m[0])return;
 const oldBalls=state.balls,oldIds=new Set(oldBalls.map(b=>b.id));
 const newBalls=balls.filter(b=>!oldIds.has(b.id));
 const latestNew=newBalls[newBalls.length-1];
 const relevantInnings=latestNew?latestNew.innings_no:m[0].current_innings;
 const oldThisInnings=oldBalls.filter(b=>b.innings_no===relevantInnings);
 const oldTeamTotal=oldThisInnings.reduce((sum,b)=>sum+Number(b.total_runs),0);
 const oldPlayerTotals={};
 oldThisInnings.forEach(b=>{oldPlayerTotals[b.striker_id]=(oldPlayerTotals[b.striker_id]||0)+Number(b.runs_off_bat)});
 state.match=m[0];state.innings=innings;state.balls=balls;
 if(state.match.status==="finished"){stopPolling();renderSummary();return}
 renderScore();
 if(newBalls.length)checkMilestones(newBalls,oldTeamTotal,oldPlayerTotals);
}
function stopPolling(){if(state.poll)clearInterval(state.poll);state.poll=null}
function stats(inn){const balls=state.balls.filter(b=>b.innings_no===inn.innings_no),total=balls.reduce((s,b)=>s+Number(b.total_runs),0),wk=balls.filter(b=>b.wicket).length,legalBalls=balls.filter(legal).length;return{balls,total,wk,legalBalls,overs:overText(legalBalls),rr:legalBalls?(total/(legalBalls/6)).toFixed(2):"0.00"}}
function renderScore(){
 show("scoreView");
 const inn=currentInnings();if(!inn)return;
 const s=stats(inn),first=state.innings.find(i=>i.innings_no===1);
 const target=state.match.current_innings===2&&first?stats(first).total+1:null;
 const battingCount=state.players.filter(p=>p.team===inn.batting_team).length;
 const allOut=s.wk>=Math.max(1,battingCount-1);
 const oversDone=s.legalBalls>=state.match.overs*6;
 const chaseDone=target!==null&&s.total>=target;
 const closed=allOut||oversDone||chaseDone;
 $("matchTitle").textContent=state.match.team1+" vs "+state.match.team2;
 $("tossText").textContent="Toss: "+state.match.toss_winner+" won and chose to "+state.match.toss_decision;
 $("scoreTournamentName").textContent=state.tournament?.name||"";
 $("matchStatus").textContent="Innings "+state.match.current_innings;
 $("inningsLabel").textContent=teamName(inn.batting_team)+" batting";
 $("scoreText").textContent=s.total+"/"+s.wk;
 $("oversText").textContent=s.overs+" overs";
 $("runRate").textContent=s.rr;
 $("targetText").textContent=target?"Target "+target+" · Need "+Math.max(0,target-s.total)+" from "+Math.max(0,state.match.overs*6-s.legalBalls)+" balls":"";
 $("ballText").textContent="Legal ball "+(s.legalBalls+1);
 $("activeScorer").textContent=localScorer()||"Viewer";
 fillPlayerSelects(inn,s.balls);renderBalls(s.balls);
 $("addBallBtn").disabled=closed;
 $("addBallBtn").classList.toggle("disabled",closed);
 $("scoreError").textContent=allOut?"All out. End the innings to continue.":oversDone?"Over limit reached. End the innings to continue.":chaseDone?"Target reached. End the innings to finish the chase.":"";
}
function setSelectOptions(id,players,selectedId,placeholder){
 const el=$(id);el.innerHTML=(placeholder?'<option value="">'+esc(placeholder)+'</option>':'')+players.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
 if(selectedId&&players.some(p=>p.id===selectedId))el.value=selectedId;
}
function fillPlayerSelects(inn,balls){
 const batting=state.players.filter(p=>p.team===inn.batting_team);
 const bowling=state.players.filter(p=>p.team===inn.bowling_team);
 const last=balls[balls.length-1];
 const oldStriker=$("striker").value,oldNon=$("nonStriker").value,oldBowler=$("bowler").value;
 const striker=last?(last.next_striker_id||""):oldStriker;
 const non=last?(last.next_non_striker_id||""):oldNon;
 const overJustEnded=!!(last&&legal(last)&&Number(last.ball_number)===6);
 const bowlersForThisOver=overJustEnded?bowling.filter(p=>p.id!==last.bowler_id):bowling;
 const bowler=last?(overJustEnded?"":(last.bowler_id||"")):oldBowler;
 setSelectOptions("striker",batting,striker,"Select striker");
 setSelectOptions("nonStriker",batting,non,"Select non-striker");
 setSelectOptions("bowler",bowlersForThisOver,bowler,overJustEnded?"Choose a new bowler":"Select bowler");
 const dismissedBefore=new Set(balls.filter(b=>b.wicket&&b.dismissed_batsman_id).map(b=>b.dismissed_batsman_id));
 const active=[striker,non].filter(Boolean);
 const activeBatters=batting.filter(p=>active.includes(p.id));
 const dismissedSelect=$("dismissedBatsman");
 const oldDismissed=dismissedSelect.value;
 setSelectOptions("dismissedBatsman",activeBatters,oldDismissed||striker,"Choose dismissed batter");
 const dismissedNow=$("dismissedBatsman").value;
 const survivor=active.find(id=>id&&id!==dismissedNow);
 const incoming=batting.filter(p=>!dismissedBefore.has(p.id)&&p.id!==dismissedNow&&p.id!==survivor);
 const oldIncoming=$("newBatter").value;
 setSelectOptions("newBatter",incoming,oldIncoming,"Choose incoming batter");
 const showWicket=!!$("wicket").value;
 $("dismissedWrap").classList.toggle("hidden",!showWicket);
 $("newBatterWrap").classList.toggle("hidden",!showWicket);
}
function renderBalls(bs){$("ballsList").innerHTML=bs.length?[...bs].reverse().slice(0,18).map(b=>{const legalBefore=bs.slice(0,bs.indexOf(b)).filter(legal).length;const label=b.wicket?`WICKET · ${esc(b.wicket)}`:b.extra_type?esc(b.extra_type.toUpperCase()):b.runs_off_bat===4?"FOUR":b.runs_off_bat===6?"SIX":`${b.total_runs} run(s)`;return `<div class="ball"><strong>${Math.floor(legalBefore/6)}.${legalBefore%6+1}</strong><span>${esc(playerName(b.striker_id))} · ${label} · ${esc(playerName(b.bowler_id))}</span><span class="muted">${esc(b.scorer_name)}</span></div>`}).join(""):'<div class="empty">No deliveries yet. Select the opening players above.</div>'}
function nextBatters(bs,ball){let striker=bs[0]?.striker_id,non=bs[0]?.non_striker_id;for(const b of bs){if(!striker){striker=b.striker_id;non=b.non_striker_id}if(b.wicket&&b.dismissed_batsman_id){if(b.dismissed_batsman_id===striker)striker=b.next_batter_id;else if(b.dismissed_batsman_id===non)non=b.next_batter_id}const runCount=Number(b.runs_off_bat)+(["bye","leg-bye"].includes(b.extra_type)?Number(b.extra_runs):0);if(runCount%2)[striker,non]=[non,striker];if(legal(b)&&Number(b.ball_number)===6)[striker,non]=[non,striker]}return{striker,non}}
async function addBall(){
 const inn=currentInnings(),bs=state.balls.filter(b=>b.innings_no===inn.innings_no);
 const scorer=localScorer(),striker=$("striker").value,non=$("nonStriker").value,bowler=$("bowler").value;
 const wicket=$("wicket").value,extra=$("extraType").value,runs=Number($("runs").value),extras=Number($("extraRuns").value);
 $("scoreError").textContent="";
 if(!scorer||!striker||!non||!bowler||striker===non){$("scoreError").textContent="Choose a scorer, two different batters and a bowler.";return}
 if(extra==="wide"&&runs!==0){$("scoreError").textContent="For a wide, set runs off bat to 0 and enter any completed runs under Extra runs.";return}
 if(["bye","leg-bye"].includes(extra)&&runs!==0){$("scoreError").textContent="For byes and leg-byes, set runs off bat to 0 and enter the runs under Extra runs.";return}
 if(extra==="wide"&&wicket&&!["run out","stumped"].includes(wicket)){$("scoreError").textContent="On a wide, the supported wicket types are Run out and Stumped.";return}
 if(extra==="no-ball"&&wicket&&wicket!=="run out"){$("scoreError").textContent="On a no-ball, only Run out is supported by this scorer.";return}
 if(wicket&&wicket!=="run out"&&(runs>0||extras>0)){$("scoreError").textContent="For this wicket type, record a dot ball. Use Run out if runs were completed.";return}
 if(!extra&&extras>0){$("scoreError").textContent="Select an extra type before adding extra runs.";return}
 const legalBalls=bs.filter(legal).length,ballNo=legalBalls%6+1,overNo=Math.floor(legalBalls/6);
 const penalty=["wide","no-ball"].includes(extra)?1:0,totalExtra=extras+penalty;
 const dismissed=wicket?$("dismissedBatsman").value:null;
 if(wicket&&![striker,non].includes(dismissed)){$("scoreError").textContent="Select the striker or non-striker who was dismissed.";return}
 const dismissedBefore=new Set(bs.filter(b=>b.wicket&&b.dismissed_batsman_id).map(b=>b.dismissed_batsman_id));
 const batting=state.players.filter(p=>p.team===inn.batting_team);
 const survivor=dismissed===striker?non:striker;
 const incomingOptions=batting.filter(p=>!dismissedBefore.has(p.id)&&p.id!==dismissed&&p.id!==survivor);
 let incoming=null;
 if(wicket&&incomingOptions.length){
  incoming=$("newBatter").value;
  if(!incoming||!incomingOptions.some(p=>p.id===incoming)){$("scoreError").textContent="Select an eligible incoming batter.";return}
 }
 let nextStriker=striker,nextNon=non;
 if(wicket){if(dismissed===nextStriker)nextStriker=incoming;else nextNon=incoming}
 const completedRuns=runs+extras;
 if(completedRuns%2)[nextStriker,nextNon]=[nextNon,nextStriker];
 if(legal({extra_type:extra})&&ballNo===6)[nextStriker,nextNon]=[nextNon,nextStriker];
 const payload={match_id:state.match.id,innings_no:inn.innings_no,over_number:overNo,ball_number:ballNo,striker_id:striker,non_striker_id:non,bowler_id:bowler,runs,runs_off_bat:runs,extra_type:extra||null,extra_runs:totalExtra,total_runs:runs+totalExtra,wicket:wicket||null,dismissed_batsman_id:dismissed,next_striker_id:nextStriker,next_non_striker_id:nextNon,next_batter_id:incoming,scorer_name:scorer};
 try{
  const oldTeam=stats(inn).total,oldPlayer=bs.filter(b=>b.striker_id===striker).reduce((sum,b)=>sum+Number(b.runs_off_bat),0);
  await api("balls",{method:"POST",body:JSON.stringify(payload)});
  $("wicket").value="";$("runs").value="0";$("extraType").value="";$("extraRuns").value="0";
  await loadMatch(state.match.id);checkMilestones([payload],oldTeam,oldPlayer,striker);
 }catch(e){$("scoreError").textContent=e.message}
}
async function undoBall(){const bs=state.balls.filter(b=>b.innings_no===state.match.current_innings);if(!bs.length){alert("No delivery to undo.");return}const last=bs[bs.length-1];if(!confirm(`Undo last delivery: ${last.total_runs} run(s)${last.wicket?", wicket":""}? This cannot be reversed.`))return;try{await api(`balls?id=eq.${last.id}`,{method:"DELETE",prefer:"return=minimal"});await loadMatch(state.match.id)}catch(e){alert("Undo failed: "+e.message)}}
async function endInnings(){const inn=currentInnings(),next=state.match.current_innings+1;if(next>2){await finishMatch();return}if(!confirm("End this innings and start the second innings?"))return;await api(`innings?id=eq.${inn.id}`,{method:"PATCH",body:JSON.stringify({status:"completed"})});await api("innings",{method:"POST",body:JSON.stringify({match_id:state.match.id,innings_no:next,batting_team:inn.bowling_team,bowling_team:inn.batting_team,status:"live"})});await api(`matches?id=eq.${state.match.id}`,{method:"PATCH",body:JSON.stringify({current_innings:next})});await loadMatch(state.match.id)}
async function finishMatch(){if(!confirm("Finish match and show final scorecard?"))return;stopPolling();await api(`matches?id=eq.${state.match.id}`,{method:"PATCH",body:JSON.stringify({status:"finished",finished_at:new Date().toISOString()})});await loadMatch(state.match.id)}
async function shareMatch(){const url=new URL(window.location.href);url.searchParams.set("match",state.match.id);try{await navigator.clipboard.writeText(url.toString());alert("Live score link copied. Anyone with the link can view this match.");}catch(e){window.prompt("Copy this live score link:",url.toString())}}
function showMilestone(kicker,title,detail){$("milestoneKicker").textContent=kicker;$("milestoneTitle").textContent=title;$("milestoneDetail").textContent=detail;$("milestoneOverlay").classList.remove("hidden")}
function checkMilestones(newBalls,oldTeam=0,oldPlayer=0,pid=null){
 const inn=currentInnings();if(!inn)return;
 const thresholds=[50,100,150,200,250,300];
 const currentTeam=stats(inn).total;
 const teamMark=thresholds.filter(n=>oldTeam<n&&currentTeam>=n).pop();
 if(teamMark){
  const key="team:"+state.match.id+":"+inn.innings_no+":"+teamMark;
  if(!state.milestones.has(key)){state.milestones.add(key);showMilestone("TEAM MILESTONE",teamMark===50?"TEAM FIFTY!":teamMark===100?"TEAM CENTURY!":"TEAM "+teamMark+"!",teamName(inn.batting_team)+" reached "+teamMark);}
 }
 const ids=pid?[pid]:[...new Set(newBalls.map(b=>b.striker_id).filter(Boolean))];
 for(const id of ids){
  const previous=typeof oldPlayer==="object"?(oldPlayer[id]||0):(id===pid?oldPlayer:0);
  const current=state.balls.filter(b=>b.innings_no===inn.innings_no&&b.striker_id===id).reduce((sum,b)=>sum+Number(b.runs_off_bat),0);
  const mark=thresholds.filter(n=>n<=200&&previous<n&&current>=n).pop();
  if(mark){
   const key="batter:"+state.match.id+":"+inn.innings_no+":"+id+":"+mark;
   if(!state.milestones.has(key)){state.milestones.add(key);showMilestone("BATTER MILESTONE",mark===50?"HALF-CENTURY!":mark===100?"CENTURY!":mark+"!",playerName(id)+" reached "+mark+" runs");}
  }
 }
}
function renderSummary(){show("summaryView");const scores=state.innings.map(i=>({i,...stats(i)}));let result="Match ended";if(scores.length===2){const a=scores[0],b=scores[1];if(a.total>b.total)result=`${teamName(a.i.batting_team)} won by ${a.total-b.total} runs`;else if(b.total>a.total)result=`${teamName(b.i.batting_team)} won by ${Math.max(0,state.players.filter(p=>p.team===b.i.batting_team).length-b.wk)} wickets`;else result="Match tied"}$("resultText").textContent=result;$("summaryToss").textContent=`Toss: ${state.match.toss_winner} chose to ${state.match.toss_decision} · ${state.tournament?.name||""}`;const bat={};state.players.forEach(p=>{const pb=state.balls.filter(b=>b.striker_id===p.id),runs=pb.reduce((s,b)=>s+b.runs_off_bat,0),fours=pb.filter(b=>b.runs_off_bat===4).length,sixes=pb.filter(b=>b.runs_off_bat===6).length,legalBalls=pb.filter(legal).length;if(runs||legalBalls)bat[p.id]={runs,balls:legalBalls,fours,sixes}});$("battingSummary").innerHTML=Object.entries(bat).sort((a,b)=>b[1].runs-a[1].runs).map(([id,s])=>`<div class="row"><span>${esc(playerName(id))} <small class="muted">${s.balls} balls · ${s.fours}×4 · ${s.sixes}×6</small></span><strong>${s.runs}</strong></div>`).join("")||'<div class="empty">No batting data.</div>';const bowl={};state.balls.forEach(b=>{if(b.wicket&&["bowled","caught","lbw","stumped","hit wicket"].includes(b.wicket))bowl[b.bowler_id]=(bowl[b.bowler_id]||0)+1});$("bowlingSummary").innerHTML=Object.entries(bowl).sort((a,b)=>b[1]-a[1]).map(([id,v])=>`<div class="row"><span>${esc(playerName(id))}</span><strong>${v} wicket(s)</strong></div>`).join("")||'<div class="empty">No credited wickets.</div>';$("inningsSummary").innerHTML=scores.map(s=>`<div class="row"><span>${esc(teamName(s.i.batting_team))}</span><strong>${s.total}/${s.wk} · ${s.overs} ov · RR ${s.rr}</strong></div>`).join("");const moments=[];state.balls.forEach(b=>{if(b.runs_off_bat===6)moments.push(`Six by ${playerName(b.striker_id)}`);if(b.runs_off_bat===4)moments.push(`Four by ${playerName(b.striker_id)}`);if(b.wicket)moments.push(`${playerName(b.dismissed_batsman_id)} out — ${b.wicket}`)});$("momentsSummary").innerHTML=moments.slice(0,12).map(x=>`<div class="row"><span>${esc(x)}</span></div>`).join("")||'<div class="empty">No notable moments.</div>'}
function bind(id,fn){$(id).addEventListener("click",fn)}
bind("startTournamentBtn",()=>(show("tournamentCreateView"),$("tournamentCreateError").textContent=""));bind("joinTournamentBtn",listTournaments);bind("reloadHomeBtn",loadHome);bind("createTournamentBtn",createTournament);bind("backHomeBtn",loadHome);bind("joinBackBtn",listTournaments);bind("confirmJoinBtn",confirmJoin);bind("viewTournamentBtn",()=>openTournament(state.tournament.id));bind("tournamentHomeBtn",loadHome);bind("tournamentJoinBtn",()=>openJoin(state.tournament.id));bind("tournamentNewMatchBtn",startMatchSetup);bind("refreshTournamentBtn",refreshTournament);bind("matchSetupBackBtn",()=>openTournament(state.tournament.id));bind("createMatchBtn",createMatch);bind("addBallBtn",addBall);bind("undoBtn",undoBall);bind("endInningsBtn",endInnings);bind("finishMatchBtn",finishMatch);bind("refreshBtn",()=>loadMatch(state.match.id));bind("shareMatchBtn",shareMatch);bind("homeBtn",loadHome);bind("summaryTournamentBtn",()=>openTournament(state.tournament.id));bind("milestoneClose",()=>$("milestoneOverlay").classList.add("hidden"));$("wicket").onchange=()=>{if(currentInnings())fillPlayerSelects(currentInnings(),state.balls.filter(b=>b.innings_no===state.match.current_innings))};$("dismissedBatsman").onchange=()=>{if(currentInnings())fillPlayerSelects(currentInnings(),state.balls.filter(b=>b.innings_no===state.match.current_innings))};
init();