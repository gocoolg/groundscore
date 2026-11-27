import {
  buildDelivery,
  deliveryNotation,
  inningsStats,
  currentBattingState,
  battingScorecard,
  bowlingScorecard,
  fallOfWickets,
  matchResult,
  chaseProgress,
  tournamentStandings
} from "./js/scoring-engine.js";

const cfg = window.GROUNDSCORE_CONFIG || {};
const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const state = {
  tournament: null, match: null, innings: [], balls: [], players: [], members: [],
  teams: [], teamPlayers: {}, playerDirectory: [], playerDirectoryAvailable: false,
  scorerDirectory: [], scorerDirectoryAvailable: false, rematchContext: null,
  poll: null, current: null, saving: false,
  selectedScoreTab: "scorer", selectedTournamentTab: "matches",
  lineupConfirmed: false, pendingBatterReview: false, milestones: new Set(), pendingKey: null,
  toss: null, squadDraft: { team1: [], team2: [] }, teamCreationDraft: [],
  loaderDepth: 0, loaderStartedAt: 0, loaderTimer: null, autoCompleting: false,
  viewerPresenceTimer: null, viewerSessionId: null,
  scoreboardOpen: false, scoreboardWakeLock: null, scoreboardWakeEnabled: false,
  scoreboardFullscreenEntered: false,
  tournamentMatches: [],
  quickExtraType: "wide", quickExtraRuns: 0, quickWicketBatterId: ""
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
const SQUAD_FIELDS = {
  team1: { input: "players1Input", textarea: "players1", chips: "players1Chips" },
  team2: { input: "players2Input", textarea: "players2", chips: "players2Chips" },
  teamCreation: { input: "newTeamPlayerInput", textarea: "newTeamPlayers", chips: "newTeamPlayersChips" }
};
function updateSquadField(key) {
  const field = SQUAD_FIELDS[key];
  const names = key === "teamCreation" ? state.teamCreationDraft : state.squadDraft[key];
  $(field.textarea).value = names.join(", ");
  $(field.chips).innerHTML = names.map((name, index) =>
    '<span class="squad-chip"><span>' + esc(name) + '</span><button type="button" data-remove-squad="' +
    key + '" data-index="' + index + '" aria-label="Remove ' + esc(name) + '">×</button></span>'
  ).join("");
}
function setSquadNames(key, names) {
  const unique = [];
  const seen = new Set();
  (names || []).forEach(value => {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    const normalized = name.toLocaleLowerCase();
    if (name && !seen.has(normalized)) { seen.add(normalized); unique.push(name); }
  });
  if (key === "teamCreation") state.teamCreationDraft = unique;
  else state.squadDraft[key] = unique;
  updateSquadField(key);
  renderScorerSuggestions();
}
function addSquadEntry(key) {
  const field = SQUAD_FIELDS[key];
  const input = $(field.input);
  const entries = parseNames(input.value);
  if (!entries.length) { input.focus(); return; }
  const current = key === "teamCreation" ? state.teamCreationDraft : state.squadDraft[key];
  const seen = new Set(current.map(x => x.toLocaleLowerCase()));
  const additions = entries.filter(name => {
    const normalized = name.toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  const next = [...current, ...additions];
  setSquadNames(key, next);
  input.value = "";
  input.focus();
}
function removeSquadEntry(key, index) {
  const current = key === "teamCreation" ? state.teamCreationDraft : state.squadDraft[key];
  setSquadNames(key, current.filter((_, i) => i !== index));
}
function setBatterSelection(changed) {
  const striker = $("striker").value;
  const nonStriker = $("nonStriker").value;
  if (striker && nonStriker && striker === nonStriker) {
    if (changed === "striker") $("nonStriker").value = "";
    else $("striker").value = "";
    state.lineupConfirmed = false;
    toast("A player cannot be both striker and non-striker. Choose another batter.");
  }
  if (state.match) renderScore();
}

function overText(n) { return Math.floor(n / 6) + "." + (n % 6); }
function showView(id) {
  if (id !== "scoreView" && state.scoreboardOpen) closeScoreboardMode();
  ["homeView","tournamentCreateView","tournamentListView","joinView","tournamentView","matchSetupView","scoreView","summaryView"]
    .forEach(view => $(view)?.classList.toggle("hidden", view !== id));
  $("homeBtn").classList.toggle("hidden", id === "homeView");
  window.scrollTo({ top: 0, behavior: "auto" });
}
async function withLoader(message, action) {
  const outermost = state.loaderDepth === 0;
  if (outermost) clearTimeout(state.loaderTimer);
  state.loaderDepth += 1;
  if (outermost) {
    state.loaderStartedAt = Date.now();
    $("loaderMessage").textContent = message || "Getting the ground ready…";
    $("appLoader").classList.remove("hidden");
  }
  try {
    return await action();
  } finally {
    state.loaderDepth = Math.max(0, state.loaderDepth - 1);
    if (state.loaderDepth === 0) {
      const elapsed = Date.now() - state.loaderStartedAt;
      const remaining = Math.max(0, 360 - elapsed);
      clearTimeout(state.loaderTimer);
      state.loaderTimer = setTimeout(() => $("appLoader").classList.add("hidden"), remaining);
      if (!remaining) $("appLoader").classList.add("hidden");
    }
  }
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
function renderPlayerDirectorySuggestions() {
  const list = $("playerDirectoryList");
  if (!list) return;
  list.innerHTML = state.playerDirectory
    .map(name => '<option value="' + esc(name) + '"></option>')
    .join("");
}
async function loadPlayerDirectory() {
  try {
    const rows = await api("player_directory?select=name&order=name.asc&limit=1000");
    state.playerDirectory = [...new Set(rows.map(row => String(row.name || "").trim()).filter(Boolean))];
    state.playerDirectoryAvailable = true;
    renderPlayerDirectorySuggestions();
    return true;
  } catch (error) {
    // The app remains usable before the player-directory migration is installed.
    state.playerDirectoryAvailable = false;
    state.playerDirectory = [];
    renderPlayerDirectorySuggestions();
    console.info("Shared player suggestions are unavailable until the player-directory migration is applied.", error);
    return false;
  }
}
async function savePlayerDirectoryNames(names) {
  const unique = new Map();
  (names || []).forEach(value => {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    const normalized = name.toLocaleLowerCase();
    if (name && name.length <= 80 && !unique.has(normalized)) unique.set(normalized, name);
  });
  const cleanNames = [...unique.values()];
  if (!cleanNames.length) return true;
  try {
    await api("rpc/register_player_directory_names", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ p_names: cleanNames })
    });
    const merged = new Map(state.playerDirectory.map(name => [name.toLocaleLowerCase(), name]));
    cleanNames.forEach(name => { if (!merged.has(name.toLocaleLowerCase())) merged.set(name.toLocaleLowerCase(), name); });
    state.playerDirectory = [...merged.values()].sort((a, b) => a.localeCompare(b));
    state.playerDirectoryAvailable = true;
    renderPlayerDirectorySuggestions();
    return true;
  } catch (error) {
    console.warn("Could not save player names to the shared directory.", error);
    return false;
  }
}

function renderScorerSuggestions() {
  const list = $("scorerDirectoryList");
  if (!list) return;
  const names = [
    ...state.scorerDirectory,
    ...state.playerDirectory,
    ...Object.values(state.teamPlayers).flat().map(player => player.name),
    ...state.squadDraft.team1,
    ...state.squadDraft.team2,
    ...state.teamCreationDraft,
    ...state.players.map(player => player.name)
  ];
  const unique = new Map();
  names.forEach(value => {
    const name = String(value || "").trim();
    if (name && !unique.has(name.toLocaleLowerCase())) unique.set(name.toLocaleLowerCase(), name);
  });
  list.innerHTML = [...unique.values()].sort((a, b) => a.localeCompare(b))
    .map(name => '<option value="' + esc(name) + '"></option>')
    .join("");
}
async function loadScorerDirectory() {
  try {
    const rows = await api("scorer_directory?select=name&order=name.asc&limit=1000");
    state.scorerDirectory = [...new Set(rows.map(row => String(row.name || "").trim()).filter(Boolean))];
    state.scorerDirectoryAvailable = true;
    renderScorerSuggestions();
    return true;
  } catch (error) {
    // Scorer entry still accepts free text if the database migration is pending.
    state.scorerDirectoryAvailable = false;
    state.scorerDirectory = [];
    renderScorerSuggestions();
    console.info("Saved scorer suggestions are unavailable until the scorer-directory migration is applied.", error);
    return false;
  }
}
async function saveScorerDirectoryName(value) {
  const name = String(value || "").trim().replace(/\\s+/g, " ");
  if (!name || name.length > 80) return false;
  try {
    await api("rpc/register_scorer_directory_name", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ p_name: name })
    });
    const merged = new Map(state.scorerDirectory.map(existing => [existing.toLocaleLowerCase(), existing]));
    if (!merged.has(name.toLocaleLowerCase())) merged.set(name.toLocaleLowerCase(), name);
    state.scorerDirectory = [...merged.values()].sort((a, b) => a.localeCompare(b));
    state.scorerDirectoryAvailable = true;
    renderScorerSuggestions();
    return true;
  } catch (error) {
    console.warn("Could not save scorer name to the shared directory.", error);
    return false;
  }
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
  const panels = {
    matches:"tMatchesPanel", teams:"tTeamsPanel", standings:"tStandingsPanel",
    metrics:"tMetricsPanel", members:"tMembersPanel"
  };
  Object.entries(panels).forEach(([name, id]) =>
    $(id).classList.toggle("hidden", tab !== name)
  );
  if (tab === "standings") renderStandings().catch(showError);
  if (tab === "metrics") renderTournamentMetrics().catch(showError);
}

