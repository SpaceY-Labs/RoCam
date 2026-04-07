"""
Author: Zifan Si
Date: 2026-01-28
Purpose: Minimal CI smoke test to verify the test infrastructure works.
"""

def add(a: int, b: int) -> int:
    return a + b


if __name__ == "__main__":
    print(add(1, 2))
