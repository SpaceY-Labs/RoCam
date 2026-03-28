# RoCam Final Presentation - Speech Scripts

> **Total time**: ~20 minutes + 5 min Q&A
> **Remember**: Dress professionally, use the microphone, and practice with the actual devices.

---

## Slide Flow & Speaker Map

| Slide | Title | Speaker | Time |
|-------|-------|---------|------|
| 1 | Title | Jianqing | 0:25 |
| 2 | Team Photo | Jianqing | 0:10 |
| 3 | The Challenge | Jianqing | 1:20 |
| 4 | The RoCam Solution | Jianqing | 0:55 |
| 5 | Modular System Architecture | Jianqing | 1:15 |
| 6 | LIVE DEMO | All | 2:45 |
| 7 | Data Tooling - RoCam Labeler | Mike | 1:20 |
| 8 | Computer Vision Pipeline | Mike | 1:00 |
| 9 | Computer Vision Pipeline (Detection Result) | Mike / Xiaotian | 0:40 |
| 10 | Zero-Latency Tracking | Xiaotian | 0:55 |
| 11 | Machine Learning Training | Xiaotian | 1:10 |
| 12 | Model Development Journey | Xiaotian | 0:55 |
| 13 | Hardware & Firmware Control | Jianqing | 1:10 |
| 14 | Fault-Tolerant Architecture | Jianqing | 0:50 |
| 15 | Mission Control UI | Zifan | 1:00 |
| 16 | Recording Workflow | Zifan | 0:55 |
| 17 | Testing & Quality Assurance | Xiaotian | 1:05 |
| 18 | Project Challenges | Jianqing | 0:55 |
| 19 | Future Scalability | Jianqing | 0:40 |
| 20 | Stakeholder Feedback | Zifan | 0:55 |
| 21 | Thank You | Jianqing | 0:10 |

**Total approx. 20 min**

---

## JIANQING LIU - Slides 1-5

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

### Slide 5 - Modular System Architecture (1:15)

Before the demo, here is the system in one slide.

The camera captures **1080p video at 60 frames per second**. The Jetson runs hardware-accelerated computer vision and extracts the target position. That target information goes over UART to our custom STM32 board, which computes control outputs for the gimbal. And finally, the operator interacts with the system through a web interface.

The important design choice is modularity. Input, processing, control, and interface are decoupled, which lets us isolate faults and restart components independently instead of taking down the whole system.

---

### Slide 6 - LIVE DEMO (2:45, all members)

**Jianqing**: Now let us show the full system live. This is RoCam running as a deployed system, not as a simulated demo.

*[Jianqing operates the hardware while Zifan mirrors the browser UI on screen]*

**Zifan**: On the interface, you can see the live preview, system status, and operator controls. I am going to arm the system now, and you can watch the state change in real time.

**Jianqing / Xiaotian**: Once the target enters frame, the detector locks on and the gimbal starts tracking automatically.

**Mike**: At the same time, the dashboard is updating live with telemetry such as detection confidence, frame rate, and gimbal state.

**Zifan**: I can also override the gimbal manually from the browser, then release control and return immediately to autonomous tracking.

**Jianqing**: That is the core loop - detect, track, actuate - running end to end in real time. Mike will now walk through how we built the data and inference pipeline behind that demo.

---

## MIKE CHEN - Slides 7-9

### Slide 7 - Data Tooling - RoCam Labeler (1:20)

Thanks, Jianqing. The first problem in any ML project is data.

There is no public dataset of small hobby rockets at long range against realistic sky backgrounds, so we built our own annotation platform from scratch: the **RoCam Labeler**.

It gave us three core capabilities. First, **SAM-assisted annotation**, where one click can produce a segmentation mask and cut annotation time significantly. Second, **project management**, so multiple datasets can be organized and tracked cleanly. Third, **batch import and export**, so raw image archives can become YOLO-ready datasets with minimal manual overhead.

Every image that trained our final model passed through this tooling.

### Slide 8 - Computer Vision Pipeline (1:00)

Here is the deployed real-time inference path on the Jetson.

The flow is: **camera capture**, then GPU **letterboxing**, then **YOLO26s** in TensorRT FP16, then **best-detection selection**, then two downstream outputs - **P-control** for the gimbal and a **GL shader** for live zoom in the operator view.

We chose YOLO26s because it gave us the best deployment tradeoff on Jetson. Combined with DeepStream, the whole decode-to-inference path stays on GPU, which is how we remain inside a single-frame latency budget.

### Slide 9 - Computer Vision Pipeline (Detection Result) (0:40)

This example makes the problem concrete. The rocket is occupying less than **0.1% of the frame**, yet we still detect it at usable confidence.

That is why tiny-object robustness drove everything else in the project: how we labeled data, how we trained the model, and how we designed the tracking pipeline. I will hand it to Xiaotian to show how that detection becomes perceptually instant tracking.

---

## XIAOTIAN LOU - Slides 10-12

### Slide 10 - Zero-Latency Tracking (0:55)

The key idea here is **optical redundancy**.

We keep the camera's full field of view wider than what the operator sees. As soon as YOLO gives us a bounding box, the fast path computes translation and scale and updates the GPU shader in about a millisecond. That means the preview looks locked onto the rocket within one display frame.

In parallel, a slower path sends the correction over UART to the STM32, which drives the servos and physically re-centers the gimbal. So the operator sees instant lock while the hardware catches up in the background.

### Slide 11 - Machine Learning Training (1:10)

That deployment result came from a very data-centric training process.

