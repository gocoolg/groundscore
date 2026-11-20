const BOWLER_WICKETS = new Set(["bowled", "caught", "lbw", "stumped", "hit wicket"]);
const EXTRAS = new Set(["wide", "no-ball", "bye", "leg-bye"]);
const WICKETS = new Set(["bowled", "caught", "lbw", "run out", "stumped", "hit wicket"]);

export function isActiveDelivery(ball) {
  return !ball.voided_at;
}
export function isLegalDelivery(ball) {
  return isActiveDelivery(ball) && !["wide", "no-ball"].includes(ball.extra_type);
}
export function formatOvers(legalBalls) {
  return Math.floor(legalBalls / 6) + "." + (legalBalls % 6);
}
function num(value) { return Number(value || 0); }
function activeInningsBalls(balls, inningsNo) {
  return (balls || []).filter(b => b.innings_no === inningsNo && isActiveDelivery(b));
}
function orderedBalls(balls) {
  return [...(balls || [])].sort((a, b) =>
    num(a.delivery_number || 0) - num(b.delivery_number || 0) ||
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
}
export function inningsStats(balls, inningsNo, oversLimit = 0) {
  const rows = activeInningsBalls(balls, inningsNo);
  const total = rows.reduce((sum, b) => sum + num(b.total_runs), 0);
  const wickets = rows.filter(b => !!b.wicket).length;
  const legalBalls = rows.filter(isLegalDelivery).length;
  const extras = rows.reduce((acc, b) => {
    acc.wides += num(b.wide_runs) || (b.extra_type === "wide" ? num(b.extra_runs) : 0);
    acc.noBalls += num(b.no_ball_runs) || (b.extra_type === "no-ball" ? 1 : 0);
    acc.byes += num(b.bye_runs) || (b.extra_type === "bye" ? num(b.extra_runs) : 0);
    acc.legByes += num(b.leg_bye_runs) || (b.extra_type === "leg-bye" ? num(b.extra_runs) : 0);
    return acc;
  }, { wides: 0, noBalls: 0, byes: 0, legByes: 0 });
  const runRate = legalBalls ? total / (legalBalls / 6) : 0;
  return {
    balls: rows, total, wickets, legalBalls, overs: formatOvers(legalBalls),
    runRate, runRateText: runRate.toFixed(2), extras,
    oversRemaining: oversLimit ? Math.max(0, oversLimit * 6 - legalBalls) : null
  };
}
export function currentBattingState(balls, inningsNo, opening = {}) {
  const rows = orderedBalls(activeInningsBalls(balls, inningsNo));
  const last = rows[rows.length - 1];
  if (!last) return {
    strikerId: opening.strikerId || "",
    nonStrikerId: opening.nonStrikerId || "",
    bowlerId: opening.bowlerId || "",
    legalBalls: 0,
    ballNumber: 1,
    overNumber: 0,
    needsNewBowler: false,
    previousOverBowlerId: ""
  };
  const legalBalls = rows.filter(isLegalDelivery).length;
  const lastLegal = [...rows].reverse().find(isLegalDelivery);
  const needsNewBowler = legalBalls > 0 && legalBalls % 6 === 0;
  const previousOverBowlerId = needsNewBowler
    ? (lastLegal && num(lastLegal.ball_number) === 6 ? lastLegal.bowler_id : "")
    : "";
  // A wicket with no incoming batter must leave that end empty rather than
  // falling back to the dismissed batter from the delivery record.
  const strikerId = last.wicket
    ? (last.next_striker_id || "")
    : (last.next_striker_id || last.striker_id || "");
  const nonStrikerId = last.wicket
    ? (last.next_non_striker_id || "")
    : (last.next_non_striker_id || last.non_striker_id || "");
  return {
    strikerId,
    nonStrikerId,
    bowlerId: needsNewBowler ? "" : (last.bowler_id || ""),
    legalBalls,
    ballNumber: (legalBalls % 6) + 1,
    overNumber: Math.floor(legalBalls / 6),
    needsNewBowler,
    previousOverBowlerId
  };
}
export function buildDelivery(input) {
  const {
    matchId, inningsNo, balls = [], players = [], strikerId, nonStrikerId, bowlerId,
    batRuns = 0, extraType = "", extraRuns = 0, wicket = "", dismissedBatsmanId = "",
    incomingBatterId = "", crossedBeforeWicket = false, scorerName = "", oversLimit = 0
  } = input;
  const rows = orderedBalls(balls);
  const active = rows.filter(b => b.innings_no === inningsNo && isActiveDelivery(b));
  const state = currentBattingState(rows, inningsNo, { strikerId, nonStrikerId, bowlerId });
  const striker = strikerId || state.strikerId;
  const nonStriker = nonStrikerId || state.nonStrikerId;
  const bowler = bowlerId || state.bowlerId;
  const bat = Number(batRuns);
  const extras = Number(extraRuns);
  const errors = [];
  if (!matchId || !inningsNo) errors.push("Match and innings are required.");
  if (!scorerName || !scorerName.trim()) errors.push("Select a scorer name.");
  if (!striker || !nonStriker || !bowler) errors.push("Select the striker, non-striker and current bowler.");
  if (striker && nonStriker && striker === nonStriker) errors.push("Striker and non-striker must be different players.");
  if (![0,1,2,3,4,5,6].includes(bat)) errors.push("Runs off bat must be between 0 and 6.");
  if (!Number.isInteger(extras) || extras < 0 || extras > 5) errors.push("Additional runs must be between 0 and 5.");
  if (extraType && !EXTRAS.has(extraType)) errors.push("Select a valid extra type.");
  if (wicket && !WICKETS.has(wicket)) errors.push("Select a supported dismissal type.");
  if (extraType === "wide" && bat !== 0) errors.push("A wide cannot be recorded as runs off the bat.");
  if (["bye", "leg-bye"].includes(extraType) && bat !== 0) errors.push("Byes and leg-byes must be entered as extras, not bat runs.");
  if (!extraType && extras > 0) errors.push("Choose an extra type before entering extra runs.");
  if (extraType === "wide" && wicket && !["run out", "stumped"].includes(wicket)) errors.push("A wide can only be recorded with a run-out or stumping in this scorer.");
  if (extraType === "no-ball" && wicket && wicket !== "run out") errors.push("A no-ball can only be recorded with a run-out in this scorer.");
  if (wicket && wicket !== "run out" && (bat > 0 || extras > 0)) errors.push("For this dismissal, record a dot ball. Use run-out for completed runs.");
  if (wicket && ![striker, nonStriker].includes(dismissedBatsmanId)) errors.push("Choose which batter was dismissed.");
  if (!wicket && dismissedBatsmanId) errors.push("Dismissed batter is only valid when a wicket is selected.");
  const dismissedBefore = new Set(active.filter(b => b.wicket && b.dismissed_batsman_id).map(b => b.dismissed_batsman_id));
  if (striker && dismissedBefore.has(striker)) errors.push("The selected striker has already been dismissed.");
  if (nonStriker && dismissedBefore.has(nonStriker)) errors.push("The selected non-striker has already been dismissed.");
  const battingPlayers = players.filter(p => p.team === input.battingTeam);
  const bowlingPlayers = players.filter(p => p.team === input.bowlingTeam);
  if (striker && !battingPlayers.some(p => p.id === striker)) errors.push("Striker must belong to the batting team.");
  if (nonStriker && !battingPlayers.some(p => p.id === nonStriker)) errors.push("Non-striker must belong to the batting team.");
  if (bowler && input.bowlingTeam && !bowlingPlayers.some(p => p.id === bowler)) errors.push("Bowler must belong to the bowling team.");
  const availableIncoming = battingPlayers.filter(p =>
    !dismissedBefore.has(p.id) && p.id !== striker && p.id !== nonStriker
  );
  if (wicket && availableIncoming.length && (!incomingBatterId || !availableIncoming.some(p => p.id === incomingBatterId))) {
    errors.push("Choose an eligible incoming batter.");
  }
  if (wicket && incomingBatterId && (incomingBatterId === striker || incomingBatterId === nonStriker || dismissedBefore.has(incomingBatterId))) {
    errors.push("Incoming batter must be an unused player.");
  }
  const currentStats = inningsStats(rows, inningsNo, oversLimit);
  if (oversLimit && currentStats.legalBalls >= oversLimit * 6) errors.push("The over limit has been reached.");
  if (battingPlayers.length && currentStats.wickets >= battingPlayers.length - 1) errors.push("The batting side is all out.");
  if (state.needsNewBowler && bowler && bowler === state.previousOverBowlerId) errors.push("The same bowler cannot bowl consecutive overs.");
  if (errors.length) return { ok: false, errors };

  const penalty = extraType === "wide" || extraType === "no-ball" ? 1 : 0;
  const totalExtras = extras + penalty;
  const completedRuns = bat + extras;
  const totalRuns = bat + totalExtras;
  const legal = !["wide", "no-ball"].includes(extraType);
  const ballNo = state.ballNumber;
  const overNo = state.overNumber;

  let nextStriker = striker;
  let nextNonStriker = nonStriker;
  if (completedRuns % 2) [nextStriker, nextNonStriker] = [nextNonStriker, nextStriker];
  if (legal && ballNo === 6) [nextStriker, nextNonStriker] = [nextNonStriker, nextStriker];
  if (wicket) {
    if (nextStriker === dismissedBatsmanId) nextStriker = incomingBatterId || null;
    else if (nextNonStriker === dismissedBatsmanId) nextNonStriker = incomingBatterId || null;
  }
  const highestSequence = rows.reduce((highest, b) => Math.max(highest, Number(b.delivery_number || 0)), 0);
  const ball = {
    match_id: matchId,
    innings_no: inningsNo,
    delivery_number: highestSequence + 1,
    over_number: overNo,
    ball_number: ballNo,
    striker_id: striker,
    non_striker_id: nonStriker,
    bowler_id: bowler,
    runs: bat,
    runs_off_bat: bat,
    extra_type: extraType || null,
    extra_runs: totalExtras,
    wide_runs: extraType === "wide" ? 1 + extras : 0,
    no_ball_runs: extraType === "no-ball" ? 1 + extras : 0,
    bye_runs: extraType === "bye" ? extras : 0,
    leg_bye_runs: extraType === "leg-bye" ? extras : 0,
    total_runs: totalRuns,
    running_runs: completedRuns,
    is_boundary: bat === 4 || bat === 6,
    wicket: wicket || null,
    dismissed_batsman_id: wicket ? dismissedBatsmanId : null,
    crossed_before_wicket: !!(wicket === "run out" && crossedBeforeWicket),
    next_striker_id: nextStriker,
    next_non_striker_id: nextNonStriker,
    next_batter_id: incomingBatterId || null,
    scorer_name: scorerName.trim()
  };
  return { ok: true, ball, state: { ...state, strikerId: nextStriker || "", nonStrikerId: nextNonStriker || "", bowlerId: legal && ballNo === 6 ? "" : bowler } };
}
export function battingScorecard(balls, players, inningsNo) {
  const active = orderedBalls(activeInningsBalls(balls, inningsNo));
  return players.map(player => {
    const faced = active.filter(b => b.striker_id === player.id);
    const runs = faced.reduce((sum, b) => sum + num(b.runs_off_bat), 0);
    const ballsFaced = faced.filter(b => b.extra_type !== "wide").length;
    const fours = faced.filter(b => b.is_boundary && num(b.runs_off_bat) === 4).length;
    const sixes = faced.filter(b => b.is_boundary && num(b.runs_off_bat) === 6).length;
    const dismissal = active.find(b => b.wicket && b.dismissed_batsman_id === player.id);
    return {
      id: player.id, name: player.name, runs, balls: ballsFaced, fours, sixes,
      strikeRate: ballsFaced ? (runs * 100 / ballsFaced) : 0,
      dismissal: dismissal ? dismissal.wicket : "not out",
      dismissed: !!dismissal
    };
  }).filter(p => p.balls || p.runs || p.dismissed);
}
export function bowlingScorecard(balls, players, inningsNo) {
  const active = orderedBalls(activeInningsBalls(balls, inningsNo));
  return players.map(player => {
    const deliveries = active.filter(b => b.bowler_id === player.id);
    if (!deliveries.length) return null;
    const legal = deliveries.filter(isLegalDelivery);
    const runsConceded = deliveries.reduce((sum, b) => {
      const byes = num(b.bye_runs) || (b.extra_type === "bye" ? num(b.extra_runs) : 0);
      const legByes = num(b.leg_bye_runs) || (b.extra_type === "leg-bye" ? num(b.extra_runs) : 0);
      return sum + Math.max(0, num(b.total_runs) - byes - legByes);
    }, 0);
    const wickets = deliveries.filter(b => b.wicket && BOWLER_WICKETS.has(b.wicket)).length;
    const overs = legal.length;
    const overGroups = new Map();
    deliveries.forEach(b => {
      const key = String(b.over_number);
      if (!overGroups.has(key)) overGroups.set(key, { legal: 0, conceded: 0 });
      const group = overGroups.get(key);
      if (isLegalDelivery(b)) group.legal += 1;
      const byes = num(b.bye_runs) || (b.extra_type === "bye" ? num(b.extra_runs) : 0);
      const legByes = num(b.leg_bye_runs) || (b.extra_type === "leg-bye" ? num(b.extra_runs) : 0);
      group.conceded += Math.max(0, num(b.total_runs) - byes - legByes);
    });
    const maidens = [...overGroups.values()].filter(x => x.legal === 6 && x.conceded === 0).length;
    return {
      id: player.id, name: player.name, overs: formatOvers(overs), legalBalls: overs,
      maidens, runs: runsConceded, wickets,
      economy: overs ? (runsConceded / (overs / 6)) : 0
    };
  }).filter(Boolean).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs);
}
export function fallOfWickets(balls, inningsNo, players) {
  const rows = orderedBalls(activeInningsBalls(balls, inningsNo));
  let score = 0;
  let wickets = 0;
  const result = [];
  rows.forEach(b => {
    score += num(b.total_runs);
    if (b.wicket) {
      wickets += 1;
      const player = players.find(p => p.id === b.dismissed_batsman_id);
      const legalBalls = rows.slice(0, rows.indexOf(b) + 1).filter(isLegalDelivery).length;
      result.push({ wicket: wickets, score, batter: player ? player.name : "Batter", overs: formatOvers(legalBalls) });
    }
  });
  return result;
}
export function matchResult(innings, balls, players, match) {
  const scores = innings.map(i => ({ innings: i, ...inningsStats(balls, i.innings_no, match.overs) }));
  if (scores.length < 2) return { text: "Match in progress", winner: null, type: "in_progress" };
  const first = scores[0], second = scores[1];
  const firstTeam = first.innings.batting_team === "team1" ? match.team1 : match.team2;
  const secondTeam = second.innings.batting_team === "team1" ? match.team1 : match.team2;
  if (second.total > first.total) {
    const battingPlayers = players.filter(p => p.team === second.innings.batting_team).length;
    const wicketsRemaining = Math.max(0, battingPlayers - 1 - second.wickets);
    return { text: secondTeam + " won by " + wicketsRemaining + " wickets", winner: second.innings.batting_team, type: "wickets" };
  }
  if (first.total > second.total) return { text: firstTeam + " won by " + (first.total - second.total) + " runs", winner: first.innings.batting_team, type: "runs" };
  return { text: "Match tied", winner: null, type: "tie" };
}
export function tournamentStandings(matches, ballsByMatch, teams) {
  const rows = new Map();
  teams.forEach(team => rows.set(team.id, {
    id: team.id, name: team.name, played: 0, won: 0, lost: 0, tied: 0, points: 0,
    runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0, nrr: 0
  }));
  matches.filter(m => m.status === "finished" && m.team1_id && m.team2_id).forEach(match => {
    const team1 = rows.get(match.team1_id), team2 = rows.get(match.team2_id);
    if (!team1 || !team2) return;
    const matchBalls = ballsByMatch[match.id] || [];
    const i1 = inningsStats(matchBalls, 1, match.overs);
    const i2 = inningsStats(matchBalls, 2, match.overs);
    const firstBatTeamId = match.innings1_batting_team_id || null;
    const batting1Id = firstBatTeamId || (match.toss_winner === match.team1 ? (match.toss_decision === "bat" ? match.team1_id : match.team2_id) : (match.toss_decision === "bat" ? match.team2_id : match.team1_id));
    const batting2Id = batting1Id === match.team1_id ? match.team2_id : match.team1_id;
    const first = batting1Id === match.team1_id ? team1 : team2;
    const second = batting2Id === match.team1_id ? team1 : team2;
    const quota = match.overs * 6;
    first.runsFor += i1.total; first.ballsFor += i1.wickets >= (match.players_per_team || 11) - 1 ? quota : i1.legalBalls;
    first.runsAgainst += i2.total; first.ballsAgainst += i2.wickets >= (match.players_per_team || 11) - 1 ? quota : i2.legalBalls;
    second.runsFor += i2.total; second.ballsFor += i2.wickets >= (match.players_per_team || 11) - 1 ? quota : i2.legalBalls;
    second.runsAgainst += i1.total; second.ballsAgainst += i1.wickets >= (match.players_per_team || 11) - 1 ? quota : i1.legalBalls;
    team1.played += 1; team2.played += 1;
    if (i1.total === i2.total) { team1.tied++; team2.tied++; team1.points++; team2.points++; }
    else {
      const winnerId = (batting1Id === match.team1_id ? (i1.total > i2.total ? match.team1_id : match.team2_id) : (i1.total > i2.total ? match.team2_id : match.team1_id));
      const winner = rows.get(winnerId), loser = rows.get(winnerId === match.team1_id ? match.team2_id : match.team1_id);
      winner.won++; winner.points += 2; loser.lost++;
    }
  });
  return [...rows.values()].map(row => ({
    ...row,
    nrr: (row.ballsFor ? row.runsFor / (row.ballsFor / 6) : 0) - (row.ballsAgainst ? row.runsAgainst / (row.ballsAgainst / 6) : 0)
  })).sort((a, b) => b.points - a.points || b.nrr - a.nrr || b.won - a.won);
}
