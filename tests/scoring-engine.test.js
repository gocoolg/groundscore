import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDelivery, deliveryNotation, inningsStats, currentBattingState, currentWicketBatters, chaseProgress,
  battingScorecard, bowlingScorecard
} from "../js/scoring-engine.js";

const players = [
  { id: "a", name: "Arun", team: "team1" },
  { id: "b", name: "Bala", team: "team1" },
  { id: "c", name: "Charan", team: "team1" },
  { id: "d", name: "Deepak", team: "team2" },
  { id: "e", name: "Ezhil", team: "team2" }
];
function delivery(options = {}, balls = []) {
  const built = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls, players,
    battingTeam: "team1", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", ...options
  });
  assert.equal(built.ok, true, built.errors?.join("; "));
  return built.ball;
}
test("one completed run rotates strike", () => {
  const b = delivery({ batRuns: 1 });
  assert.equal(b.next_striker_id, "b");
  assert.equal(b.next_non_striker_id, "a");
});
test("two, four and six do not rotate strike", () => {
  for (const runs of [2, 4, 6]) {
    const b = delivery({ batRuns: runs });
    assert.equal(b.next_striker_id, "a");
    assert.equal(b.next_non_striker_id, "b");
  }
});
test("a wide adds a penalty, does not count as a legal ball and penalty does not rotate strike", () => {
  const b = delivery({ extraType: "wide", extraRuns: 0 });
  assert.equal(b.total_runs, 1);
  assert.equal(b.wide_runs, 1);
  assert.equal(b.ball_number, 1);
  assert.equal(b.next_striker_id, "a");
});
test("completed runs on a wide rotate strike by completed-run parity, not penalty parity", () => {
  const b = delivery({ extraType: "wide", extraRuns: 1 });
  assert.equal(b.total_runs, 2);
  assert.equal(b.running_runs, 1);
  assert.equal(b.next_striker_id, "b");
});
test("no-ball penalty is not counted as a completed run; bat run is", () => {
  const b = delivery({ extraType: "no-ball", batRuns: 1 });
  assert.equal(b.total_runs, 2);
  assert.equal(b.no_ball_runs, 1);
  assert.equal(b.next_striker_id, "b");
});
test("byes count as legal deliveries and completed runs rotate strike", () => {
  const b = delivery({ extraType: "bye", extraRuns: 1 });
  assert.equal(b.ball_number, 1);
  assert.equal(b.total_runs, 1);
  assert.equal(b.next_striker_id, "b");
});
test("sixth legal ball changes ends after completed-run rotation", () => {
  const previous = Array.from({ length: 5 }, (_, i) => ({
    innings_no: 1, delivery_number: i + 1, ball_number: i + 1,
    over_number: 0, striker_id: "a", non_striker_id: "b", bowler_id: "d",
    extra_type: null, total_runs: 0, runs_off_bat: 0,
    next_striker_id: "a", next_non_striker_id: "b"
  }));
  const b = delivery({ strikerId: "a", nonStrikerId: "b", batRuns: 1 }, previous);
  assert.equal(b.ball_number, 6);
  assert.equal(b.next_striker_id, "a");
  assert.equal(b.next_non_striker_id, "b");
  const next = currentBattingState([...previous, b], 1);
  assert.equal(next.needsNewBowler, true);
  assert.equal(next.bowlerId, "");
});
test("wicket replaces the dismissed striker after run and over-end rotation", () => {
  const b = delivery({
    wicket: "bowled", dismissedBatsmanId: "a", incomingBatterId: "c"
  });
  assert.equal(b.next_striker_id, "c");
  assert.equal(b.next_non_striker_id, "b");
});
test("wide cannot be recorded as bat runs", () => {
  const b = buildDelivery({
    matchId: "m", inningsNo: 1, players, battingTeam: "team1", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "d", scorerName: "S",
    extraType: "wide", batRuns: 1
  });
  assert.equal(b.ok, false);
});
test("innings totals ignore voided balls and count only legal deliveries", () => {
  const rows = [
    { innings_no: 1, total_runs: 2, extra_type: null },
    { innings_no: 1, total_runs: 1, extra_type: "wide" },
    { innings_no: 1, total_runs: 3, extra_type: "no-ball" },
    { innings_no: 1, total_runs: 4, extra_type: null, wicket: "bowled", voided_at: "2026-01-01" }
  ];
  const s = inningsStats(rows, 1, 10);
  assert.equal(s.total, 6);
  assert.equal(s.wickets, 0);
  assert.equal(s.legalBalls, 1);
});
test("bowling figures exclude byes/leg-byes from runs conceded and run-outs from wickets", () => {
  const rows = [
    { innings_no: 1, over_number: 0, ball_number: 1, bowler_id: "d", striker_id: "a", total_runs: 4, runs_off_bat: 0, extra_type: "bye", extra_runs: 4, bye_runs: 4 },
    { innings_no: 1, over_number: 0, ball_number: 2, bowler_id: "d", striker_id: "a", total_runs: 2, runs_off_bat: 1, extra_type: "no-ball", extra_runs: 1, no_ball_runs: 1, wicket: "run out", dismissed_batsman_id: "a" }
  ];
  const figures = bowlingScorecard(rows, players, 1)[0];
  assert.equal(figures.runs, 2);
  assert.equal(figures.wickets, 0);
});
test("batting balls faced count no-balls and byes/leg-byes, but exclude wides", () => {
  const rows = [
    { innings_no: 1, striker_id: "a", runs_off_bat: 0, extra_type: "wide" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 0, extra_type: "bye" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 0, extra_type: "leg-bye" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 1, extra_type: "no-ball" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 4, extra_type: null, is_boundary: true }
  ];
  const figures = battingScorecard(rows, players, 1).find(p => p.id === "a");
  assert.equal(figures.runs, 5);
  assert.equal(figures.balls, 4);
  assert.equal(figures.fours, 1);
});