Our final model was trained for **420 epochs** on H100 GPUs using data from our custom labeler. The winning recipe had three parts. First, **full mosaic at 1.0** for most of training, which increased effective rocket density. Second, **15,832 labeled images plus 4,000 COCO hard negatives**, which sharpened the boundary between rockets and background clutter. Third, **multi-scale training plus seven augmentations** to simulate real field conditions such as blur, compression, and noise.

The result was a deployed **mAP@50 of 0.875**, with only about a **9% gap** from training to Jetson FP16 deployment.

### Slide 12 - Model Development Journey (0:55)

This slide shows the part that usually gets hidden: what we tried that did **not** survive deployment.

We ran more than **10 serious experiments** over roughly **4 GPU-weeks**. Some ideas looked promising in training but degraded badly after quantization or edge deployment. The lesson was that the best-looking training curve is not enough - the architecture has to survive the Jetson.

That is why this slide ends with **one survivor**. Our final model was the branch that held up best under real deployment constraints, not just in the lab.

---

## JIANQING LIU - Slides 13-14

### Slide 13 - Hardware & Firmware Control (1:10)

Once the Jetson has a target, the embedded side takes over.

We designed a custom board around the **STM32F405**, and the firmware is written in **bare-metal Rust** using the Embassy async framework. The control loop runs at **60 Hz**. Every cycle, the board reads the latest target coordinates over UART, computes the correction, and updates the servo outputs.

We also built safety directly into the link. UART packets are protected by **CRC-8**, and a watchdog trips in under **half a second** if the firmware becomes unresponsive. So the control path is fast, deterministic, and fail-safe.

### Slide 14 - Fault-Tolerant Architecture (0:50)

On the Jetson, the backend is split into independent processes: **CV**, **live video**, **control core**, and **transcode**.

The reason is fault isolation. If the CV process crashes, the control core can stay alive and keep the system in a safe state instead of freezing the whole tracker. We also use **shared-memory IPC** so large 1080p frames move between processes without expensive copies.

That architecture is what lets us combine real-time performance with process-level resilience.

---

## ZIFAN SI - Slides 15-16

### Slide 15 - Mission Control UI (1:00)

Everything the operator touches lives in this **Mission Control** interface.

We built it with **React, TypeScript, and Vite**, but the real design goal was field usability. Before launch, the operator needs to confirm framing, arm the system, override the gimbal if necessary, and understand system health immediately.

So the UI centers on four things: **low-latency live preview**, **direct manual gimbal override**, **real-time health telemetry**, and **bilingual support** in English and French. It is not just a dashboard - it is the control surface for the whole system.

### Slide 16 - Recording Workflow (0:55)

When the operator hits record, we intentionally do **not** try to render a polished replay in the launch-time critical path.

Instead, recording is split into three steps. First, the browser triggers start and stop from Mission Control. Second, the system stores the raw camera stream in **`video.avi`** and logs per-frame telemetry in **`log.txt`**, including timestamps, pan, tilt, FPS, and stabilization transforms. Third, after the event, a separate transcode path reconstructs stabilized preview and download on demand.

That separation keeps capture lightweight during launch while still giving us a much richer replay afterward.

---

## XIAOTIAN LOU - Slide 17

### Slide 17 - Testing & Quality Assurance (1:05)

To validate the system, we built substantial automated coverage across both backend and frontend.

We currently have **481 automated tests** passing: **313 backend pytest tests** at **88% coverage**, and **168 frontend Vitest tests** at **86% coverage**. These run in GitHub Actions on every pull request.

That matters because we changed major parts of the system during the project. With this test suite, regressions were caught quickly instead of appearing during field testing. The point is not just the test count - it is that we can keep iterating without losing confidence in correctness.

---

## JIANQING LIU - Slides 18-19

### Slide 18 - Project Challenges (0:55)

No capstone like this goes smoothly, so here are the three hardest problems we had to solve.

First, **real-time latency**. A single-process design was not robust enough, so we moved to multi-process shared-memory IPC. Second, **micro-object detection**. Rockets at long range are tiny, so we had to engineer the dataset, augmentation strategy, and model selection around that reality. Third, **hardware communication**. We initially saw UART reliability issues, then tightened the link with CRC-8 and protocol-level checks until it became dependable in the control loop.

These were not theoretical design choices - they were direct responses to failure modes we actually hit.

### Slide 19 - Future Scalability (0:40)

RoCam is already usable, but the architecture leaves clear room to scale.

On the vision side, we can push toward **4K capture**, **INT8 deployment**, and **autofocus**. On the hardware side, we can move to larger gimbals, multi-camera setups, and weatherproof enclosures. On the operator side, we see a path to mobile control and richer post-flight analytics.

The next concrete target is moving from hobby-scale launches to **multi-kilometer high-power events**.

---

## ZIFAN SI - Slide 20

### Slide 20 - Stakeholder Feedback (0:55)

Before we close, I want to show one example of stakeholder feedback directly shaping the product.

In walkthroughs with **McMaster Rocketry Team**, one request kept coming up: **"A more direct and intuitive way to move the gimbal."** That feedback directly led to **drag-to-move control** on the live preview.

More broadly, the feedback clustered into the three themes shown on the right: **faster framing**, **clearer operator state visibility**, and **more reliable recording behavior**. So this slide is evidence that the UI and workflow were refined with real operators, not just from our own assumptions in the lab.

---

## JIANQING LIU - Slide 21

### Slide 21 - Thank You (0:10)

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
