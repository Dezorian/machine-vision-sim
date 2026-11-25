"""Subscribe to label crops and metadata, and run the (stubbed) label OCR."""

import json

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String

try:
    import cv2
    import numpy as np
except ImportError:
    # OCR processing is optional at runtime; ROS2 messages still flow without cv2.
    cv2 = None
    np = None


class YOLOLabelOCR:
    """Scaffold for YOLO label detection plus OCR of the label fields.

    TODO: Load YOLO model weights (e.g. a trained label-detector .pt/onnx file)
    and configure the model path, confidence threshold and device.
    TODO: Plug in an OCR engine to read, from each detected label crop:
    - weight
    - country code
    - barcode
    - order number
    """

    def __init__(self):
        # TODO: load YOLO weights and initialise the OCR engine here.
        pass

    def detect_and_read(self, image):
        """Detect labels in a decoded BGR image and read their text.

        :param image: OpenCV BGR image (numpy.ndarray)
        :returns: list of detections; empty until the model/engine are wired up.
        """
        # TODO: run YOLO inference to get label crops.
        # TODO: OCR each crop for weight, country code and order number.
        return []


class LabelOCRNode(Node):
    """Pair label images with metadata and publish OCR results as JSON."""

    def __init__(self):
        super().__init__('label_ocr_node')

        self._ocr = YOLOLabelOCR()
        self._latest_meta = None
        self._latest_image = None
        self._processed_key = None

        self._image_sub = self.create_subscription(
            CompressedImage, '/conveyor/label_image', self.image_callback, 10)
        self._meta_sub = self.create_subscription(
            String, '/conveyor/label_meta', self.meta_callback, 10)
        self._result_pub = self.create_publisher(String, '/conveyor/label_ocr', 10)

        if cv2 is None:
            self.get_logger().warn(
                'cv2 is not available; label OCR processing is disabled. '
                'Install python3-opencv to enable it.')

    def meta_callback(self, msg):
        try:
            meta = json.loads(msg.data)
        except (ValueError, TypeError) as exc:
            self.get_logger().warn('Invalid label metadata JSON: {}'.format(exc))
            return
        if not isinstance(meta, dict):
            self.get_logger().warn('Label metadata JSON is not an object; ignoring')
            return
        self._latest_meta = meta
        self.try_process()

    def image_callback(self, msg):
        self._latest_image = msg
        self.try_process()

    def try_process(self):
        """Process the most recent image/metadata pair exactly once."""
        if self._latest_meta is None or self._latest_image is None:
            return
        if cv2 is None:
            self.get_logger().warn(
                'Skipping label OCR because cv2 is not available',
                throttle_duration_sec=10.0)
            return

        image_msg = self._latest_image
        stamp = image_msg.header.stamp
        key = (
            self._latest_meta.get('stamp_sec'),
            stamp.sec,
            stamp.nanosec,
        )
        if key == self._processed_key:
            return

        try:
            image = cv2.imdecode(
                np.frombuffer(bytes(image_msg.data), dtype=np.uint8),
                cv2.IMREAD_COLOR)
        except Exception as exc:
            self.get_logger().warn('Failed to decode label image: {}'.format(exc))
            return
        if image is None:
            self.get_logger().warn('Failed to decode label image; skipping')
            return

        detections = self._ocr.detect_and_read(image)

        result = dict(self._latest_meta)
        result['detections'] = detections
        out_msg = String()
        out_msg.data = json.dumps(result, sort_keys=True)
        self._result_pub.publish(out_msg)
        self._processed_key = key
        self.get_logger().debug(
            'Published OCR result with {} detection(s)'.format(len(detections)))


def main(args=None):
    rclpy.init(args=args)
    node = LabelOCRNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