test("selected new bowler is accepted after six legal balls", () => {
  const previous = Array.from({ length: 6 }, (_, i) => ({
    innings_no: 1, delivery_number: i + 1, ball_number: i + 1,
    over_number: 0, striker_id: "a", non_striker_id: "b", bowler_id: "d",
    extra_type: null, total_runs: 0, runs_off_bat: 0,
    next_striker_id: "a", next_non_striker_id: "b"
  }));
  const next = currentBattingState(previous, 1, { strikerId: "a", nonStrikerId: "b", bowlerId: "e" });
  assert.equal(next.needsNewBowler, true);
  assert.equal(next.bowlerId, "e");
  const built = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: previous, players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "e", scorerName: "Scorer", batRuns: 1
  });
  assert.equal(built.ok, true, built.errors?.join("; "));
  assert.equal(built.ball.bowler_id, "e");
});
test("wicket with no incoming batter does not put dismissed player back at the crease", () => {
  const rows = [{
    innings_no: 1, delivery_number: 1, ball_number: 1, over_number: 0,
    striker_id: "a", non_striker_id: "b", bowler_id: "d",
    extra_type: null, total_runs: 0, runs_off_bat: 0,
    wicket: "bowled", dismissed_batsman_id: "a",
    next_striker_id: null, next_non_striker_id: "b"
  }];
  const next = currentBattingState(rows, 1);
  assert.equal(next.strikerId, "");
  assert.equal(next.nonStrikerId, "b");
});

test("the same player cannot be selected as striker and non-striker", () => {
  const built = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "a", nonStrikerId: "a", bowlerId: "d",
    scorerName: "Scorer", batRuns: 0
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some(message => message.includes("must be different players")));
});

test("wide with one additional run is displayed as WD+1", () => {
  const ball = delivery({ extraType: "wide", extraRuns: 1 });
  assert.equal(ball.total_runs, 2);
  assert.equal(deliveryNotation(ball), "WD+1");
});
test("no-ball with one additional run is displayed as NB+1", () => {
  const ball = delivery({ extraType: "no-ball", extraRuns: 1 });
  assert.equal(ball.total_runs, 2);
  assert.equal(deliveryNotation(ball), "NB+1");
});
test("no-ball accepts six additional runs and displays NB+6", () => {
  const ball = delivery({ extraType: "no-ball", extraRuns: 6 });
  assert.equal(ball.total_runs, 7);
  assert.equal(deliveryNotation(ball), "NB+6");
});
test("wide with only the penalty is displayed as WD", () => {
  const ball = delivery({ extraType: "wide", extraRuns: 0 });
  assert.equal(deliveryNotation(ball), "WD");
});