function showError(error) { toast(error?.message || String(error)); }

function getViewerSessionId() {
  try {
    const stored = sessionStorage.getItem("groundscore_viewer_session");
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored;
  } catch (_) {}
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => {
        const r = Math.floor(Math.random() * 16);
        return (ch === "x" ? r : ((r & 3) | 8)).toString(16);
      });
  try { sessionStorage.setItem("groundscore_viewer_session", id); } catch (_) {}
  return id;
}
async function updateSiteViewerCount() {
  try {
    const count = await api("rpc/record_site_viewer", {
      method: "POST",
      body: JSON.stringify({ p_session_id: state.viewerSessionId })
    });
    const viewers = Number(count);
    if (!Number.isFinite(viewers) || viewers < 0) throw new Error("Invalid viewer count");
    const label = $("viewerCount");
    const wrap = $("viewerCountWrap");
    if (label) label.textContent = viewers + (viewers === 1 ? " VIEWER ONLINE" : " VIEWERS ONLINE");
    if (wrap) wrap.classList.remove("viewer-count-unavailable");
  } catch (error) {
    const label = $("viewerCount");
    const wrap = $("viewerCountWrap");
    if (label) label.textContent = "LIVE COUNT UNAVAILABLE";
    if (wrap) wrap.classList.add("viewer-count-unavailable");
    console.info("Live site viewer count is unavailable. Apply the site-viewer presence migration in Supabase.", error);
  }
}
function startSiteViewerCount() {
  if (state.viewerPresenceTimer) return;
  state.viewerSessionId = getViewerSessionId();
  updateSiteViewerCount();
  state.viewerPresenceTimer = setInterval(updateSiteViewerCount, 25000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateSiteViewerCount();
  });
}

async function init() {
  setNetwork();
  if (!configured) {
    $("configNotice").classList.remove("hidden");
    $("configNotice").textContent = "Supabase is not configured. Check config.js before using GroundScore.";
    showView("homeView");
    return;
  }
  startSiteViewerCount();
  await loadPlayerDirectory();
  await loadScorerDirectory();
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
    button.addEventListener("click", () => withLoader("Opening tournament…", () => openTournament(button.dataset.view)).catch(showError))
  );
  container.querySelectorAll("[data-join]").forEach(button =>
    button.addEventListener("click", () => withLoader("Opening player check-in…", () => openJoin(button.dataset.join)).catch(showError))
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
function openDeleteTournamentSheet() {
  if (!state.tournament) return;
  $("deleteTournamentName").textContent = state.tournament.name;
  $("deleteTournamentNameConfirm").value = "";
  $("deleteTournamentPassword").value = "";
  $("deleteTournamentError").textContent = "";
  $("confirmDeleteTournamentBtn").disabled = false;
  $("confirmDeleteTournamentBtn").textContent = "Delete permanently";
  $("deleteTournamentSheet").classList.remove("hidden");
  document.body.classList.add("sheet-open");
}
function closeDeleteTournamentSheet() {
  $("deleteTournamentSheet").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}
async function deleteTournamentPermanently() {
  if (!state.tournament) return;
  const tournament = state.tournament;
  const typedName = $("deleteTournamentNameConfirm").value.trim();
  const password = $("deleteTournamentPassword").value;
  $("deleteTournamentError").textContent = "";

  if (typedName !== tournament.name) {
    $("deleteTournamentError").textContent = "The tournament name does not match. Enter it exactly as shown.";
    return;
  }
  if (!password) {
    $("deleteTournamentError").textContent = "Enter the admin password.";
    return;
  }

  const button = $("confirmDeleteTournamentBtn");
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    const response = await fetch(cfg.SUPABASE_URL + "/functions/v1/delete-tournament", {
      method: "POST",
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tournamentId: tournament.id,
        expectedName: tournament.name,
        password
      })
    });
    const raw = await response.text();
    let result = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!response.ok) {
      const detail = result.error || result.message || raw || ("HTTP " + response.status);
      if (response.status === 404 || response.status === 401 || /function.*not found|requested function/i.test(String(detail))) {
        throw new Error(String(detail) + " — check that the delete-tournament Edge Function is deployed and configured.");
      }
      throw new Error(String(detail));
    }
    closeDeleteTournamentSheet();
    stopPolling();
    state.tournament = null;
    state.match = null;
    state.innings = [];
    state.players = [];
    state.balls = [];
    state.members = [];
    state.teams = [];
    state.teamPlayers = {};
    await withLoader("Returning to the GroundScore home…", loadHome);
    toast("Tournament and its match data deleted");
  } catch (error) {
    $("deleteTournamentError").textContent = error.message;
    button.disabled = false;
    button.textContent = "Delete permanently";
  }
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
  state.tournamentMatches = matches;
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
    button.addEventListener("click", () => withLoader("Opening live scorecard…", () => loadMatch(button.dataset.match)).catch(showError))
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
  const players = [...state.teamCreationDraft];
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
    const directorySaved = await savePlayerDirectoryNames(players);
    $("newTeamName").value = "";
    $("newTeamPlayerInput").value = "";
    setSquadNames("teamCreation", []);
    await refreshTournament();
    setActiveTournamentTab("teams");
    toast(directorySaved ? "Team and squad saved" : "Team and squad saved, but shared player suggestions need the player-directory SQL migration.");
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
async function onTeamNameChange(inputId, squadKey) {
  const name = $(inputId).value.trim();
  const team = state.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (!team) {
    setSquadNames(squadKey, state.squadDraft[squadKey]);
    return;
  }
  let squad = state.teamPlayers[team.id];
  if (!squad) {
    squad = await api("team_players?team_id=eq." + team.id + "&select=*&order=name.asc");
    state.teamPlayers[team.id] = squad;
  }
  setSquadNames(squadKey, squad.map(player => player.name));
}

