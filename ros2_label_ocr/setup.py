from setuptools import setup

package_name = 'label_ocr'

setup(
    name=package_name,
    version='0.0.1',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml', 'README.md']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='uconsole-scene-demo',
    maintainer_email='maintainer@example.com',
    description='ROS2 bridge and OCR scaffold for conveyor label crops',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'bridge_to_ros2 = label_ocr.bridge_to_ros2:main',
            'label_ocr_node = label_ocr.label_ocr_node:main',
        ],
    },
)
