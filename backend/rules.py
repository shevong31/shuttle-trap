class BadmintonRules:
    """Enforces BWF Singles and Doubles rules."""
    # Logical court grid: 6 columns (width) x 10 rows (length)
    # AI side: rows 0..4 | Player side: rows 5..9
    GRID_COLS = 6
    GRID_ROWS = 10

    def __init__(self, mode="singles"):
        self.mode = mode  # "singles" or "doubles"
        self.reset_match()

    def reset_match(self):
        self.player_score = 0
        self.ai_score = 0
        self.server = "player"  # "player" or "ai"
        self.rally_count = 0
        self.winner = None

    def get_valid_bounds(self):
        """Singles uses inner sidelines (cols 1..4); Doubles uses full width (cols 0..5)."""
        if self.mode == "singles":
            return {"min_col": 1, "max_col": 4, "min_row": 0, "max_row": 9}
        return {"min_col": 0, "max_col": 5, "min_row": 0, "max_row": 9}

    def is_in_bounds(self, col, row):
        b = self.get_valid_bounds()
        return b["min_col"] <= col <= b["max_col"] and b["min_row"] <= row <= b["max_row"]

    def get_service_side(self):
        """Even score serves from Right court; Odd score serves from Left court."""
        score = self.player_score if self.server == "player" else self.ai_score
        return "RIGHT" if score % 2 == 0 else "LEFT"

    def award_point(self, point_winner):
        if point_winner == "player":
            self.player_score += 1
            self.server = "player"
        else:
            self.ai_score += 1
            self.server = "ai"

        self.rally_count = 0
        self._check_match_winner()

    def _check_match_winner(self):
        p, a = self.player_score, self.ai_score
        if (p >= 21 and p - a >= 2) or p == 30:
            self.winner = "player"
        elif (a >= 21 and a - p >= 2) or a == 30:
            self.winner = "ai"