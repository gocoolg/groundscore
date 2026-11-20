import {
  buildDelivery,
  inningsStats,
  currentBattingState,
  battingScorecard,
  bowlingScorecard,
  fallOfWickets,
  matchResult,
  tournamentStandings
} from "./js/scoring-engine.js";

const cfg = window.GROUNDSCORE_CONFIG || {};
const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const state = {
  tournament: null, match: null, innings: [], balls: [], players: [], members: [],
  teams: [], teamPlayers: {}, poll: null, current: null, saving: false,
  selectedScoreTab: "scorer", selectedTournamentTab: "matches",
  lineupConfirmed: false, pendingBatterReview: false, milestones: new Set(), pendingKey: null,
  toss: null
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
}
function queryValue(value) { return encodeURIComponent(String(value)); }
function parseNames(value) {
  return [...new Set(String(value || "").split(",").map(x => x.trim()).filter(Boolean))];
}
function teamName(teamKey) {
  return !state.match ? "" : (teamKey === "team1" ? state.match.team1 : state.match.team2);
}
function playersFor(teamKey) { return state.players.filter(p => p.team === teamKey); }
function playerName(id) { return state.players.find(p => p.id === id)?.name || "—"; }
function currentInnings() {
  return state.innings.find(i => Number(i.innings_no) === Number(state.match?.current_innings));
}
function activeBalls(inningsNo) {
  return state.balls.filter(b => Number(b.innings_no) === Number(inningsNo) && !b.voided_at);
}
function localScorer() {
  return localStorage.getItem("groundscore_scorer") || "";
}
function overText(n) { return Math.floor(n / 6) + "." + (n % 6); }
function showView(id) {
  ["homeView","tournamentCreateView","tournamentListView","joinView","tournamentView","matchSetupView","scoreView","summaryView"]
    .forEach(view => $(view)?.classList.toggle("hidden", view !== id));
  $("homeBtn").classList.toggle("hidden", id === "homeView");
  window.scrollTo({ top: 0, behavior: "auto" });
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}
function setNetwork() {
  const online = navigator.onLine;
  $("networkStatus").classList.toggle("offline", !online);
  $("networkStatus").querySelector("span").textContent = online ? "Connected" : "Offline";
}
async function api(path, options = {}) {
  if (!configured) throw new Error("Supabase is not configured. Check config.js.");
  const headers = {
    apikey: cfg.SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    Prefer: options.prefer || "return=representation"
  };
  const response = await fetch(cfg.SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const body = await response.text();
  if (!response.ok) {
    let message = body || response.statusText;
    try { const parsed = JSON.parse(body); message = parsed.message || parsed.details || parsed.hint || message; } catch (_) {}
    throw new Error(message);
  }
  return body ? JSON.parse(body) : [];
}
function bind(id, event, callback) {
  const el = $(id);
  if (el) el.addEventListener(event, callback);
}
function setActiveScoreTab(tab) {
  state.selectedScoreTab = tab;
  document.querySelectorAll("[data-score-tab]").forEach(button =>
    button.classList.toggle("active", button.dataset.scoreTab === tab)
  );
  ["scorerPanel","scorecardPanel","commentaryPanel","matchDetailsPanel"].forEach(id =>
    $(id).classList.toggle("hidden", id !== ({
      scorer:"scorerPanel", scorecard:"scorecardPanel",
      commentary:"commentaryPanel", match:"matchDetailsPanel"
    })[tab])
  );
  if (tab === "scorecard") renderScorecard();
  if (tab === "commentary") renderCommentary();
  if (tab === "match") renderMatchDetails();
}
function setActiveTournamentTab(tab) {
  state.selectedTournamentTab = tab;
  document.querySelectorAll("[data-tournament-tab]").forEach(button =>
    button.classList.toggle("active", button.dataset.tournamentTab === tab)
  );
  ["matches","teams","standings","members"].forEach(name => {
    const id = ({matches:"tMatchesPanel",teams:"tTeamsPanel",standings:"tStandingsPanel",members:"tMembersPanel"})[name];
    $(id).classList.toggle("hidden", tab !== name);
  });
  if (tab === "standings") renderStandings().catch(showError);
}

function showError(error) { toast(error?.message || String(error)); }

async function init() {
  setNetwork();
  if (!configured) {
    $("configNotice").classList.remove("hidden");
    $("configNotice").textContent = "Supabase is not configured. Check config.js before using GroundScore.";
    showView("homeView");
    return;
  }
  const sharedMatch = new URLSearchParams(window.location.search).get("match");
  if (sharedMatch) {
    try { await loadMatch(sharedMatch); return; }
    catch (error) {
      $("configNotice").classList.remove("hidden");
      $("configNotice").textContent = "Could not load this match: " + error.message;
    }
  }
  await loadHome();
}
async function loadHome() {
  try {
    const rows = await api("tournaments?select=*&order=event_date.desc.nullslast,created_at.desc");
    renderTournamentCards($("homeTournaments"), rows.slice(0, 8), false);
  } catch (error) {
    $("homeTournaments").innerHTML = '<div class="empty">' + esc(error.message) + "</div>";
  }
  showView("homeView");
}
function renderTournamentCards(container, tournaments, joinMode) {
  if (!tournaments.length) {
    container.innerHTML = '<div class="empty">No tournaments yet. Start one and invite your group.</div>';
    return;
  }
  container.innerHTML = tournaments.map(t => {
    const date = t.event_date ? new Date(t.event_date + "T00:00:00").toLocaleDateString() : "Date TBA";
    const statusClass = t.status === "completed" ? "finished" : "";
    return '<article class="tournament-card"><div><span class="status-pill ' + statusClass + '">' + esc(t.status || "upcoming") +
      '</span><h2>' + esc(t.name) + '</h2><p class="muted">' + esc(date) + " · " + esc(t.venue || "Venue TBA") +
      '</p></div><div class="tournament-actions"><button class="btn btn-secondary" data-view="' + t.id +
      '">View scores</button>' + (joinMode ? '<button class="btn btn-primary" data-join="' + t.id + '">Join</button>' :
      '<button class="btn btn-quiet" data-view="' + t.id + '">Open</button>') + "</div></article>";
  }).join("");
  container.querySelectorAll("[data-view]").forEach(button =>
    button.addEventListener("click", () => openTournament(button.dataset.view).catch(showError))
  );
  container.querySelectorAll("[data-join]").forEach(button =>
    button.addEventListener("click", () => openJoin(button.dataset.join).catch(showError))
  );
}
async function listTournaments() {
  showView("tournamentListView");
  $("tournamentList").innerHTML = '<div class="skeleton">Loading tournaments…</div>';
  try {
    const rows = await api("tournaments?select=*&order=event_date.desc.nullslast,created_at.desc");
    renderTournamentCards($("tournamentList"), rows, true);
  } catch (error) {
    $("tournamentList").innerHTML = '<div class="empty">' + esc(error.message) + "</div>";
  }
}
async function addMember(tournamentId, name) {
  const clean = name.trim().replace(/\s+/g, " ");
  const existing = await api("tournament_members?tournament_id=eq." + tournamentId +
    "&name=eq." + queryValue(clean) + "&select=*");
  if (existing.length) return existing[0];
  try {
    return (await api("tournament_members", {
      method: "POST", body: JSON.stringify({ tournament_id: tournamentId, name: clean })
    }))[0];
  } catch (error) {
    // A second device may have added the same name between lookup and insert.
    const retry = await api("tournament_members?tournament_id=eq." + tournamentId +
      "&name=eq." + queryValue(clean) + "&select=*");
    if (retry.length) return retry[0];
    throw error;
  }
}
async function createTournament() {
  const name = $("tournamentName").value.trim();
  const organizer = $("organizerName").value.trim();
  $("tournamentCreateError").textContent = "";
  if (!name || !organizer) { $("tournamentCreateError").textContent = "Enter the tournament name and your display name."; return; }
  try {
    const created = (await api("tournaments", {
      method: "POST",
      body: JSON.stringify({
        name,
        event_date: $("tournamentDate").value || null,
        venue: $("tournamentVenue").value.trim() || null,
        format: $("tournamentFormat").value || "friendly",
        status: "upcoming",
        created_by: organizer
      })
    }))[0];
    await addMember(created.id, organizer);
    localStorage.setItem("groundscore_member", organizer);
    localStorage.setItem("groundscore_scorer", organizer);
    await openTournament(created.id);
    toast("Tournament created");
  } catch (error) { $("tournamentCreateError").textContent = error.message; }
}
async function openJoin(tournamentId) {
  state.tournament = (await api("tournaments?id=eq." + tournamentId + "&select=*"))[0];
  if (!state.tournament) throw new Error("Tournament not found.");
  state.members = await api("tournament_members?tournament_id=eq." + tournamentId + "&select=*&order=name.asc");
  $("joinTournamentTitle").textContent = state.tournament.name;
  $("joinTournamentMeta").textContent = [state.tournament.event_date, state.tournament.venue].filter(Boolean).join(" · ");
  $("existingMember").innerHTML = '<option value="">Select a name</option>' + state.members.map(member =>
    '<option value="' + esc(member.name) + '">' + esc(member.name) + "</option>"
  ).join("");
  $("newMemberName").value = "";
  $("joinError").textContent = "";
  showView("joinView");
}
async function confirmJoin() {
  const name = $("existingMember").value || $("newMemberName").value.trim();
  $("joinError").textContent = "";
  if (!name) { $("joinError").textContent = "Select your name or enter a new name."; return; }
  try {
    await addMember(state.tournament.id, name);
    localStorage.setItem("groundscore_member", name);
    localStorage.setItem("groundscore_scorer", name);
    await openTournament(state.tournament.id);
    toast("You're on the tournament list");
  } catch (error) { $("joinError").textContent = error.message; }
}
async function openTournament(tournamentId) {
  state.tournament = (await api("tournaments?id=eq." + tournamentId + "&select=*"))[0];
  if (!state.tournament) throw new Error("Tournament not found.");
  await refreshTournament();
  showView("tournamentView");
  setActiveTournamentTab(state.selectedTournamentTab || "matches");
}
async function refreshTournament() {
  const id = state.tournament.id;
  const [matches, members, teams] = await Promise.all([
    api("matches?tournament_id=eq." + id + "&select=*&order=scheduled_at.asc.nullslast,created_at.desc"),
    api("tournament_members?tournament_id=eq." + id + "&select=*&order=name.asc"),
    api("teams?tournament_id=eq." + id + "&select=*&order=name.asc")
  ]);
  state.members = members;
  state.teams = teams;
  state.teamPlayers = {};
  await Promise.all(teams.map(async team => {
    state.teamPlayers[team.id] = await api("team_players?team_id=eq." + team.id + "&select=*&order=name.asc");
  }));
  $("tournamentTitle").textContent = state.tournament.name;
  $("tournamentMeta").textContent = [
    state.tournament.event_date ? new Date(state.tournament.event_date + "T00:00:00").toLocaleDateString() : "Date TBA",
    state.tournament.venue || "Venue TBA",
    (state.tournament.format || "friendly").toUpperCase()
  ].join(" · ");
  renderFixtures(matches);
  renderTeams();
  $("memberList").innerHTML = members.map(member => '<span class="member-chip">' + esc(member.name) + "</span>").join("") ||
    '<div class="empty">No members yet.</div>';
  const datalist = $("teamNamesList");
  if (datalist) datalist.innerHTML = teams.map(team => '<option value="' + esc(team.name) + '"></option>').join("");
}
function renderFixtures(matches) {
  const target = $("tournamentMatches");
  if (!matches.length) { target.innerHTML = '<div class="empty">No matches yet. Create the first match.</div>'; return; }
  target.innerHTML = matches.map(match => {
    const live = match.status === "live";
    const date = match.scheduled_at ? new Date(match.scheduled_at).toLocaleString() : (match.created_at ? new Date(match.created_at).toLocaleDateString() : "");
    return '<article class="tournament-card"><div><span class="status-pill ' + (live ? "" : "finished") + '">' +
      esc(match.status) + '</span><h2>' + esc(match.team1) + " vs " + esc(match.team2) + '</h2><p class="muted">' +
      esc(match.round_name || (match.overs + " overs")) + " · " + esc(date) + '</p></div><div class="tournament-actions"><button class="btn btn-primary" data-match="' +
      match.id + '">' + (live ? "Follow live" : "Scorecard") + "</button></div></article>";
  }).join("");
  target.querySelectorAll("[data-match]").forEach(button =>
    button.addEventListener("click", () => loadMatch(button.dataset.match).catch(showError))
  );
}
function renderTeams() {
  const target = $("teamCards");
  if (!state.teams.length) { target.innerHTML = '<div class="empty">No saved teams yet. Add a team and reuse its squad for future matches.</div>'; return; }
  target.innerHTML = state.teams.map(team => {
    const members = state.teamPlayers[team.id] || [];
    return '<article class="team-card"><strong>' + esc(team.name) + '</strong><p>' +
      esc(members.map(p => p.name).join(" · ") || "No squad members yet") + "</p></article>";
  }).join("");
}
async function createTeam() {
  const name = $("newTeamName").value.trim();
  const players = parseNames($("newTeamPlayers").value);
  $("teamCreateError").textContent = "";
  if (!name || players.length < 2) { $("teamCreateError").textContent = "Enter a team name and at least two squad members."; return; }
  try {
    const duplicate = await api("teams?tournament_id=eq." + state.tournament.id + "&name=eq." + queryValue(name) + "&select=id");
    if (duplicate.length) { $("teamCreateError").textContent = "That team already exists in this tournament."; return; }
    const team = (await api("teams", {
      method: "POST", body: JSON.stringify({ tournament_id: state.tournament.id, name })
    }))[0];
    await api("team_players", {
      method: "POST",
      body: JSON.stringify(players.map(player => ({ team_id: team.id, name: player })))
    });
    $("newTeamName").value = ""; $("newTeamPlayers").value = "";
    await refreshTournament();
    setActiveTournamentTab("teams");
    toast("Team and squad saved");
  } catch (error) { $("teamCreateError").textContent = error.message; }
}
async function findOrCreateTeam(name) {
  const matches = await api("teams?tournament_id=eq." + state.tournament.id + "&name=eq." + queryValue(name) + "&select=*");
  if (matches.length) return matches[0];
  return (await api("teams", {
    method: "POST", body: JSON.stringify({ tournament_id: state.tournament.id, name })
  }))[0];
}
async function ensureTeamSquad(teamId, names) {
  const existing = await api("team_players?team_id=eq." + teamId + "&select=*");
  const existingNames = new Set(existing.map(p => p.name.toLowerCase()));
  const additions = names.filter(name => !existingNames.has(name.toLowerCase()));
  if (additions.length) {
    await api("team_players", {
      method: "POST",
      body: JSON.stringify(additions.map(name => ({ team_id: teamId, name })))
    });
  }
}
async function onTeamNameChange(inputId, squadId) {
  const name = $(inputId).value.trim();
  const team = state.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (!team) return;
  const squad = state.teamPlayers[team.id] || [];
  if (squad.length) $(squadId).value = squad.map(p => p.name).join(", ");
}

async function startMatchSetup() {
  state.members = await api("tournament_members?tournament_id=eq." + state.tournament.id + "&select=*&order=name.asc");
  state.teams = await api("teams?tournament_id=eq." + state.tournament.id + "&select=*&order=name.asc");
  $("matchScorer").innerHTML = '<option value="">Choose your name</option>' + state.members.map(member =>
    '<option value="' + esc(member.name) + '">' + esc(member.name) + "</option>"
  ).join("");
  const saved = localScorer() || localStorage.getItem("groundscore_member");
  if (saved) $("matchScorer").value = saved;
  $("team1").value = ""; $("team2").value = "";
  $("players1").value = ""; $("players2").value = "";
  $("setupError").textContent = "";
  resetTossUI();
  showView("matchSetupView");
}
function resetTossUI() {
  state.toss = null;
  $("tossCallHeads").classList.remove("selected");
  $("tossCallTails").classList.remove("selected");
  $("tossStatus").textContent = "Team 1: choose heads or tails.";
  $("coinFace").textContent = "?";
  $("coinFace").classList.remove("flipping");
  $("tossWinnerStatus").textContent = "";
  $("flipCoinBtn").disabled = true;
  $("flipCoinBtn").classList.remove("hidden");
  $("tossDecisionSummary").classList.add("hidden");
  $("createMatchBtn").disabled = true;
}
function chooseTossCall(call) {
  if (state.toss?.result) return;
  state.toss = { call, result: null, winnerKey: null, decision: null, tossedAt: null };
  $("tossCallHeads").classList.toggle("selected", call === "heads");
  $("tossCallTails").classList.toggle("selected", call === "tails");
  $("tossStatus").textContent = "Team 1 called " + call.toUpperCase() + ". Flip the coin.";
  $("flipCoinBtn").disabled = false;
}
function flipCoin() {
  if (!state.toss?.call || state.toss.result) return;
  const bytes = new Uint8Array(1);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else bytes[0] = Math.floor(Math.random() * 256);
  const result = (bytes[0] & 1) === 0 ? "heads" : "tails";
  const winnerKey = result === state.toss.call ? "team1" : "team2";
  state.toss.result = result;
  state.toss.winnerKey = winnerKey;
  state.toss.tossedAt = new Date().toISOString();
  $("coinFace").classList.remove("flipping");
  void $("coinFace").offsetWidth;
  $("coinFace").classList.add("flipping");
  $("coinFace").textContent = result === "heads" ? "H" : "T";
  const winnerName = winnerKey === "team1" ? $("team1").value.trim() : $("team2").value.trim();
  $("tossStatus").textContent = result.toUpperCase() + " — " + winnerName + " won the toss.";
  $("tossWinnerStatus").textContent = winnerName + " won the toss. Choose to bat or bowl.";
  $("flipCoinBtn").classList.add("hidden");
  $("tossDecisionSummary").classList.remove("hidden");
  $("tossWinnerName").textContent = winnerName;
  $("tossDecisionSheet").classList.remove("hidden");
  document.body.classList.add("sheet-open");
}
function chooseTossDecision(decision) {
  if (!state.toss?.winnerKey || !state.toss?.result) return;
  state.toss.decision = decision;
  const winnerName = state.toss.winnerKey === "team1" ? $("team1").value.trim() : $("team2").value.trim();
  $("tossStatus").textContent = "Toss complete: " + winnerName + " won and chose to " + decision + " first.";
  $("tossWinnerStatus").textContent = winnerName + " won · " + state.toss.result.toUpperCase() + " · chose to " + decision.toUpperCase();
  $("tossDecisionSummary").classList.remove("hidden");
  $("tossDecisionResult").textContent = winnerName + " elected to " + decision + " first.";
  $("createMatchBtn").disabled = false;
  $("tossDecisionSheet").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}
async function createMatch() {
  const scorer = $("matchScorer").value;
  const team1Name = $("team1").value.trim();
  const team2Name = $("team2").value.trim();
  let squad1 = parseNames($("players1").value);
  let squad2 = parseNames($("players2").value);
  const overs = Number($("overs").value);
  const playersPerTeam = Number($("playersPerTeam").value);
  const tossWinner = state.toss?.winnerKey || "";
  const decision = state.toss?.decision || "";
  $("setupError").textContent = "";
  if (!scorer || !team1Name || !team2Name || team1Name.toLowerCase() === team2Name.toLowerCase() ||
      overs < 1 || overs > 50 || playersPerTeam < 2 || playersPerTeam > 15 ||
      !tossWinner || !decision) {
    $("setupError").textContent = "Choose the scorer, distinct teams, overs, players per side, complete the coin toss and choose bat or bowl.";
    return;
  }
  try {
    const team1 = await findOrCreateTeam(team1Name);
    const team2 = await findOrCreateTeam(team2Name);
    if (!squad1.length) squad1 = (await api("team_players?team_id=eq." + team1.id + "&select=*&order=name.asc")).map(p => p.name);
    if (!squad2.length) squad2 = (await api("team_players?team_id=eq." + team2.id + "&select=*&order=name.asc")).map(p => p.name);
    if (squad1.length !== playersPerTeam || squad2.length !== playersPerTeam) {
      $("setupError").textContent = "Both playing XIs must match the Players per side value (" + playersPerTeam + "). Edit the squads or change the player count.";
      return;
    }
    await ensureTeamSquad(team1.id, squad1);
    await ensureTeamSquad(team2.id, squad2);
    const firstBatKey = decision === "bat" ? tossWinner : (tossWinner === "team1" ? "team2" : "team1");
    const firstBatId = firstBatKey === "team1" ? team1.id : team2.id;
    const scheduledValue = $("scheduledAt").value;
    const match = (await api("matches", {
      method: "POST",
      body: JSON.stringify({
        tournament_id: state.tournament.id,
        team1: team1Name, team2: team2Name,
        team1_id: team1.id, team2_id: team2.id,
        innings1_batting_team_id: firstBatId,
        overs, players_per_team: playersPerTeam,
        toss_winner: tossWinner === "team1" ? team1Name : team2Name,
        toss_decision: decision,
        toss_call: state.toss.call,
        toss_result: state.toss.result,
        toss_tossed_at: state.toss.tossedAt,
        round_name: $("roundName").value.trim() || null,
        scheduled_at: scheduledValue ? new Date(scheduledValue).toISOString() : null,
        venue: state.tournament.venue || null,
        status: "live", current_innings: 1, created_by: scorer
      })
    }))[0];
    const matchPlayers = [
      ...squad1.map(name => ({ match_id: match.id, tournament_id: state.tournament.id, team_id: team1.id, team: "team1", name })),
      ...squad2.map(name => ({ match_id: match.id, tournament_id: state.tournament.id, team_id: team2.id, team: "team2", name }))
    ];
    await api("players", { method: "POST", body: JSON.stringify(matchPlayers) });
    await api("innings", {
      method: "POST",
      body: JSON.stringify({
        match_id: match.id, innings_no: 1,
        batting_team: firstBatKey, bowling_team: firstBatKey === "team1" ? "team2" : "team1",
        status: "live"
      })
    });
    await api("tournaments?id=eq." + state.tournament.id, {
      method: "PATCH", body: JSON.stringify({ status: "live", updated_at: new Date().toISOString() }),
      prefer: "return=minimal"
    });
    localStorage.setItem("groundscore_scorer", scorer);
    state.lineupConfirmed = false;
    state.pendingBatterReview = false;
    state.selectedScoreTab = "scorer";
    await loadMatch(match.id);
    toast("Match ready. Confirm the opening players.");
  } catch (error) { $("setupError").textContent = error.message; }
}

function stopPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}
async function loadMatch(matchId) {
  stopPolling();
  const matchRows = await api("matches?id=eq." + matchId + "&select=*");
  state.match = matchRows[0];
  if (!state.match) throw new Error("Match not found.");
  if (state.match.tournament_id) {
    const tournaments = await api("tournaments?id=eq." + state.match.tournament_id + "&select=*");
    state.tournament = tournaments[0] || null;
  }
  const [innings, players, balls] = await Promise.all([
    api("innings?match_id=eq." + matchId + "&select=*&order=innings_no.asc"),
    api("players?match_id=eq." + matchId + "&select=*&order=name.asc"),
    api("balls?match_id=eq." + matchId + "&select=*&order=delivery_number.asc,created_at.asc")
  ]);
  state.innings = innings;
  state.players = players;
  state.balls = balls;
  state.lineupConfirmed = activeBalls(state.match.current_innings).length > 0;
  if (state.match.status === "finished") {
    renderSummary();
    showView("summaryView");
    return;
  }
  showView("scoreView");
  renderScore();
  setActiveScoreTab(state.selectedScoreTab || "scorer");
  state.poll = setInterval(() => refreshLiveMatch(matchId).catch(() => {}), 8000);
}
async function refreshLiveMatch(matchId) {
  if (!state.match || state.match.id !== matchId || state.match.status === "finished") return;
  const [matches, innings, balls] = await Promise.all([
    api("matches?id=eq." + matchId + "&select=*"),
    api("innings?match_id=eq." + matchId + "&select=*&order=innings_no.asc"),
    api("balls?match_id=eq." + matchId + "&select=*&order=delivery_number.asc,created_at.asc")
  ]);
  if (!matches[0]) return;
  const oldBalls = state.balls;
  const oldIds = new Set(oldBalls.filter(b => !b.voided_at).map(b => b.id));
  const added = balls.filter(b => !b.voided_at && !oldIds.has(b.id));
  const oldByInnings = {};
  oldBalls.filter(b => !b.voided_at).forEach(b => {
    const key = b.innings_no;
    if (!oldByInnings[key]) oldByInnings[key] = [];
    oldByInnings[key].push(b);
  });
  state.match = matches[0];
  state.innings = innings;
  state.balls = balls;
  if (state.match.status === "finished") {
    stopPolling(); renderSummary(); showView("summaryView"); return;
  }
  renderScore();
  if (added.length) {
    const latest = added[added.length - 1];
    const oldRows = oldByInnings[latest.innings_no] || [];
    const oldTotal = oldRows.reduce((sum,b) => sum + Number(b.total_runs || 0), 0);
    const playerRuns = {};
    oldRows.forEach(b => { playerRuns[b.striker_id] = (playerRuns[b.striker_id] || 0) + Number(b.runs_off_bat || 0); });
    checkMilestones(latest, oldTotal, playerRuns[latest.striker_id] || 0);
  }
  if (state.selectedScoreTab === "scorecard") renderScorecard();
  if (state.selectedScoreTab === "commentary") renderCommentary();
}
function fillSelect(element, players, selectedId, placeholder) {
  element.innerHTML = '<option value="">' + esc(placeholder) + "</option>" +
    players.map(player => '<option value="' + esc(player.id) + '">' + esc(player.name) + "</option>").join("");
  if (selectedId && players.some(player => player.id === selectedId)) element.value = selectedId;
}
function renderScore() {
  const innings = currentInnings();
  if (!innings) return;
  const stats = inningsStats(state.balls, innings.innings_no, state.match.overs);
  const first = state.innings.find(i => Number(i.innings_no) === 1);
  const firstStats = first ? inningsStats(state.balls, 1, state.match.overs) : null;
  const target = Number(state.match.current_innings) === 2 && firstStats ? firstStats.total + 1 : null;
  const remaining = Math.max(0, Number(state.match.overs) * 6 - stats.legalBalls);
  const runsNeeded = target === null ? null : Math.max(0, target - stats.total);
  const requiredRate = target === null ? null : (remaining ? runsNeeded / (remaining / 6) : (runsNeeded ? Infinity : 0));
  $("matchTitle").textContent = state.match.team1 + " vs " + state.match.team2;
  $("matchSubTitle").textContent = (state.tournament?.name || "Friendly match") + " · " +
    (state.match.round_name || (state.match.overs + " overs"));
  $("matchStatus").textContent = state.match.status === "live" ? "LIVE" : state.match.status.toUpperCase();
  $("inningsLabel").textContent = (Number(state.match.current_innings) === 1 ? "1st" : "2nd") + " innings · " + teamName(innings.batting_team);
  $("scoreText").textContent = stats.total + "/" + stats.wickets;
  $("oversText").textContent = stats.overs + " / " + state.match.overs + " ov";
  $("targetText").textContent = target === null ? "" : (runsNeeded === 0 ? "Target achieved" : "Target " + target + " · Need " + runsNeeded + " off " + remaining);
  $("runRate").textContent = stats.runRateText;
  $("requiredRate").textContent = target === null ? "—" : (Number.isFinite(requiredRate) ? requiredRate.toFixed(2) : "—");
  $("scoreTournamentName").textContent = state.tournament?.name || "No tournament";
  $("detailMatchTitle").textContent = state.match.team1 + " vs " + state.match.team2;
  $("scorecardInnings").textContent = teamName(innings.batting_team) + " · " + stats.total + "/" + stats.wickets;
  const tossDetails = state.match.toss_call && state.match.toss_result
    ? teamName(state.match.toss_winner === state.match.team1 ? "team1" : "team2") + " won · Team 1 called " +
      state.match.toss_call.toUpperCase() + " · Coin landed " + state.match.toss_result.toUpperCase() +
      " · Chose to " + state.match.toss_decision
    : state.match.toss_winner + " won · chose to " + state.match.toss_decision;
  $("matchFacts").innerHTML = [
    ["Overs", state.match.overs], ["Players per side", state.match.players_per_team || state.players.filter(p => p.team === "team1").length],
    ["Coin toss", tossDetails],
    ["Scorer", state.match.created_by], ["Venue", state.match.venue || state.tournament?.venue || "—"],
    ["Scheduled", state.match.scheduled_at ? new Date(state.match.scheduled_at).toLocaleString() : "—"]
  ].map(row => '<div class="row"><span>' + esc(row[0]) + '</span><strong>' + esc(row[1]) + "</strong></div>").join("");
  $("team1DetailName").textContent = state.match.team1;
  $("team2DetailName").textContent = state.match.team2;
  $("team1PlayerList").innerHTML = playersFor("team1").map(p => '<div class="player-list-item">' + esc(p.name) + "</div>").join("");
  $("team2PlayerList").innerHTML = playersFor("team2").map(p => '<div class="player-list-item">' + esc(p.name) + "</div>").join("");
  const batting = playersFor(innings.batting_team);
  const bowling = playersFor(innings.bowling_team);
  const opening = {
    strikerId: $("striker").value || "",
    nonStrikerId: $("nonStriker").value || "",
    bowlerId: $("bowler").value || ""
  };
  const current = currentBattingState(state.balls, innings.innings_no, opening);
  // At an over boundary the engine intentionally leaves bowlerId blank until a
  // new bowler is selected. Resolve it from the actual dropdown selection.
  if (current.needsNewBowler && opening.bowlerId &&
      opening.bowlerId !== current.previousOverBowlerId) {
    current.bowlerId = opening.bowlerId;
  }
  state.current = current;
  fillSelect($("striker"), batting, current.strikerId || opening.strikerId, "Select striker");
  fillSelect($("nonStriker"), batting, current.nonStrikerId || opening.nonStrikerId, "Select non-striker");
  const availableBowlers = current.needsNewBowler ? bowling.filter(p => p.id !== current.previousOverBowlerId) : bowling;
  fillSelect($("bowler"), availableBowlers, current.bowlerId || opening.bowlerId, current.needsNewBowler ? "Choose new bowler" : "Select bowler");
  const activeBatters = [current.strikerId || $("striker").value, current.nonStrikerId || $("nonStriker").value].filter(Boolean);
  fillSelect($("wicketBatter"), batting.filter(p => activeBatters.includes(p.id)), "", "Choose batter");
  const dismissed = new Set(activeBalls(innings.innings_no).filter(b => b.wicket).map(b => b.dismissed_batsman_id));
  const incoming = batting.filter(p => !dismissed.has(p.id) && !activeBatters.includes(p.id));
  fillSelect($("incomingBatter"), incoming, "", incoming.length ? "Choose incoming batter" : "No batter remaining");
  const scorer = localScorer();
  const allOut = stats.wickets >= Math.max(1, batting.length - 1);
  const oversDone = stats.legalBalls >= Number(state.match.overs) * 6;
  const chaseDone = target !== null && stats.total >= target;
  const closed = allOut || oversDone || chaseDone;
  const canScore = !!scorer && !closed && state.match.status === "live";
  $("stickyStriker").textContent = playerName(current.strikerId || $("striker").value);
  $("stickyNonStriker").textContent = playerName(current.nonStrikerId || $("nonStriker").value);
  $("stickyBowler").textContent = playerName(current.bowlerId || $("bowler").value);
  $("ballText").textContent = current.overNumber + "." + current.ballNumber + " · " + (current.needsNewBowler ? "New over — choose bowler" : "Next delivery");
  const hasOpeningSelection = !!($("striker").value && $("nonStriker").value &&
    $("striker").value !== $("nonStriker").value && $("bowler").value);
  const needsBatterConfirm = state.pendingBatterReview;
  $("lineupHint").textContent = !scorer ? "Join this tournament to score. You are viewing as a spectator." :
    (current.needsNewBowler && !current.bowlerId ? "OVER COMPLETE — select a different bowler to continue." :
    (needsBatterConfirm ? "NEW BATTER — check the batting pair and confirm before the next ball." :
    (activeBalls(innings.innings_no).length === 0 ? "Choose the opening pair and bowler, then confirm." :
    (current.needsNewBowler ? "New bowler selected ✓" : "Scoring as " + scorer))));
  $("confirmLineupBtn").textContent = state.lineupConfirmed ? "Players confirmed ✓" :
    (needsBatterConfirm ? "Confirm new batters" : "Confirm players");
  $("confirmLineupBtn").classList.toggle("confirmed", state.lineupConfirmed);
  $("confirmLineupBtn").classList.toggle("needs-attention", needsBatterConfirm || (!state.lineupConfirmed && hasOpeningSelection));
  $("confirmLineupBtn").disabled = !scorer || !hasOpeningSelection || closed || state.saving;
  $("bowler").classList.toggle("needs-attention", !!(current.needsNewBowler && !current.bowlerId));
  $("striker").classList.toggle("needs-attention", needsBatterConfirm);
  $("nonStriker").classList.toggle("needs-attention", needsBatterConfirm);
  const canSubmit = canScore && state.lineupConfirmed && !needsBatterConfirm &&
    !!current.strikerId && !!current.nonStrikerId && !!current.bowlerId && !state.saving;
  document.querySelectorAll("[data-quick-run],#openExtrasBtn,#openWicketBtn,#saveExtrasBtn,#saveWicketBtn")
    .forEach(button => { button.disabled = !canSubmit; });
  $("undoBtn").disabled = !scorer || !activeBalls(innings.innings_no).length || state.saving;
  $("endInningsBtn").disabled = !scorer;
  $("endInningsBtn").textContent = target !== null && chaseDone ? "Finish chase →" : "End innings →";
  $("scoreError").textContent = closed ? (allOut ? "All out — end the innings." : oversDone ? "Over limit reached — end the innings." : "Target reached — finish the chase.") : "";
  renderOverStrip(innings.innings_no);
}
function confirmLineup() {
  if (!localScorer()) { toast("Join the tournament before scoring"); return; }
  if (!$("striker").value || !$("nonStriker").value || !$("bowler").value ||
      $("striker").value === $("nonStriker").value) {
    toast("Choose two different opening batters and a bowler");
    return;
  }
  state.lineupConfirmed = true;
  state.pendingBatterReview = false;
  toast("Players confirmed");
  renderScore();
}
function renderOverStrip(inningsNo) {
  const rows = activeBalls(inningsNo);
  if (!rows.length) {
    $("overBalls").innerHTML = '<span class="tiny-muted">No deliveries yet</span>';
    $("overSummary").textContent = "0 runs";
    return;
  }
  const last = rows[rows.length - 1];
  const overNo = Number(last.over_number);
  const currentOver = rows.filter(b => Number(b.over_number) === overNo);
  $("overBalls").innerHTML = currentOver.map(ball => {
    const label = ball.wicket ? "W" : ball.extra_type === "wide" ? "WD" : ball.extra_type === "no-ball" ? "NB" :
      ball.extra_type === "bye" ? "B" : ball.extra_type === "leg-bye" ? "LB" :
      (Number(ball.total_runs) === 0 ? "·" : String(ball.total_runs));
    const cls = ball.wicket ? "wicket" : ball.extra_type ? "extra" : ([4,6].includes(Number(ball.runs_off_bat)) ? "boundary" : "");
    return '<span class="over-ball ' + cls + '">' + label + "</span>";
  }).join("");
  const total = currentOver.reduce((sum,b) => sum + Number(b.total_runs), 0);
  $("overSummary").textContent = total + " runs · " + currentOver.filter(b => !["wide","no-ball"].includes(b.extra_type)).length + " legal";
}
function currentLineup() {
  return {
    strikerId: $("striker").value,
    nonStrikerId: $("nonStriker").value,
    bowlerId: $("bowler").value
  };
}
function makeIdempotencyKey() {
  if (!state.pendingKey) {
    if (crypto.randomUUID) state.pendingKey = crypto.randomUUID();
    else {
      state.pendingKey = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => {
        const r = Math.floor(Math.random() * 16);
        return (ch === "x" ? r : ((r & 3) | 8)).toString(16);
      });
    }
  }
  return state.pendingKey;
}
async function submitDelivery(input) {
  if (state.saving) return;
  const innings = currentInnings();
  if (!innings) { toast("No active innings"); return; }
  if (!localScorer()) { toast("Join the tournament before scoring"); return; }
  const lineup = currentLineup();
  const built = buildDelivery({
    matchId: state.match.id,
    inningsNo: innings.innings_no,
    balls: state.balls,
    players: state.players,
    battingTeam: innings.batting_team,
    bowlingTeam: innings.bowling_team,
    strikerId: lineup.strikerId,
    nonStrikerId: lineup.nonStrikerId,
    bowlerId: lineup.bowlerId,
    scorerName: localScorer(),
    oversLimit: Number(state.match.overs),
    batRuns: input.batRuns || 0,
    extraType: input.extraType || "",
    extraRuns: input.extraRuns || 0,
    wicket: input.wicket || "",
    dismissedBatsmanId: input.dismissedBatsmanId || "",
    incomingBatterId: input.incomingBatterId || "",
    crossedBeforeWicket: !!input.crossedBeforeWicket
  });
  if (!built.ok) {
    $("scoreError").textContent = built.errors.join(" ");
    toast(built.errors[0]);
    return;
  }
  const ball = { ...built.ball, idempotency_key: makeIdempotencyKey() };
  state.saving = true;
  document.querySelectorAll("[data-quick-run],#openExtrasBtn,#openWicketBtn,#saveExtrasBtn,#saveWicketBtn").forEach(button => button.disabled = true);
  try {
    const before = inningsStats(state.balls, innings.innings_no, state.match.overs);
    const previousBatterRuns = activeBalls(innings.innings_no)
      .filter(b => b.striker_id === ball.striker_id)
      .reduce((sum,b) => sum + Number(b.runs_off_bat || 0), 0);
    await api("balls", { method: "POST", body: JSON.stringify(ball) });
    state.pendingKey = null;
    closeSheets();
    $("wicketType").value = "bowled";
    $("extraKind").value = "wide";
    $("extraBatRuns").value = "0";
    $("extraRunCount").value = "0";
    $("runOutRuns").value = "0";
    $("crossedBeforeWicket").checked = false;
    await loadMatch(state.match.id);
    if (ball.wicket) {
      // Require the scorer to acknowledge the replacement batter(s) before
      // another delivery. This also provides a clear visual wicket transition.
      state.lineupConfirmed = false;
      state.pendingBatterReview = true;
      setActiveScoreTab("scorer");
      renderScore();
    }
    checkMilestones(ball, before.total, previousBatterRuns);
    toast(ball.wicket ? "Wicket recorded — confirm the new batting pair" : "Delivery saved");
  } catch (error) {
    $("scoreError").textContent = error.message;
    toast("Delivery not saved: " + error.message);
  } finally {
    state.saving = false;
    renderScore();
  }
}
function quickRun(runs) {
  submitDelivery({ batRuns: Number(runs) });
}
function openSheet(id) {
  $(id).classList.remove("hidden");
  document.body.classList.add("sheet-open");
}
function closeSheets() {
  $("extrasSheet").classList.add("hidden");
  $("wicketSheet").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}
