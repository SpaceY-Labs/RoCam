# RoCam Final Presentation — Speech Scripts

> **Total time**: 20 minutes + 5 min Q&A
> **Remember**: Dress professionally, use the microphone, practice with actual devices.

---

## Slide Flow & Speaker Map

| Slide | Title | Speaker | Time |
|-------|-------|---------|------|
| 1 | Title | Jianqing | 0:30 |
| 2 | Problem & Roadmap | Jianqing | 1:30 |
| 3 | Solution | Jianqing | 1:00 |
| 4 | Architecture | Jianqing | 1:30 |
| 5 | **LIVE DEMO** | **All** | 3:00 |
| 6 | Labelling App | Mike | 1:30 |
| 7 | CV Pipeline | Mike / Xiaotian | 1:30 |
| 8 | ML Training | Xiaotian | 1:30 |
| 9 | Hardware & Firmware | Jianqing | 1:30 |
| 10 | Fault Tolerance | Jianqing | 1:00 |
| 11 | Web UI | Zifan | 1:30 |
| 12 | State Machine & Safety | Zifan | 1:00 |
| 13 | Testing & QA | Xiaotian | 1:30 |
| 14 | Challenges | Jianqing | 1:00 |
| 15 | Future | Jianqing | 0:45 |
| 16 | Thank You | Jianqing | 0:15 |

**Total ≈ 20 min**

---

## JIANQING LIU — Slides 1-4, 9-10, 14-16

### Slide 1 — Title (0:30)

Good morning, everyone. We are Team SpaceY, and this is **RoCam** — a high-performance, vision-guided rocket tracking system.

Let me quickly introduce our team. Zifan designed our web interface and user experience. I handled the system architecture, backend, and embedded firmware. Mike built our data tooling and labelling platform. And Xiaotian led our computer vision, machine learning pipeline, and system testing.

### Slide 2 — The Challenge (1:30)

So, what problem are we solving?

Hobbyist rockets can reach **Mach 3** — that's over 1,000 meters per second — and the entire visible event may last less than one second. At those speeds, no human can manually track and film a rocket through a telephoto lens. It's physically impossible.

The commercial solutions that exist — motorized tracking rigs with radar or GPS — cost **upward of $10,000**. That puts them completely out of reach for hobbyist rocketry clubs and university teams.

Here's our roadmap for today: We'll start with the problem and our solution, then jump straight into a **live demo** so you can see it working. After that, we'll walk through the technical deep dives — data pipeline, CV, ML, hardware, and the user interface. We'll close with testing evidence, challenges we overcame, and where RoCam goes next.

### Slide 3 — The RoCam Solution (1:00)

Our answer is RoCam — a fully autonomous, closed-loop optical tracking system.

Three key design pillars. First, **Edge AI Tracking**: we run a custom YOLO model accelerated by TensorRT directly on a Jetson Orin Nano — all inference happens at the edge, no cloud dependency. Second, a **60 Hz control loop**: our STM32 firmware processes bounding-box data and drives servos at 60 updates per second — fast enough to keep up with a rocket at close range. Third, and critically for a capstone project, we met our **budget constraint**: total bill of materials came in under $500 Canadian, compared to $10,000-plus commercial alternatives.

This isn't just cheaper — it's a fundamentally different, accessible approach to high-speed optical tracking.

### Slide 4 — Modular System Architecture (1:30)

Before the demo, let me give you the 30-second architecture overview so you know what you're about to see.

The system has four modular stages. **Stage 1, Input**: a 1080p camera captures raw video at 60 frames per second. **Stage 2, Processing**: the Jetson's GPU runs hardware-accelerated inference through NVIDIA DeepStream and extracts bounding-box coordinates. **Stage 3, Actuation**: those coordinates are sent over UART to a custom STM32 PCB, which runs a PID controller and drives the gimbal servos directly. **Stage 4, Interface**: a React web application provides live video preview, manual override, and real-time telemetry.

These four modules are fully decoupled — you can restart any process independently without crashing the others. Now, let me prove this actually works.

---

*[Jianqing transitions to Demo]*

### Slide 5 — LIVE DEMO (3:00, all members)

**Jianqing**: Alright, let's fire it up. What you're seeing here is RoCam running live — not from an IDE, not from a script — this is the deployed system.

