import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINKER = ROOT / 'data' / 'linker.json'
CS = ROOT / 'data' / 'cs.json'

# 简单的经纬度换算: 1 deg latitude ~ 111320 m; longitude ~ 111320 * cos(lat)
METERS_PER_DEG_LAT = 111320.0


def read_json(p: Path):
    return json.loads(p.read_text(encoding='utf-8'))


def write_json(p: Path, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def distribute_within_circle(center_lat, center_lng, radius_meters, n):
    """Return n (lat,lng) points distributed in the circle around center.
    Use deterministic angular distribution with small radial jitter so points stay inside circle.
    """
    results = []
    if n <= 0:
        return results
    if n == 1:
        return [(center_lat, center_lng)]

    for i in range(n):
        angle = (i / n) * 2 * math.pi
        # radial: spread from 0.2R .. 0.8R to avoid center and edge
        frac = 0.25 + 0.5 * ((i % n) / max(1, n - 1))
        r = radius_meters * frac
        dy = math.cos(angle) * r
        dx = math.sin(angle) * r
        lat = center_lat + (dy / METERS_PER_DEG_LAT)
        lon = center_lng + (dx / (METERS_PER_DEG_LAT * math.cos(math.radians(center_lat))))
        results.append((round(lat, 6), round(lon, 6)))
    return results


def main():
    linker = read_json(LINKER)
    cs = read_json(CS)

    # build center map: building -> {lat,lng,radius}
    centers = {}
    for item in linker:
        raw = str(item.get('中心经纬度', '')).split(',')
        if len(raw) >= 2:
            try:
                lng = float(raw[0].strip())
                lat = float(raw[1].strip())
            except Exception:
                continue
            centers[item.get('楼宇')] = {
                'lat': lat,
                'lng': lng,
                'radius': float(item.get('半径') or 40.0)
            }

    # group cs by building
    groups = {}
    for r in cs:
        b = r.get('楼宇')
        groups.setdefault(b, []).append(r)

    # For each building in groups, if center exists, distribute coordinates
    modified = 0
    for b, restrooms in groups.items():
        center = centers.get(b)
        if not center:
            continue
        coords = distribute_within_circle(center['lat'], center['lng'], center['radius'] * 0.6, len(restrooms))
        for idx, r in enumerate(restrooms):
            lat, lng = coords[idx]
            r['纬度'] = lat
            r['经度'] = lng
            modified += 1

    if modified:
        write_json(CS, cs)
        print(f"Updated {modified} restroom coordinates in {CS}")
    else:
        print("No updates made (no matching buildings found or no restrooms).")


if __name__ == '__main__':
    main()
