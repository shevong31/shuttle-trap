from flask import Flask, jsonify, request
from flask_cors import CORS
import math
from rules import BadmintonRules
from ai_engine import ShuttleAI, SHOT_TYPES

app = Flask(__name__)
CORS(app)

rules = BadmintonRules(mode="singles")
ai = ShuttleAI()

state = {
    "mode": "singles",
    "player_pos": [2, 7],
    "player_partner_pos": [3, 8],  # Used in Doubles
    "ai_pos": [3, 2],
    "ai_partner_pos": [2, 1],      # Used in Doubles
    "player_stamina": 100,
    "ai_stamina": 100,
    "shuttle_pos": [2, 7],
    "last_ai_path": [],
    "ai_prediction": "Waiting for serve...",
    "suggested_play": "Play a Clear to back-left.",
    "log": "Match started (Singles). Select a shot and target zone."
}

@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify({
        **state,
        "player_score": rules.player_score,
        "ai_score": rules.ai_score,
        "rally": rules.rally_count,
        "server": rules.server,
        "service_side": rules.get_service_side(),
        "winner": rules.winner,
        "tendencies": ai.opponent_model.get_tendencies()
    })

@app.route("/api/reset", methods=["POST"])
def reset_game():
    data = request.json or {}
    mode = data.get("mode", "singles")
    rules.mode = mode
    rules.reset_match()
    state.update({
        "mode": mode,
        "player_pos": [2, 7],
        "player_partner_pos": [3, 8],
        "ai_pos": [3, 2],
        "ai_partner_pos": [2, 1],
        "player_stamina": 100,
        "ai_stamina": 100,
        "shuttle_pos": [2, 7],
        "last_ai_path": [],
        "log": f"New {mode.title()} match started! Serve from {rules.get_service_side()} court."
    })
    return get_state()

@app.route("/api/play_shot", methods=["POST"])
def play_shot():
    if rules.winner:
        return get_state()

    data = request.json
    shot_type = data.get("shot_type", "CLEAR")
    target = tuple(data.get("target", [2, 1]))  # (col, row) on AI side (rows 0..4)
    algo = data.get("algorithm", "greedy")      # "greedy" or "hill_climbing"

    bounds = rules.get_valid_bounds()
    rules.rally_count += 1

    # Observe player tendency for Adaptive AI
    ai.opponent_model.observe(shot_type)
    state["player_stamina"] = max(10, state["player_stamina"] - SHOT_TYPES[shot_type]["stamina_cost"])

    # Check if player hit out of bounds (Singles vs Doubles sidelines)
    if not rules.is_in_bounds(target[0], target[1]):
        rules.award_point("ai")
        state["log"] = f"OUT! Your {shot_type} landed outside {rules.mode} lines. Point to AI."
        return get_state()

    # AI uses A* Search to move to shuttle landing spot
    ai_start = tuple(state["ai_pos"])
    path = ai.a_star_path(ai_start, target, bounds)
    state["last_ai_path"] = [list(p) for p in path]
    travel_dist = len(path) - 1

    # Win condition: unreachable return (distance too far for current AI stamina)
    max_reach = 5 if state["ai_stamina"] > 40 else 3
    if travel_dist > max_reach:
        rules.award_point("player")
        state["ai_pos"] = list(path[min(max_reach, len(path)-1)])
        state["shuttle_pos"] = list(target)
        state["log"] = f"WINNER! AI couldn't reach your {shot_type} (needed {travel_dist} steps)."
        return get_state()

    # AI reaches shuttle and selects counter-shot using chosen algorithm
    state["ai_pos"] = list(target)
    state["ai_stamina"] = max(10, state["ai_stamina"] - (travel_dist * 3))

    if algo == "hill_climbing":
        (ai_shot, ai_target), score = ai.hill_climbing_shot(state["player_pos"], bounds, state["ai_stamina"])
    else:
        (ai_shot, ai_target), score = ai.greedy_best_first(state["player_pos"], bounds, state["ai_stamina"])

    # Update player position toward AI's return
    p_dist = math.hypot(ai_target[0] - state["player_pos"][0], ai_target[1] - state["player_pos"][1])
    state["shuttle_pos"] = list(ai_target)

    if p_dist > 4.2 and state["player_stamina"] < 35:
        rules.award_point("ai")
        state["log"] = f"AI trapped you with a {ai_shot} to {ai_target}! Point to AI."
    else:
        state["player_pos"] = list(ai_target)
        likely_shot, pct = ai.opponent_model.predict_next_shot()
        state["ai_prediction"] = f"Model predicts your {likely_shot} ({pct}% tendency)."
        state["suggested_play"] = f"AI used {algo.upper()} (score {score}) → {ai_shot}."
        state["log"] = f"Rally {rules.rally_count}: You played {shot_type} → AI countered with {ai_shot}."

    return get_state()

if __name__ == "__main__":
    app.run(debug=True, port=5000)