*[Jianqing operates the hardware, Zifan shows the Web UI on screen]*

**Zifan**: On the web interface, you can see the live video feed. I'm going to arm the system now — watch the state indicator change from Disarmed to Armed. The CV pipeline is now actively scanning for a target.

**Jianqing/Xiaotian**: *[Introduce the target — e.g., a moving object or recorded rocket footage]* Watch as the system detects the target — there, you see the bounding box lock on. The gimbal is now tracking autonomously at 60 Hz.

**Mike**: And on the telemetry panel, you can see the real-time detection confidence, frame rate, and servo positions updating live.

**Jianqing**: Let me show you the manual override — Zifan, take control.

**Zifan**: *[Demonstrates manual gimbal control via web UI]* I can override the gimbal from the browser, and when I release, automatic tracking resumes immediately.

**Jianqing**: That's the core loop — detect, track, actuate — all under 16 milliseconds per frame. Now, let's dive into how each piece works under the hood. I'll hand it over to Mike.

---

*[Transition to Mike]*

---

## MIKE CHEN — Slides 6-7

### Slide 6 — RoCam Labeler / Data Tooling (1:30)

Thanks, Jianqing. So the first question in any ML pipeline is: where does the data come from?

Rocket imagery is not something you find on Kaggle. There is no public dataset of high-altitude hobbyist rockets against sky backgrounds. So we built our own annotation platform from scratch — the **RoCam Labeler**.

It's a full-stack application with three core features. First, **SAM-Assisted Annotation** — we integrated Meta's Segment Anything Model, so an annotator clicks once on a rocket, and SAM generates a precise segmentation mask automatically. This cut our annotation time by roughly 5x compared to manual bounding-box drawing. Second, **multi-project workspace** — you can see on the right, each dataset is organized as a project with progress tracking, so we always know how many images are labelled and how many remain. Third, **batch operations** — upload a ZIP of raw images, and export in YOLO format with one click. This gave us a clean, reproducible pipeline from raw field footage to training-ready datasets.

Every single training image in our model passed through this system.

### Slide 7 — CV Pipeline (1:30)

Now let me walk you through the inference pipeline that runs on the Jetson in real time.

The flow is: **Decode** the camera stream → run **YOLO26s** object detection → **Extract** the bounding-box center → pass it to **TensorRT** for hardware-accelerated FP16 inference.

Why did we choose YOLO26s specifically? Because we added a **custom P2 stride-4 detection head**. Standard YOLO architectures use stride-8 or stride-16, which works fine for large objects. But at extreme range, our rocket can occupy less than **1% of the frame** — we're talking maybe 15 pixels wide. The P2 head preserves fine-grained spatial features that would be lost at higher strides.

On the deployment side, we use **NVIDIA DeepStream** — this isn't just running inference in a Python loop. DeepStream handles hardware-accelerated video decode, batched TensorRT inference, and metadata extraction all within a single optimized pipeline. That's how we guarantee the entire cycle — decode, infer, extract — stays under our **16.6-millisecond** per-frame budget.

I'll hand it to Xiaotian to walk through the training side.

---

## XIAOTIAN LOU — Slides 8, 13

### Slide 8 — ML Training Pipeline (1:30)

Thanks, Mike. So you've seen where the data comes from and how inference runs. Let me show you how we trained the model.

We developed a **3-stage training pipeline** on a multi-GPU H100 cluster, using 15,000 rocket images from Mike's Labelling App plus 2,000 COCO negative samples — empty skies, birds, clouds — to suppress false positives.

**Stage 1**: 300 epochs, 4-GPU DDP. We load COCO pre-trained weights into our YOLO26s-P2 config and train at 960px with mosaic=0.4 and patience=0 — no early stopping. The negative samples are mixed in from the start so the model learns what a rocket is *not* from day one. We also inject custom Albumentations — motion blur, Gaussian noise, JPEG compression, downscale — to simulate real-world imaging degradation.

**Stage 2**: 120 epochs, single GPU. We switch to SGD at lr=0.002, turn off mosaic, and enable `rect=True` for full-resolution fine-tuning. This is where the model learns to detect at native aspect ratio without the distortion that mosaic introduces.

