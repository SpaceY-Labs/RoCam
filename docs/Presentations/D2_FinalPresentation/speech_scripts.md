# RoCam Final Presentation - Speech Scripts

> **Total time**: ~23.5 minutes + 5 min Q&A
> **Remember**: Dress professionally, use the microphone, and practice with the actual devices.

---

## Slide Flow & Speaker Map

| Slide | Title | Speaker | Time |
|-------|-------|---------|------|
| 1 | Title | Jianqing | 0:25 |
| 2 | Team Photo | Jianqing | 2:00 |
| 3 | The Challenge | Jianqing | 1:20 |
| 4 | The RoCam Solution | Jianqing | 0:55 |
| 5 | LIVE DEMO | All | 5:00 |
| 6 | Computer Vision Pipeline | Mike / Xiaotian | 1:00 |
| 7 | Computer Vision Pipeline (Detection Result) | Mike | 0:30 |
| 8 | Zero-Latency Tracking | Xiaotian | 0:55 |
| 9 | Data Tooling - RoCam Labeler | Mike | 1:20 |
| 10 | Machine Learning Training | Xiaotian | 1:10 |
| 11 | Model Development Journey | Xiaotian | 0:55 |
| 12 | Fault-Tolerant Architecture | Jianqing | 0:50 |
| 13 | Modular System Architecture | Jianqing | 1:15 |
| 14 | Mission Control UI | Zifan | 1:00 |
| 15 | Recording Workflow | Zifan | 0:55 |
| 16 | Testing & Quality Assurance | Xiaotian | 1:05 |
| 17 | Project Challenges | Jianqing | 0:55 |
| 18 | Future Scalability | Zifan | 0:40 |
| 19 | Stakeholder Feedback | Zifan | 0:55 |
| 20 | Thank You | Jianqing | 0:10 |

**Total approx. 23.5 min**

---

## JIANQING LIU - Slides 1-4

### Slide 1 - Title (0:25)

Good morning, everyone. We are Team SpaceY, and this is **RoCam** - a high-performance, vision-guided rocket tracking system.

Let me quickly introduce the team. Zifan designed the web interface and operator experience. I handled the system architecture, backend, and embedded firmware. Mike built our data tooling and annotation workflow. Xiaotian led the computer vision, machine learning pipeline, and system testing.

### Slide 2 - Team Photo (0:10)

This is the team behind the project. We also worked closely with McMaster Rocketry Team and our capstone advisors, and that stakeholder feedback influenced several of the UI and recording decisions you will see later.

### Slide 3 - The Challenge (1:20)

So what problem are we solving?

Hobbyist rockets can reach **Mach 3**, and a small target can cross a telephoto frame in well under a second. At that point, manual optical tracking is not just difficult - it is physically unrealistic.

Commercial tracking rigs exist, but they often cost **well over $10,000**, which puts them out of reach for student teams and hobbyist clubs.

So our question was: can we build an autonomous optical tracker that is fast enough for real launches, reliable enough to trust in the field, and affordable enough to actually be used? We will answer that through the system overview, a live demo, then deep dives into data, CV, ML, hardware, UI, testing, and future work.

### Slide 4 - The RoCam Solution (0:55)

Our answer is RoCam - a fully autonomous, closed-loop optical tracking system.

Three design pillars matter here. First, **edge AI tracking**: YOLO plus TensorRT runs locally on a Jetson Orin Nano. Second, **high-speed control**: the STM32 firmware drives the gimbal at **60 Hz**. Third, **accessibility**: the full bill of materials stays under **$500 Canadian**, compared to commercial systems that cost an order of magnitude more.

So this is not just a cheaper copy of an existing product. It is an accessible architecture built around the constraints of hobbyist rocketry.

---

### Slide 5 - LIVE DEMO (2:45, all members)

**Jianqing**: Now let us show the full system live. This is RoCam running as a deployed system, not as a simulated demo.

*[Jianqing operates the hardware while Zifan mirrors the browser UI on screen]*

**Zifan**: On the interface, you can see the live preview, system status, and operator controls. I am going to arm the system now, and you can watch the state change in real time.

**Jianqing / Xiaotian**: Once the target enters frame, the detector locks on and the gimbal starts tracking automatically.

**Mike**: At the same time, the dashboard is updating live with telemetry such as detection confidence, frame rate, and gimbal state.

**Zifan**: I can also override the gimbal manually from the browser, then release control and return immediately to autonomous tracking.

**Jianqing**: That is the core loop - detect, track, actuate - running end to end in real time. Mike will now walk through the CV inference pipeline behind that demo.

---

## MIKE CHEN / XIAOTIAN LOU - Slides 6-8

### Slide 6 - Computer Vision Pipeline (1:00)

Thanks, Jianqing. Here is the deployed real-time inference path on the Jetson.

