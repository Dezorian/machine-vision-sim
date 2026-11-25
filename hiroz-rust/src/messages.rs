use hiroz::{
    MessageTypeInfo,
    msg::{SerdeCdrSerdes, ZMessage},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
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
#[ros_msg(type_name = "conveyor_demo/msg/BoxState")]
pub struct BoxState {
    pub id: u64,
    pub pose: Vec3,
    pub size: Vec3,
    pub weight_kg: f64,
}

impl ZMessage for BoxState {
    type Serdes = SerdeCdrSerdes<BoxState>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[ros_msg(type_name = "conveyor_demo/msg/CameraState")]
pub struct CameraState {
    pub pose: Vec3,
    pub fov_y_deg: f64,
    pub fov_x_deg: f64,
    pub fov_distance: f64,
}

impl ZMessage for CameraState {
    type Serdes = SerdeCdrSerdes<CameraState>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, MessageTypeInfo)]
#[ros_msg(type_name = "conveyor_demo/msg/SceneSnapshot")]
pub struct SceneSnapshot {
    pub stamp_sec: f64,
    pub conveyor_speed: f64,
    pub camera: CameraState,
    pub boxes: Vec<BoxState>,
    pub scale_kg: f64,
}

impl ZMessage for SceneSnapshot {
    type Serdes = SerdeCdrSerdes<SceneSnapshot>;
}
