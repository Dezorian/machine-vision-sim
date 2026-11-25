# label_ocr

ROS2 package that forwards cropped conveyor label images from the Rust HTTP
bridge into ROS2 topics, then passes them through a scaffold for label OCR.

## Topics

| Topic | Type | Description |
| --- | --- | --- |
| `/conveyor/label_image` | `sensor_msgs/msg/CompressedImage` | Latest crop (`format` = bridge `image_encoding`, e.g. `jpeg`) |
| `/conveyor/label_meta` | `std_msgs/msg/String` | JSON metadata (no `image_b64`): `stamp_sec`, `camera_id`, `box_id`, `trigger_anchor`, `trigger_offset`, `trigger_y`, `image_encoding`, `image_width`, `image_height` |
| `/conveyor/label_ocr` | `std_msgs/msg/String` | Same metadata plus a `detections` list |

The bridge node polls `http://127.0.0.1:8765/label_image/latest` (configurable
via the `bridge_url` parameter) at 10 Hz by default (`poll_hz` parameter). It
ignores HTTP 404 responses and only publishes when a new `stamp_sec` is seen.

## Build

From the ROS2 workspace root (or from this repository root, where colcon will
discover `ros2_label_ocr/` as the `label_ocr` package):

```bash
colcon build --packages-select label_ocr
source install/setup.bash
```

## Run

In separate terminals, after sourcing the workspace:

```bash
ros2 run label_ocr bridge_to_ros2
ros2 run label_ocr label_ocr_node
```

Optional parameter overrides:

```bash
ros2 run label_ocr bridge_to_ros2 --ros-args \
  -p bridge_url:=http://192.168.1.10:8765/label_image/latest -p poll_hz:=5.0
```

Inspect results with:

```bash
ros2 topic echo /conveyor/label_ocr
```

## YOLO/OCR status

**This is a scaffold only.** `YOLOLabelOCR.detect_and_read(image)` in
`label_ocr/label_ocr_node.py` currently returns `[]`. Real inference is waiting
for model weights (a trained YOLO label detector) and an OCR engine to read the
label's **weight**, **country code**, and **order number** (and optionally the
**barcode**). The TODOs in that file mark where model loading and OCR integration
belong.

OpenCV (`cv2`) is optional: if it is missing, the OCR node logs a warning and
skips processing without crashing. Install `python3-opencv` to enable image
decoding.
