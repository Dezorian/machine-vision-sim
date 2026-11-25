use hiroz::{
    MessageTypeInfo,
    msg::{SerdeCdrSerdes, ZMessage},
};
use serde::{Deserialize, Serialize};

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

    pub camera_pose: Vec3,
    pub camera_rot_deg: Vec3,
    pub camera_size: Vec3,
    pub fov_y_m: f64,
    pub fov_x_m: f64,
    pub fov_distance: f64,

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
    pub camera: CameraState,
    pub scale_pose: Vec3,
    pub scale_kg: f64,
    pub config: SceneConfig,
    pub boxes: Vec<BoxState>,
}

impl ZMessage for SceneSnapshot {
    type Serdes = SerdeCdrSerdes<SceneSnapshot>;
}
