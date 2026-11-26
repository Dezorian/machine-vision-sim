use hiroz::{
    MessageTypeInfo,
    msg::{SerdeCdrSerdes, ZMessage},
};
use serde::{Deserialize, Serialize};

// Older configs omit `sensor_y`; they must get the 500 mm default, not 0 mm.
fn default_sensor_y() -> f64 {
    0.5
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/Vec3")]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl ZMessage for Vec3 {
    type Serdes = SerdeCdrSerdes<Vec3>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/BoxState")]
pub struct BoxState {
    pub id: u64,
    pub pose: Vec3,
    pub rot_deg: Vec3,
    pub size: Vec3,
    pub weight_kg: f64,
    // Label face: 0 = +X, 1 = -X, 2 = +Y, 3 = -Y. Top/bottom are unused.
    pub label_side: u64,
    pub label_seed: u64,
    pub country_code: String,
    pub barcode: String,
    pub order_number: String,
}

impl ZMessage for BoxState {
    type Serdes = SerdeCdrSerdes<BoxState>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/CameraState")]
pub struct CameraState {
    pub pose: Vec3,
    pub rot_deg: Vec3,
    pub fov_y_deg: f64,
    pub fov_x_deg: f64,
    pub fov_distance: f64,
}

impl ZMessage for CameraState {
    type Serdes = SerdeCdrSerdes<CameraState>;
}

// One editable camera. `id` is stable across config edits; the browser renders
// all of them and uses a viewer-only selection for the PiP view.
#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/CameraConfig")]
pub struct CameraConfig {
    pub id: u64,
    pub name: String,
    pub pose: Vec3,
    pub rot_deg: Vec3,
    pub size: Vec3,
    pub fov_y_m: f64,
    pub fov_x_m: f64,
    pub fov_distance: f64,
    // Sensor-edge trigger for cropped OCR frames: off | middle | begin | end.
    // `begin` is the rising flank (leading/+Y edge), `end` the falling flank
    // (trailing/-Y edge). `trigger_offset` is metres past the sensor.
    pub trigger_anchor: String,
    pub trigger_offset: f64,
}

impl ZMessage for CameraConfig {
    type Serdes = SerdeCdrSerdes<CameraConfig>;
}

// The browser sends this whenever an editor field changes. The sim owns the
// resulting state and echoes it back in SceneSnapshot.
#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/SceneConfig")]
pub struct SceneConfig {
    pub conveyor_pos: Vec3,
    pub conveyor_rot_deg: Vec3,
    pub conveyor_size: Vec3, // x = width, y = length, z = height
    pub conveyor_speed: f64,
    // World Y of the normally-open box sensor; 0.5 m from the conveyor start.
    #[serde(default = "default_sensor_y")]
    pub sensor_y: f64,

    // Classic single-camera fields mirror cameras[0] for older clients.
    pub camera_pose: Vec3,
    pub camera_rot_deg: Vec3,
    pub camera_size: Vec3,
    pub fov_y_m: f64,
    pub fov_x_m: f64,
    pub fov_distance: f64,
    pub cameras: Vec<CameraConfig>,

    pub scale_pose: Vec3,
    pub scale_rot_deg: Vec3,
    pub scale_size: Vec3,

    pub sink_pose: Vec3,
    pub sink_rot_deg: Vec3,
    pub sink_size: Vec3,

    pub boxes_pos: Vec3,
    pub boxes_rot_deg: Vec3,
    pub boxes_size: Vec3,
    pub boxes_random_size: bool,
    pub boxes_min: Vec3,
    pub boxes_max: Vec3,
    pub spawn_interval: f64,

    pub labels_show: bool,
    pub paused: bool,

    // Monotonic counters: the sim applies spawn/reset only when these advance.
    pub config_seq: u64,
    pub spawn_seq: u64,
    pub reset_seq: u64,

    // Pose/size edits for a specific existing box.
    pub box_overrides: Vec<BoxState>,
    // Ids of boxes the editor asked the sim to remove. Applied once per config.
    pub despawn_ids: Vec<u64>,
}

impl ZMessage for SceneConfig {
    type Serdes = SerdeCdrSerdes<SceneConfig>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/SceneSnapshot")]
pub struct SceneSnapshot {
    pub stamp_sec: f64,
    pub conveyor_speed: f64,
    pub camera: CameraState, // cameras[0], for older clients
    pub cameras: Vec<CameraConfig>,
    pub scale_pose: Vec3,
    pub scale_kg: f64,
    pub config: SceneConfig,
    pub boxes: Vec<BoxState>,
}

impl ZMessage for SceneSnapshot {
    type Serdes = SerdeCdrSerdes<SceneSnapshot>;
}

// A cropped label frame, captured only when a box crosses a camera trigger.
// The full PiP stream is web viewing only and is never sent to the OCR node.
#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[serde(default)]
#[ros_msg(type_name = "conveyor_demo/msg/LabelImage")]
pub struct LabelImage {
    pub stamp_sec: f64,
    pub camera_id: u64,
    pub box_id: u64,
    pub trigger_anchor: String,
    pub trigger_offset: f64,
    pub trigger_y: f64,
    pub image_encoding: String,
    pub image_width: u64,
    pub image_height: u64,
    pub image_b64: String,
}

impl ZMessage for LabelImage {
    type Serdes = SerdeCdrSerdes<LabelImage>;
}