function openExtras() {
  $("extraKind").value = "wide"; $("extraBatRuns").value = "0"; $("extraRunCount").value = "0";
  updateExtraHelp();
  openSheet("extrasSheet");
}
function updateExtraHelp() {
  const kind = $("extraKind").value;
  const isWide = kind === "wide";
  const isBye = kind === "bye" || kind === "leg-bye";
  $("extraBatRuns").disabled = isWide || isBye;
  if (isWide || isBye) $("extraBatRuns").value = "0";
  $("extraHelp").textContent = kind === "wide" ? "A wide adds one automatic penalty run. Select any additional completed runs below." :
    kind === "no-ball" ? "A no-ball adds one automatic penalty run. Add bat runs and/or additional completed runs." :
    "Byes and leg-byes count as legal balls. Enter the completed runs under Additional runs.";
}
function saveExtras() {
  submitDelivery({
    extraType: $("extraKind").value,
    batRuns: Number($("extraBatRuns").value),
    extraRuns: Number($("extraRunCount").value)
  });
}
function openWicket() {
  const innings = currentInnings();
  const batting = playersFor(innings.batting_team);
  const current = currentBattingState(state.balls, innings.innings_no, currentLineup());
  const currentIds = [current.strikerId, current.nonStrikerId].filter(Boolean);
  fillSelect($("wicketBatter"), batting.filter(p => currentIds.includes(p.id)), current.strikerId, "Choose batter");
  const dismissed = new Set(activeBalls(innings.innings_no).filter(b => b.wicket).map(b => b.dismissed_batsman_id));
  const available = batting.filter(p => !dismissed.has(p.id) && !currentIds.includes(p.id));
  fillSelect($("incomingBatter"), available, "", available.length ? "Choose incoming batter" : "No batter remaining");
  $("wicketType").value = "bowled";
  $("runOutRuns").value = "0";
  $("crossedBeforeWicket").checked = false;
  $("runOutFields").classList.add("hidden");
  $("wicketHelp").textContent = available.length ? "Choose the dismissed batter and the incoming batter." : "No recognised batter remains. Confirm the final wicket.";
  openSheet("wicketSheet");
}
function saveWicket() {
  const wicket = $("wicketType").value;
  submitDelivery({
    wicket,
    dismissedBatsmanId: $("wicketBatter").value,
    incomingBatterId: $("incomingBatter").value,
    batRuns: wicket === "run out" ? Number($("runOutRuns").value) : 0,
    crossedBeforeWicket: $("crossedBeforeWicket").checked
  });
}
async function undoBall() {
  if (!localScorer()) { toast("Join the tournament before correcting scores"); return; }
  const rows = activeBalls(state.match.current_innings);
  if (!rows.length) { toast("No delivery to undo"); return; }
  const last = rows[rows.length - 1];
  const label = last.wicket ? "wicket" : Number(last.total_runs) + " run(s)";
  if (!confirm("Undo the last delivery (" + label + ")? The entry will be marked void and removed from the scorecard.")) return;
  try {
    await api("balls?id=eq." + last.id, {
      method: "PATCH",
      body: JSON.stringify({ voided_at: new Date().toISOString(), voided_by: localScorer() }),
      prefer: "return=minimal"
    });
    await loadMatch(state.match.id);
    toast("Last delivery undone");
  } catch (error) { toast("Undo failed: " + error.message); }
}
async function endInnings() {
  if (!localScorer()) { toast("Join the tournament before managing innings"); return; }
  const innings = currentInnings();
  const nextNo = Number(state.match.current_innings) + 1;
  if (!confirm(nextNo > 2 ? "Finish this match and calculate the result?" : "End the first innings and begin the chase?")) return;
  try {
    await api("innings?id=eq." + innings.id, {
      method: "PATCH", body: JSON.stringify({ status: "completed" }), prefer: "return=minimal"
    });
    if (nextNo > 2) {
      await finishMatch(true);
      return;
    }
    await api("innings", {
      method: "POST",
      body: JSON.stringify({
        match_id: state.match.id, innings_no: 2,
        batting_team: innings.bowling_team, bowling_team: innings.batting_team, status: "live"
      })
    });
    await api("matches?id=eq." + state.match.id, {
      method: "PATCH", body: JSON.stringify({ current_innings: 2, updated_at: new Date().toISOString() }),
      prefer: "return=minimal"
    });
    state.lineupConfirmed = false;
    await loadMatch(state.match.id);
    toast("Second innings started");
  } catch (error) { toast("Could not end innings: " + error.message); }
}
async function finishMatch(alreadyConfirmed) {
  if (!localScorer()) { toast("Join the tournament before finishing a match"); return; }
  if (!alreadyConfirmed && !confirm("Finish the match and publish the result?")) return;
  stopPolling();
  await api("matches?id=eq." + state.match.id, {
    method: "PATCH",
    body: JSON.stringify({ status: "finished", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    prefer: "return=minimal"
  });
  await loadMatch(state.match.id);
  toast("Match completed");
}
async function shareMatch() {
  const url = new URL(window.location.href);
  url.searchParams.set("match", state.match.id);
  try {
    await navigator.clipboard.writeText(url.toString());
    toast("Live score link copied");
  } catch (_) { window.prompt("Copy the live score link:", url.toString()); }
}
function checkMilestones(ball, oldTeamTotal, oldPlayerRuns) {
  const innings = currentInnings();
  const teamTotal = inningsStats(state.balls, innings.innings_no, state.match.overs).total;
  const thresholds = [50,100,150,200,250,300];
  const teamMark = thresholds.find(n => oldTeamTotal < n && teamTotal >= n);
  if (teamMark) {
    const key = "team:" + state.match.id + ":" + innings.innings_no + ":" + teamMark;
    if (!state.milestones.has(key)) {
      state.milestones.add(key);
      showMilestone("TEAM MILESTONE", teamMark === 50 ? "TEAM FIFTY!" : teamMark === 100 ? "TEAM CENTURY!" : "TEAM " + teamMark + "!", teamName(innings.batting_team) + " reached " + teamMark);
    }
  }
  const currentPlayerRuns = activeBalls(innings.innings_no).filter(b => b.striker_id === ball.striker_id)
    .reduce((sum,b) => sum + Number(b.runs_off_bat || 0), 0);
  const playerMark = thresholds.find(n => oldPlayerRuns < n && currentPlayerRuns >= n);
  if (playerMark) {
    const key = "player:" + state.match.id + ":" + innings.innings_no + ":" + ball.striker_id + ":" + playerMark;
    if (!state.milestones.has(key)) {
      state.milestones.add(key);
      showMilestone("BATTER MILESTONE", playerMark === 50 ? "HALF-CENTURY!" : playerMark === 100 ? "CENTURY!" : playerMark + "!", playerName(ball.striker_id) + " reached " + playerMark + " runs");
    }
  }
}
function showMilestone(kicker, title, detail) {
  $("milestoneKicker").textContent = kicker;
  $("milestoneTitle").textContent = title;
  $("milestoneDetail").textContent = detail;
  $("milestoneOverlay").classList.remove("hidden");
}
function htmlTable(headers, rows, emptyText) {
  if (!rows.length) return '<div class="empty">' + esc(emptyText || "No figures yet.") + "</div>";
  return '<table class="data-table"><thead><tr>' + headers.map(h => "<th>" + esc(h) + "</th>").join("") +
    "</tr></thead><tbody>" + rows.map(row => "<tr>" + row.map(cell => "<td>" + cell + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
}
function renderScorecard() {
  const innings = currentInnings();
  if (!innings) return;
  const batting = playersFor(innings.batting_team);
  const bowling = playersFor(innings.bowling_team);
  const batRows = battingScorecard(state.balls, batting, innings.innings_no);
  const bowlRows = bowlingScorecard(state.balls, bowling, innings.innings_no);
  $("battingScorecard").innerHTML = htmlTable(
    ["Batter","Dismissal","R","B","4s","6s","SR"],
    batRows.map(p => [esc(p.name), esc(p.dismissal), p.runs, p.balls, p.fours, p.sixes, p.strikeRate.toFixed(1)]),
    "No batting figures yet."
  );
  $("bowlingScorecard").innerHTML = htmlTable(
    ["Bowler","O","M","R","W","Eco"],
    bowlRows.map(p => [esc(p.name), p.overs, p.maidens, p.runs, p.wickets, p.economy.toFixed(2)]),
    "No bowling figures yet."
  );
  const stats = inningsStats(state.balls, innings.innings_no, state.match.overs);
  const extras = stats.extras;
  const extrasTotal = extras.wides + extras.noBalls + extras.byes + extras.legByes;
  $("extrasSummary").innerHTML = [
    ["Wides",extras.wides],["No-balls",extras.noBalls],["Byes",extras.byes],["Leg-byes",extras.legByes],["Total extras",extrasTotal]
  ].map(row => '<div class="row"><span>' + esc(row[0]) + '</span><strong>' + row[1] + "</strong></div>").join("");
  const fow = fallOfWickets(state.balls, innings.innings_no, state.players);
  $("fallWickets").innerHTML = fow.length ? fow.map(item =>
    '<div class="row"><span>' + item.wicket + " - " + item.score + '</span><strong>' + esc(item.batter) + " (" + item.overs + ")</strong></div>"
  ).join("") : '<div class="empty">No wickets yet.</div>';
  $("inningsSummary").innerHTML = state.innings.map(i => {
    const s = inningsStats(state.balls, i.innings_no, state.match.overs);
    return '<div class="innings-chip"><span>' + esc(teamName(i.batting_team)) + '</span><strong>' +
      s.total + "/" + s.wickets + " · " + s.overs + " ov · RR " + s.runRateText + "</strong></div>";
  }).join("");
}
function ballOutcome(ball) {
  if (ball.wicket) return "WICKET · " + ball.wicket.toUpperCase();
  if (ball.extra_type === "wide") return "WIDE +" + ball.total_runs;
  if (ball.extra_type === "no-ball") return "NO BALL +" + ball.total_runs;
  if (ball.extra_type === "bye") return ball.extra_runs + " BYE";
  if (ball.extra_type === "leg-bye") return ball.extra_runs + " LEG-BYE";
  if (ball.runs_off_bat === 4 && ball.is_boundary) return "FOUR";
  if (ball.runs_off_bat === 6 && ball.is_boundary) return "SIX";
  return ball.total_runs === 0 ? "DOT BALL" : ball.total_runs + " RUN" + (ball.total_runs === 1 ? "" : "S");
}
function renderCommentary() {
  const rows = [...state.balls].filter(b => !b.voided_at).sort((a,b) => Number(a.delivery_number) - Number(b.delivery_number)).reverse();
  $("commentaryList").innerHTML = rows.length ? rows.map(ball => {
    const overLabel = (Number(ball.over_number) + 1) + "." + ball.ball_number;
    return '<article class="commentary-item"><span class="commentary-over">' + overLabel + '</span><div class="commentary-copy">' +
      esc(playerName(ball.striker_id)) + " · " + esc(playerName(ball.bowler_id)) +
      '<small>Scored by ' + esc(ball.scorer_name) + " · Delivery #" + ball.delivery_number + "</small></div><strong class=\"commentary-result\">" +
      esc(ballOutcome(ball)) + "</strong></article>";
  }).join("") : '<div class="empty">No deliveries recorded yet.</div>';
}
function renderMatchDetails() {
  $("scoreTournamentName").textContent = state.tournament?.name || "Friendly match";
}
function renderSummary() {
  const result = matchResult(state.innings, state.balls, state.players, state.match);
  $("resultText").textContent = result.text;
  $("summaryToss").textContent = "Toss: " + state.match.toss_winner + " chose to " + state.match.toss_decision +
    (state.tournament ? " · " + state.tournament.name : "");
  const battingTotals = {};
  state.players.forEach(player => {
    const rows = state.balls.filter(b => !b.voided_at && b.striker_id === player.id);
    const runs = rows.reduce((sum,b) => sum + Number(b.runs_off_bat || 0), 0);
    const balls = rows.filter(b => b.extra_type !== "wide").length;
    const fours = rows.filter(b => b.is_boundary && b.runs_off_bat === 4).length;
    const sixes = rows.filter(b => b.is_boundary && b.runs_off_bat === 6).length;
    if (balls || runs) battingTotals[player.id] = { runs, balls, fours, sixes };
  });
  $("battingSummary").innerHTML = Object.entries(battingTotals).sort((a,b) => b[1].runs - a[1].runs).slice(0,8).map(([id,s]) =>
    '<div class="row"><span>' + esc(playerName(id)) + " · " + s.balls + " balls · " + s.fours + "×4 · " + s.sixes + "×6</span><strong>" + s.runs + "</strong></div>"
  ).join("") || '<div class="empty">No batting figures.</div>';
  const wickets = {};
  state.balls.filter(b => !b.voided_at && b.wicket && ["bowled","caught","lbw","stumped","hit wicket"].includes(b.wicket))
    .forEach(b => { wickets[b.bowler_id] = (wickets[b.bowler_id] || 0) + 1; });
  $("bowlingSummary").innerHTML = Object.entries(wickets).sort((a,b) => b[1]-a[1]).map(([id,count]) =>
    '<div class="row"><span>' + esc(playerName(id)) + "</span><strong>" + count + " wkts</strong></div>"
  ).join("") || '<div class="empty">No credited wickets.</div>';
  $("summaryInnings").innerHTML = state.innings.map(i => {
    const s = inningsStats(state.balls, i.innings_no, state.match.overs);
    return '<div class="row"><span>' + esc(teamName(i.batting_team)) + '</span><strong>' +
      s.total + "/" + s.wickets + " · " + s.overs + " ov · RR " + s.runRateText + "</strong></div>";
  }).join("");
  const moments = [];
  state.balls.filter(b => !b.voided_at).forEach(b => {
    if (b.is_boundary && b.runs_off_bat === 6) moments.push("Six by " + playerName(b.striker_id));
    if (b.is_boundary && b.runs_off_bat === 4) moments.push("Four by " + playerName(b.striker_id));
    if (b.wicket) moments.push(playerName(b.dismissed_batsman_id) + " out — " + b.wicket);
  });
  $("momentsSummary").innerHTML = moments.slice(0,12).map(x => '<div class="row"><span>' + esc(x) + "</span></div>").join("") ||
    '<div class="empty">No notable moments recorded.</div>';
}
async function renderStandings() {
  if ((state.tournament.format || "friendly") !== "league") {
    $("standingsTable").innerHTML = '<div class="empty">Points standings are available for league / round-robin tournaments.</div>';
    return;
  }
  const matches = await api("matches?tournament_id=eq." + state.tournament.id + "&select=*&order=created_at.asc");
  if (!state.teams.length) { $("standingsTable").innerHTML = '<div class="empty">Add teams to calculate the table.</div>'; return; }
  const ids = matches.map(m => m.id);
  let allBalls = [];
  if (ids.length) allBalls = await api("balls?match_id=in.(" + ids.join(",") + ")&select=*&order=delivery_number.asc");
  const ballsByMatch = {};
  allBalls.forEach(ball => { (ballsByMatch[ball.match_id] ||= []).push(ball); });
  const rows = tournamentStandings(matches, ballsByMatch, state.teams);
  $("standingsTable").innerHTML = htmlTable(
    ["Team","P","W","L","T","Pts","NRR"],
    rows.map((row,index) => [
      '<strong>' + (index + 1) + ". " + esc(row.name) + "</strong>",
      row.played,row.won,row.lost,row.tied,row.points,
      (row.nrr >= 0 ? "+" : "") + row.nrr.toFixed(3)
    ]),
    "No completed league matches yet."
  );
}
async function backToTournament() {
  if (!state.tournament) { await loadHome(); return; }
  await openTournament(state.tournament.id);
  setActiveTournamentTab("matches");
}

function attachEvents() {
  bind("startTournamentBtn","click",() => showView("tournamentCreateView"));
  bind("joinTournamentBtn","click",() => listTournaments().catch(showError));
  bind("reloadHomeBtn","click",() => loadHome().catch(showError));
  bind("createTournamentBtn","click",createTournament);
  bind("backHomeBtn","click",() => loadHome().catch(showError));
  bind("joinBackBtn","click",() => listTournaments().catch(showError));
  bind("confirmJoinBtn","click",confirmJoin);
  bind("viewTournamentBtn","click",() => openTournament(state.tournament.id).catch(showError));
  bind("tournamentHomeBtn","click",() => loadHome().catch(showError));
  bind("tournamentJoinBtn","click",() => openJoin(state.tournament.id).catch(showError));
  bind("tournamentNewMatchBtn","click",() => startMatchSetup().catch(showError));
  bind("refreshTournamentBtn","click",() => refreshTournament().catch(showError));
  bind("addTeamBtn","click",createTeam);
  bind("matchSetupBackBtn","click",backToTournament);
  bind("createMatchBtn","click",createMatch);
  bind("tossCallHeads","click",() => chooseTossCall("heads"));
  bind("tossCallTails","click",() => chooseTossCall("tails"));
  bind("flipCoinBtn","click",flipCoin);
  bind("chooseBatFirstBtn","click",() => chooseTossDecision("bat"));
  bind("chooseBowlFirstBtn","click",() => chooseTossDecision("bowl"));
  bind("confirmLineupBtn","click",confirmLineup);
  bind("openExtrasBtn","click",openExtras);
  bind("openWicketBtn","click",openWicket);
  bind("saveExtrasBtn","click",saveExtras);
  bind("saveWicketBtn","click",saveWicket);
  bind("undoBtn","click",undoBall);
  bind("endInningsBtn","click",endInnings);
  bind("finishMatchBtn","click",() => finishMatch(false).catch(showError));
  bind("shareMatchBtn","click",shareMatch);
  bind("refreshBtn","click",() => loadMatch(state.match.id).catch(showError));
  bind("backToTournamentBtn","click",backToTournament);
  bind("summaryTournamentBtn","click",backToTournament);
  bind("homeBtn","click",() => loadHome().catch(showError));
  bind("brandHomeBtn","click",() => loadHome().catch(showError));
  bind("milestoneClose","click",() => $("milestoneOverlay").classList.add("hidden"));
  bind("tossDecisionSheet","click",event => { if(event.target.id === "tossDecisionSheet") { /* winner must choose */ } });

  bind("extraKind","change",updateExtraHelp);
  bind("wicketType","change",() => $("runOutFields").classList.toggle("hidden", $("wicketType").value !== "run out"));
  bind("team1","change",() => { resetTossUI(); onTeamNameChange("team1","players1").catch(showError); });
  bind("team2","change",() => { resetTossUI(); onTeamNameChange("team2","players2").catch(showError); });
  bind("striker","change",() => { if (state.match) { if (!activeBalls(state.match.current_innings).length) state.lineupConfirmed = false; renderScore(); } });
  bind("nonStriker","change",() => { if (state.match) { if (!activeBalls(state.match.current_innings).length) state.lineupConfirmed = false; renderScore(); } });
  bind("bowler","change",() => { if (state.match) { renderScore(); } });
  document.querySelectorAll("[data-home]").forEach(button => button.addEventListener("click", () => loadHome().catch(showError)));
  document.querySelectorAll("[data-score-tab]").forEach(button =>
    button.addEventListener("click", () => setActiveScoreTab(button.dataset.scoreTab))
  );
  document.querySelectorAll("[data-tournament-tab]").forEach(button =>
    button.addEventListener("click", () => setActiveTournamentTab(button.dataset.tournamentTab))
  );
  document.querySelectorAll("[data-quick-run]").forEach(button =>
    button.addEventListener("click", () => quickRun(button.dataset.quickRun))
  );
  document.querySelectorAll("[data-close-sheet]").forEach(button =>
    button.addEventListener("click", closeSheets)
  );
  ["extrasSheet","wicketSheet"].forEach(id => $(id).addEventListener("click", event => {
    if (event.target.id === id) closeSheets();
  }));
  window.addEventListener("online", setNetwork);
  window.addEventListener("offline", setNetwork);
  window.addEventListener("beforeunload", stopPolling);
}

attachEvents();
init().catch(error => {
  $("configNotice").classList.remove("hidden");
  $("configNotice").textContent = "GroundScore could not start: " + error.message;
});