test("chase progress reports runs and balls remaining", () => {
  const rows = [
    { innings_no: 1, total_runs: 52, extra_type: null },
    { innings_no: 2, total_runs: 2, extra_type: null },
    { innings_no: 2, total_runs: 1, extra_type: "wide" }
  ];
  const progress = chaseProgress(rows, 1, 2, 2);
  assert.equal(progress.target, 53);
  assert.equal(progress.runsRequired, 50);
  assert.equal(progress.ballsRemaining, 11);
  assert.equal(progress.reached, false);
});
test("chase is complete as soon as target is reached", () => {
  const rows = [
    { innings_no: 1, total_runs: 52, extra_type: null },
    { innings_no: 2, total_runs: 52, extra_type: null },
    { innings_no: 2, total_runs: 1, extra_type: "wide" }
  ];
  const progress = chaseProgress(rows, 1, 2, 2);
  assert.equal(progress.target, 53);
  assert.equal(progress.runsRequired, 0);
  assert.equal(progress.reached, true);
});


test("generic wicket can be recorded without choosing a dismissal type or incoming batter", () => {
  const b = delivery({ wicket: "wicket", dismissedBatsmanId: "a" });
  assert.equal(b.wicket, "wicket");
  assert.equal(b.dismissed_batsman_id, "a");
  assert.equal(b.next_striker_id, null);
  assert.equal(b.next_non_striker_id, "b");
});

test("generic wicket is credited to the current bowler", () => {
  const rows = [{
    innings_no: 1, over_number: 0, ball_number: 1,
    bowler_id: "d", striker_id: "a", total_runs: 0, runs_off_bat: 0,
    extra_type: null, wicket: "wicket", dismissed_batsman_id: "a"
  }];
  const figures = bowlingScorecard(rows, players, 1)[0];
  assert.equal(figures.wickets, 1);
});


test("generic wicket leaves the dismissed end empty while retaining the surviving batter", () => {
  const wicket = delivery({ wicket: "wicket", dismissedBatsmanId: "a" });
  const next = currentBattingState([wicket], 1);
  assert.equal(next.strikerId, "");
  assert.equal(next.nonStrikerId, "b");
});

test("wicket replacement lineup can be completed after the wicket delivery", () => {
  const wicket = delivery({ wicket: "wicket", dismissedBatsmanId: "a" });
  const next = currentBattingState([wicket], 1);
  const replacementLineup = {
    strikerId: "c",
    nonStrikerId: next.nonStrikerId,
    bowlerId: next.bowlerId || "e"
  };
  assert.equal(replacementLineup.strikerId, "c");
  assert.equal(replacementLineup.nonStrikerId, "b");
});


test("last remaining batter can continue scoring alone without a non-striker", () => {
  const firstWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "a"
  });
  assert.equal(firstWicket.ok, true, firstWicket.errors?.join("; "));

  const secondWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [firstWicket.ball], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "c", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "c"
  });
  assert.equal(secondWicket.ok, true, secondWicket.errors?.join("; "));

  const soloRun = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [firstWicket.ball, secondWicket.ball], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "b", nonStrikerId: "", bowlerId: "e",
    scorerName: "Scorer", batRuns: 3
  });
  assert.equal(soloRun.ok, true, soloRun.errors?.join("; "));
  assert.equal(soloRun.ball.runs_off_bat, 3);
  assert.equal(soloRun.ball.total_runs, 3);
  assert.equal(soloRun.ball.striker_id, "b");
  assert.equal(soloRun.ball.non_striker_id, "");
  assert.equal(soloRun.ball.next_striker_id, "b");
  assert.equal(soloRun.ball.next_non_striker_id, "");
});

