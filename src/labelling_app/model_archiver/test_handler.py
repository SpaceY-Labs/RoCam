import numpy as np

from handler import Sam3Handler


def main():
    handler = Sam3Handler()

    mask = np.zeros((10, 10), dtype=np.uint8)
    mask[2:6, 3:8] = 1

    result = handler._build_mask_response(mask, 0.9)

    assert "polygon" in result
    assert "boundingBox" in result
    assert result["boundingBox"]["w"] > 0
    assert result["boundingBox"]["h"] > 0
    assert result["area"] > 0

    print("OK: handler helpers produce mask response")


if __name__ == "__main__":
    main()
