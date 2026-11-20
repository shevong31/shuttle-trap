import heapq
import math
import random

SHOT_TYPES = {
    "CLEAR":    {"stamina_cost": 10, "error_risk": 0.05, "preferred_rows": [8, 9]},
    "DROP":     {"stamina_cost": 7,  "error_risk": 0.10, "preferred_rows": [5, 6]},
    "SMASH":    {"stamina_cost": 16, "error_risk": 0.18, "preferred_rows": [6, 7, 8]},
    "NET_SHOT": {"stamina_cost": 6,  "error_risk": 0.12, "preferred_rows": [5]},
}

class AdaptiveOpponentModel:
    """Tracks player return tendencies across rallies and adapts predictions."""
    def __init__(self):
        self.shot_counts = {"CLEAR": 1, "DROP": 1, "SMASH": 1, "NET_SHOT": 1}

    def observe(self, shot_type):
        if shot_type in self.shot_counts:
            self.shot_counts[shot_type] += 1

    def get_tendencies(self):
        total = sum(self.shot_counts.values())
        return {k: round((v / total) * 100) for k, v in self.shot_counts.items()}

    def predict_next_shot(self):
        tendencies = self.get_tendencies()
        likely = max(tendencies, key=tendencies.get)
        return likely, tendencies[likely]


class ShuttleAI:
    def __init__(self):
        self.opponent_model = AdaptiveOpponentModel()

    # 1. A* SEARCH: Find lowest-cost movement path to target/recovery position
    def a_star_path(self, start, goal, bounds):
        def heuristic(a, b):
            return abs(a[0] - b[0]) + abs(a[1] - b[1])  # Manhattan distance

        open_set = []
        heapq.heappush(open_set, (0, start))
        came_from = {}
        g_score = {start: 0}

        while open_set:
            _, current = heapq.heappop(open_set)
            if current == goal:
                path = [current]
                while current in came_from:
                    current = came_from[current]
                    path.append(current)
                return list(reversed(path))

            # 8-directional court movement
            for dc, dr in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)]:
                nxt = (current[0] + dc, current[1] + dr)
                if not (bounds["min_col"] <= nxt[0] <= bounds["max_col"] and 0 <= nxt[1] <= 4):
                    continue
                step_cost = 1.41 if (dc != 0 and dr != 0) else 1.0
                tentative_g = g_score[current] + step_cost

                if nxt not in g_score or tentative_g < g_score[nxt]:
                    came_from[nxt] = current
                    g_score[nxt] = tentative_g
                    f_score = tentative_g + heuristic(nxt, goal)
                    heapq.heappush(open_set, (f_score, nxt))

        return [start, goal]

    # Evaluation function: opponent distance + open space - error risk
    def evaluate_shot(self, target, shot_type, player_pos, ai_stamina):
        dist = math.hypot(target[0] - player_pos[0], target[1] - player_pos[1])
        risk = SHOT_TYPES[shot_type]["error_risk"]
        stamina_penalty = 0.3 if ai_stamina < 30 and shot_type == "SMASH" else 0.0
        # Reward stretching opponent away from center base (col 2.5, row 7)
        imbalance = math.hypot(target[0] - 2.5, target[1] - 7.0) * 0.4
        return round((dist * 1.5) + imbalance - (risk * 10) - stamina_penalty, 2)

    # 2. GREEDY BEST-FIRST: Pick shot with largest immediate opening
    def greedy_best_first(self, player_pos, bounds, ai_stamina):
        best_score = -999
        best_move = ("CLEAR", (bounds["min_col"], 9))
        for shot, info in SHOT_TYPES.items():
            for c in range(bounds["min_col"], bounds["max_col"] + 1):
                for r in info["preferred_rows"]:
                    score = self.evaluate_shot((c, r), shot, player_pos, ai_stamina)
                    if score > best_score:
                        best_score = score
                        best_move = (shot, (c, r))
        return best_move, best_score

    # 3. HILL CLIMBING: Iteratively refine a candidate shot plan
    def hill_climbing_shot(self, player_pos, bounds, ai_stamina):
        # Start with a random valid candidate
        shot = random.choice(list(SHOT_TYPES.keys()))
        col = random.randint(bounds["min_col"], bounds["max_col"])
        row = random.choice(SHOT_TYPES[shot]["preferred_rows"])
        current_score = self.evaluate_shot((col, row), shot, player_pos, ai_stamina)

        improved = True
        while improved:
            improved = False
            for dc, dr in [(-1,0),(1,0),(0,-1),(0,1)]:
                nc, nr = col + dc, row + dr
                if bounds["min_col"] <= nc <= bounds["max_col"] and 5 <= nr <= 9:
                    s = self.evaluate_shot((nc, nr), shot, player_pos, ai_stamina)
                    if s > current_score:
                        col, row, current_score = nc, nr, s
                        improved = True

        return (shot, (col, row)), current_score