async function startMatchSetup(options = {}) {
  const rematch = options.rematch || null;
  state.rematchContext = null;
  state.members = await api("tournament_members?tournament_id=eq." + state.tournament.id + "&select=*&order=name.asc");
  state.teams = await api("teams?tournament_id=eq." + state.tournament.id + "&select=*&order=name.asc");
  state.teamPlayers = {};
  await Promise.all(state.teams.map(async team => {
    state.teamPlayers[team.id] = await api("team_players?team_id=eq." + team.id + "&select=*&order=name.asc");
  }));
  state.squadDraft = { team1: [], team2: [] };
  setSquadNames("team1", []);
  setSquadNames("team2", []);
  setSquadNames("teamCreation", []);
  $("players1Input").value = ""; $("players2Input").value = "";
  $("newTeamPlayerInput").value = "";
  const saved = localScorer() || localStorage.getItem("groundscore_member") || "";
  $("matchScorer").value = saved;
  renderScorerSuggestions();
  $("team1").value = ""; $("team2").value = "";
  $("team1").disabled = false; $("team2").disabled = false;
  $("players1").value = ""; $("players2").value = "";
  $("overs").value = 10;
  $("playersPerTeam").value = 11;
  $("roundName").value = "";
  $("scheduledAt").value = "";
  $("setupError").textContent = "";
  resetTossUI();

  if (rematch) {
    state.rematchContext = rematch;
    $("matchSetupHeading").textContent = "Start the next match";
    $("matchSetupDescription").textContent = "The teams and playing squads are carried over from the previous scorecard.";
    $("team1").value = rematch.match.team1;
    $("team2").value = rematch.match.team2;
    $("team1").disabled = true;
    $("team2").disabled = true;
    setSquadNames("team1", rematch.squads.team1);
    setSquadNames("team2", rematch.squads.team2);
    $("overs").value = Number(rematch.match.overs || 10);
    $("playersPerTeam").value = Number(rematch.match.players_per_team || rematch.squads.team1.length || 11);
    $("roundName").value = "Rematch";
    state.toss = {
      call: null, result: null, winnerKey: rematch.winnerKey,
      decision: null, tossedAt: null
    };
    $("tossSectionTitle").textContent = "Next match decision";
    $("tossKicker").textContent = "PREVIOUS MATCH WINNER";
    $("tossTitle").textContent = "Choose to bat or bowl";
    $("tossDescription").textContent = rematch.winnerName + " won the previous match and gets first choice for this rematch.";
    $("coinTossControls").classList.add("hidden");
    $("rematchChoiceControls").classList.remove("hidden");
    $("coinFace").classList.add("hidden");
    $("rematchWinnerPrompt").textContent = rematch.winnerName + " won the previous match. Choose their decision:";
    $("tossStatus").textContent = rematch.winnerName + " will choose whether to bat or bowl first.";
    $("tossWinnerStatus").textContent = rematch.winnerName + " won the previous match.";
    $("tossDecisionSummary").classList.add("hidden");
    $("createMatchBtn").disabled = true;
    $("createMatchBtn").textContent = "Create rematch & go to scorer";
  }
  renderScorerSuggestions();
  showView("matchSetupView");
}
function resetTossUI() {
  // Heads is the default call. The user may switch to tails before flipping.
  state.toss = { call: "heads", result: null, winnerKey: null, decision: null, tossedAt: null };
  $("tossDecisionSheet").classList.add("hidden");
  document.body.classList.remove("sheet-open");
  $("matchSetupHeading").textContent = "Set the game up";
  $("matchSetupDescription").textContent = "Choose teams, playing squads and toss. Then confirm the opening players at the ground.";
  $("tossSectionTitle").textContent = "Coin toss";
  $("tossKicker").textContent = "TEAM 1 CALLS";
  $("tossTitle").textContent = "Heads or tails?";
  $("tossDescription").textContent = "Team 1 chooses one side. The coin decides which team wins the toss.";
  $("coinTossControls").classList.remove("hidden");
  $("rematchChoiceControls").classList.add("hidden");
  $("coinFace").classList.remove("hidden");
  $("tossCallHeads").classList.add("selected");
  $("tossCallTails").classList.remove("selected");
  $("rematchBatFirstBtn").classList.remove("selected");
  $("rematchBowlFirstBtn").classList.remove("selected");
  $("tossStatus").textContent = "Team 1 call: HEADS selected by default. Choose TAILS to switch, or flip the coin.";
  $("coinFace").textContent = "H";
  $("coinFace").classList.remove("flipping");
  $("tossWinnerStatus").textContent = "";
  $("flipCoinBtn").disabled = false;
  $("flipCoinBtn").classList.remove("hidden");
  $("tossDecisionSummary").classList.add("hidden");
  $("tossDecisionResult").textContent = "";
  $("createMatchBtn").disabled = true;
  $("createMatchBtn").textContent = "Create match & go to scorer";
}
function chooseTossCall(call) {
  if (state.rematchContext || state.toss?.result || !["heads", "tails"].includes(call)) return;
  state.toss = { call, result: null, winnerKey: null, decision: null, tossedAt: null };
  $("tossCallHeads").classList.toggle("selected", call === "heads");
  $("tossCallTails").classList.toggle("selected", call === "tails");
  $("tossCallHeads").setAttribute("aria-pressed", String(call === "heads"));
  $("tossCallTails").setAttribute("aria-pressed", String(call === "tails"));
  $("coinFace").textContent = call === "heads" ? "H" : "T";
  $("tossStatus").textContent = "Team 1 called " + call.toUpperCase() + ". Flip the coin.";
  $("flipCoinBtn").disabled = false;
  $("flipCoinBtn").classList.remove("hidden");
}
function flipCoin() {
  if (state.rematchContext) return;
  if (!state.toss?.call || state.toss.result) {
    toast("Choose heads or tails before flipping.");
    return;
  }
  if (!String($("team1").value || "").trim() || !String($("team2").value || "").trim()) {
    toast("Enter both team names before the toss.");
    return;
  }
  $("flipCoinBtn").disabled = true;
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
  $("coinResultLarge").textContent = result.toUpperCase();
  $("tossStatus").textContent = result.toUpperCase() + " — " + winnerName + " won the toss.";
  $("tossWinnerStatus").textContent = winnerName + " won the toss. Choose to bat or bowl.";
  $("flipCoinBtn").classList.add("hidden");
  $("tossDecisionSummary").classList.remove("hidden");
  $("tossWinnerName").textContent = winnerName;
  $("tossDecisionSheet").classList.remove("hidden");
  document.body.classList.add("sheet-open");
}
function chooseTossDecision(decision) {
  if (!state.toss?.winnerKey || (!state.toss?.result && !state.rematchContext)) return;
  if (!["bat", "bowl"].includes(decision)) return;
  state.toss.decision = decision;
  const winnerName = state.toss.winnerKey === "team1" ? $("team1").value.trim() : $("team2").value.trim();
  if (state.rematchContext) {
    $("tossStatus").textContent = winnerName + " won the previous match and chose to " + decision + " first.";
    $("tossWinnerStatus").textContent = winnerName + " has the choice.";
    $("rematchBatFirstBtn").classList.toggle("selected", decision === "bat");
    $("rematchBowlFirstBtn").classList.toggle("selected", decision === "bowl");
  } else {
    $("tossStatus").textContent = "Toss complete: " + winnerName + " won and chose to " + decision + " first.";
    $("tossWinnerStatus").textContent = winnerName + " won · " + state.toss.result.toUpperCase() + " · chose to " + decision.toUpperCase();
  }
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
    const playerDirectorySaved = await savePlayerDirectoryNames([...squad1, ...squad2]);
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
    const scorerDirectorySaved = await saveScorerDirectoryName(scorer);
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
    toast(playerDirectorySaved && scorerDirectorySaved
      ? "Match ready. Confirm the opening players."
      : "Match ready. Scorer/player suggestions may need their Supabase directory migration.");
  } catch (error) {
    const message = String(error?.message || error);
    if (/toss_call|toss_result|toss_tossed_at|schema cache|PGRST204/i.test(message)) {
      $("setupError").textContent =
        "Coin toss database update is required. Open Supabase → SQL Editor, run supabase/add_coin_toss_columns.sql from this GitHub repository, then retry Create match. Your toss result is still selected on this screen.";
    } else {
      $("setupError").textContent = message;
    }
  }
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
  const currentDeliveries = activeBalls(state.match.current_innings);
  state.pendingBatterReview = !!currentDeliveries[currentDeliveries.length - 1]?.wicket;
  state.lineupConfirmed = currentDeliveries.length > 0 && !state.pendingBatterReview;
  if (state.match.status === "finished") {
    renderSummary();
    showView("summaryView");
    return;
  }
  showView("scoreView");
  renderScore();
  setActiveScoreTab(state.selectedScoreTab || "scorer");
  state.poll = setInterval(() => refreshLiveMatch(matchId).catch(() => {}), 8000);
  await completeMatchIfTargetReached();
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
  await completeMatchIfTargetReached();
}
function fillSelect(element, players, selectedId, placeholder) {
  element.innerHTML = '<option value="">' + esc(placeholder) + "</option>" +
    players.map(player => '<option value="' + esc(player.id) + '">' + esc(player.name) + "</option>").join("");
  if (selectedId && players.some(player => player.id === selectedId)) element.value = selectedId;
}
function updateScoreboardWakeUi(message) {
  const status = $("scoreboardWakeStatus");
  const button = $("scoreboardWakeBtn");
  if (!status || !button) return;
  const active = !!state.scoreboardWakeLock && !state.scoreboardWakeLock.released;
  if (active) {
    status.textContent = "SCREEN AWAKE";
    button.textContent = "Wake lock · On";
    button.setAttribute("aria-pressed", "true");
    button.disabled = false;
  } else {
    status.textContent = message || ("wakeLock" in navigator ? "SCREEN MAY TURN OFF" : "KEEP AWAKE NOT SUPPORTED");
    button.textContent = "Keep awake";
    button.setAttribute("aria-pressed", "false");
    button.disabled = !("wakeLock" in navigator);
  }
}
async function requestScoreboardWakeLock() {
  if (!state.scoreboardOpen || !state.scoreboardWakeEnabled) return;
  if (!("wakeLock" in navigator)) {
    updateScoreboardWakeUi("KEEP AWAKE NOT SUPPORTED");
    return;
  }
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    state.scoreboardWakeLock = sentinel;
    sentinel.addEventListener("release", () => {
      if (state.scoreboardWakeLock === sentinel) state.scoreboardWakeLock = null;
      if (state.scoreboardOpen) updateScoreboardWakeUi();
    });
    updateScoreboardWakeUi();
  } catch (error) {
    updateScoreboardWakeUi("SCREEN MAY TURN OFF");
    console.info("Screen Wake Lock is unavailable in this browser or context.", error);
  }
}
function toggleScoreboardWakeLock() {
  if (state.scoreboardWakeLock && !state.scoreboardWakeLock.released) {
    state.scoreboardWakeEnabled = false;
    const lock = state.scoreboardWakeLock;
    state.scoreboardWakeLock = null;
    lock.release().catch(() => {});
    updateScoreboardWakeUi("SCREEN MAY TURN OFF");
    return;
  }
  state.scoreboardWakeEnabled = true;
  requestScoreboardWakeLock();
}
function openScoreboardMode() {
  if (!state.match) return;
  state.scoreboardOpen = true;
  state.scoreboardWakeEnabled = true;
  $("scoreboardMode").classList.remove("hidden");

  // Paint the most recently loaded score immediately from memory. Do not wait
  // for the next eight-second live poll before showing the current total.
  if (currentInnings()) {
    renderScore();
  } else {
    $("scoreboardScore").textContent = "—";
    $("scoreboardStatus").textContent = "LOADING MATCH DATA…";
  }

  // Refresh in the background so the first visible score is fast and fresh.
  const openingMatchId = state.match.id;
  refreshLiveMatch(openingMatchId).catch(error =>
    console.info("Could not refresh the scoreboard immediately; keeping the last loaded score.", error)
  );

  // Invoke both browser APIs directly from the user's tap while activation is available.
  if (document.documentElement.requestFullscreen) {
    try {
      document.documentElement.requestFullscreen({ navigationUI: "hide" })
        .catch(error => console.info("Browser full-screen mode is unavailable; using the in-page full-screen layout.", error));
    } catch (error) {
      console.info("Browser full-screen mode is unavailable; using the in-page full-screen layout.", error);
    }
  }
  requestScoreboardWakeLock();
}
function closeScoreboardMode(exitFullscreen = true) {
  if (!state.scoreboardOpen) return;
  state.scoreboardOpen = false;
  state.scoreboardWakeEnabled = false;
  $("scoreboardMode")?.classList.add("hidden");
  const lock = state.scoreboardWakeLock;
  state.scoreboardWakeLock = null;
  if (lock && !lock.released) lock.release().catch(() => {});
  if (exitFullscreen && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}
function renderFullscreenScoreboard(stats, chase, requiredRate, innings) {
  if (!state.scoreboardOpen || !state.match || !innings) return;
  $("scoreboardMatchTitle").textContent = state.match.team1 + "  vs  " + state.match.team2;
  $("scoreboardTournament").textContent = state.tournament?.name || "GroundScore";
  $("scoreboardBattingTeam").textContent = teamName(innings.batting_team);
  $("scoreboardInnings").textContent = (Number(innings.innings_no) === 1 ? "1ST" : "2ND") + " INNINGS";
  $("scoreboardScore").textContent = stats.total + "/" + stats.wickets;
  $("scoreboardOvers").textContent = stats.overs + " / " + state.match.overs + " OVERS";
  $("scoreboardStatus").textContent = state.match.status === "live" ? "LIVE SCORE · UPDATES AUTOMATICALLY" : "MATCH " + String(state.match.status || "").toUpperCase();
  const cards = chase ? [
    ["TARGET", chase.target],
    ["TO WIN", chase.runsRequired],
    ["BALLS LEFT", chase.ballsRemaining],
    ["REQUIRED RATE", Number.isFinite(requiredRate) ? requiredRate.toFixed(2) : "—"],
    ["CURRENT RATE", stats.runRateText]
  ] : [
    ["CURRENT RUN RATE", stats.runRateText],
    ["BALLS LEFT", Math.max(0, Number(state.match.overs) * 6 - stats.legalBalls)],
    ["WICKETS LEFT", Math.max(0, playersFor(innings.batting_team).length - 1 - stats.wickets)]
  ];
  $("scoreboardStats").innerHTML = cards.map(([label, value]) =>
    '<div class="scoreboard-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'
  ).join("");
}

function renderScore() {
  const innings = currentInnings();
  if (!innings) return;
  const stats = inningsStats(state.balls, innings.innings_no, state.match.overs);
  const first = state.innings.find(i => Number(i.innings_no) === 1);
  const chase = Number(state.match.current_innings) === 2
    ? chaseProgress(state.balls, 1, 2, state.match.overs)
    : null;
  const target = chase ? chase.target : null;
  const remaining = chase ? chase.ballsRemaining : Math.max(0, Number(state.match.overs) * 6 - stats.legalBalls);
  const runsNeeded = chase ? chase.runsRequired : null;
  const requiredRate = chase === null ? null : (remaining ? runsNeeded / (remaining / 6) : (runsNeeded ? Infinity : 0));
  $("matchTitle").textContent = state.match.team1 + " vs " + state.match.team2;
  $("matchSubTitle").textContent = (state.tournament?.name || "Friendly match") + " · " +
    (state.match.round_name || (state.match.overs + " overs"));
  $("matchStatus").textContent = state.match.status === "live" ? "LIVE" : state.match.status.toUpperCase();
  $("inningsLabel").textContent = (Number(state.match.current_innings) === 1 ? "1st" : "2nd") + " innings · " + teamName(innings.batting_team);
  $("scoreText").textContent = stats.total + "/" + stats.wickets;
  $("oversText").textContent = stats.overs + " / " + state.match.overs + " ov";
  $("targetText").textContent = target === null ? "" : "Target " + target;
  $("chaseFooter").classList.toggle("hidden", !chase || state.match.status !== "live");
  if (chase) {
    $("chaseRunsRequired").textContent = chase.runsRequired;
    $("chaseBallsRemaining").textContent = chase.ballsRemaining;
    $("chaseOversRemaining").textContent = chase.oversRemaining;
    $("chaseFooter").classList.toggle("chase-achieved", chase.reached);
  } else {
    $("chaseFooter").classList.remove("chase-achieved");
  }
  $("runRate").textContent = stats.runRateText;
  $("requiredRate").textContent = target === null ? "—" : (Number.isFinite(requiredRate) ? requiredRate.toFixed(2) : "—");
  renderFullscreenScoreboard(stats, chase, requiredRate, innings);
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
  // At an over boundary the engine deliberately leaves bowlerId blank until a
  // new bowler is selected. Resolve it from the actual dropdown selection.
  if (current.needsNewBowler && opening.bowlerId &&
      opening.bowlerId !== current.previousOverBowlerId) {
    current.bowlerId = opening.bowlerId;
  }
  const lastDelivery = activeBalls(innings.innings_no).slice(-1)[0];
  const afterWicket = !!lastDelivery?.wicket;
  let strikerSelection = current.strikerId || (afterWicket ? "" : opening.strikerId);
  let nonStrikerSelection = current.nonStrikerId || (afterWicket ? "" : opening.nonStrikerId);
  if (strikerSelection && nonStrikerSelection && strikerSelection === nonStrikerSelection) {
    // Repair invalid legacy/current UI state before it can be confirmed.
    nonStrikerSelection = "";
    state.lineupConfirmed = false;
  }
  state.current = current;
  const strikerOptions = batting.filter(player => player.id !== nonStrikerSelection);
  const nonStrikerOptions = batting.filter(player => player.id !== strikerSelection);
  fillSelect($("striker"), strikerOptions, strikerSelection, "Select striker");
  fillSelect($("nonStriker"), nonStrikerOptions, nonStrikerSelection, "Select non-striker");
  const availableBowlers = current.needsNewBowler ? bowling.filter(p => p.id !== current.previousOverBowlerId) : bowling;
  fillSelect($("bowler"), availableBowlers, current.bowlerId || opening.bowlerId, current.needsNewBowler ? "Choose new bowler" : "Select bowler");
  $("coinResultLarge").textContent = state.match.toss_result ? state.match.toss_result.toUpperCase() : "TOSS";
  const scorer = localScorer();
  const allOut = stats.wickets >= Math.max(1, batting.length - 1);
  const oversDone = stats.legalBalls >= Number(state.match.overs) * 6;
  const chaseDone = target !== null && stats.total >= target;
  const closed = allOut || oversDone || chaseDone;
  const canScore = !!scorer && !closed && state.match.status === "live";
  $("stickyStriker").textContent = playerName(current.strikerId || $("striker").value);
  $("stickyNonStriker").textContent = playerName(current.nonStrikerId || $("nonStriker").value);
  $("stickyBowler").textContent = playerName(current.bowlerId || $("bowler").value);
  $("coinResultLarge").textContent = state.match.toss_result ? state.match.toss_result.toUpperCase() : "TOSS";
  $("ballText").textContent = current.overNumber + "." + current.ballNumber + " · " + (current.needsNewBowler ? "New over — choose bowler" : "Next delivery");
  const hasOpeningSelection = !!($("striker").value && $("nonStriker").value &&
    $("striker").value !== $("nonStriker").value && $("bowler").value);
  const needsBatterConfirm = state.pendingBatterReview;
  $("lineupHint").textContent = !scorer ? "Join this tournament to score. You are viewing as a spectator." :
    (current.needsNewBowler && !current.bowlerId ? "OVER COMPLETE — select a different bowler to continue." :
    (needsBatterConfirm ? "NEW BATTER — check the batting pair and confirm before the next ball." :
    (activeBalls(innings.innings_no).length === 0 ? "Choose the opening pair and bowler, then confirm." :
    (current.needsNewBowler ? "New bowler selected ✓" : "Scoring as " + scorer))));
  $("confirmLineupBtn").setAttribute("aria-label", state.lineupConfirmed ? "Players confirmed" :
    (needsBatterConfirm ? "Confirm new batters" : "Confirm players"));
  $("confirmLineupBtn").title = state.lineupConfirmed ? "Players confirmed" : "Confirm selected players";
  $("confirmLineupBtn").classList.toggle("confirmed", state.lineupConfirmed);
  $("confirmLineupBtn").classList.toggle("needs-attention", needsBatterConfirm || (!state.lineupConfirmed && hasOpeningSelection));
  $("lineupStatusDot").classList.toggle("confirmed", state.lineupConfirmed);
  $("lineupStatusDot").classList.toggle("needs-attention", needsBatterConfirm || (!state.lineupConfirmed && hasOpeningSelection));
  $("confirmLineupBtn").disabled = !scorer || !hasOpeningSelection || closed || state.saving;
  $("scoreSavingIndicator").classList.toggle("hidden", !state.saving);
  $("bowler").classList.toggle("needs-attention", !!(current.needsNewBowler && !current.bowlerId));
  $("striker").classList.toggle("needs-attention", needsBatterConfirm);
  $("nonStriker").classList.toggle("needs-attention", needsBatterConfirm);
  const canSubmit = canScore && state.lineupConfirmed && !needsBatterConfirm &&
    !!current.strikerId && !!current.nonStrikerId && !!current.bowlerId && !state.saving;
  document.querySelectorAll("[data-quick-run],#openExtrasBtn,#openWicketBtn,#confirmQuickExtrasBtn,#confirmQuickWicketBtn")
    .forEach(button => { button.disabled = !canSubmit; });
  $("undoBtn").disabled = !scorer || !activeBalls(innings.innings_no).length || state.saving;
  $("endInningsBtn").disabled = !scorer;
  $("endInningsBtn").textContent = target !== null && chaseDone ? "Finish chase →" : "End innings →";
  $("scoreError").textContent = closed ? (allOut ? "All out — end the innings." : oversDone ? "Over limit reached — end the innings." : "Target reached — finish the chase.") : "";
  renderOverStrip(innings.innings_no);
  syncScoreStickyOffset();
}
function syncScoreStickyOffset() {
  const sticky = $("matchSticky");
  if (!sticky) return;
  const apply = () => $("scoreView").style.setProperty("--scorebar-height", sticky.getBoundingClientRect().height + "px");
  if (window.requestAnimationFrame) window.requestAnimationFrame(apply);
  else apply();
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
    const label = deliveryNotation(ball);
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
async function submitDelivery(input, sourceButton = null) {
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
  const saveStartedAt = Date.now();
  if (sourceButton) {
    sourceButton.classList.add("score-saving");
    sourceButton.setAttribute("aria-busy", "true");
  }
  renderScore();
  document.querySelectorAll("[data-quick-run],#openExtrasBtn,#openWicketBtn,#confirmQuickExtrasBtn,#confirmQuickWicketBtn").forEach(button => button.disabled = true);
  try {
    const before = inningsStats(state.balls, innings.innings_no, state.match.overs);
    const previousBatterRuns = activeBalls(innings.innings_no)
      .filter(b => b.striker_id === ball.striker_id)
      .reduce((sum,b) => sum + Number(b.runs_off_bat || 0), 0);
    await api("balls", { method: "POST", body: JSON.stringify(ball) });
    state.pendingKey = null;
    closeQuickPopups();
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
    // Keep the feedback visible long enough to register even on a fast connection.
    const feedbackTime = Math.max(0, 240 - (Date.now() - saveStartedAt));
    if (feedbackTime) await new Promise(resolve => setTimeout(resolve, feedbackTime));
    state.saving = false;
    if (sourceButton) {
      sourceButton.classList.remove("score-saving");
      sourceButton.removeAttribute("aria-busy");
    }
    renderScore();
  }
}
function quickRun(runs, sourceButton) {
  submitDelivery({ batRuns: Number(runs) }, sourceButton);
}
function closeQuickPopups() {
  $("quickExtrasPopup").classList.add("hidden");
  $("quickWicketPopup").classList.add("hidden");
}
function renderQuickExtras() {
  document.querySelectorAll("[data-extra-type]").forEach(button =>
    button.classList.toggle("selected", button.dataset.extraType === state.quickExtraType)
  );
  document.querySelectorAll("[data-extra-runs]").forEach(button =>
    button.classList.toggle("selected", Number(button.dataset.extraRuns) === state.quickExtraRuns)
  );
  const label = state.quickExtraType === "wide" ? "Wide" : "No-ball";
  $("quickExtrasSummary").textContent =
    label + " · 1 automatic penalty + " + state.quickExtraRuns + " additional run(s)";
  $("confirmQuickExtrasBtn").textContent = "Record " + label.toLowerCase();
}
function openExtras() {
  if (state.saving) return;
  state.quickExtraType = "wide";
  state.quickExtraRuns = 0;
  renderQuickExtras();
  $("quickExtrasPopup").classList.remove("hidden");
}
function selectQuickExtraType(type) {
  if (!["wide", "no-ball"].includes(type)) return;
  state.quickExtraType = type;
  renderQuickExtras();
}
function selectQuickExtraRuns(runs) {
  const value = Number(runs);
  if (!Number.isInteger(value) || value < 0 || value > 6) return;
  state.quickExtraRuns = value;
  renderQuickExtras();
}
function saveQuickExtras() {
  submitDelivery({
    extraType: state.quickExtraType,
    batRuns: 0,
    extraRuns: state.quickExtraRuns
  }, $("confirmQuickExtrasBtn"));
}
function openWicket() {
  if (state.saving) return;
  const innings = currentInnings();
  if (!innings) return;
  const current = currentBattingState(state.balls, innings.innings_no, currentLineup());
  const currentIds = [current.strikerId, current.nonStrikerId].filter(Boolean);
  const choices = currentIds.map(id => state.players.find(player => player.id === id)).filter(Boolean);
  if (!choices.length) {
    toast("Select the current batters before recording a wicket");
    return;
  }
  state.quickWicketBatterId = current.strikerId && choices.some(p => p.id === current.strikerId)
    ? current.strikerId : choices[0].id;
  $("quickWicketPlayers").innerHTML = choices.map(player => {
    const role = player.id === current.strikerId ? "STRIKER" : "NON-STRIKER";
    return '<button type="button" class="wicket-player-chip ' +
      (player.id === state.quickWicketBatterId ? "selected" : "") +
      '" data-wicket-batter="' + esc(player.id) + '">' +
      '<small>' + role + '</small><strong>' + esc(player.name) + '</strong></button>';
  }).join("");
  $("quickWicketPopup").classList.remove("hidden");
}
function selectQuickWicketBatter(playerId) {
  if (!playerId || !$("quickWicketPlayers").querySelector('[data-wicket-batter="' + CSS.escape(playerId) + '"]')) return;
  state.quickWicketBatterId = playerId;
  $("quickWicketPlayers").querySelectorAll("[data-wicket-batter]").forEach(button =>
    button.classList.toggle("selected", button.dataset.wicketBatter === playerId)
  );
}
function saveQuickWicket() {
  if (!state.quickWicketBatterId) {
    toast("Choose which batter is out");
    return;
  }
  // The scorer selects the replacement batter on the crease panel after this
  // generic wicket is recorded. No dismissal-type selection is needed here.
  submitDelivery({
    wicket: "wicket",
    dismissedBatsmanId: state.quickWicketBatterId
  }, $("confirmQuickWicketBtn"));
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
async function completeMatchIfTargetReached() {
  if (!state.match || state.match.status !== "live" ||
      Number(state.match.current_innings) !== 2 || state.autoCompleting) return false;
  const chase = chaseProgress(state.balls, 1, 2, state.match.overs);
  if (!chase.reached) return false;
  state.autoCompleting = true;
  try {
    const innings = currentInnings();
    const finishedAt = new Date().toISOString();
    if (innings && innings.status !== "completed") {
      await api("innings?id=eq." + innings.id, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        prefer: "return=minimal"
      });
      innings.status = "completed";
    }
    await api("matches?id=eq." + state.match.id, {
      method: "PATCH",
      body: JSON.stringify({
        status: "finished",
        finished_at: finishedAt,
        updated_at: finishedAt
      }),
      prefer: "return=minimal"
    });
    state.match.status = "finished";
    state.match.finished_at = finishedAt;
    stopPolling();
    renderSummary();
    showView("summaryView");
    toast("Target reached — match completed!");
    return true;
  } catch (error) {
    toast("Target reached, but match completion could not be saved: " + error.message);
    return false;
  } finally {
    state.autoCompleting = false;
  }
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
  if (ball.extra_type === "wide") return "WIDE " + deliveryNotation(ball);
  if (ball.extra_type === "no-ball") return "NO BALL " + deliveryNotation(ball);
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
  const previousWinnerChoice = String(state.match.round_name || "").toLowerCase().startsWith("rematch");
  $("summaryToss").textContent = (previousWinnerChoice
    ? state.match.toss_winner + " won the previous match and chose to " + state.match.toss_decision
    : "Toss: " + state.match.toss_winner + " chose to " + state.match.toss_decision) +
    (state.tournament ? " · " + state.tournament.name : "");
  const rematchCta = $("rematchCta");
  const canRematch = !!(state.tournament?.id && result.winner && state.match.team1 && state.match.team2);
  rematchCta.classList.toggle("hidden", !canRematch);
  if (canRematch) {
    const winnerName = result.winner === "team1" ? state.match.team1 : state.match.team2;
    $("rematchDescription").textContent = winnerName + " won this match and gets to choose bat or bowl first in the next match.";
    $("startRematchBtn").textContent = "Start next match · " + state.match.team1 + " vs " + state.match.team2;
  }
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
  renderFinalScorecard();
}
async function startNextMatchWithSameTeams() {
  if (!state.match || !state.tournament?.id) {
    toast("A tournament match is required to start a rematch.");
    return;
  }
  const result = matchResult(state.innings, state.balls, state.players, state.match);
  if (!result.winner) {
    toast("This match has no winner. Start a regular match from the tournament instead.");
    return;
  }
  const sourceMatch = { ...state.match };
  const winnerName = result.winner === "team1" ? sourceMatch.team1 : sourceMatch.team2;
  const squads = {
    team1: state.players.filter(player => player.team === "team1").map(player => player.name),
    team2: state.players.filter(player => player.team === "team2").map(player => player.name)
  };
  if (!squads.team1.length && sourceMatch.team1_id) {
    squads.team1 = (await api("team_players?team_id=eq." + sourceMatch.team1_id + "&select=*&order=name.asc")).map(player => player.name);
  }
  if (!squads.team2.length && sourceMatch.team2_id) {
    squads.team2 = (await api("team_players?team_id=eq." + sourceMatch.team2_id + "&select=*&order=name.asc")).map(player => player.name);
  }
  if (!squads.team1.length || !squads.team2.length) {
    toast("The previous playing squads could not be loaded. Start a regular match and select the squads.");
    return;
  }
  await startMatchSetup({
    rematch: {
      match: sourceMatch,
      winnerKey: result.winner,
      winnerName,
      squads
    }
  });
}
function renderFinalScorecard() {
  $("finalScorecard").innerHTML = state.innings.map(innings => {
    const batters = playersFor(innings.batting_team);
    const bowlers = playersFor(innings.bowling_team);
    const score = inningsStats(state.balls, innings.innings_no, state.match.overs);
    const battingFigures = battingScorecard(state.balls, batters, innings.innings_no);
    const bowlingFigures = bowlingScorecard(state.balls, bowlers, innings.innings_no);
    const battingTable = htmlTable(
      ["Batter","Dismissal","R","B","4s","6s","SR"],
      battingFigures.map(p => [esc(p.name), esc(p.dismissal), p.runs, p.balls, p.fours, p.sixes, p.strikeRate.toFixed(1)]),
      "No batting figures."
    );
    const bowlingTable = htmlTable(
      ["Bowler","O","M","R","W","Eco"],
      bowlingFigures.map(p => [esc(p.name), p.overs, p.maidens, p.runs, p.wickets, p.economy.toFixed(2)]),
      "No bowling figures."
    );
    const extra = score.extras;
    const extrasTotal = extra.wides + extra.noBalls + extra.byes + extra.legByes;
    const fow = fallOfWickets(state.balls, innings.innings_no, state.players);
    const fowHtml = fow.length ? fow.map(item =>
      '<span class="fow-item">' + item.wicket + '/' + item.score + ' · ' + esc(item.batter) + ' (' + item.overs + ')</span>'
    ).join("") : '<span class="muted">No wickets</span>';
    return '<article class="card final-innings-card">' +
      '<div class="final-innings-heading"><div><span class="eyebrow">INNINGS ' + innings.innings_no + '</span><h3>' +
      esc(teamName(innings.batting_team)) + '</h3></div><strong>' + score.total + '/' + score.wickets +
      '<small>' + score.overs + ' overs · RR ' + score.runRateText + '</small></strong></div>' +
      '<h4>Batting</h4>' + battingTable + '<h4>Bowling</h4>' + bowlingTable +
      '<div class="final-extras"><strong>Extras ' + extrasTotal + '</strong><span>WD ' + extra.wides +
      ' · NB ' + extra.noBalls + ' · B ' + extra.byes + ' · LB ' + extra.legByes + '</span></div>' +
      '<div class="fall-of-wickets"><strong>Fall of wickets</strong><div>' + fowHtml + '</div></div>' +
      '</article>';
  }).join("");
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
async function renderTournamentMetrics() {
  const target = $("tournamentMetrics");
  target.innerHTML = '<div class="skeleton">Calculating tournament metrics…</div>';
  const matches = state.tournamentMatches || [];
  if (!matches.length) {
    target.innerHTML = '<div class="empty">No matches yet. Tournament metrics will appear after the first match.</div>';
    return;
  }
  const matchIds = matches.map(match => match.id).filter(Boolean);
  if (!matchIds.length) {
    target.innerHTML = '<div class="empty">No match data available yet.</div>';
    return;
  }
  const matchFilter = "in.(" + matchIds.join(",") + ")";
  const [balls, players] = await Promise.all([
    api("balls?match_id=" + matchFilter + "&select=*&order=delivery_number.asc&limit=10000"),
    api("players?match_id=" + matchFilter + "&select=*&limit=10000")
  ]);
  const matchById = new Map(matches.map(match => [match.id, match]));
  const playerByMatchId = new Map();
  const playerTotals = new Map();

  players.forEach(player => {
    const match = matchById.get(player.match_id);
    if (!match) return;
    const team = player.team === "team1" ? match.team1 : match.team2;
    const name = String(player.name || "Unknown player").trim();
    const key = name.toLocaleLowerCase() + "|" + String(team || "").toLocaleLowerCase();
    if (!playerTotals.has(key)) {
      playerTotals.set(key, { name, team: team || "Unknown team", runs:0, wickets:0, sixes:0, fours:0, dots:0 });
    }
    playerByMatchId.set(player.match_id + ":" + player.id, playerTotals.get(key));
  });

  let totalRuns = 0, totalWickets = 0, activeDeliveries = 0;
  balls.forEach(ball => {
    if (ball.voided_at) return;
    activeDeliveries += 1;
    const total = Number(ball.total_runs || 0);
    const batRuns = Number(ball.runs_off_bat || 0);
    totalRuns += total;
    if (ball.wicket) totalWickets += 1;

    const batter = playerByMatchId.get(ball.match_id + ":" + ball.striker_id);
    if (batter) {
      batter.runs += batRuns;
      if (ball.is_boundary && batRuns === 6) batter.sixes += 1;
      if (ball.is_boundary && batRuns === 4) batter.fours += 1;
    }
    const bowler = playerByMatchId.get(ball.match_id + ":" + ball.bowler_id);
    if (bowler) {
      // Older typed run-outs are excluded from bowler wickets. New quick
      // wickets are generic and are counted against the current bowler.
      if (ball.wicket && ball.wicket !== "run out") bowler.wickets += 1;
      if (!["wide", "no-ball"].includes(ball.extra_type) && total === 0) bowler.dots += 1;
    }
  });

  const metrics = [
    { key:"runs", title:"Most runs", detail:"Batting runs" },
    { key:"wickets", title:"Most wickets", detail:"Wickets credited to bowlers" },
    { key:"sixes", title:"Most sixes", detail:"Sixes hit" },
    { key:"fours", title:"Most fours", detail:"Fours hit" },
    { key:"dots", title:"Most dots", detail:"Legal dot balls bowled" }
  ];
  const cards = metrics.map(metric => {
    const leaders = [...playerTotals.values()]
      .filter(player => player[metric.key] > 0)
      .sort((a,b) => b[metric.key] - a[metric.key] || a.name.localeCompare(b.name))
      .slice(0,5);
    const rows = leaders.length ? leaders.map((player,index) =>
      '<li class="metric-leader"><span class="metric-rank">' + (index + 1) +
      '</span><span class="metric-player"><strong>' + esc(player.name) +
      '</strong><small>' + esc(player.team) + '</small></span><strong class="metric-value">' +
      player[metric.key] + '</strong></li>'
    ).join("") : '<li class="metric-empty">No records yet</li>';
    return '<article class="metric-card"><div class="metric-card-heading"><div><span class="eyebrow">' +
      esc(metric.detail) + '</span><h3>' + esc(metric.title) +
      '</h3></div><span class="metric-card-icon">' + ({
        runs:"R", wickets:"W", sixes:"6", fours:"4", dots:"·"
      })[metric.key] + '</span></div><ol class="metric-leader-list">' + rows + '</ol></article>';
  }).join("");

  target.innerHTML =
    '<div class="metrics-summary">' +
      '<div><span>MATCHES</span><strong>' + matches.length + '</strong></div>' +
      '<div><span>RUNS SCORED</span><strong>' + totalRuns + '</strong></div>' +
      '<div><span>WICKETS</span><strong>' + totalWickets + '</strong></div>' +
      '<div><span>DELIVERIES</span><strong>' + activeDeliveries + '</strong></div>' +
    '</div><div class="metrics-grid">' + cards + '</div>' +
    '<p class="metrics-footnote">Figures include all recorded match deliveries and exclude voided balls. Dot balls count legal deliveries with zero runs. Historical run-outs are not credited to bowlers.</p>';
}
async function backToTournament() {
  if (!state.tournament) { await loadHome(); return; }
  await openTournament(state.tournament.id);
  setActiveTournamentTab("matches");
}

function attachEvents() {
  bind("startTournamentBtn","click",() => showView("tournamentCreateView"));
  bind("joinTournamentBtn","click",() => withLoader("Finding tournaments…", listTournaments).catch(showError));
  bind("reloadHomeBtn","click",() => withLoader("Refreshing the ground…", loadHome).catch(showError));
  bind("createTournamentBtn","click",() => withLoader("Creating your tournament…", createTournament).catch(showError));
  bind("backHomeBtn","click",() => withLoader("Returning home…", loadHome).catch(showError));
  bind("joinBackBtn","click",() => withLoader("Loading tournaments…", listTournaments).catch(showError));
  bind("confirmJoinBtn","click",() => withLoader("Joining tournament…", confirmJoin).catch(showError));
  bind("viewTournamentBtn","click",() => withLoader("Opening tournament…", () => openTournament(state.tournament.id)).catch(showError));
  bind("tournamentHomeBtn","click",() => withLoader("Returning home…", loadHome).catch(showError));
  bind("tournamentJoinBtn","click",() => withLoader("Opening player check-in…", () => openJoin(state.tournament.id)).catch(showError));
  bind("tournamentNewMatchBtn","click",() => withLoader("Preparing match setup…", startMatchSetup).catch(showError));
  bind("refreshTournamentBtn","click",() => withLoader("Refreshing fixtures…", refreshTournament).catch(showError));
  bind("refreshMetricsBtn","click",() => renderTournamentMetrics().catch(showError));
  bind("openDeleteTournamentBtn","click",openDeleteTournamentSheet);
  bind("closeDeleteTournamentBtn","click",closeDeleteTournamentSheet);
  bind("cancelDeleteTournamentBtn","click",closeDeleteTournamentSheet);
  bind("confirmDeleteTournamentBtn","click",deleteTournamentPermanently);
  bind("deleteTournamentSheet","click",event => {
    if (event.target.id === "deleteTournamentSheet") closeDeleteTournamentSheet();
  });
  bind("addTeamBtn","click",() => withLoader("Saving team and squad…", createTeam).catch(showError));
  bind("matchSetupBackBtn","click",() => withLoader("Returning to tournament…", backToTournament).catch(showError));
  bind("createMatchBtn","click",() => withLoader("Setting up the match…", createMatch).catch(showError));
  bind("tossCallHeads","click",() => chooseTossCall("heads"));
  bind("tossCallTails","click",() => chooseTossCall("tails"));
  bind("flipCoinBtn","click",flipCoin);
  bind("chooseBatFirstBtn","click",() => chooseTossDecision("bat"));
  bind("chooseBowlFirstBtn","click",() => chooseTossDecision("bowl"));
  bind("rematchBatFirstBtn","click",() => chooseTossDecision("bat"));
  bind("rematchBowlFirstBtn","click",() => chooseTossDecision("bowl"));
  bind("confirmLineupBtn","click",confirmLineup);
  bind("openExtrasBtn","click",openExtras);
  bind("openWicketBtn","click",openWicket);
  bind("undoBtn","click",undoBall);
  bind("endInningsBtn","click",endInnings);
  bind("finishMatchBtn","click",() => finishMatch(false).catch(showError));
  bind("shareMatchBtn","click",shareMatch);
  bind("scoreboardModeBtn","click",openScoreboardMode);
  bind("closeScoreboardBtn","click",() => closeScoreboardMode());
  bind("scoreboardWakeBtn","click",toggleScoreboardWakeLock);
  bind("scoreboardMode","click",event => { if (event.target.id === "scoreboardMode") closeScoreboardMode(); });
  document.addEventListener("visibilitychange", () => {
    if (state.scoreboardOpen && !document.hidden && state.scoreboardWakeEnabled &&
        (!state.scoreboardWakeLock || state.scoreboardWakeLock.released)) requestScoreboardWakeLock();
  });
  document.addEventListener("fullscreenchange", () => {
    if (state.scoreboardOpen && state.scoreboardFullscreenEntered && !document.fullscreenElement) closeScoreboardMode(false);
    state.scoreboardFullscreenEntered = !!document.fullscreenElement;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.scoreboardOpen) closeScoreboardMode();
    else if (event.key === "Escape") closeQuickPopups();
  });
  bind("refreshBtn","click",() => withLoader("Refreshing scorecard…", () => loadMatch(state.match.id)).catch(showError));
  bind("backToTournamentBtn","click",() => withLoader("Opening tournament…", backToTournament).catch(showError));
  bind("summaryTournamentBtn","click",() => withLoader("Opening tournament…", backToTournament).catch(showError));
  bind("startRematchBtn","click",() => withLoader("Preparing the rematch…", startNextMatchWithSameTeams).catch(showError));
  bind("homeBtn","click",() => withLoader("Returning home…", loadHome).catch(showError));
  bind("brandHomeBtn","click",() => withLoader("Returning home…", loadHome).catch(showError));
  bind("milestoneClose","click",() => $("milestoneOverlay").classList.add("hidden"));
  bind("tossDecisionSheet","click",event => { if(event.target.id === "tossDecisionSheet") { /* winner must choose */ } });

  bind("quickExtrasTypes","click",event => {
    const button = event.target.closest("[data-extra-type]");
    if (button) selectQuickExtraType(button.dataset.extraType);
  });
  bind("quickExtrasRuns","click",event => {
    const button = event.target.closest("[data-extra-runs]");
    if (button) selectQuickExtraRuns(button.dataset.extraRuns);
  });
  bind("quickWicketPlayers","click",event => {
    const button = event.target.closest("[data-wicket-batter]");
    if (button) selectQuickWicketBatter(button.dataset.wicketBatter);
  });
  bind("confirmQuickExtrasBtn","click",saveQuickExtras);
  bind("confirmQuickWicketBtn","click",saveQuickWicket);
  bind("quickExtrasCancelBtn","click",closeQuickPopups);
  bind("quickWicketCancelBtn","click",closeQuickPopups);
  bind("quickExtrasPopup","click",event => {
    if (event.target.id === "quickExtrasPopup") closeQuickPopups();
  });
  bind("quickWicketPopup","click",event => {
    if (event.target.id === "quickWicketPopup") closeQuickPopups();
  });
  bind("team1","change",() => { resetTossUI(); onTeamNameChange("team1","team1").catch(showError); });
  bind("team2","change",() => { resetTossUI(); onTeamNameChange("team2","team2").catch(showError); });
  bind("addPlayers1Btn","click",() => addSquadEntry("team1"));
  bind("addPlayers2Btn","click",() => addSquadEntry("team2"));
  bind("addTeamPlayerBtn","click",() => addSquadEntry("teamCreation"));
  ["players1Input","players2Input","newTeamPlayerInput"].forEach((id,index) => {
    const keys = ["team1","team2","teamCreation"];
    bind(id,"keydown",event => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        addSquadEntry(keys[index]);
      }
    });
    bind(id,"blur",() => { if ($(id).value.trim()) addSquadEntry(keys[index]); });
  });
  document.addEventListener("click",event => {
    const button = event.target.closest("[data-remove-squad]");
    if (button) removeSquadEntry(button.dataset.removeSquad, Number(button.dataset.index));
  });
  bind("striker","change",() => { if (!activeBalls(state.match?.current_innings || 0).length) state.lineupConfirmed = false; setBatterSelection("striker"); });
  bind("nonStriker","change",() => { if (!activeBalls(state.match?.current_innings || 0).length) state.lineupConfirmed = false; setBatterSelection("nonStriker"); });
  bind("bowler","change",() => { if (state.match) { renderScore(); } });
  document.querySelectorAll("[data-home]").forEach(button => button.addEventListener("click", () => withLoader("Returning home…", loadHome).catch(showError)));
  document.querySelectorAll("[data-score-tab]").forEach(button =>
    button.addEventListener("click", () => setActiveScoreTab(button.dataset.scoreTab))
  );
  document.querySelectorAll("[data-tournament-tab]").forEach(button =>
    button.addEventListener("click", () => setActiveTournamentTab(button.dataset.tournamentTab))
  );
  document.querySelectorAll("[data-quick-run]").forEach(button =>
    button.addEventListener("click", () => quickRun(button.dataset.quickRun, button))
  );

  window.addEventListener("online", setNetwork);
  window.addEventListener("offline", setNetwork);
  window.addEventListener("beforeunload", stopPolling);
}

attachEvents();
withLoader("Setting up the ground…", init).catch(error => {
  $("configNotice").classList.remove("hidden");
  $("configNotice").textContent = "GroundScore could not start: " + error.message;
});
