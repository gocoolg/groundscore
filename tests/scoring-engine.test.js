import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDelivery, inningsStats, currentBattingState,
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
test("batting balls faced do not count wides, byes or leg-byes", () => {
  const rows = [
    { innings_no: 1, striker_id: "a", runs_off_bat: 0, extra_type: "wide" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 0, extra_type: "bye" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 0, extra_type: "leg-bye" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 1, extra_type: "no-ball" },
    { innings_no: 1, striker_id: "a", runs_off_bat: 4, extra_type: null, is_boundary: true }
  ];
  const figures = battingScorecard(rows, players, 1).find(p => p.id === "a");
  assert.equal(figures.runs, 5);
  assert.equal(figures.balls, 2);
  assert.equal(figures.fours, 1);
});
