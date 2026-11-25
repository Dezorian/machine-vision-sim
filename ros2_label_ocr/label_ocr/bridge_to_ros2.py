"""Poll the Rust bridge for the latest cropped label image and publish to ROS2."""

import base64
import binascii
import json
import urllib.error
import urllib.request

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String


class BridgeToROS2(Node):
    """Forward label crops from the HTTP bridge to ROS2 topics."""

    def __init__(self):
        super().__init__('bridge_to_ros2')

        self.declare_parameter('bridge_url', 'http://127.0.0.1:8765/label_image/latest')
        self.declare_parameter('poll_hz', 10.0)

        url = self.get_parameter('bridge_url').get_parameter_value().string_value
        poll_hz = self.get_parameter('poll_hz').get_parameter_value().double_value
        if poll_hz <= 0.0:
            self.get_logger().warn('poll_hz must be positive; using 10.0')
            poll_hz = 10.0
        self._url = url
        self._last_stamp_sec = None

        self._image_pub = self.create_publisher(
            CompressedImage, '/conveyor/label_image', 10)
        self._meta_pub = self.create_publisher(
            String, '/conveyor/label_meta', 10)

        self.create_timer(1.0 / poll_hz, self.poll)
        self.get_logger().info('Polling {} at {} Hz'.format(self._url, poll_hz))

    def poll(self):
        """Fetch the latest label crop; publish only if it is new."""
        try:
            with urllib.request.urlopen(self._url, timeout=2.0) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                self.get_logger().debug('No label image available yet (HTTP 404)')
            else:
                self.get_logger().warn(
                    'Bridge returned HTTP {}'.format(exc.code),
                    throttle_duration_sec=5.0)
            return
        except (urllib.error.URLError, OSError) as exc:
            self.get_logger().warn(
                'Could not reach bridge at {}: {}'.format(self._url, exc),
                throttle_duration_sec=5.0)
            return

        try:
            payload = json.loads(body.decode('utf-8'))
            stamp_sec = payload['stamp_sec']
            image_bytes = base64.b64decode(payload['image_b64'])
        except (ValueError, TypeError, KeyError, UnicodeDecodeError, binascii.Error) as exc:
            self.get_logger().warn(
                'Invalid label image response: {}'.format(exc),
                throttle_duration_sec=5.0)
            return

        if stamp_sec == self._last_stamp_sec:
            return

        # Publish metadata first so the OCR node has it when the image arrives.
        meta = {key: value for key, value in payload.items() if key != 'image_b64'}
        meta_msg = String()
        meta_msg.data = json.dumps(meta, sort_keys=True)
        self._meta_pub.publish(meta_msg)

        image_msg = CompressedImage()
        image_msg.header.stamp = self.get_clock().now().to_msg()
        image_msg.header.frame_id = str(payload.get('camera_id') or 'camera')
        image_msg.format = str(payload.get('image_encoding') or 'jpeg')
        image_msg.data = image_bytes
        self._image_pub.publish(image_msg)

        self._last_stamp_sec = stamp_sec
        self.get_logger().debug('Published label crop with stamp_sec={}'.format(stamp_sec))


def main(args=None):
    rclpy.init(args=args)
    node = BridgeToROS2()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
