GitHub: https://github.com/SpaceY-Labs/RoCam

After 8 months, our software engineering capstone project is complete.

We built RoCam, a real-time vision-guided rocket tracker for the McMaster Rocketry Team. A rocket in Mach-class flight can occupy less than 0.1% of a 1080p frame, roughly 15×15 pixels, which makes manual tracking extremely difficult.

The system combines Jetson Orin Nano edge inference, YOLO26s deployed with TensorRT FP16, DeepStream/GStreamer, a multi-process Python backend with shared-memory IPC across CV, control, livestream, and transcode, Rust + Embassy firmware on an STM32F405RG, a CRC-8/SMBUS UART gimbal protocol, and a React/TypeScript/Vite operator UI.

Runtime fast path:

`camera capture -> GPU letterboxing/preprocessing -> YOLO26s inference -> best detection selection -> P-control + GL shader crop/zoom in the operator preview`

A few implementation details:

* Browser preview, local live output, and recording were split into separate paths instead of being treated as the same workload.
* Full-resolution live output stayed local through a dedicated livestream process, while the browser preview used JPEG preview frames over a 30 Hz SSE status stream.
* Recording was designed as raw capture first, stabilized replay later, with preview and download rebuilt on demand from video plus per-frame telemetry.

We also built a separate labeling stack with React, Express, Firebase, SAM-assisted annotation, Feather/Arrow mask import, and sparse-mask storage.

The ML side was optimized for deployed behavior, not just offline metrics: 15,000 labeled images, 4,000 COCO hard negatives, full mosaic = 1.0, multi-scale training, ONNX export, and TensorRT FP16 deployment on Jetson. Much of the training and ablation work was run on McMaster’s CAS department GPU cluster, including 4-GPU DDP experiments on H100s.

We went through a lot of failed iterations before the final detector. Across 10+ serious experiments, we tested P2 four-head variants, low-mosaic regimes, higher-resolution scaling, transfer learning, copy-paste synthesis, and SAHI tiled detection. Several ideas looked good in training but failed under Jetson FP16 deployment or missed the runtime budget.

Final deployed result:

* 94.3% precision
* 89.8% recall
* 60 FPS
* about 9% deployment accuracy loss relative to training

We also put a lot of effort into software quality:

* 481 automated tests
* 313 backend tests with pytest
* 168 frontend tests with Vitest
* about 88% backend line coverage
* about 86% frontend line coverage

Real-world ML is usually a systems engineering problem first.

Proud of what our team built.

Jianqing Liu, Xiaotian Lou
