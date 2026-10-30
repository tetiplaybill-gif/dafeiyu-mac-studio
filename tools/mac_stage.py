"""Gift rules and monotonic rehearsal timer; no platform or payment side effects."""
import copy
import math
import time

GIFT_RULES = {
    "人气票": {"action": "17", "motion": "none", "seconds": 30},
    "小心心": {"action": "20", "motion": "dance", "seconds": 60},
    "玫瑰": {"action": "01", "motion": "roam", "seconds": 90},
    "大啤酒": {"action": "18", "motion": "dance", "seconds": 180},
    "棒棒糖": {"action": "24", "motion": "roam", "seconds": 120},
    "鲜花": {"action": "01", "motion": "roam", "seconds": 60},
    "加油鸭": {"action": "18", "motion": "dance", "seconds": 300},
    "爱你哟": {"action": "20", "motion": "dance", "seconds": 300},
}


def bounded_integer(value, low, high):
    if isinstance(value, bool) or not str(value).isdigit():
        raise ValueError("请输入范围内的整数。")
    result = int(value)
    if not low <= result <= high:
        raise ValueError("数值超出允许范围。")
    return result


class StageTimer:
    def __init__(self, now=time.monotonic):
        self.now = now
        self.initial_seconds = 3600
        self.remaining = 3600.0
        self.elapsed = 0.0
        self.anchor = now()
        self.running = False
        self.added = 0
        self.bonus_seq = 0
        self.last_bonus = 0
        self.rules = copy.deepcopy(GIFT_RULES)

    def _tick(self):
        current = self.now()
        if self.running:
            delta = max(0, current - self.anchor)
            self.elapsed += min(self.remaining, delta)
            self.remaining = max(0, self.remaining - delta)
            if self.remaining == 0:
                self.running = False
        self.anchor = current

    def snapshot(self):
        self._tick()
        return {"remaining_seconds": math.ceil(self.remaining), "elapsed_seconds": int(self.elapsed),
                "running": self.running, "initial_seconds": self.initial_seconds,
                "added_seconds": self.added, "bonus_seq": self.bonus_seq,
                "last_bonus_seconds": self.last_bonus}

    def control(self, data):
        action = data.get("action")
        if action not in ("start", "pause", "reset"):
            raise ValueError("计时操作无效。")
        initial = bounded_integer(data.get("minutes", self.initial_seconds // 60), 1, 1440) * 60
        self._tick()
        if action == "reset":
            self.initial_seconds = initial
            self.remaining, self.elapsed, self.added = float(initial), 0, 0
            self.last_bonus = 0
            self.running = False
        elif action == "start":
            if self.remaining <= 0:
                raise ValueError("倒计时已结束，请重设时间或用礼物加时后开始。")
            self.running = True
        else:
            self.running = False

    def configure_rules(self, updates):
        if not isinstance(updates, dict) or not updates:
            raise ValueError("礼物规则无效。")
        rules = copy.deepcopy(self.rules)
        for name, rule in updates.items():
            if name not in rules or not isinstance(rule, dict):
                raise ValueError("未知礼物。")
            seconds = bounded_integer(rule.get("seconds", rules[name]["seconds"]), 0, 3600)
            motion = rule.get("motion", rules[name]["motion"])
            if motion not in ("none", "dance", "roam"):
                raise ValueError("未知舞台动作。")
            rules[name].update(seconds=seconds, motion=motion)
        self.rules = rules

    def gift(self, name, count):
        self._tick()
        rule = copy.deepcopy(self.rules.get(name, {"action": "18", "motion": "dance", "seconds": 0}))
        # Cap the countdown at 24 h; show the actual credited bonus, not requested time.
        bonus = min(rule["seconds"] * count, max(0, 86400 - self.remaining))
        self.remaining += bonus
        self.added += bonus
        self.last_bonus = bonus
        self.bonus_seq += 1
        return rule, bonus
