import numpy as np

from app import _build_mask_response


def main() -> None:
    mask = np.zeros((8, 8), dtype=np.uint8)
    mask[2:6, 1:5] = 1
    result = _build_mask_response(mask, 0.9)

    assert "mask" in result
    assert "boundingBox" in result
    assert result["boundingBox"]["w"] > 0
    assert result["boundingBox"]["h"] > 0
    assert result["area"] > 0
    assert len(result["mask"]) == 8
    assert len(result["mask"][0]) == 8

    print("OK: SAM app helper response")


if __name__ == "__main__":
    main()
