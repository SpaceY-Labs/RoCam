//! Author: Jianqing Liu
//! Date: 2025-10-28
//! Purpose: RPC server handling gimbal commands over half-duplex UART serial.

use defmt::{error, info};
use embassy_stm32::{
    gpio::Level,
    usart::{BufferedUart, Error as UartError},
};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, watch::Watch};
use embedded_io_async::{Read, Write};
use firmware_common_new::rpc::{gimbal_rpc::*, half_duplex_serial::HalfDuplexSerial};

use crate::led::{set_arm_led, set_status_led};

pub struct GimbalRpc {
    pub tilt_angle_deg_watch: &'static Watch<CriticalSectionRawMutex, f32, 1>,
    pub pan_angle_deg_watch: &'static Watch<CriticalSectionRawMutex, f32, 1>,
    pub focal_length_mm_watch: &'static Watch<CriticalSectionRawMutex, f32, 1>,
}

impl GimbalRpcServer for GimbalRpc {
    async fn gimbal_info(&mut self) -> GimbalInfoResponse {
        GimbalInfoResponse {
            tilt_range_deg: (0.0, 90.0),
            pan_range_deg: (-45.0, 45.0),
            focal_length_range_mm: (24.0, 120.0),
        }
    }

    async fn set_arm_led(&mut self, enabled: bool) -> SetArmLedResponse {
        set_arm_led(if enabled { Level::High } else { Level::Low });
        SetArmLedResponse {}
    }

    async fn set_status_led(&mut self, enabled: bool) -> SetStatusLedResponse {
        set_status_led(if enabled { Level::High } else { Level::Low });
        SetStatusLedResponse {}
    }

    async fn set_deg(&mut self, mut tilt: f32, mut pan: f32) -> SetDegResponse {
        if tilt > 90.0 {
            tilt = 90.0;
        } else if tilt < 0.0 {
            tilt = 0.0;
        }
        if pan > 45.0 {
            pan = 45.0;
        } else if pan < -45.0 {
            pan = -45.0;
        }
        self.tilt_angle_deg_watch.sender().send(tilt);
        self.pan_angle_deg_watch.sender().send(pan);
        SetDegResponse {}
    }

    async fn get_deg(&mut self) -> GetDegResponse {
        GetDegResponse {
            tilt_deg: self
                .tilt_angle_deg_watch
                .anon_receiver()
                .try_get()
                .unwrap_or(0.0),
            pan_deg: self
                .pan_angle_deg_watch
                .anon_receiver()
                .try_get()
                .unwrap_or(0.0),
        }
    }

    async fn set_focal_length_mm(&mut self, focal_length_mm: f32) -> SetFocalLengthMmResponse {
        self.focal_length_mm_watch.sender().send(focal_length_mm);
        SetFocalLengthMmResponse {}
    }

    async fn get_focal_length_mm(&mut self) -> GetFocalLengthMmResponse {
        GetFocalLengthMmResponse {
            focal_length_mm: self
                .focal_length_mm_watch
                .anon_receiver()
                .try_get()
                .unwrap_or(24.0),
        }
    }

    async fn get_gps_data(&mut self) -> GetGpsDataResponse {
        GetGpsDataResponse {
            longitude: f64::NAN,
            latitude: f64::NAN,
            timestamp_ms: 0,
        }
    }
}

#[embassy_executor::task]
pub async fn rpc_task(uart: BufferedUart<'static>, mut rpc: GimbalRpc) {
    struct SerialWrapper(BufferedUart<'static>);

    impl HalfDuplexSerial for SerialWrapper {
        type Error = UartError;

        async fn read(&mut self, buf: &mut [u8]) -> Result<usize, Self::Error> {
            self.0.read(buf).await
        }

        async fn write(&mut self, buf: &[u8]) -> Result<usize, Self::Error> {
            self.0.write(buf).await
        }

        async fn clear_read_buffer(&mut self) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    let mut serial = SerialWrapper(uart);

    info!("RPC server started");
    loop {
        let err = rpc.run_server(&mut serial).await.unwrap_err();
        error!("Error while running rpc server: {:?}", err);
    }
}
