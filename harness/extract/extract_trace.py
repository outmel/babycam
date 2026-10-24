"""
Turn a recorded video into a Lulu trace so the replay harness can score it.

Runs the same model family as the app (YOLO11n, MediaPipe Pose on person crops, YAMNet on
0.975 s audio windows every 0.5 s) and writes harness/clips/<clip>/trace.jsonl plus a
labels.json template for you to fill in with what *should* have alerted.

    pip install -r harness/extract/requirements.txt
    python models/fetch_models.py            # downloads YAMNet + the pose model this script uses
    python harness/extract/extract_trace.py nursery.mp4 --zone "crib:0.25,0.2;0.75,0.2;0.75,0.85;0.25,0.85"

Then label the clip (times in seconds) and run `npm run replay` in harness/.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FPS = 5
HOP_S = 0.5
WINDOW = 15600
PERSON = 0
HAZARDS = {40: "wine glass", 42: "fork", 43: "knife", 76: "scissors"}
CRY_CLASSES = ["Crying, sobbing", "Baby cry, infant cry"]


def parse_zone(spec: str, i: int) -> dict:
    name, _, pts = spec.partition(":") if ":" in spec else (f"zone {i + 1}", "", spec)
    points = [{"x": float(x), "y": float(y)} for x, y in (p.split(",") for p in pts.split(";"))]
    if len(points) < 3:
        raise SystemExit(f"Zone '{spec}' needs at least 3 points")
    return {"id": f"z{i + 1}", "name": name, "points": points}


def health(frame_bgr: np.ndarray) -> dict:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    samples = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_NEAREST).astype(np.float32)
    thumb = cv2.resize(gray, (16, 16), interpolation=cv2.INTER_AREA)
    return {"mean": round(float(samples.mean()), 1), "std": round(float(samples.std()), 1), "thumb": thumb.flatten().astype(int).tolist()}


def r3(x: float) -> float:
    return round(float(x), 3)


def detect(model, frame_bgr: np.ndarray, imgsz: int) -> list[dict]:
    res = model.predict(frame_bgr, imgsz=imgsz, conf=0.1, classes=[PERSON, *HAZARDS], verbose=False)[0]
    dets = []
    for (x1, y1, x2, y2), score, cls in zip(res.boxes.xyxyn.tolist(), res.boxes.conf.tolist(), res.boxes.cls.tolist()):
        cls = int(cls)
        if cls != PERSON and score < 0.4:
            continue
        dets.append({"box": {"x": r3(x1), "y": r3(y1), "w": r3(x2 - x1), "h": r3(y2 - y1)}, "score": r3(score), "cls": cls})
    return dets


def poses_for(landmarker, mp, frame_bgr: np.ndarray, dets: list[dict]) -> list[dict]:
    """Same approach as the app: square crop around each confident person, landmarks mapped back."""
    h, w = frame_bgr.shape[:2]
    people = sorted((d for d in dets if d["cls"] == PERSON and d["score"] >= 0.4), key=lambda d: -d["score"])[:2]
    out = []
    for d in people:
        b = d["box"]
        cx, cy = (b["x"] + b["w"] / 2) * w, (b["y"] + b["h"] / 2) * h
        size = max(b["w"] * w, b["h"] * h) * 1.25
        x0, y0 = int(round(cx - size / 2)), int(round(cy - size / 2))
        s = int(round(size))
        canvas = np.zeros((s, s, 3), dtype=np.uint8)
        sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x0 + s), min(h, y0 + s)
        if sx1 <= sx0 or sy1 <= sy0:
            continue
        canvas[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = frame_bgr[sy0:sy1, sx0:sx1]
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
        result = landmarker.detect(image)
        if not result.pose_landmarks:
            continue
        lms = [{"x": r3((x0 + p.x * s) / w), "y": r3((y0 + p.y * s) / h), "v": r3(p.visibility or 0)} for p in result.pose_landmarks[0]]
        out.append({"box": b, "landmarks": lms})
    return out


def audio_scores(video: Path, yamnet_path: Path) -> list[dict]:
    from mediapipe.tasks.python import audio
    from mediapipe.tasks.python.components.containers import audio_data
    from mediapipe.tasks.python.core.base_options import BaseOptions

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        capture_output=True,
        check=False,
    ).stdout
    samples = np.frombuffer(raw, dtype=np.float32)
    if samples.size < WINDOW:
        print("  no usable audio track; skipping cry detection")
        return []
    opts = audio.AudioClassifierOptions(
        base_options=BaseOptions(model_asset_path=str(yamnet_path)),
        running_mode=audio.RunningMode.AUDIO_CLIPS,
        category_allowlist=CRY_CLASSES,
        max_results=len(CRY_CLASSES),
    )
    items = []
    with audio.AudioClassifier.create_from_options(opts) as clf:
        hop = int(HOP_S * 16000)
        for start in range(0, samples.size - WINDOW + 1, hop):
            clip = audio_data.AudioData.create_from_array(samples[start : start + WINDOW], 16000)
            results = clf.classify(clip)
            cats = results[0].classifications[0].categories if results and results[0].classifications else []
            cry = max((c.score for c in cats), default=0.0)
            # Same timestamp convention as the app: when the window ends.
            items.append({"kind": "audio", "t": r3((start + WINDOW) / 16000), "cry": r3(cry)})
    return items


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path)
    ap.add_argument("--zone", action="append", default=[], help='"name:x,y;x,y;x,y" in 0..1 frame coordinates (repeatable)')
    ap.add_argument("--mount", choices=["overhead", "side"], default="overhead")
    ap.add_argument("--clip", help="clip name (default: video file name)")
    ap.add_argument("--imgsz", type=int, default=320, help="YOLO input size, 320 matches the app")
    ap.add_argument("--yolo-weights", default="yolo11n.pt")
    ap.add_argument("--no-pose", action="store_true")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--out", type=Path, default=ROOT / "harness" / "clips")
    args = ap.parse_args()

    from ultralytics import YOLO

    clip = args.clip or f"video-{args.video.stem}"
    zones = [parse_zone(z, i) for i, z in enumerate(args.zone)]
    model = YOLO(args.yolo_weights)

    landmarker = mp = None
    if not args.no_pose:
        import mediapipe as mp
        from mediapipe.tasks.python import vision
        from mediapipe.tasks.python.core.base_options import BaseOptions

        task = ROOT / "harness" / "extract" / "pose_landmarker_lite.task"
        if not task.exists():
            raise SystemExit("Pose model missing: run `python models/fetch_models.py` first")
        landmarker = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(task)), running_mode=vision.RunningMode.IMAGE, num_poses=1)
        )

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"Cannot open {args.video}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(src_fps / FPS))
    items: list[dict] = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            t = idx / src_fps
            dets = detect(model, frame, args.imgsz)
            item = {"kind": "frame", "t": r3(t), "detections": dets, "health": health(frame)}
            if landmarker is not None:
                poses = poses_for(landmarker, mp, frame, dets)
                if poses:
                    item["poses"] = poses
            items.append(item)
            if len(items) % 50 == 0:
                print(f"  {t:.0f}s analysed")
        idx += 1
    cap.release()
    duration = idx / src_fps

    if not args.no_audio:
        yamnet = ROOT / "apps" / "mobile" / "assets" / "models" / "yamnet.tflite"
        if yamnet.exists():
            items += audio_scores(args.video, yamnet)
        else:
            print("  yamnet.tflite missing (run models/fetch_models.py); skipping audio")
    items.sort(key=lambda x: x["t"])

    out = args.out / clip
    out.mkdir(parents=True, exist_ok=True)
    header = {"kind": "header", "version": 1, "clip": clip, "source": "video", "mount": args.mount, "zones": zones, "durationSec": round(duration, 1), "note": f"Extracted from {args.video.name}"}
    with open(out / "trace.jsonl", "w", encoding="utf-8") as f:
        for row in [header, *items]:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
    labels = out / "labels.json"
    if not labels.exists():
        labels.write_text(json.dumps({
            "clip": clip,
            "durationSec": round(duration, 1),
            "labels": [],
            "_howto": "Add one entry per thing that SHOULD alert: {\"type\": \"cry_detected\", \"start\": 12.0, \"end\": 40.0}. "
                      "Types: cry_detected, zone_edge, zone_exit, sat_up, rolled_over, hazard_near, camera_blocked, camera_dark, camera_moved. "
                      "An empty list means nothing should alert.",
        }, indent=2) + "\n")
    print(f"wrote {out / 'trace.jsonl'} ({len(items)} items, {duration:.0f}s)")


if __name__ == "__main__":
    main()
