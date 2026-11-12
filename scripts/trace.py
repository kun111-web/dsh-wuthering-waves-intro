"""Generate line art and a motion profile from the existing character clips."""

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 3840, 1488
SIGNAL_SAMPLES = 56


def trace(image):
    image = cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 1.0)
    edges = cv2.Canny(gray, 38, 95, L2gradient=True)
    edges[:12, :] = edges[-12:, :] = edges[:, :12] = edges[:, -12:] = 0
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    outlines = []
    for contour in contours:
        if cv2.arcLength(contour, False) < 50:
            continue
        points = cv2.approxPolyDP(contour, 1.2, False)
        length = round(cv2.arcLength(points, False), 1)
        if length >= 45 and len(points) >= 3:
            outlines.append((length, points.reshape(-1).tolist()))
    outlines.sort(reverse=True)

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturated = hsv[(hsv[:, :, 1] > 55) & (hsv[:, :, 2] > 92)]
    hue = np.bincount(saturated[:, 0], minlength=180).argmax() if len(saturated) else 100
    rgb = cv2.cvtColor(np.uint8([[[hue, 92, 255]]]), cv2.COLOR_HSV2RGB)[0, 0]
    return {"color": "#" + "".join(f"{channel:02x}" for channel in rgb), "paths": outlines[:128]}


def motion_profile(clip):
    capture = cv2.VideoCapture(str(clip))
    intensity = []
    motion = []
    previous = None
    index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            index += 1
            if index % 2 == 0:
                continue
            small = cv2.resize(frame, (40, 16), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            intensity.append(float(gray.mean()))
            motion.append(float(cv2.absdiff(previous, gray).mean()) if previous is not None else 0)
            previous = gray
    finally:
        capture.release()
    if len(motion) < 2:
        raise ValueError(f"Could not read frames from {clip}")

    def normalize(values):
        low, high = np.percentile(values, [5, 95])
        return np.clip((values - low) / max(high - low, 1), 0, 1)

    levels = 0.68 * normalize(motion) + 0.32 * normalize(intensity)
    positions = np.linspace(0, len(levels) - 1, SIGNAL_SAMPLES)
    signal = np.rint(np.interp(positions, np.arange(len(levels)), levels) * 100).astype(int).tolist()
    # Pick a two-second window with sustained motion and visible detail.
    count = min(60, len(levels))
    score = np.convolve(levels, np.ones(count) / count, mode="valid")
    start = int(np.argmax(score))
    return signal, start, start + count


def frame_at(clip, index):
    capture = cv2.VideoCapture(str(clip))
    try:
        capture.set(cv2.CAP_PROP_POS_FRAMES, index * 2)
        ok, frame = capture.read()
        if not ok:
            raise ValueError(f"Could not read frame {index} from {clip}")
        return frame
    finally:
        capture.release()


def entry_frame(clip, start, end):
    # A few clips begin with nearly blank transition frames. Skip at most 0.4 s.
    for index in range(start, min(start + 13, end)):
        outline = trace(frame_at(clip, index))
        if len(outline["paths"]) >= 8:
            return index, outline["paths"]
    return start, trace(frame_at(clip, start))["paths"]


characters = json.loads((ROOT / "src/characters.json").read_text(encoding="utf-8"))
overrides = json.loads((ROOT / "scripts/quick-scenes.json").read_text(encoding="utf-8"))
unknown = set(overrides) - {c["id"] for c in characters}
if unknown:
    raise ValueError(f"Unknown quick scene overrides: {unknown}")
sketches = {}
for character in characters:
    clip = ROOT / "assets/characters" / character["id"]
    video = clip.with_suffix(".mp4")
    signal, start, end = motion_profile(video)
    frame_count = character["end"] - character["start"]
    full_start, full_paths = entry_frame(video, 0, frame_count)
    if character["id"] in overrides:
        selected = overrides[character["id"]]
        start, end = selected["startFrame"], selected["endFrame"]
        if not (type(start) is int and type(end) is int and 0 <= start < end <= frame_count and end - start <= 60):
            raise ValueError(f"Invalid quick scene for {character['id']}")
        quick_paths = trace(frame_at(video, start))["paths"]
        if not quick_paths:
            raise ValueError(f"Quick scene starts on a blank frame: {character['id']}")
    else:
        start, quick_paths = entry_frame(video, max(start, full_start), frame_count)
        end = min(start + 60, frame_count)
    # The settings poster stays independent of both playback entry frames.
    poster = cv2.imdecode(np.frombuffer(clip.with_suffix(".webp").read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    sketches[clip.name] = {
        "color": trace(poster)["color"],
        "startFrame": full_start,
        "paths": full_paths,
        "signal": signal,
        "quick": {"startFrame": start, "endFrame": end, "paths": quick_paths},
    }
data = {"width": WIDTH, "height": HEIGHT, "characters": sketches}
(ROOT / "src/sketches.json").write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
