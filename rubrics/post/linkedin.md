GitHub: https://github.com/SpaceY-Labs/RoCam

After 8 months of work, our capstone project is complete.

We built RoCam, a real-time vision-guided rocket tracker for the McMaster Rocketry Team. The target problem was difficult from both a CV and systems standpoint: a Mach 3-class rocket can occupy less than 0.1% of a 1080p frame, roughly 15x15 pixels, so manual tracking is not realistic.

The final system combined:

- Jetson Orin Nano edge inference
- YOLO26s deployed with TensorRT FP16
- DeepStream/GStreamer for the video pipeline
- a multi-process Python backend with shared-memory IPC separating CV, control, livestream, and transcode
- Rust + Embassy firmware on an STM32F405RG
- a CRC-8/SMBUS UART gimbal protocol
- a React/TypeScript/Vite operator UI for preview, telemetry, override, and recording

At runtime, the fast path was:

camera capture -> GPU letterboxing/preprocessing -> YOLO26s inference -> best detection selection -> P-control for the gimbal + GL shader crop/zoom in the operator preview

A few implementation details I think are worth calling out:

- We kept the latency-critical path on GPU and split browser preview, local live output, and recording into different paths instead of treating them as the same workload.
- Full-resolution live output stayed local through a separate livestream process, while the browser preview used lighter-weight JPEG preview frames over a 30 Hz SSE status stream.
- The gimbal/control side used a simple single-target P-controller with timestamp matching between detections and preview frames.
- Recording was designed as raw capture first, stabilized replay later, with preview/download rebuilt on demand from video plus per-frame telemetry.

We also built a separate labeling stack for the dataset:

- React + Express + Firebase
- SAM-assisted annotation
- Feather/Arrow mask import
- sparse-mask storage for more manageable annotation data

The ML side was optimized for deployed behavior, not just offline training metrics:

- 15,000 labeled images
- 4,000 COCO hard negatives
- full mosaic = 1.0
- multi-scale training
- export through ONNX and deployment on Jetson in TensorRT FP16

One of the biggest lessons was that the best training model was not the best deployed model. Our strongest FP32 training variant lost too much accuracy after FP16 deployment, so final model selection was driven by Jetson results, not just H100 training curves.

Final deployed result:

- 94.3% precision
- 89.8% recall
- 60 FPS
- about 9% training-to-deployment accuracy loss

We also put a lot of effort into software quality:

- 481 automated tests
- 313 backend tests with pytest
- 168 frontend tests with Vitest
- about 88% backend line coverage
- about 86% frontend line coverage

This project was a good reminder that real-world ML is usually a systems engineering problem first.

Proud of what our team built.

#CapstoneProject #ComputerVision #EmbeddedSystems #EdgeAI #MachineLearning #Robotics #Jetson #TensorRT #GStreamer #Rust #SoftwareEngineering