test("last batter stays on strike after odd runs and legal over end", () => {
  const rows = [
    { innings_no: 1, delivery_number: 1, ball_number: 1, over_number: 0,
      striker_id: "a", non_striker_id: "b", bowler_id: "d", extra_type: null,
      total_runs: 0, runs_off_bat: 0, wicket: "wicket", dismissed_batsman_id: "a",
      next_striker_id: null, next_non_striker_id: "b" },
    { innings_no: 1, delivery_number: 2, ball_number: 2, over_number: 0,
      striker_id: "c", non_striker_id: "b", bowler_id: "d", extra_type: null,
      total_runs: 0, runs_off_bat: 0, wicket: "wicket", dismissed_batsman_id: "c",
      next_striker_id: null, next_non_striker_id: "b" },
    ...Array.from({ length: 3 }, (_, i) => ({
      innings_no: 1, delivery_number: i + 3, ball_number: i + 3,
      over_number: 0, striker_id: "b", non_striker_id: null, bowler_id: "d",
      extra_type: null, total_runs: 0, runs_off_bat: 0, wicket: null,
      next_striker_id: "b", next_non_striker_id: null
    }))
  ];
  const next = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: rows, players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "b", nonStrikerId: "", bowlerId: "d",
    scorerName: "Scorer", batRuns: 1
  });
  assert.equal(next.ok, true, next.errors?.join("; "));
  assert.equal(next.ball.ball_number, 6);
  assert.equal(next.ball.next_striker_id, "b");
  assert.equal(next.ball.next_non_striker_id, "");
  const afterOverEnd = currentBattingState([...rows, next.ball], 1);
  assert.equal(afterOverEnd.needsNewBowler, true);
  assert.equal(afterOverEnd.strikerId, "b");
  assert.equal(afterOverEnd.nonStrikerId, "");
});

test("innings ends when the final batter is dismissed", () => {
  const history = [
    { innings_no: 1, wicket: "wicket", dismissed_batsman_id: "a" },
    { innings_no: 1, wicket: "wicket", dismissed_batsman_id: "c" }
  ];
  const lastWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: history, players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "b", nonStrikerId: "", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "b"
  });
  assert.equal(lastWicket.ok, true, lastWicket.errors?.join("; "));
  const afterAllOut = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [...history, lastWicket.ball], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "", nonStrikerId: "", bowlerId: "d",
    scorerName: "Scorer", batRuns: 1
  });
  assert.equal(afterAllOut.ok, false);
  assert.match(afterAllOut.errors.join(" "), /all out/i);
});


test("wicket popup uses the newly selected replacement batter before the next delivery is saved", () => {
  const firstWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "a"
  });
  assert.equal(firstWicket.ok, true, firstWicket.errors?.join("; "));

  // The first wicket's saved next_striker_id is blank. The scorer has now
  // selected Charan as the incoming striker, but no new delivery is saved yet.
  const crease = currentWicketBatters([firstWicket.ball], 1, {
    strikerId: "c",
    nonStrikerId: "b",
    bowlerId: "e"
  });
  assert.deepEqual(crease, { strikerId: "c", nonStrikerId: "b" });
});

test("wicket popup never offers a batter already dismissed, even if still selected in the UI", () => {
  const firstWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "a"
  });
  const crease = currentWicketBatters([firstWicket.ball], 1, {
    strikerId: "a",
    nonStrikerId: "b",
    bowlerId: "e"
  });
  assert.deepEqual(crease, { strikerId: "", nonStrikerId: "b" });
});


test("last batter can score no-ball with four additional runs using nullable UUID fields", () => {
  const firstWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "a", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "a"
  });
  const secondWicket = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [firstWicket.ball], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "c", nonStrikerId: "b", bowlerId: "d",
    scorerName: "Scorer", wicket: "wicket", dismissedBatsmanId: "c"
  });
  assert.equal(firstWicket.ok, true, firstWicket.errors?.join("; "));
  assert.equal(secondWicket.ok, true, secondWicket.errors?.join("; "));

  const soloNoBall = buildDelivery({
    matchId: "match-1", inningsNo: 1, balls: [firstWicket.ball, secondWicket.ball], players,
    battingTeam: "team1", bowlingTeam: "team2", oversLimit: 10,
    strikerId: "b", nonStrikerId: "", bowlerId: "e",
    scorerName: "Scorer", extraType: "no-ball", extraRuns: 4
  });
  assert.equal(soloNoBall.ok, true, soloNoBall.errors?.join("; "));
  assert.equal(soloNoBall.ball.total_runs, 5);
  assert.equal(soloNoBall.ball.extra_runs, 5);
  assert.equal(soloNoBall.ball.no_ball_runs, 5);
  assert.equal(soloNoBall.ball.runs_off_bat, 0);
  assert.equal(soloNoBall.ball.non_striker_id, null);
  assert.equal(soloNoBall.ball.next_non_striker_id, null);
  assert.equal(soloNoBall.ball.next_striker_id, "b");
});