The flow is: **camera capture**, then GPU **letterboxing**, then **YOLO26s** in TensorRT FP16, then **best-detection selection**, then two downstream outputs - **P-control** for the gimbal and a **GL shader** for live zoom in the operator view.

We chose YOLO26s because it gave us the best deployment tradeoff on Jetson. Combined with DeepStream, the whole decode-to-inference path stays on GPU, which is how we remain inside a single-frame latency budget.

### Slide 7 - Computer Vision Pipeline (Detection Result) (0:30)

This frame shows the core challenge — the rocket occupies less than **0.1% of the image**, roughly **15×15 pixels** in a 1080p frame. Standard detectors struggle at this scale. Everything we did in training and pipeline design was driven by this constraint. Xiaotian will now show you how that tiny detection becomes perceptually instant tracking.

### Slide 8 - Zero-Latency Tracking (0:55)

The key idea here is that our camera sees more than what the operator sees on screen. So when YOLO finds the rocket, a GPU shader can crop and zoom the preview in **under one millisecond**. The operator sees the target locked right away — within one frame.

At the same time, a second path sends commands over UART to the STM32, which moves the gimbal to re-center. So the screen updates instantly, and the hardware catches up in the background. That is how we get **zero perceived latency**.

---

## MIKE CHEN - Slide 9

### Slide 9 - Data Tooling - RoCam Labeler (1:20)

The first problem in any ML project is data.

There is no public dataset of small hobby rockets at long range against realistic sky backgrounds, so we built our own annotation platform from scratch: the **RoCam Labeler**.

It gave us three core capabilities. First, **SAM-assisted annotation**, where one click can produce a segmentation mask and cut annotation time significantly. Second, **project management**, so multiple datasets can be organized and tracked cleanly. Third, **batch import and export**, so raw image archives can become YOLO-ready datasets with minimal manual overhead.

Every image that trained our final model passed through this tooling.

---

## XIAOTIAN LOU - Slides 10-11

### Slide 10 - Machine Learning Training (1:10)

Our best training accuracy was **96.2% mAP@50** on H100 GPUs. But training accuracy is not enough — what matters is how well it works after deployment. Our best-in-training model actually lost **30%** accuracy after FP16 conversion on the Jetson.

The recipe that worked has three parts. First, **full mosaic at 1.0** — every training image is a 2-by-2 grid, so the model sees four times more targets. We turn this off for the last 80 epochs to fine-tune on full images. Second, **15,000 labelled images plus 4,000 COCO negatives** — background images with no rockets, to reduce false positives. Third, **multi-scale training with seven augmentations** — blur, noise, compression — to match real-world conditions.

Result: only **9% accuracy loss** from training to Jetson. **94.3% precision**, **89.8% recall**, **60 FPS**, under **1ms shader latency**.

### Slide 11 - Model Development Journey (0:55)

This diagram shows every major direction we tried — **six different research branches**.

First, a **P2 four-head model** — it scored highest in training, but FP16 destroyed its fine features. Second, **low mosaic** at 0.15 to 0.30 — not strong enough for small targets. Third, **higher resolution** at 640 pixels — it actually needed even more augmentation to work. Fourth, **transfer learning** from a pretrained model — small target accuracy got worse. Fifth, **copy-paste augmentation** — pasting rocket patches into new backgrounds — not enough on its own. Sixth, **SAHI tiled detection** with over 50,000 tiled images — three times slower, very small gain.

The main line — strong mosaic, multi-scale, COCO negatives — was the only one that survived all the way to the Jetson. Over **100 GPU-hours**, and **one survivor**.

---

## JIANQING LIU - Slides 12-13

### Slide 12 - Fault-Tolerant Architecture (0:50)

On the Jetson, the backend is split into independent processes: **CV**, **live video**, **control core**, and **transcode**.

The reason is fault isolation. If the CV process crashes, the control core can stay alive and keep the system in a safe state instead of freezing the whole tracker. We also use **shared-memory IPC** so large 1080p frames move between processes without expensive copies.

That architecture is what lets us combine real-time performance with process-level resilience.

### Slide 13 - Modular System Architecture (1:15)

Here is the system in one slide.

The camera captures **1080p video at 60 frames per second**. The Jetson runs hardware-accelerated computer vision and extracts the target position. That target information goes over UART to our custom STM32 board, which computes control outputs for the gimbal. And finally, the operator interacts with the system through a web interface.

The important design choice is modularity. Input, processing, control, and interface are decoupled, which lets us isolate faults and restart components independently instead of taking down the whole system.

---

## ZIFAN SI - Slides 14-15

### Slide 14 - Mission Control UI (1:00)

Everything the operator touches lives in this **Mission Control** interface.