**Stage 3**: 60 epochs, lr=0.0002 — a 10x drop. Same dataset, but augmentation probabilities are reduced by 30%. This stabilizes the weights and squeezes out the last bit of precision.

The result: **0.958 mAP@50**, and a **22% improvement** in mAP@50-95 over baseline COCO weights under extreme weather validation.

---

*[Jianqing returns for Hardware]*

---

## JIANQING LIU (continued) — Slides 9-10

### Slide 9 — Hardware & Firmware (1:30)

Thanks, Xiaotian. Now let me talk about what happens after the Jetson computes a bounding box — how we actually move the gimbal.

We designed a **custom PCB** around the STM32F405, and the firmware is written entirely in **Rust** using the Embassy async framework. Why Rust instead of C? Two reasons: memory safety guarantees — there are no null pointer dereferences or buffer overflows possible — and Embassy gives us cooperative async without an RTOS, so the firmware is more deterministic.

The control loop runs at **60 Hz** — every 16 milliseconds, the firmware reads the latest bounding-box coordinates from the Jetson over UART at 115,200 baud, computes PID corrections for pan and tilt, and writes PWM signals to the servos. Every UART packet includes a **CRC-8 checksum** — if a packet is corrupted, we discard it and hold the last known position rather than sending garbage to the servos.

Finally, a **hardware watchdog** trips in under half a second if the firmware freezes. The gimbal parks itself safely rather than spinning out of control.

### Slide 10 — Fault-Tolerant Architecture (1:00)

Our backend runs as **four independent OS processes** on the Jetson — CV Process, Live Video streaming, the Control Core, and a Transcode process for recording.

Why not just one big process? Because if the CV inference hits an edge case and crashes, the **Control Core** — which owns the UART connection to the gimbal — stays alive. The gimbal doesn't lock up; it holds position until CV restarts. This typically takes under 2 seconds, and the user never loses their video feed.

Communication between processes uses **shared-memory IPC** — zero-copy. A 1080p frame is 6 megabytes; copying that through a pipe or socket 60 times per second would be a bottleneck. With shared memory, it's instant.

Now, Zifan will show you the operator's side of all this.

---

## ZIFAN SI — Slides 11-12

### Slide 11 — Mission Control UI (1:30)

Thanks, Jianqing. So everything you've heard about — the CV pipeline, the firmware, the fault-tolerant backend — the operator controls all of it through **this** web interface.

We built the UI with **React, TypeScript, and Vite**, using Tailwind CSS for styling. The design goal was simple: if you're standing in a field about to launch a rocket, you need to arm the system, see the live feed, and monitor health — all without reading a manual.

Let me walk through the key features. **Low-latency live preview** — we stream the camera feed directly to the browser so the operator can confirm the framing before launch. **Manual gimbal override** — as you saw in the demo, the operator can take direct control of pan and tilt from the browser at any time. **Real-time telemetry** — the dashboard shows detection confidence, frame rate, servo positions, and system health. If something goes wrong, the operator sees it instantly through **toast notifications** — not buried in a log file.

We also implemented **full bilingual support** — English and French — using a complete i18n system, because accessibility matters even for a field tool.

### Slide 12 — State Machine & Safety (1:00)

The system operates through **four well-defined states**, and the operator transitions between them through the web UI.

**Disarmed** is the safe default — motors are off, the operator has full manual control. You use this for setup and framing. When the operator clicks "Arm," we enter the **Armed** state — the servos activate and the CV pipeline begins scanning for a target. The moment the model detects a rocket with sufficient confidence, we auto-transition to **Tracking** — the closed-loop PID takes over and follows the rocket autonomously. After the event ends — detection lost for a configurable timeout — we enter **Recording**, where the system saves the captured H.264 footage to disk.

Critically, **hardware limits are enforced at every state**. The servos have software-defined angle limits, and the watchdog will park the gimbal if the firmware ever becomes unresponsive. There is no state where the system can spin out of control.

---

## XIAOTIAN LOU (continued) — Slide 13

### Slide 13 — Testing & Quality Assurance (1:30)

Alright, now let me back up our claims with data.

