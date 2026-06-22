from dataclasses import dataclass


@dataclass(frozen=True)
class Centroid:
    x: float
    y: float


def bbox_centroid(x1: float, y1: float, x2: float, y2: float) -> Centroid:
    return Centroid(x=(x1 + x2) / 2, y=(y1 + y2) / 2)


def bbox_bottom_center(x1: float, y1: float, x2: float, y2: float) -> Centroid:
    return Centroid(x=(x1 + x2) / 2, y=y2)