We built it with **React, TypeScript, and Vite**, but the real design goal was field usability. Before launch, the operator needs to confirm framing, arm the system, override the gimbal if necessary, and understand system health immediately.

So the UI centers on four things: **low-latency live preview**, **direct manual gimbal override**, **real-time health telemetry**, and **bilingual support** in English and French. It is not just a dashboard - it is the control surface for the whole system.

### Slide 15 - Recording Workflow (0:55)

When the operator hits record, we intentionally do **not** try to render a polished replay in the launch-time critical path.

Instead, recording is split into three steps. First, the browser triggers start and stop from Mission Control. Second, the system stores the raw camera stream in **`video.avi`** and logs per-frame telemetry in **`log.txt`**, including timestamps, pan, tilt, FPS, and stabilization transforms. Third, after the event, a separate transcode path reconstructs stabilized preview and download on demand.

That separation keeps capture lightweight during launch while still giving us a much richer replay afterward.

---

## XIAOTIAN LOU - Slide 16

### Slide 16 - Testing & Quality Assurance (1:05)

We have **481 automated tests** in total. **313 backend tests** using pytest with **88% code coverage**, and **168 frontend tests** using Vitest with **86% coverage**. Every pull request goes through GitHub Actions, and we maintain a **100% pass rate**.

This was important because we kept changing core parts of the system — the backend, the control protocol, the CV pipeline. These tests caught bugs early in CI, not during field testing. The goal was not the number — it was making sure we could keep improving without breaking things.

---

## JIANQING LIU - Slides 17-18

### Slide 17 - Project Challenges (0:55)

No capstone like this goes smoothly, so here are the three hardest problems we had to solve.

First, **real-time latency**. A single-process design was not robust enough, so we moved to multi-process shared-memory IPC. Second, **micro-object detection**. Rockets at long range are tiny, so we had to engineer the dataset, augmentation strategy, and model selection around that reality. Third, **hardware communication**. We initially saw UART reliability issues, then tightened the link with CRC-8 and protocol-level checks until it became dependable in the control loop.

These were not theoretical design choices - they were direct responses to failure modes we actually hit.

### Slide 18 - Future Scalability (0:40)

RoCam is already usable, but the architecture leaves clear room to scale.

On the vision side, we can push toward **4K capture**, **INT8 deployment**, and **autofocus**. On the hardware side, we can move to larger gimbals, multi-camera setups, and weatherproof enclosures. On the operator side, we see a path to mobile control and richer post-flight analytics.

The next concrete target is moving from hobby-scale launches to **multi-kilometer high-power events**.

---

## ZIFAN SI - Slide 19

### Slide 19 - Stakeholder Feedback (0:55)

Before we close, I want to show one example of stakeholder feedback directly shaping the product.

In walkthroughs with **McMaster Rocketry Team**, one request kept coming up: **"A more direct and intuitive way to move the gimbal."** That feedback directly led to **drag-to-move control** on the live preview.

More broadly, the feedback clustered into the three themes shown on the right: **faster framing**, **clearer operator state visibility**, and **more reliable recording behavior**. So this slide is evidence that the UI and workflow were refined with real operators, not just from our own assumptions in the lab.

---

## JIANQING LIU - Slide 20

### Slide 20 - Thank You (0:10)

That is RoCam. Thank you for your time. Our code is open-source at the GitHub link on screen, and we would be happy to take your questions.

---

## Prepared Q&A - Likely Questions

**Q: Why YOLO26s instead of YOLOv8 or another detector?**
A: YOLO26s gave us the best deployment tradeoff on the Jetson Orin Nano. It maintained stronger small-object performance while still fitting our latency budget in TensorRT FP16.

**Q: How do you get zero perceived latency if the gimbal itself is mechanical?**
A: The preview is stabilized first in the GPU shader path, which updates within about one display frame. The gimbal then catches up physically through the slower servo path. So the operator sees immediate lock even though the hardware is still moving.

**Q: Why store raw video and telemetry separately instead of saving the final replay directly?**
A: Because replay rendering is intentionally taken out of the critical launch path. Storing raw frames plus per-frame telemetry keeps capture lightweight during the event and allows stabilized preview or download to be reconstructed later.

**Q: What happens if the CV process crashes during operation?**
A: The backend is split into separate processes, so the control core can stay alive and keep the system in a safe state while CV restarts. That is the main benefit of the fault-tolerant architecture.

**Q: How did you validate the system beyond just one demo?**
A: We combined automated software testing with deployment validation. The repo currently has 481 automated tests, and the ML model was evaluated both during training and after Jetson deployment to measure the real edge performance gap.

**Q: Is the system safe to use near people?**
A: Safety is enforced at multiple levels: controlled state transitions in the UI, CRC-protected control packets, firmware watchdog behavior, and bounded servo control on the embedded side.