We have **481 automated tests** passing across the entire codebase. On the backend, **313 pytest unit tests** cover the CV process, control logic, and state management, achieving **88% code coverage**. On the frontend, **168 Vitest component tests** validate the React UI — toggle states, telemetry rendering, override controls — at **86% coverage**.

All of this runs automatically through **GitHub Actions CI** on every pull request, with a cross-platform test matrix and formatting gates. Our CI has maintained a **100% pass rate** on the main branch throughout the project.

This isn't just testing for the sake of testing. When we swapped from YOLOv8 to YOLO26s mid-project, these tests caught three regression bugs in the control process within minutes — bugs that would have been invisible in manual testing.

The key takeaway: with 481 automated tests and continuous integration, we can make aggressive design changes — like switching our entire ML model — and verify correctness in under 3 minutes.

---

## JIANQING LIU (continued) — Slides 14-16

### Slide 14 — Project Challenges (1:00)

No project goes smoothly, so let me share three real challenges we hit.

First, **real-time latency**. Python's Global Interpreter Lock was blocking our CV loop — we couldn't run inference and servo communication in the same process efficiently. Our solution: we moved to a **multi-process architecture with shared-memory IPC**, completely bypassing the GIL.

Second, **micro-object detection**. At extreme range, rockets literally vanish into background noise. Standard YOLO missed them entirely. That's why we developed the **YOLO26s-P2 head** and the **hard-negative mining** stage in our training — these weren't theoretical choices, they were direct responses to real failure modes.

Third, **hardware communication**. We were losing UART packets between the Jetson and the STM32. We hooked up a logic analyzer, found timing issues at 115,200 baud, and implemented **CRC-8 checksums** with automatic retransmission. Packet loss went from ~2% to effectively zero.

### Slide 15 — Future Scalability (0:45)

RoCam is designed to scale. On the **performance** side: 4K tracking, INT8 quantization for even faster inference, and optical autofocus for sharper imagery at range. On **hardware**: full-size gimbal mounts, multi-camera arrays, and weatherproof enclosures for field deployment. And on the **software UX** side: mobile-native apps, post-flight analytics, and an AR telemetry overlay.

Our next concrete step is scaling from the current 200-meter hobby range to **3-kilometer-plus** high-power launches — and the modular architecture we've shown today makes that a configuration change, not a rewrite.

### Slide 16 — Thank You (0:15)

That is RoCam. Thank you for your time. Our code is fully open-source at the GitHub link on screen. We'd love to take your questions.

---

## Prepared Q&A — Likely Questions

**Q: Why YOLO26s instead of YOLOv8 or YOLOv11?**
A: YOLO26s offered the best throughput-to-accuracy trade-off for our hardware (Jetson Orin Nano). With the P2 head, it achieves higher mAP on micro-objects than YOLOv8-small while running faster under TensorRT FP16. We benchmarked all three.

**Q: How do you handle the case where the model loses the rocket temporarily?**
A: The control core implements a configurable hold-and-scan strategy. If detection is lost for N frames, the gimbal holds its last known heading. If lost for longer, it enters a slow spiral scan pattern centered on the last known position. This recovers tracking in the majority of cases.

**Q: What happens if the camera can't keep up with the rocket's angular velocity?**
A: At extreme close range, the angular velocity can exceed our servo's maximum slew rate. Our mitigation is to deploy at sufficient standoff distance — typically 50+ meters — where the angular rate stays within mechanical limits. The future roadmap includes larger, faster servos for close-range tracking.

**Q: What is the end-to-end latency from frame capture to servo movement?**
A: Under 16.6 milliseconds (one frame at 60fps). Frame decode on DeepStream is ~2ms, TensorRT inference ~6ms, UART transmission ~1ms, and PID+PWM write ~1ms. We verified this with oscilloscope measurements.

**Q: How did you handle version control and team coordination?**
A: We used GitHub with a feature-branch workflow, required PR reviews, and GitHub Actions CI gates. All PRs must pass the full 481-test suite and formatting checks before merge. We tracked work through GitHub Issues and documented everything in our capstone repo.

**Q: Is this system safe to use near people?**
A: Yes. The gimbal has software-defined angle limits enforced in firmware. The hardware watchdog parks the gimbal if the firmware is unresponsive. The "Disarmed" state keeps motors completely off. We performed a full hazard analysis as part of our capstone documentation.
