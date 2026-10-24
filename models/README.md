# On-device models

| File (in `apps/mobile/assets/models/`) | Model | Used for |
|---|---|---|
| `yolo11n.tflite` | Ultralytics YOLO11n, 320×320, float32 | People and objects (scissors, knives, forks, glasses) |
| `pose_landmarks.tflite` | MediaPipe Pose Landmarker (lite) | Sitting up, rolled onto tummy |
| `yamnet.tflite` | YAMNet audio classifier | Crying (classes 19 "Crying, sobbing" and 20 "Baby cry, infant cry") |

```sh
python models/fetch_models.py            # YAMNet + MediaPipe Pose (downloads, ~7 MB)
python models/fetch_models.py --yolo     # + YOLO11n export (Linux x86 or macOS, needs `pip install ultralytics`)
```

Ultralytics only exports TFLite on Linux and macOS. On Windows, run the **Export YOLO11n** GitHub Action
(`.github/workflows/export-yolo.yml`, Actions tab → Run workflow), download the artifact, then:

```sh
python models/fetch_models.py --skip-downloads --yolo-file path/to/yolo11n_float32.tflite
```

The script regenerates `apps/mobile/src/vision/modelAssets.ts`. Rebuild the app afterwards. Until YOLO is
installed, the camera still runs cry detection and camera-health checks, and it shows a banner saying
object alerts are off.

Licenses: YOLO11 is AGPL-3.0 (Ultralytics); MediaPipe models and YAMNet are Apache-2.0.
